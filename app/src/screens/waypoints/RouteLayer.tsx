import type { PlotProposal } from "../../api/types";
import type { MapView } from "../../shared/map/FieldMap";
import { chambers } from "../../waypoints/geometry";
import { glyphs, labelBoxes } from "../../waypoints/labels";
import type { EditorPoint } from "../../waypoints/types";

export const KIND_COLOURS: Record<EditorPoint["kind"], string> = {
  Measure: "#3fcf98",
  DriveThrough: "#4aa3f0",
  TurningPoint: "#f2a541",
  Stop: "#f0648a",
};
export interface Layers {
  labels: boolean;
  route: boolean;
  headings: boolean;
  chambers: boolean;
  plots: boolean;
}
/** Screen distance of the heading/group rotation handle. */
export const HANDLE_PX = 46;

export function RouteLayer({
  view,
  points,
  selected,
  layers,
  proposal,
  box,
  rotation,
}: {
  view: MapView;
  points: EditorPoint[];
  selected: ReadonlySet<string>;
  layers: Layers;
  proposal: PlotProposal | undefined;
  box: { x: number; y: number; width: number; height: number } | null;
  /** Where the rotation handle is drawn, or null when rotation is unavailable. */
  rotation: {
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null;
}) {
  const screen = points.map((p) => view.toScreen(p.x, p.y));
  // Overview: compact markers; zooming in reveals larger rings for earlier
  // overlapping entries so stacked revisits stay clickable.
  const detail = Math.min(1, Math.max(0, (view.pxPerMetre - 3) / 12));
  const items = glyphs(
    points.map((p, i) => ({
      uid: p.uid,
      name: p.name,
      x: screen[i].x,
      y: screen[i].y,
      vector: headingVector(view, p),
    })),
    detail,
  );
  const labels = layers.labels
    ? labelBoxes(items, {
        textWidth: (t) => t.length * 6.1,
        height: 13,
        viewport: { x: 0, y: 0, width: view.width, height: view.height },
        preferred: selected,
      })
    : new Map();
  const polygon = (corners: [number, number][]) =>
    corners
      .map(([x, y]) => {
        const s = view.toScreen(x, y);
        return s.x + "," + s.y;
      })
      .join(" ");
  return (
    <g className="route-layer">
      {layers.plots &&
        proposal?.plots.map((p) => {
          const c = view.toScreen(p.x, p.y);
          return (
            <g key={p.key} className="proposal-plot">
              <polygon points={polygon(p.polygon)} />
              {view.pxPerMetre > 4 && (
                <text
                  x={c.x}
                  y={c.y + 3}
                  textAnchor="middle"
                  className="map-label"
                >
                  {p.label}
                  {p.visits.length > 1 ? " ×" + p.visits.length : ""}
                </text>
              )}
            </g>
          );
        })}
      {layers.route && (
        <polyline
          className="route-line"
          points={screen.map((s) => s.x + "," + s.y).join(" ")}
        />
      )}
      {layers.chambers &&
        chambers(points).map((c, i) => {
          const s = view.toScreen(c.x, c.y);
          return (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={Math.max(2.5, Math.min(6, view.pxPerMetre * 0.25))}
              className={"chamber " + c.side}
            />
          );
        })}
      {items.map((g) => {
        const p = points[g.index],
          on = selected.has(p.uid),
          colour = KIND_COLOURS[p.kind];
        return (
          <g key={p.uid} data-uid={p.uid} className="waypoint-glyph">
            {layers.headings && (
              <line
                x1={g.position.x}
                y1={g.position.y}
                x2={g.arrowEnd.x}
                y2={g.arrowEnd.y}
                stroke={colour}
                strokeWidth={g.arrowWidth}
                markerEnd="url(#wp-arrow)"
              />
            )}
            <circle
              cx={g.position.x}
              cy={g.position.y}
              r={g.radius}
              fill={colour}
              stroke={on ? "#fff" : "rgba(10,20,25,.75)"}
              strokeWidth={on ? 3 : 1.5}
            />
          </g>
        );
      })}
      {items.map((g) => {
        const b = labels.get(g.uid);
        if (!b) return null;
        const p = points[g.index];
        return (
          <g key={"l" + p.uid} data-uid={p.uid} className="waypoint-tag">
            <line
              x1={g.position.x + g.radius}
              y1={g.position.y}
              x2={b.x}
              y2={b.y + b.height / 2}
            />
            <rect
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
              rx={4}
              className={selected.has(p.uid) ? "on" : ""}
            />
            <text x={b.x + 7} y={b.y + b.height / 2 + 4}>
              {g.index + 1} · {p.name}
            </text>
          </g>
        );
      })}
      {rotation && (
        <g data-handle="rotate" className="rotate-handle">
          <line
            x1={rotation.from.x}
            y1={rotation.from.y}
            x2={rotation.to.x}
            y2={rotation.to.y}
          />
          <circle cx={rotation.to.x} cy={rotation.to.y} r={7} />
        </g>
      )}
      {box && (
        <rect
          className="selection-box"
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
        />
      )}
      <defs>
        <marker
          id="wp-arrow"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
      </defs>
    </g>
  );
}
/** Screen-space unit vector of a waypoint heading (grid angle → screen). */
export function headingVector(
  view: MapView,
  p: { x: number; y: number; angle: number },
) {
  const a = view.toScreen(p.x, p.y),
    b = view.toScreen(p.x + Math.cos(p.angle), p.y + Math.sin(p.angle)),
    len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}
