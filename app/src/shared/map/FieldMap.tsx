import { useQuery } from "@tanstack/react-query";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../../api";
import type { MapTile } from "../../api/types";
import {
  Projection,
  WORLD,
  metresPerMapUnit,
  tileAt,
  tileBounds,
} from "../../waypoints/projection";

/** What layers need to draw: ground (UTM) metres ⇄ screen pixels. */
export interface MapView {
  toScreen(x: number, y: number): { x: number; y: number };
  fromScreen(sx: number, sy: number): { x: number; y: number };
  /** Screen pixels per ground metre. */
  pxPerMetre: number;
  width: number;
  height: number;
}
export interface MapPointer {
  /** Ground coordinates (project CRS). */
  x: number;
  y: number;
  /** Screen coordinates inside the map. */
  sx: number;
  sy: number;
  event: React.PointerEvent<SVGSVGElement>;
}
export interface FieldMapHandle {
  fit(points: [number, number][], padding?: number): void;
  centreOn(x: number, y: number): void;
  view(): MapView | null;
}
interface Camera {
  cx: number;
  cy: number;
  /** Mercator metres per screen pixel. */
  res: number;
}
type Props = {
  crs: string;
  /** Fitted on first layout and whenever `fitKey` changes. */
  fit: [number, number][];
  fitKey?: string | number;
  children: (view: MapView) => ReactNode;
  /** HTML drawn above the map (toolbars, legends). */
  overlay?: ReactNode;
  /** Return true when the layer handled the press; otherwise the map pans. */
  onPointerDown?: (p: MapPointer) => boolean | void;
  onPointerMove?: (p: MapPointer) => void;
  onPointerUp?: (p: MapPointer) => void;
  /** A press that was not handled and did not pan (a click on empty map). */
  onBackgroundClick?: (p: MapPointer) => void;
  cursor?: string;
  label: string;
  className?: string;
};

const TILE_PX = 256;
function niceLength(metres: number) {
  const steps = [1, 2, 5];
  let best = 1;
  for (let e = -1; e < 6; e++)
    for (const s of steps) {
      const v = s * 10 ** e;
      if (v <= metres) best = v;
    }
  return best;
}

export const FieldMap = forwardRef<FieldMapHandle, Props>(function FieldMap(
  {
    crs,
    fit,
    fitKey,
    children,
    overlay,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onBackgroundClick,
    cursor,
    label,
    className,
  },
  ref,
) {
  const box = useRef<HTMLDivElement>(null),
    [size, setSize] = useState({ width: 0, height: 0 }),
    [camera, setCamera] = useState<Camera | null>(null),
    pan = useRef<{ sx: number; sy: number; camera: Camera } | null>(null);
  const projection = useMemo(() => {
    try {
      return new Projection(crs);
    } catch {
      return new Projection("EPSG:32632");
    }
  }, [crs]);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({
        width: Math.round(e.contentRect.width),
        height: Math.round(e.contentRect.height),
      }),
    );
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const fitTo = useCallback(
    (points: [number, number][], padding = 40) => {
      if (!size.width || !size.height) return;
      const finite = points.filter(([x, y]) => Number.isFinite(x + y));
      if (!finite.length) {
        // Somewhere sensible: Ås, where the robot lives.
        const m = projection.toMap(599250, 6615300);
        setCamera({ cx: m.mx, cy: m.my, res: 0.5 });
        return;
      }
      const ms = finite.map(([x, y]) => projection.toMap(x, y)),
        minX = Math.min(...ms.map((m) => m.mx)),
        maxX = Math.max(...ms.map((m) => m.mx)),
        minY = Math.min(...ms.map((m) => m.my)),
        maxY = Math.max(...ms.map((m) => m.my));
      const res = Math.max(
        (maxX - minX) / Math.max(1, size.width - 2 * padding),
        (maxY - minY) / Math.max(1, size.height - 2 * padding),
        0.02,
      );
      setCamera({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, res });
    },
    [projection, size.width, size.height],
  );
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    if (size.width && size.height) fitTo(fitRef.current);
    // Refit only for a new subject or the first real size, not every render.
  }, [fitKey, crs, size.width > 0 && size.height > 0]);
  const view: MapView | null = useMemo(() => {
    if (!camera || !size.width) return null;
    const { cx, cy, res } = camera,
      w = size.width,
      h = size.height;
    return {
      width: w,
      height: h,
      pxPerMetre: 1 / (res * metresPerMapUnit(cy)),
      toScreen: (x, y) => {
        const m = projection.toMap(x, y);
        return { x: (m.mx - cx) / res + w / 2, y: (cy - m.my) / res + h / 2 };
      },
      fromScreen: (sx, sy) =>
        projection.fromMap(cx + (sx - w / 2) * res, cy - (sy - h / 2) * res),
    };
  }, [camera, size, projection]);
  useImperativeHandle(
    ref,
    () => ({
      fit: fitTo,
      centreOn: (x, y) => {
        const m = projection.toMap(x, y);
        setCamera((c) => (c ? { ...c, cx: m.mx, cy: m.my } : c));
      },
      view: () => view,
    }),
    [fitTo, projection, view],
  );
  // Wheel zoom around the cursor; registered natively so it can prevent scrolling.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(),
        sx = e.clientX - r.left,
        sy = e.clientY - r.top;
      setCamera((c) => {
        if (!c) return c;
        const factor = Math.pow(1.0015, e.deltaY),
          res = Math.min(2000, Math.max(0.005, c.res * factor)),
          mx = c.cx + (sx - r.width / 2) * c.res,
          my = c.cy - (sy - r.height / 2) * c.res;
        return {
          res,
          cx: mx - (sx - r.width / 2) * res,
          cy: my + (sy - r.height / 2) * res,
        };
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const pointer = (e: React.PointerEvent<SVGSVGElement>): MapPointer | null => {
    if (!view) return null;
    const r = e.currentTarget.getBoundingClientRect(),
      sx = e.clientX - r.left,
      sy = e.clientY - r.top;
    return { ...view.fromScreen(sx, sy), sx, sy, event: e };
  };
  // Imagery from the user's local XYZ folder (desktop app only).
  const tiles = useQuery({
    queryKey: ["mapTiles"],
    queryFn: () => api.mapTilesGet(),
    staleTime: Infinity,
  });
  const tileList = useMemo(() => {
    const levels = tiles.data?.levels;
    if (!camera || !levels?.length || !size.width) return [];
    const ideal = Math.round(Math.log2(WORLD / (TILE_PX * camera.res))),
      z = Math.max(levels[0], Math.min(levels[levels.length - 1], ideal)),
      a = tileAt(
        camera.cx - (size.width / 2) * camera.res,
        camera.cy + (size.height / 2) * camera.res,
        z,
      ),
      b = tileAt(
        camera.cx + (size.width / 2) * camera.res,
        camera.cy - (size.height / 2) * camera.res,
        z,
      );
    if ((b.x - a.x + 1) * (b.y - a.y + 1) > 120) return [];
    const out: { z: number; x: number; y: number }[] = [];
    for (let x = a.x; x <= b.x; x++)
      for (let y = a.y; y <= b.y; y++) out.push({ z, x, y });
    return out;
  }, [camera, size, tiles.data]);
  const tileImages = useTileCache(tileList, !!tiles.data);
  const grid = useMemo(() => {
    if (!view) return [];
    // A light ground grid (project CRS), spaced for roughly 60–150 px.
    const step = niceLength(120 / view.pxPerMetre);
    const a = view.fromScreen(0, view.height),
      b = view.fromScreen(view.width, 0),
      c = view.fromScreen(0, 0),
      d = view.fromScreen(view.width, view.height);
    const minX = Math.min(a.x, b.x, c.x, d.x),
      maxX = Math.max(a.x, b.x, c.x, d.x),
      minY = Math.min(a.y, b.y, c.y, d.y),
      maxY = Math.max(a.y, b.y, c.y, d.y);
    if ((maxX - minX) / step > 80 || (maxY - minY) / step > 80) return [];
    const lines: { p: { x: number; y: number }[] }[] = [];
    for (let x = Math.floor(minX / step) * step; x <= maxX; x += step)
      lines.push({ p: [view.toScreen(x, minY), view.toScreen(x, maxY)] });
    for (let y = Math.floor(minY / step) * step; y <= maxY; y += step)
      lines.push({ p: [view.toScreen(minX, y), view.toScreen(maxX, y)] });
    return lines;
  }, [view]);
  const scale = view ? niceLength(110 / view.pxPerMetre) : 0;
  return (
    <div
      ref={box}
      className={"field-map " + (className ?? "")}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg
        role="img"
        aria-label={label}
        width={size.width}
        height={size.height}
        style={{ cursor: pan.current ? "grabbing" : (cursor ?? "grab") }}
        onPointerDown={(e) => {
          const p = pointer(e);
          if (!p || !camera) return;
          const handled =
            e.button === 0 && onPointerDown ? onPointerDown(p) : false;
          // Unhandled presses and right/middle drags pan the map.
          if (!handled) pan.current = { sx: e.clientX, sy: e.clientY, camera };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (pan.current) {
            const { sx, sy, camera: c } = pan.current;
            setCamera({
              ...c,
              cx: c.cx - (e.clientX - sx) * c.res,
              cy: c.cy + (e.clientY - sy) * c.res,
            });
            return;
          }
          const p = pointer(e);
          if (p) onPointerMove?.(p);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          if (pan.current) {
            const still =
              Math.hypot(
                e.clientX - pan.current.sx,
                e.clientY - pan.current.sy,
              ) < 4;
            pan.current = null;
            if (still && e.button === 0) {
              const p = pointer(e);
              if (p) onBackgroundClick?.(p);
            }
            return;
          }
          const p = pointer(e);
          if (p) onPointerUp?.(p);
        }}
      >
        {camera &&
          tileList.map((t) => {
            const img = tileImages.get(t.z + "/" + t.x + "/" + t.y);
            if (!img) return null;
            const b = tileBounds(t.z, t.x, t.y),
              x = (b.minX - camera.cx) / camera.res + size.width / 2,
              y = (camera.cy - b.maxY) / camera.res + size.height / 2,
              w = (b.maxX - b.minX) / camera.res,
              part = TILE_PX / img.factor;
            return (
              <svg
                key={t.z + "/" + t.x + "/" + t.y}
                x={x}
                y={y}
                width={w + 0.5}
                height={w + 0.5}
                viewBox={`${img.dx * part} ${img.dy * part} ${part} ${part}`}
                preserveAspectRatio="none"
                className="map-tile"
              >
                <image href={img.data} width={TILE_PX} height={TILE_PX} />
              </svg>
            );
          })}
        <g className="map-grid">
          {grid.map((l, i) => (
            <line
              key={i}
              x1={l.p[0].x}
              y1={l.p[0].y}
              x2={l.p[1].x}
              y2={l.p[1].y}
            />
          ))}
        </g>
        {view && children(view)}
      </svg>
      {view && (
        <div className="map-scale" aria-label="Scale">
          <span style={{ width: scale * view.pxPerMetre }} />
          {scale >= 1000 ? scale / 1000 + " km" : scale + " m"}
        </div>
      )}
      <div className="map-north" title="North is up (Web Mercator)">
        ↑ N{tiles.data ? " · local imagery" : ""}
      </div>
      {overlay}
    </div>
  );
});

/** Fetches visible tiles once each, a few at a time, and keeps them. */
function useTileCache(
  wanted: { z: number; x: number; y: number }[],
  enabled: boolean,
) {
  const cache = useRef(new Map<string, MapTile | null>()),
    pending = useRef(new Set<string>()),
    [, bump] = useState(0);
  useEffect(() => {
    if (!enabled) {
      cache.current.clear();
      return;
    }
    let cancelled = false;
    const todo = wanted.filter((t) => {
      const k = t.z + "/" + t.x + "/" + t.y;
      return !cache.current.has(k) && !pending.current.has(k);
    });
    const run = async () => {
      while (todo.length && !cancelled) {
        const t = todo.shift()!,
          k = t.z + "/" + t.x + "/" + t.y;
        pending.current.add(k);
        try {
          cache.current.set(k, await api.mapTile(t.z, t.x, t.y));
        } catch {
          cache.current.set(k, null);
        } finally {
          pending.current.delete(k);
        }
        if (!cancelled) bump((n) => n + 1);
      }
    };
    void Promise.all([run(), run(), run(), run()]);
    if (cache.current.size > 600) cache.current.clear();
    return () => {
      cancelled = true;
    };
  }, [wanted, enabled]);
  return cache.current;
}
