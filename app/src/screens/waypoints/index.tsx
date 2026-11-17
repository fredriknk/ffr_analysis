import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import type {
  PlotGenOptions,
  Waypoint,
  WaypointKind,
  WaypointSide,
} from "../../api/types";
import { error, pick, pickRoute, toastFn } from "../../shared/common";
import {
  FieldMap,
  type FieldMapHandle,
  type MapPointer,
  type MapView,
} from "../../shared/map/FieldMap";
import { useStore } from "../../store";
import {
  addPoint,
  commit,
  createDoc,
  insertMidpoint,
  isDirty,
  markSaved,
  movePoints,
  redoDoc,
  rotateGroup,
  selectRange,
  setFields,
  setHeading,
  undoDoc,
  type EditorDoc,
} from "../../waypoints/editor";
import {
  autorotate,
  centre,
  snapChambers,
  snapPositions,
} from "../../waypoints/geometry";
import { deletePoints } from "../../waypoints/naming";
import { parseCrs } from "../../waypoints/projection";
import { stripUids, type EditorPoint } from "../../waypoints/types";
import { PlotsPanel, defaultPlotOptions } from "./PlotsPanel";
import {
  HANDLE_PX,
  KIND_COLOURS,
  RouteLayer,
  headingVector,
  type Layers,
} from "./RouteLayer";

type Tool = "move" | "rotate" | "select";
type AddKind = WaypointKind | "pair";
type Gesture =
  | {
      kind: "move";
      start: { x: number; y: number; sx: number; sy: number };
      baseline: EditorPoint[];
      uids: string[];
      moved: boolean;
      clicked: string;
      selectOnly: boolean;
    }
  | {
      kind: "heading";
      uid: string;
      baseline: EditorPoint[];
    }
  | {
      kind: "group";
      pivot: { x: number; y: number };
      startAngle: number;
      baseline: EditorPoint[];
      uids: string[];
    }
  | {
      kind: "box";
      sx: number;
      sy: number;
      additive: boolean;
      before: Set<string>;
    };
const KIND_KEYS: Record<string, AddKind> = {
  D: "DriveThrough",
  M: "Measure",
  T: "TurningPoint",
  S: "Stop",
  B: "pair",
};
const deg = (r: number) => (r * 180) / Math.PI;
const fileName = (p: string | null) =>
  p ? (p.split(/[\\/]/).pop() ?? p) : "Unsaved route";

export function Waypoints() {
  const store = useStore(),
    client = useQueryClient(),
    visible = store.screen === "Waypoints",
    map = useRef<FieldMapHandle>(null);
  const project = useQuery({
    queryKey: ["project"],
    queryFn: () => api.projectInfo(),
  });
  const config = useQuery({
    queryKey: ["config"],
    enabled: visible && !!project.data,
    queryFn: () => api.getConfig(),
  });
  const storedRoute = useQuery({
    queryKey: ["route"],
    enabled: visible && !!project.data,
    queryFn: () => api.getRoute(),
  });
  const [doc, setDoc] = useState<EditorDoc>(() => createDoc([])),
    [sourcePath, setSourcePath] = useState<string | null>(null),
    [fitKey, setFitKey] = useState(0),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [anchor, setAnchor] = useState<string | null>(null),
    [tool, setTool] = useState<Tool>("move"),
    [preview, setPreview] = useState<EditorPoint[] | null>(null),
    [box, setBox] = useState<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>(null),
    [search, setSearch] = useState(""),
    [layers, setLayers] = useState<Layers>({
      labels: true,
      route: true,
      headings: true,
      chambers: false,
      plots: true,
    }),
    [placing, setPlacing] = useState<AddKind | null>(null),
    [addKind, setAddKind] = useState<AddKind>("Measure"),
    [addSide, setAddSide] = useState<WaypointSide>("both"),
    [addWhere, setAddWhere] = useState<"end" | "before" | "after">("end"),
    [autoRotate, setAutoRotate] = useState(false),
    [alignAfterMove, setAlignAfterMove] = useState(false),
    [positionsToo, setPositionsToo] = useState(true),
    [snapDistance, setSnapDistance] = useState(1.5),
    [snapAll, setSnapAll] = useState(false),
    [chamberMode, setChamberMode] = useState<
      "closest" | "left" | "right" | "opposite"
    >("closest"),
    [transformInput, setTransformInput] = useState({ dx: 0, dy: 0, deg: 0 }),
    [plotOptions, setPlotOptions] =
      useState<PlotGenOptions>(defaultPlotOptions),
    [pending, setPending] = useState<null | { label: string; run: () => void }>(
      null,
    ),
    [crsLocal, setCrsLocal] = useState(
      () => localStorage.getItem("ffr-waypoint-crs") ?? "EPSG:32632",
    );
  const gesture = useRef<Gesture | null>(null);
  const crs = project.data ? (config.data?.crs ?? "EPSG:32632") : crsLocal,
    points = preview ?? doc.points,
    dirty = isDirty(doc),
    primary =
      anchor && selected.has(anchor)
        ? points.find((p) => p.uid === anchor)
        : selected.size === 1
          ? points.find((p) => selected.has(p.uid))
          : undefined;

  function load(next: Waypoint[], path: string | null) {
    setDoc(createDoc(next));
    setSourcePath(path);
    setSelected(new Set());
    setAnchor(null);
    setPreview(null);
    setFitKey((k) => k + 1);
  }
  /** Runs `fn` now, or after the user agrees to drop unsaved edits. */
  function guarded(label: string, fn: () => void) {
    if (isDirty(doc) && doc.points.length) setPending({ label, run: fn });
    else fn();
  }
  // A route handed over from Start ("New project from waypoint list").
  useEffect(() => {
    const r = store.routeRequest;
    if (!r) return;
    store.set({ routeRequest: null });
    guarded("Open " + fileName(r.sourcePath), () => {
      load(r.points, r.sourcePath);
      if (r.plots) setLayers((l) => ({ ...l, plots: true }));
    });
  }, [store.routeRequest]);

  const proposal = useQuery({
    queryKey: [
      "waypointPlots",
      JSON.stringify(stripUids(doc.points)),
      plotOptions,
    ],
    enabled: visible && doc.points.some((p) => p.kind === "Measure"),
    queryFn: () => api.waypointPlots(stripUids(doc.points), plotOptions),
    placeholderData: keepPreviousData,
    retry: false,
  });

  function apply(label: string, next: EditorPoint[], select?: string[]) {
    setDoc((d) => commit(d, label, next));
    setPreview(null);
    if (select) {
      setSelected(new Set(select));
      setAnchor(select.at(-1) ?? null);
    }
  }
  function attempt(
    label: string,
    fn: () => EditorPoint[] | { points: EditorPoint[]; createdUids: string[] },
  ) {
    try {
      const r = fn();
      if (Array.isArray(r)) apply(label, r);
      else apply(label, r.points, r.createdUids);
    } catch (e) {
      error(e);
    }
  }
  const followPath = (next: EditorPoint[], uids: Iterable<string>) =>
    autoRotate ? autorotate(next, uids) : next;
  function setSelection(uids: string[], primaryUid?: string) {
    setSelected(new Set(uids));
    setAnchor(primaryUid ?? uids.at(-1) ?? null);
  }
  function selectPoint(uid: string, mode: "only" | "toggle" | "range") {
    if (mode === "toggle") {
      const next = new Set(selected);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      setSelected(next);
      setAnchor(uid);
    } else if (mode === "range" && anchor) {
      setSelected(new Set(selectRange(points, anchor, uid)));
    } else setSelection([uid]);
  }
  function addAt(x: number, y: number) {
    const kind = placing ?? addKind;
    attempt(kind === "pair" ? "Add drive-through + turn" : "Add " + kind, () =>
      addPoint(doc.points, {
        kind: kind === "pair" ? "DriveThrough" : kind,
        pair: kind === "pair",
        side: addSide,
        x,
        y,
        position: addWhere,
        anchorUid: primary?.uid,
      }),
    );
    setPlacing(null);
  }
  function deleteSelection() {
    if (!selected.size) return;
    attempt("Delete " + selected.size, () =>
      deletePoints(doc.points, selected),
    );
    setSelected(new Set());
    setAnchor(null);
  }
  function focusSelection() {
    const sel = points.filter((p) => selected.has(p.uid));
    if (sel.length)
      map.current?.fit(
        sel.map((p) => [p.x, p.y]),
        120,
      );
  }
  async function openFile() {
    const path = await pickRoute();
    if (!path) return;
    const next = await api.waypointsRead(path);
    load(next, path);
  }
  async function saveAs() {
    const base = fileName(sourcePath).replace(/\.csv$/i, "");
    const path = await pickRoute(true, base + "_edited.csv");
    if (!path) return;
    await api.waypointsWrite(path, stripUids(doc.points), sourcePath);
    setDoc((d) => markSaved(d));
    toastFn("Route saved to " + fileName(path));
  }

  // Map gestures -----------------------------------------------------------
  const rotationHandle = (view: MapView) => {
    if (!selected.size || tool === "select") return null;
    const sel = points.filter((p) => selected.has(p.uid));
    if (sel.length === 1) {
      if (autoRotate) return null;
      const s = view.toScreen(sel[0].x, sel[0].y),
        v = headingVector(view, sel[0]);
      return {
        from: s,
        to: {
          x: s.x + v.x * (HANDLE_PX + 10),
          y: s.y + v.y * (HANDLE_PX + 10),
        },
      };
    }
    const c = centre(sel),
      s = view.toScreen(c.x, c.y);
    return { from: s, to: { x: s.x, y: s.y - HANDLE_PX - 20 } };
  };
  function down(p: MapPointer): boolean {
    const e = p.event,
      target = (e.target as Element).closest("[data-uid],[data-handle]"),
      uid = target?.getAttribute("data-uid") ?? null,
      view = map.current?.view();
    if (placing) {
      addAt(p.x, p.y);
      return true;
    }
    if (target?.getAttribute("data-handle") === "rotate") {
      const sel = points.filter((q) => selected.has(q.uid));
      if (sel.length === 1)
        gesture.current = {
          kind: "heading",
          uid: sel[0].uid,
          baseline: doc.points,
        };
      else {
        const c = centre(sel);
        gesture.current = {
          kind: "group",
          pivot: c,
          startAngle: Math.atan2(p.y - c.y, p.x - c.x),
          baseline: doc.points,
          uids: [...selected],
        };
      }
      return true;
    }
    if (uid) {
      if (e.ctrlKey || e.metaKey) {
        selectPoint(uid, "toggle");
        return true;
      }
      if (e.shiftKey) {
        selectPoint(uid, "range");
        return true;
      }
      const already = selected.has(uid);
      if (!already) setSelection([uid]);
      if (tool === "rotate") {
        const uids = already ? [...selected] : [uid];
        if (uids.length === 1)
          gesture.current = { kind: "heading", uid, baseline: doc.points };
        else {
          const sel = points.filter((q) => uids.includes(q.uid)),
            c = centre(sel);
          gesture.current = {
            kind: "group",
            pivot: c,
            startAngle: Math.atan2(p.y - c.y, p.x - c.x),
            baseline: doc.points,
            uids,
          };
        }
        return true;
      }
      if (tool === "move")
        gesture.current = {
          kind: "move",
          start: { x: p.x, y: p.y, sx: p.sx, sy: p.sy },
          baseline: doc.points,
          uids: already ? [...selected] : [uid],
          moved: false,
          clicked: uid,
          selectOnly: already && selected.size > 1,
        };
      else setSelection([uid]);
      return true;
    }
    if ((tool === "select" || e.shiftKey) && view) {
      gesture.current = {
        kind: "box",
        sx: p.sx,
        sy: p.sy,
        additive: e.ctrlKey || e.metaKey,
        before: new Set(selected),
      };
      return true;
    }
    return false;
  }
  function move(p: MapPointer) {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "move") {
      const dx = p.x - g.start.x,
        dy = p.y - g.start.y;
      // A click is not a move: wait for a few pixels of drag.
      if (!g.moved && Math.hypot(p.sx - g.start.sx, p.sy - g.start.sy) < 3)
        return;
      g.moved = true;
      setPreview(
        movePoints(g.baseline, g.uids, dx, dy, {
          baseline: g.baseline,
          autorotate: autoRotate,
        }),
      );
    } else if (g.kind === "heading") {
      const q = g.baseline.find((x) => x.uid === g.uid)!;
      setPreview(
        setHeading(g.baseline, [g.uid], Math.atan2(p.y - q.y, p.x - q.x)),
      );
    } else if (g.kind === "group") {
      const angle = Math.atan2(p.y - g.pivot.y, p.x - g.pivot.x) - g.startAngle;
      setPreview(
        rotateGroup(g.baseline, g.uids, angle, {
          pivot: g.pivot,
          positionsToo,
          baseline: g.baseline,
          autorotate: autoRotate && positionsToo,
        }),
      );
    } else {
      setBox({
        x: Math.min(g.sx, p.sx),
        y: Math.min(g.sy, p.sy),
        width: Math.abs(p.sx - g.sx),
        height: Math.abs(p.sy - g.sy),
      });
    }
  }
  function up(p: MapPointer) {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "move") {
      if (!g.moved || !preview) {
        setPreview(null);
        if (g.selectOnly) setSelection([g.clicked]);
        return;
      }
      const next = alignAfterMove ? autorotate(preview, g.uids) : preview;
      apply("Move " + g.uids.length, next);
    } else if (g.kind === "heading" || g.kind === "group") {
      if (preview)
        apply(g.kind === "heading" ? "Rotate" : "Rotate group", preview);
    } else {
      const view = map.current?.view();
      setBox(null);
      if (!view) return;
      const x0 = Math.min(g.sx, p.sx),
        x1 = Math.max(g.sx, p.sx),
        y0 = Math.min(g.sy, p.sy),
        y1 = Math.max(g.sy, p.sy);
      const hit = points
        .filter((q) => {
          const s = view.toScreen(q.x, q.y);
          return s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
        })
        .map((q) => q.uid);
      setSelection(g.additive ? [...g.before, ...hit] : hit);
    }
  }

  // Keyboard ---------------------------------------------------------------
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).matches("input,textarea,select");
      const key = e.key;
      if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "s") {
        e.preventDefault();
        void saveAs().catch(error);
        return;
      }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "z") {
        e.preventDefault();
        setDoc((d) => (e.shiftKey ? redoDoc(d) : undoDoc(d)));
      } else if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "y") {
        e.preventDefault();
        setDoc((d) => redoDoc(d));
      } else if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(points.map((p) => p.uid));
      } else if (key === "Delete") deleteSelection();
      else if (key === "Escape") {
        setPlacing(null);
        setBox(null);
        if (gesture.current?.kind === "box")
          setSelected(gesture.current.before);
        gesture.current = null;
        setPreview(null);
      } else if (key.toLowerCase() === "f" && !e.ctrlKey)
        map.current?.fit(points.map((p) => [p.x, p.y]));
      else if (e.shiftKey && KIND_KEYS[key.toUpperCase()]) {
        e.preventDefault();
        const kind = KIND_KEYS[key.toUpperCase()];
        setAddKind(kind);
        setPlacing(kind);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Derived figures --------------------------------------------------------
  const length = points.reduce(
      (s, p, i) =>
        i ? s + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : s,
      0,
    ),
    counts = points.reduce(
      (c, p) => ({ ...c, [p.kind]: (c[p.kind] ?? 0) + 1 }),
      {} as Partial<Record<WaypointKind, number>>,
    );
  const listed = useMemo(
    () =>
      points
        .map((p, i) => ({ p, i }))
        .filter(
          ({ p }) =>
            !search ||
            (p.name + " " + p.kind)
              .toLowerCase()
              .includes(search.toLowerCase()),
        ),
    [points, search],
  );
  const crsError = (() => {
    try {
      parseCrs(crs);
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  })();
  const fit = useMemo<[number, number][]>(
    () => doc.points.map((p) => [p.x, p.y]),
    // Fit only when a new route is loaded.
    [fitKey],
  );
  const selectedList = points.filter((p) => selected.has(p.uid));

  return (
    <div className="waypoints">
      <header className="wp-toolbar">
        <strong className="wp-title">Waypoints</strong>
        <button
          onClick={() =>
            guarded("Open another route", () => void openFile().catch(error))
          }
        >
          Open CSV…
        </button>
        {!!storedRoute.data && (
          <button
            title="The route stored in the open project"
            onClick={() =>
              guarded("Load the project route", () =>
                load(storedRoute.data!.points, storedRoute.data!.sourcePath),
              )
            }
          >
            Project route
          </button>
        )}
        <button
          disabled={!doc.points.length}
          onClick={() => void saveAs().catch(error)}
          title="Save as a new CSV (Ctrl+S). The original file is never overwritten."
        >
          Save as…
        </button>
        <span className="sep" />
        <button
          disabled={!doc.undo.length}
          title={"Undo " + (doc.undo.at(-1)?.label ?? "") + " (Ctrl+Z)"}
          onClick={() => setDoc(undoDoc)}
        >
          ↶ Undo
        </button>
        <button
          disabled={!doc.redo.length}
          title={"Redo " + (doc.redo.at(-1)?.label ?? "") + " (Ctrl+Y)"}
          onClick={() => setDoc(redoDoc)}
        >
          ↷ Redo
        </button>
        <span className="sep" />
        <div className="segmented" role="group" aria-label="Map tool">
          {(["move", "rotate", "select"] as const).map((t) => (
            <button
              key={t}
              aria-pressed={tool === t}
              className={tool === t ? "on" : ""}
              onClick={() => setTool(t)}
            >
              {t === "move" ? "Move" : t === "rotate" ? "Rotate" : "Select"}
            </button>
          ))}
        </div>
        <button onClick={() => map.current?.fit(points.map((p) => [p.x, p.y]))}>
          Fit route <kbd>F</kbd>
        </button>
        <button disabled={!selected.size} onClick={focusSelection}>
          Focus selected
        </button>
        <details className="wp-menu">
          <summary>Layers</summary>
          <div className="filter-popover">
            {(
              [
                ["labels", "Names"],
                ["route", "Route line"],
                ["headings", "Headings"],
                ["chambers", "Chambers"],
                ["plots", "Plots from route"],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={layers[k]}
                  onChange={(e) =>
                    setLayers({ ...layers, [k]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </details>
        <details className="wp-menu">
          <summary>Map setup</summary>
          <div className="filter-popover wp-map-setup">
            <label>
              Coordinate system
              <input
                aria-label="Coordinate system"
                value={crs}
                disabled={!!project.data}
                onChange={(e) => {
                  setCrsLocal(e.target.value);
                  localStorage.setItem("ffr-waypoint-crs", e.target.value);
                }}
              />
            </label>
            <small className="muted">
              {project.data
                ? "From the project settings."
                : "UTM in metres, e.g. EPSG:32632 (zone 32 N)."}{" "}
              Changing it re-interprets coordinates; it never rewrites the CSV.
            </small>
            {crsError && <small className="warn-text">{crsError}</small>}
            <button
              onClick={() =>
                void pick(true)
                  .then(async (dir) => {
                    if (!dir) return;
                    await api.mapTilesSet(dir);
                    await client.invalidateQueries({ queryKey: ["mapTiles"] });
                  })
                  .catch(error)
              }
            >
              Imagery folder…
            </button>
            <button
              onClick={() =>
                void api
                  .mapTilesSet(null)
                  .then(() =>
                    client.invalidateQueries({ queryKey: ["mapTiles"] }),
                  )
                  .catch(error)
              }
            >
              No imagery
            </button>
            <small className="muted">
              Offline XYZ tiles: a folder with zoom folders ({"{z}/{x}/{y}"}
              .jpg), e.g. Waypoint Studio’s static/Mapnik.
            </small>
          </div>
        </details>
        {pending && (
          <div className="inline-confirm wp-pending">
            <span>Discard unsaved route changes?</span>
            <button
              className="primary"
              onClick={() => {
                const run = pending.run;
                setPending(null);
                run();
              }}
            >
              {pending.label}
            </button>
            <button onClick={() => setPending(null)}>Keep editing</button>
          </div>
        )}
      </header>
      <aside className="wp-side wp-left">
        <section className="wp-section">
          <h3>Route</h3>
          <div className="muted small" title={sourcePath ?? ""}>
            {fileName(sourcePath)}
            {dirty && doc.points.length ? " · unsaved changes" : ""}
          </div>
          <div className="wp-stats">
            {points.length} waypoints · {length.toFixed(1)} m
            <br />
            {counts.Measure ?? 0} measurements · {counts.DriveThrough ?? 0}{" "}
            drive-throughs · {counts.TurningPoint ?? 0} turns
          </div>
          <input
            aria-label="Find waypoint"
            placeholder="Find a waypoint by name or type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </section>
        <div className="wp-list" role="listbox" aria-multiselectable>
          {listed.map(({ p, i }) => (
            <button
              key={p.uid}
              role="option"
              aria-selected={selected.has(p.uid)}
              className={"wp-row" + (selected.has(p.uid) ? " on" : "")}
              onClick={(e) =>
                selectPoint(
                  p.uid,
                  e.ctrlKey || e.metaKey
                    ? "toggle"
                    : e.shiftKey
                      ? "range"
                      : "only",
                )
              }
              onDoubleClick={() => map.current?.centreOn(p.x, p.y)}
            >
              <span className="muted">{i + 1}</span>
              <span>{p.name}</span>
              <span style={{ color: KIND_COLOURS[p.kind] }}>{p.kind}</span>
              <span className="muted">
                {p.kind === "Measure" ? p.side : ""}
              </span>
            </button>
          ))}
          {!points.length && (
            <p className="muted small wp-empty">
              Open a route CSV (seven columns, no header:
              X,Y,Z,Angle,Type,MeasureSide,Name), or place waypoints on the map.
            </p>
          )}
        </div>
        <section className="wp-section">
          <h3>Add a waypoint</h3>
          <div className="wp-form">
            <label>
              Type
              <select
                aria-label="New waypoint type"
                value={addKind}
                onChange={(e) => setAddKind(e.target.value as AddKind)}
              >
                <option value="Measure">Measure</option>
                <option value="DriveThrough">DriveThrough</option>
                <option value="TurningPoint">TurningPoint</option>
                <option value="Stop">Stop</option>
                <option value="pair">DriveThrough + TurningPoint</option>
              </select>
            </label>
            <label>
              Side
              <select
                aria-label="New waypoint side"
                value={addSide}
                onChange={(e) => setAddSide(e.target.value as WaypointSide)}
              >
                {["both", "left", "right", "none"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Route position
              <select
                aria-label="Route position"
                value={addWhere}
                onChange={(e) => setAddWhere(e.target.value as typeof addWhere)}
              >
                <option value="end">Append to end</option>
                <option value="before">Insert before selected</option>
                <option value="after">Insert after selected</option>
              </select>
            </label>
          </div>
          <button
            className={placing ? "primary" : ""}
            onClick={() => setPlacing(placing ? null : addKind)}
          >
            {placing ? "Cancel placement (Esc)" : "Place waypoint on map"}
          </button>
          <button
            disabled={!primary || addWhere === "end"}
            onClick={() =>
              primary &&
              attempt("Insert at midpoint", () =>
                insertMidpoint(doc.points, {
                  kind: addKind === "pair" ? "DriveThrough" : addKind,
                  pair: addKind === "pair",
                  side: addSide,
                  anchorUid: primary.uid,
                  position: addWhere === "before" ? "before" : "after",
                }),
              )
            }
          >
            Insert at segment midpoint
          </button>
          <small className="muted">
            New points align with travel. Shift+D / M / T / S / B arms
            placement; click the map to place.
          </small>
        </section>
      </aside>
      <main className="wp-map">
        <FieldMap
          ref={map}
          crs={crsError ? "EPSG:32632" : crs}
          fit={fit}
          fitKey={fitKey}
          label="Waypoint route map"
          cursor={
            placing ? "crosshair" : tool === "select" ? "crosshair" : undefined
          }
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          overlay={
            placing ? (
              <div className="map-banner">
                Click the map to place{" "}
                {placing === "pair" ? "a drive-through + turn" : "a " + placing}{" "}
                · Esc cancels
              </div>
            ) : null
          }
        >
          {(view) => (
            <RouteLayer
              view={view}
              points={points}
              selected={selected}
              layers={layers}
              proposal={proposal.data}
              box={box}
              rotation={rotationHandle(view)}
            />
          )}
        </FieldMap>
      </main>
      <aside className="wp-side wp-right">
        <section className="wp-section">
          <h3>Waypoint inspector</h3>
          {!selected.size && (
            <p className="muted small">
              Select a waypoint on the map or in the list. Shift-drag (or the
              Select tool) selects a box; Ctrl adds.
            </p>
          )}
          {primary && selected.size === 1 && (
            <Inspector
              key={primary.uid + JSON.stringify(primary)}
              point={primary}
              autoRotate={autoRotate}
              onApply={(fields) =>
                attempt("Edit " + primary.name, () =>
                  followPath(setFields(doc.points, primary.uid, fields), [
                    primary.uid,
                  ]),
                )
              }
            />
          )}
          {selected.size > 1 && (
            <>
              <p className="small">
                {selected.size} selected
                {primary ? " · anchor " + primary.name : ""}
              </p>
              <div className="wp-form three">
                <label>
                  ΔX · m
                  <input
                    type="number"
                    step="0.1"
                    value={transformInput.dx}
                    onChange={(e) =>
                      setTransformInput({
                        ...transformInput,
                        dx: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  ΔY · m
                  <input
                    type="number"
                    step="0.1"
                    value={transformInput.dy}
                    onChange={(e) =>
                      setTransformInput({
                        ...transformInput,
                        dy: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Rotate · °
                  <input
                    type="number"
                    step="1"
                    value={transformInput.deg}
                    onChange={(e) =>
                      setTransformInput({
                        ...transformInput,
                        deg: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <button
                onClick={() =>
                  attempt("Transform selection", () => {
                    const rotated = rotateGroup(
                      doc.points,
                      selected,
                      (transformInput.deg * Math.PI) / 180,
                      { pivot: centre(selectedList), positionsToo },
                    );
                    return followPath(
                      movePoints(
                        rotated,
                        selected,
                        transformInput.dx,
                        transformInput.dy,
                      ),
                      selected,
                    );
                  })
                }
              >
                Transform selection
              </button>
            </>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={positionsToo}
              onChange={(e) => setPositionsToo(e.target.checked)}
            />
            Rotate positions too
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={autoRotate}
              onChange={(e) => {
                setAutoRotate(e.target.checked);
                if (e.target.checked && selected.size)
                  attempt("Align headings", () =>
                    autorotate(doc.points, selected),
                  );
              }}
            />
            Autorotation from path
          </label>
          <button
            disabled={!selected.size}
            onClick={() =>
              attempt("Align headings", () => autorotate(doc.points, selected))
            }
          >
            Align selected headings now
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={alignAfterMove}
              onChange={(e) => setAlignAfterMove(e.target.checked)}
            />
            Autoalign headings after moving
          </label>
          {!!selected.size && (
            <div className="button-row">
              <button onClick={focusSelection}>Focus</button>
              <button className="danger" onClick={deleteSelection}>
                Delete <kbd>Del</kbd>
              </button>
            </div>
          )}
        </section>
        <section className="wp-section">
          <h3>Snap selected waypoints</h3>
          <div className="wp-form">
            <label>
              Max distance · m
              <input
                type="number"
                min="0.1"
                step="0.1"
                aria-label="Snap distance"
                value={snapDistance}
                onChange={(e) => setSnapDistance(Number(e.target.value))}
              />
            </label>
            <label>
              Waypoint snap
              <select
                aria-label="Waypoint snap mode"
                value={snapAll ? "all" : "groups"}
                onChange={(e) => setSnapAll(e.target.value === "all")}
              >
                <option value="groups">Nearby groups only</option>
                <option value="all">All selected to one average</option>
              </select>
            </label>
          </div>
          <button
            disabled={selected.size < 2}
            onClick={() =>
              attempt("Snap positions", () =>
                followPath(
                  snapPositions(
                    doc.points,
                    selected,
                    snapAll ? null : snapDistance,
                  ),
                  selected,
                ),
              )
            }
          >
            Snap waypoint positions
          </button>
          <div className="wp-form">
            <label>
              Chamber pairing
              <select
                aria-label="Chamber pairing"
                value={chamberMode}
                onChange={(e) =>
                  setChamberMode(e.target.value as typeof chamberMode)
                }
              >
                <option value="closest">Closest chambers</option>
                <option value="left">Left only</option>
                <option value="right">Right only</option>
                <option value="opposite">Left to right</option>
              </select>
            </label>
          </div>
          <button
            disabled={selected.size < 2}
            onClick={() => {
              try {
                const r = snapChambers(
                  doc.points,
                  selected,
                  snapDistance,
                  chamberMode,
                );
                if (!r.matched.length) {
                  toastFn("No chamber pairs within " + snapDistance + " m");
                  return;
                }
                apply("Snap chambers", r.points);
                setLayers((l) => ({ ...l, chambers: true }));
                toastFn(r.matched.length + " chamber pairs aligned");
              } catch (e) {
                error(e);
              }
            }}
          >
            Snap chamber pairs
          </button>
        </section>
        <PlotsPanel
          points={stripUids(doc.points)}
          sourcePath={sourcePath}
          options={plotOptions}
          setOptions={setPlotOptions}
          proposal={proposal.data}
          loading={proposal.isFetching}
          projectName={project.data?.name ?? null}
        />
        {proposal.error && (
          <p className="warn-text small">
            {String(
              (proposal.error as { message?: string }).message ??
                proposal.error,
            )}
          </p>
        )}
      </aside>
    </div>
  );
}

/** Single-waypoint properties; numbers apply on Enter or when leaving a field. */
function Inspector({
  point,
  autoRotate,
  onApply,
}: {
  point: EditorPoint;
  autoRotate: boolean;
  onApply: (f: Parameters<typeof setFields>[2]) => void;
}) {
  const [values, setValues] = useState({
    x: String(point.x),
    y: String(point.y),
    z: String(point.z),
    angle: String(Math.round(deg(point.angle) * 10000) / 10000),
  });
  const commitField = (key: keyof typeof values) => {
    const v = Number(values[key]);
    if (!Number.isFinite(v)) return;
    if (key === "angle") {
      if (Math.abs(v - deg(point.angle)) > 1e-9) onApply({ angleDeg: v });
    } else if (v !== point[key]) onApply({ [key]: v });
  };
  const input = (key: keyof typeof values, label: string) => (
    <label>
      {label}
      <input
        type="number"
        step={key === "angle" ? "1" : "0.01"}
        aria-label={label}
        value={values[key]}
        disabled={key === "angle" && autoRotate}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        onBlur={() => commitField(key)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitField(key);
        }}
      />
    </label>
  );
  return (
    <div className="wp-form">
      <label>
        Name
        <input value={point.name} readOnly aria-label="Waypoint name" />
      </label>
      <label>
        Type
        <select
          aria-label="Waypoint type"
          value={point.kind}
          onChange={(e) => onApply({ kind: e.target.value as WaypointKind })}
        >
          {["Measure", "DriveThrough", "TurningPoint", "Stop"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label>
        Measure side
        <select
          aria-label="Measure side"
          value={point.side}
          onChange={(e) => onApply({ side: e.target.value as WaypointSide })}
        >
          {["both", "left", "right", "none"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      {input("x", "X / easting · m")}
      {input("y", "Y / northing · m")}
      {input("z", "Z · m")}
      {input("angle", "Heading · °")}
      <small className="muted">
        Heading 0° = grid east, +90° = grid north. CSV headings stay in radians.
      </small>
    </div>
  );
}
