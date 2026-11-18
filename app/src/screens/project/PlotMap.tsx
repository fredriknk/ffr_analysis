import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api } from "../../api";
import type { FluxRow, Layout, Plot } from "../../api/types";
import { error, pickRoute, significant } from "../../shared/common";
import {
  FieldMap,
  type FieldMapHandle,
  type MapPointer,
  type MapView,
} from "../../shared/map/FieldMap";
import { useStore } from "../../store";
import type { XY } from "../../waypoints/geometry";
import {
  centroid,
  plotSize,
  positioned,
  renumberPlots,
  reshapePlots,
  routeTravelAngle,
  type Corner,
  type Numbering,
  type PlotShape,
  type Shape,
} from "./plotTools";

const UNASSIGNED = "#8a99a6";
const count = (selected: number, all: number) =>
  selected
    ? selected + " selected plot" + (selected === 1 ? "" : "s")
    : "all " + all + " plots";

const cornerName = (c: Corner) => c.replace(/([A-Z])/, " $1").toLowerCase();
/** Plain-language numbering: "Starts top right, goes down, next column to
 *  the left." */
function describe(o: Numbering) {
  const top = o.corner.startsWith("top"),
    left = o.corner.endsWith("Left"),
    vertical = top ? "down" : "up",
    sideways = left ? "right" : "left";
  const goes = o.by === "rows" ? sideways : vertical,
    next =
      o.by === "rows"
        ? "next row " + vertical
        : "next column to the " + sideways;
  return (
    "Starts " +
    cornerName(o.corner) +
    ", goes " +
    goes +
    ", " +
    next +
    (o.snake ? ", turning back each time." : ".")
  );
}

/** The project's field: plots, measured chamber positions and the route. */
export function PlotMap({
  layout,
  crs,
  rows,
  onChange,
  hasLayoutHistory,
  dirty,
  saving,
  onSave,
  onDiscard,
  locked,
}: {
  /** Locked projects can be looked at and selected, not edited. */
  locked: boolean;
  layout: Layout;
  crs: string;
  rows: FluxRow[] | undefined;
  onChange: (l: Layout) => void;
  hasLayoutHistory: boolean;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const store = useStore(),
    map = useRef<FieldMapHandle>(null),
    canvas = useRef<HTMLDivElement>(null),
    route = useQuery({ queryKey: ["route"], queryFn: () => api.getRoute() }),
    [selected, setSelected] = useState<Set<number>>(new Set()),
    [drag, setDrag] = useState<{
      start: XY;
      sx: number;
      sy: number;
      ids: Set<number>;
      offset: XY;
      moved: boolean;
      /** Plain click on an already selected plot: select only it on release. */
      only: number | null;
    } | null>(null),
    [box, setBox] = useState<{
      sx: number;
      sy: number;
      ex: number;
      ey: number;
      add: boolean;
    } | null>(null),
    [layers, setLayers] = useState({
      labels: true,
      chambers: true,
      route: true,
    }),
    [shape, setShape] = useState<PlotShape>({
      shape: "rectangle",
      size: 3,
      width: 2,
      height: 4,
      angle: null,
    }),
    [naming, setNaming] = useState<Numbering>({
      prefix: "P",
      start: 1,
      corner: "topLeft",
      by: "rows",
      snake: false,
    });
  const colour = useMemo(
    () => new Map(layout.treatments.map((t) => [t.id, t.colour])),
    [layout.treatments],
  );
  const placed = positioned(layout.plots),
    unplaced = layout.plots.length - placed.length;
  // One dot per measured chamber position (rounded to 10 cm).
  const chambers = useMemo(() => {
    const byPos = new Map<
      string,
      { x: number; y: number; n: number; lost: number }
    >();
    for (const r of rows ?? []) {
      if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || (!r.x && !r.y))
        continue;
      const k = r.x.toFixed(1) + "," + r.y.toFixed(1),
        c = byPos.get(k) ?? { x: r.x, y: r.y, n: 0, lost: 0 };
      c.n++;
      if (!r.plotId) c.lost++;
      byPos.set(k, c);
    }
    return [...byPos.values()];
  }, [rows]);
  const fluxCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows ?? []) m.set(r.plotId, (m.get(r.plotId) ?? 0) + 1);
    return m;
  }, [rows]);
  const lost = chambers.reduce((n, c) => n + c.lost, 0);
  const fit = useMemo<[number, number][]>(
    () =>
      placed.length
        ? placed.flatMap((p) => p.polygon)
        : chambers.length
          ? chambers.map((c) => [c.x, c.y])
          : (route.data?.points.map((p) => [p.x, p.y] as [number, number]) ??
            []),
    [placed.length > 0, chambers.length > 0, route.data],
  );
  const sel = layout.plots.filter((p) => selected.has(p.id)),
    one = sel.length === 1 ? sel[0] : null;
  const update = (f: (p: Plot) => Plot) =>
    onChange({
      ...layout,
      plots: layout.plots.map((p) => (selected.has(p.id) ? f(p) : p)),
    });

  function down(p: MapPointer) {
    canvas.current?.focus({ preventScroll: true });
    const e = p.event,
      hit = (e.target as Element).closest("[data-plot]"),
      additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!hit) {
      if (!e.shiftKey) return false;
      setBox({
        sx: p.sx,
        sy: p.sy,
        ex: p.sx,
        ey: p.sy,
        add: e.ctrlKey || e.metaKey,
      });
      return true;
    }
    const id = Number(hit.getAttribute("data-plot"));
    if (additive) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
      return true;
    }
    const next = selected.has(id) && !locked ? selected : new Set([id]);
    setSelected(next);
    if (!locked)
      setDrag({
        start: { x: p.x, y: p.y },
        sx: p.sx,
        sy: p.sy,
        ids: next,
        offset: { x: 0, y: 0 },
        moved: false,
        only: next.size > 1 ? id : null,
      });
    return true;
  }
  function move(p: MapPointer) {
    if (box) {
      setBox({ ...box, ex: p.sx, ey: p.sy });
      return;
    }
    if (!drag || locked) return;
    const moved = drag.moved || Math.hypot(p.sx - drag.sx, p.sy - drag.sy) > 3;
    if (moved)
      setDrag({
        ...drag,
        moved,
        offset: { x: p.x - drag.start.x, y: p.y - drag.start.y },
      });
  }
  function up(p: MapPointer) {
    if (box) {
      const view = map.current?.view(),
        [x0, x1] = [box.sx, p.sx].sort((a, b) => a - b),
        [y0, y1] = [box.sy, p.sy].sort((a, b) => a - b);
      if (view && x1 - x0 + y1 - y0 > 4) {
        const inside = positioned(layout.plots)
          .filter((q) => {
            const c = centroid(q.polygon),
              s = view.toScreen(c.x, c.y);
            return s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
          })
          .map((q) => q.id);
        setSelected(new Set([...(box.add ? selected : []), ...inside]));
      } else if (!box.add) setSelected(new Set());
      setBox(null);
      return;
    }
    if (drag?.moved && !locked) {
      const dx = p.x - drag.start.x,
        dy = p.y - drag.start.y;
      onChange({
        ...layout,
        plots: layout.plots.map((q) =>
          drag.ids.has(q.id) && q.polygon
            ? { ...q, polygon: q.polygon.map(([x, y]) => [x + dx, y + dy]) }
            : q,
        ),
      });
    } else if (drag?.only != null) setSelected(new Set([drag.only]));
    setDrag(null);
  }
  async function loadRoute() {
    const path = await pickRoute();
    if (!path) return;
    const points = await api.waypointsRead(path);
    store.set({ routeRequest: { points, sourcePath: path, plots: true } });
    store.nav("Waypoints");
  }
  const num = (
    value: number,
    set: (v: number) => void,
    label: string,
    step = "0.1",
  ) => (
    <input
      type="number"
      min={step === "1" ? undefined : "0.1"}
      step={step}
      aria-label={label}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && (step === "1" || v > 0)) set(v);
      }}
    />
  );
  const sizes = [
      ...new Set(
        positioned(sel).map((p) =>
          plotSize(p.polygon)
            .map((v) => significant(v, 3))
            .join(" × "),
        ),
      ),
    ],
    currentSize =
      sizes.length === 1
        ? sizes[0] + " m"
        : sizes.length > 1
          ? "mixed sizes"
          : null;
  const scope = sel.length ? selected : new Set(layout.plots.map((p) => p.id));
  const maximizing = shape.shape === "maximize";

  return (
    <div className="plot-map">
      <div className="plot-map-main">
        <div className="wp-toolbar plot-map-toolbar">
          <button onClick={() => void loadRoute().catch(error)}>
            Load waypoint list…
          </button>
          {route.data && (
            <button
              title="Open the route stored with this project in the waypoint editor"
              onClick={() => {
                store.set({
                  routeRequest: {
                    points: route.data!.points,
                    sourcePath: route.data!.sourcePath,
                    plots: true,
                  },
                });
                store.nav("Waypoints");
              }}
            >
              Edit route
            </button>
          )}
          <span className="sep" />
          <button
            title="Fit the field (F)"
            onClick={() => map.current?.fit(fit)}
          >
            Fit
          </button>
          {(["labels", "chambers", "route"] as const).map((k) => (
            <label key={k} className="check">
              <input
                type="checkbox"
                checked={layers[k]}
                onChange={(e) =>
                  setLayers({ ...layers, [k]: e.target.checked })
                }
              />
              {k === "chambers"
                ? "Measurements"
                : k[0].toUpperCase() + k.slice(1)}
            </label>
          ))}
          {hasLayoutHistory && (
            <span className="plot-map-dirty">
              {dirty ? "Unsaved layout changes" : "Layout edits undone"}
              <button
                className="primary"
                disabled={!dirty || saving}
                onClick={onSave}
              >
                Save
              </button>
              <button disabled={saving} onClick={onDiscard}>
                Discard
              </button>
            </span>
          )}
        </div>
        <div
          className="plot-map-canvas"
          ref={canvas}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSelected(new Set());
            if (e.key.toLowerCase() === "f") map.current?.fit(fit);
            if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              setSelected(new Set(layout.plots.map((p) => p.id)));
            }
          }}
        >
          <FieldMap
            ref={map}
            crs={crs}
            fit={fit}
            fitKey={layout.plots.length + ":" + placed.length}
            label="Field plot map"
            cursor={drag?.moved ? "grabbing" : box ? "crosshair" : undefined}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onBackgroundClick={(p) => {
              if (!(p.event.ctrlKey || p.event.metaKey)) setSelected(new Set());
            }}
          >
            {(view) => (
              <PlotLayer
                view={view}
                layout={layout}
                colour={colour}
                selected={selected}
                drag={drag?.moved ? drag : null}
                layers={layers}
                chambers={chambers}
                route={route.data?.points ?? null}
                box={box}
              />
            )}
          </FieldMap>
        </div>
        <p className="muted small plot-map-legend">
          {placed.length} of {layout.plots.length} plots on the map
          {unplaced > 0 && " · " + unplaced + " have no position"}
          {chambers.length > 0 &&
            " · " + chambers.length + " measured chamber positions"}
          {lost > 0 && (
            <span className="warn-text">
              {" "}
              · {lost} fluxes fall outside every plot
            </span>
          )}
        </p>
        <p className="muted small plot-map-legend">
          Click to select. Shift-click or Ctrl-click to add or remove.
          Shift-drag on empty map to box-select, or hold Ctrl as well to add.
          Click empty map or press Esc to clear.
          {!locked &&
            " Drag plots to move them. Ctrl+Z / Ctrl+Y undo and redo."}
        </p>
      </div>
      <aside className="plot-map-side">
        <section className="wp-section">
          <div className="plot-select-head">
            <h3>
              {one
                ? "Plot " + one.label
                : sel.length
                  ? sel.length + " plots selected"
                  : "No plot selected"}
            </h3>
            <button
              disabled={sel.length === layout.plots.length}
              onClick={() =>
                setSelected(new Set(layout.plots.map((p) => p.id)))
              }
            >
              All
            </button>
            <button
              disabled={!sel.length}
              onClick={() => setSelected(new Set())}
            >
              None
            </button>
          </div>
          {locked && (
            <p className="muted small">
              The project is locked. Unlock it at the top of the page to edit
              plots.
            </p>
          )}
          {!sel.length && (
            <p className="muted small">
              Select plots on the map to name them, set treatment or block, or
              change their size. Ctrl+A selects all.
            </p>
          )}
          {sel.length > 0 && (
            <fieldset className="wp-form plain-fieldset" disabled={locked}>
              {one && (
                <label>
                  Label
                  <input
                    aria-label="Selected plot label"
                    value={one.label}
                    onChange={(e) =>
                      update((p) => ({ ...p, label: e.target.value }))
                    }
                  />
                </label>
              )}
              <label>
                Treatment
                <select
                  aria-label="Selected plot treatment"
                  value={
                    sel.every((p) => p.treatmentId === sel[0].treatmentId)
                      ? sel[0].treatmentId
                      : ""
                  }
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      treatmentId: Number(e.target.value),
                    }))
                  }
                >
                  {!sel.every((p) => p.treatmentId === sel[0].treatmentId) && (
                    <option value="">Mixed</option>
                  )}
                  {layout.treatments.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Block
                <input
                  type="number"
                  step="1"
                  aria-label="Selected plot block"
                  value={
                    sel.every((p) => p.block === sel[0].block)
                      ? sel[0].block
                      : ""
                  }
                  placeholder="mixed"
                  onChange={(e) => {
                    if (e.target.value === "") return;
                    const b = Math.round(Number(e.target.value));
                    if (Number.isFinite(b)) update((p) => ({ ...p, block: b }));
                  }}
                />
              </label>
              <p className="muted small">
                {sel.reduce((n, p) => n + (fluxCount.get(p.id) ?? 0), 0)} fluxes
                {one?.waypoints?.length
                  ? " · waypoints " +
                    one.waypoints
                      .map((w) => w.waypoint + " " + w.side)
                      .join(", ")
                  : ""}
              </p>
              <button
                onClick={() => {
                  const ps = sel.flatMap((p) => p.polygon ?? []);
                  if (ps.length) map.current?.fit(ps, 120);
                }}
              >
                Zoom to selection
              </button>
            </fieldset>
          )}
        </section>
        <fieldset className="plain-fieldset plot-tools" disabled={locked}>
          <section className="wp-section">
            <h3>Plot size</h3>
            <div className="wp-form">
              <label>
                Shape
                <select
                  aria-label="New plot shape"
                  value={shape.shape}
                  onChange={(e) =>
                    setShape({
                      ...shape,
                      shape: e.target.value as Shape,
                      angle:
                        maximizing === (e.target.value === "maximize")
                          ? shape.angle
                          : null,
                    })
                  }
                >
                  <option value="rectangle">Rectangle</option>
                  <option value="square">Square</option>
                  <option value="auto">Auto square (touching)</option>
                  <option value="maximize">Maximize</option>
                </select>
              </label>
              {shape.shape === "square" && (
                <label>
                  Side · m{" "}
                  {num(
                    shape.size,
                    (size) => setShape({ ...shape, size }),
                    "Square side",
                  )}
                </label>
              )}
              {shape.shape === "rectangle" && (
                <>
                  <label>
                    Width · m{" "}
                    {num(
                      shape.width,
                      (width) => setShape({ ...shape, width }),
                      "Plot width",
                    )}
                  </label>
                  <label>
                    Length · m{" "}
                    {num(
                      shape.height,
                      (height) => setShape({ ...shape, height }),
                      "Plot length",
                    )}
                  </label>
                </>
              )}
              <label>
                {maximizing ? "Travel direction" : "Direction"} · °
                <input
                  type="number"
                  step="0.5"
                  aria-label="Plot direction degrees"
                  placeholder={maximizing ? "auto" : "keep current"}
                  value={
                    shape.angle === null
                      ? ""
                      : Math.round(((shape.angle * 180) / Math.PI) * 100) / 100
                  }
                  onChange={(e) =>
                    setShape({
                      ...shape,
                      angle:
                        e.target.value === ""
                          ? null
                          : (Number(e.target.value) * Math.PI) / 180,
                    })
                  }
                />
              </label>
            </div>
            <p className="muted small">
              {maximizing
                ? "Extend along travel until a neighbour touches, keeping the current width."
                : "Width runs along each plot's first side, length across it."}
              {currentSize && " Selected: " + currentSize + "."}
            </p>
            <button
              disabled={!placed.length}
              onClick={() =>
                onChange({
                  ...layout,
                  plots: reshapePlots(
                    layout.plots,
                    scope,
                    shape,
                    routeTravelAngle(route.data?.points ?? []),
                  ),
                })
              }
            >
              Resize {count(sel.length, placed.length)}
            </button>
          </section>
          <section className="wp-section">
            <h3>Names</h3>
            <div className="wp-form">
              <label>
                Prefix
                <input
                  aria-label="Plot name prefix"
                  value={naming.prefix}
                  onChange={(e) =>
                    setNaming({ ...naming, prefix: e.target.value })
                  }
                />
              </label>
              <label>
                First number{" "}
                {num(
                  naming.start,
                  (start) => setNaming({ ...naming, start }),
                  "First plot number",
                  "1",
                )}
              </label>
              <label>
                Fill
                <select
                  aria-label="Plot numbering direction"
                  value={naming.by}
                  onChange={(e) =>
                    setNaming({
                      ...naming,
                      by: e.target.value as Numbering["by"],
                    })
                  }
                >
                  <option value="rows">Rows</option>
                  <option value="columns">Columns</option>
                  <option value="list">Current order</option>
                </select>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={naming.snake}
                  disabled={naming.by === "list"}
                  onChange={(e) =>
                    setNaming({ ...naming, snake: e.target.checked })
                  }
                />
                Snake
              </label>
            </div>
            {naming.by !== "list" && (
              <div
                className="corner-pick"
                role="group"
                aria-label="Number 1 starts in"
              >
                <span className="muted small">Number {naming.start} in</span>
                <div>
                  {(
                    [
                      ["topLeft", "\u2196"],
                      ["topRight", "\u2197"],
                      ["bottomLeft", "\u2199"],
                      ["bottomRight", "\u2198"],
                    ] as [Corner, string][]
                  ).map(([c, arrow]) => (
                    <button
                      key={c}
                      className={naming.corner === c ? "on" : ""}
                      aria-pressed={naming.corner === c}
                      aria-label={"Start " + cornerName(c)}
                      title={"Start " + cornerName(c)}
                      onClick={() => setNaming({ ...naming, corner: c })}
                    >
                      {arrow}
                    </button>
                  ))}
                </div>
                <span className="muted small">{describe(naming)}</span>
              </div>
            )}
            <button
              disabled={!layout.plots.length}
              onClick={() =>
                onChange({
                  ...layout,
                  plots: renumberPlots(layout.plots, scope, naming),
                })
              }
            >
              Rename {count(sel.length, layout.plots.length)}
            </button>
          </section>
        </fieldset>
      </aside>
    </div>
  );
}

function PlotLayer({
  view,
  layout,
  colour,
  selected,
  drag,
  layers,
  chambers,
  route,
  box,
}: {
  box: { sx: number; sy: number; ex: number; ey: number } | null;
  view: MapView;
  layout: Layout;
  colour: Map<number, string>;
  selected: ReadonlySet<number>;
  drag: { ids: Set<number>; offset: XY } | null;
  layers: { labels: boolean; chambers: boolean; route: boolean };
  chambers: { x: number; y: number; n: number; lost: number }[];
  route: { x: number; y: number }[] | null;
}) {
  const points = (corners: [number, number][], dx = 0, dy = 0) =>
    corners
      .map(([x, y]) => {
        const s = view.toScreen(x + dx, y + dy);
        return s.x + "," + s.y;
      })
      .join(" ");
  const showLabels = layers.labels && view.pxPerMetre > 3;
  return (
    <g className="plot-layer">
      {layers.route && route && route.length > 1 && (
        <polyline
          className="route-line faint"
          points={route
            .map((p) => {
              const s = view.toScreen(p.x, p.y);
              return s.x + "," + s.y;
            })
            .join(" ")}
        />
      )}
      {[
        // Selected plots on top so a dragged plot stays visible.
        ...layout.plots.filter((p) => !selected.has(p.id)),
        ...layout.plots.filter((p) => selected.has(p.id)),
      ].map((p) => {
        if (!p.polygon || p.polygon.length < 3) return null;
        const moving = drag?.ids.has(p.id),
          dx = moving ? drag!.offset.x : 0,
          dy = moving ? drag!.offset.y : 0,
          fill = colour.get(p.treatmentId) ?? UNASSIGNED;
        return (
          <g
            key={p.id}
            data-plot={p.id}
            className={"map-plot" + (selected.has(p.id) ? " on" : "")}
          >
            <polygon
              points={points(p.polygon, dx, dy)}
              fill={fill}
              stroke={fill}
            />
          </g>
        );
      })}
      {layers.chambers &&
        chambers.map((c, i) => {
          const s = view.toScreen(c.x, c.y);
          return (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={c.lost ? 4.5 : Math.max(2, Math.min(4, view.pxPerMetre * 0.2))}
              className={"measured" + (c.lost ? " lost" : "")}
            >
              <title>
                {c.n} flux{c.n === 1 ? "" : "es"} here
                {c.lost ? " · " + c.lost + " outside every plot" : ""}
              </title>
            </circle>
          );
        })}
      {showLabels &&
        layout.plots.map((p) => {
          if (!p.polygon || p.polygon.length < 3) return null;
          const moving = drag?.ids.has(p.id),
            c = centroid(p.polygon),
            s = view.toScreen(
              c.x + (moving ? drag!.offset.x : 0),
              c.y + (moving ? drag!.offset.y : 0),
            );
          return (
            <text
              key={p.id}
              x={s.x}
              y={s.y + 4}
              textAnchor="middle"
              className="map-label plot-label"
            >
              {p.label}
            </text>
          );
        })}
      {box && (
        <rect
          className="selection-box"
          x={Math.min(box.sx, box.ex)}
          y={Math.min(box.sy, box.ey)}
          width={Math.abs(box.ex - box.sx)}
          height={Math.abs(box.ey - box.sy)}
        />
      )}
    </g>
  );
}
