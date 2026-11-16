import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, isTauri, mockMode } from "./api";
import type {
  AnalysisOptions,
  FluxRow,
  FluxDetail,
  Gas,
  ProjectConfig,
  Progress,
  Cell,
  ExportArgs,
} from "./api/types";
import { useStore, type Screen } from "./store";
import { Chart } from "./ui/Chart";
import type { EChartsCoreOption } from "echarts/core";
const fmt = (n: unknown, d = 2) =>
  typeof n === "number"
    ? n.toLocaleString("en-GB", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      })
    : String(n ?? "—");
const date = (n: number) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(n);
const plotBase = {
  grid: { left: 65, right: 25, top: 25, bottom: 45 },
  tooltip: { trigger: "axis" },
  xAxis: {
    type: "value",
    name: "Time (s)",
    nameLocation: "middle",
    nameGap: 28,
    max: 185,
  },
  yAxis: { type: "value", scale: true, splitNumber: 4 },
};
let toastFn: (s: string) => void = () => {};
const error = (e: unknown) =>
  toastFn(
    typeof e === "object" && e && "message" in e
      ? String(e.message)
      : String(e),
  );
function useAction() {
  const client = useQueryClient();
  return async (fn: () => Promise<unknown>, message?: string) => {
    try {
      await fn();
      await client.invalidateQueries();
      if (message) toastFn(message);
    } catch (e) {
      error(e);
    }
  };
}
function useRows() {
  return useQuery({
    queryKey: ["fluxes"],
    queryFn: async () => {
      const t = await api.listFluxes();
      return {
        columns: t.columns,
        rows: Array.from(
          { length: t.rows },
          (_, i) =>
            Object.fromEntries(
              t.columns.map((c) => [c.key, t.data[c.key][i]]),
            ) as FluxRow,
        ),
      };
    },
  });
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
function Status({
  loading,
  error: e,
}: {
  loading: boolean;
  error: Error | null;
}) {
  useEffect(() => {
    if (e) error(e);
  }, [e]);
  return loading ? (
    <Empty>Loading measurements…</Empty>
  ) : e ? (
    <Empty>
      Could not load this view.{" "}
      <button onClick={() => location.reload()}>Retry</button>
    </Empty>
  ) : null;
}
async function pick(folder = false, write = false) {
  if (!isTauri) return folder ? "synthetic-demo/" : "synthetic-demo.csv";
  const p = write
    ? await save({ filters: [{ name: "FFR project", extensions: ["ffr"] }] })
    : await open({ directory: folder, multiple: false });
  return typeof p === "string" ? p : null;
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Panel({
  title,
  children,
  extra,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <h3>{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}
function Start() {
  const action = useAction(),
    s = useStore();
  const [wizard, setWizard] = useState(false),
    [dir, setDir] = useState(""),
    [raw, setRaw] = useState(""),
    [out, setOut] = useState("trial.ffr"),
    [scan, setScan] = useState<Awaited<ReturnType<typeof api.legacyScan>>>();
  const recent = useQuery({
    queryKey: ["recent"],
    queryFn: () => api.recentProjects(),
  });
  const openProject = (path: string) =>
    action(async () => {
      await api.projectOpen(path);
      s.nav("Review");
    });
  return (
    <div className="start">
      <div className="eyebrow">FIELD FLUX ROBOT / ANALYSIS WORKSPACE</div>
      <h1>Make sense of every measurement.</h1>
      <p className="lead">
        From raw chamber traces to treatment-level insight.
        <br />
        One project. A complete, traceable analysis.
      </p>
      <div className="start-actions">
        <button className="primary" onClick={() => openProject("demo.ffr")}>
          Open demo project <span>→</span>
        </button>
        <button
          onClick={() =>
            void pick().then((p) => (p ? openProject(p) : undefined))
          }
        >
          Open project…
        </button>
        <button
          onClick={() =>
            void pick(false, true).then((p) =>
              p
                ? action(async () => {
                    await api.projectCreate(p, "New field trial");
                    s.nav("Project");
                  })
                : undefined,
            )
          }
        >
          New project…
        </button>
      </div>
      <div className="start-grid">
        <Panel title="Recent projects">
          <Status loading={recent.isLoading} error={recent.error} />
          {recent.data?.map((p) => (
            <button
              className="recent"
              key={p.path}
              onClick={() => openProject(p.path)}
            >
              <span className="project-icon">▦</span>
              <span>
                <strong>{p.name}</strong>
                <small>{p.path} · Synthetic demonstration</small>
              </span>
              <span>↗</span>
            </button>
          ))}
        </Panel>
        <Panel title="Bring your work with you">
          <p>
            Convert a legacy project, including its options, external series and
            manual measurements.
          </p>
          <button onClick={() => setWizard(!wizard)}>
            Import legacy project →
          </button>
        </Panel>
      </div>
      {wizard && (
        <Panel title="Import legacy project">
          <div className="form-grid">
            <Field label="Legacy folder">
              <input value={dir} onChange={(e) => setDir(e.target.value)} />
            </Field>
            <button onClick={() => void pick(true).then((p) => p && setDir(p))}>
              Browse folder
            </button>
            <Field label="Raw data folder">
              <input value={raw} onChange={(e) => setRaw(e.target.value)} />
            </Field>
            <Field label="Output project">
              <input value={out} onChange={(e) => setOut(e.target.value)} />
            </Field>
          </div>
          <button
            onClick={() =>
              action(async () => setScan(await api.legacyScan(dir)))
            }
          >
            Scan inputs
          </button>
          {scan && (
            <>
              <p>
                {scan.rawFiles.toLocaleString()} robot files · Manual{" "}
                {scan.manualExists ? "?" : "—"} · Logger{" "}
                {scan.loggerExists ? "?" : "—"} · Weather{" "}
                {scan.weatherExists ? "?" : "—"}
              </p>
              <p>{scan.warnings.join(" ")}</p>
              <button
                className="primary"
                onClick={() =>
                  action(async () => {
                    await api.legacyImport({
                      legacyDir: dir,
                      rawDir: raw,
                      outPath: out,
                    });
                    s.nav("Review");
                  })
                }
              >
                Import project
              </button>
            </>
          )}
        </Panel>
      )}
      <div className="start-foot">
        <span>7,638 synthetic fluxes</span>
        <span>12 treatments · 36 plots</span>
        <span>Two years in the field</span>
      </div>
    </div>
  );
}
function Review() {
  const s = useStore(),
    action = useAction(),
    data = useRows(),
    parent = useRef<HTMLDivElement>(null),
    [goto, setGoto] = useState(""),
    [showGoto, setShowGoto] = useState(false);
  const detail = useQuery({
    queryKey: ["detail", s.selected],
    queryFn: () => api.getFluxDetail(s.selected),
  });
  const [preview, setPreview] = useState<FluxDetail | null>(null),
    [draft, setDraft] = useState<AnalysisOptions | null>(null),
    serial = useRef(0);
  useEffect(() => {
    setPreview(null);
    setDraft(null);
    serial.current++;
  }, [detail.data]);
  const d = preview ?? detail.data,
    o = draft ?? d?.options;
  const filtered = useMemo(
    () =>
      data.data?.rows.filter(
        (r) =>
          (!s.search ||
            [r.id, r.filename, r.plotLabel, r.treatmentName]
              .join(" ")
              .toLowerCase()
              .includes(s.search.toLowerCase())) &&
          (s.quick === "all" ||
            (s.quick === "unreviewed" && !r.reviewed) ||
            (s.quick === "flagged" && r.N2O_qc !== "OK") ||
            (s.quick === "overridden" && r.overridden) ||
            (s.quick === "excluded" && r.excluded)) &&
          (!s.treatment || r.treatmentId === Number(s.treatment)) &&
          (!s.plot || r.plotId === Number(s.plot)) &&
          (!s.from || r.time >= Date.parse(s.from)) &&
          (!s.to || r.time < Date.parse(s.to) + 86400000),
      ) ?? [],
    [data.data, s.search, s.quick, s.treatment, s.plot, s.from, s.to],
  );
  const virtual = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 64,
    overscan: 8,
  });
  const index = filtered.findIndex((r) => r.id === s.selected);
  function step(n: number) {
    const next =
      filtered[Math.max(0, Math.min(filtered.length - 1, index + n))];
    if (next) s.set({ selected: next.id });
  }
  useEffect(() => {
    const i = filtered.findIndex((r) => r.id === s.selected);
    if (i >= 0) virtual.scrollToIndex(i, { align: "auto" });
  }, [s.selected, filtered, virtual]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (s.screen !== "Review") return;
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey && ["z", "y"].includes(key)) {
        e.preventDefault();
        void action(() => (key === "z" ? api.undo() : api.redo()));
      } else if (key === "arrowright") {
        e.preventDefault();
        step(1);
      } else if (key === "arrowleft") {
        e.preventDefault();
        step(-1);
      } else if (key === "x" && d)
        void action(() =>
          api.setFluxFlags([s.selected], { excluded: !d.flux.excluded }),
        );
      else if (key === "r")
        void action(() => api.setFluxOptions([s.selected], null));
      else if (key === "a")
        void action(async () => {
          await api.setFluxFlags([s.selected], { reviewed: true });
          step(1);
        });
      else if (key === "g") setShowGoto(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const changePreview = (next: AnalysisOptions) => {
    setDraft(next);
    const req = ++serial.current;
    void api
      .previewFlux(s.selected, next)
      .then((v) => {
        if (req === serial.current) setPreview(v);
      })
      .catch(error);
  };
  const commit = (next: AnalysisOptions) =>
    void action(() => api.setFluxOptions([s.selected], next));
  return (
    <div className="review">
      <aside className="queue panel">
        <div className="panel-title">
          <h3>Review queue</h3>
          <span className="badge">{filtered.length.toLocaleString()}</span>
        </div>
        <div className="queue-filters">
          <input
            aria-label="Search fluxes"
            placeholder="Search plot, treatment, file…"
            value={s.search}
            onChange={(e) => s.set({ search: e.target.value })}
          />
          <select
            aria-label="Quick filter"
            value={s.quick}
            onChange={(e) => s.set({ quick: e.target.value })}
          >
            <option value="all">All measurements</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="flagged">QC flagged</option>
            <option value="overridden">Overridden</option>
            <option value="excluded">Excluded</option>
          </select>
          <div className="two">
            <select
              aria-label="Treatment filter"
              value={s.treatment}
              onChange={(e) => s.set({ treatment: e.target.value })}
            >
              <option value="">All treatments</option>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {
                    data.data?.rows.find((r) => r.treatmentId === i + 1)
                      ?.treatmentName
                  }
                </option>
              ))}
            </select>
            <select
              aria-label="Plot filter"
              value={s.plot}
              onChange={(e) => s.set({ plot: e.target.value })}
            >
              <option value="">All plots</option>
              {Array.from({ length: 36 }, (_, i) => (
                <option key={i} value={i + 1}>
                  P{String(i + 1).padStart(2, "0")}
                </option>
              ))}
            </select>
          </div>
          <div className="two">
            <input
              aria-label="Review from"
              type="date"
              value={s.from}
              onChange={(e) => s.set({ from: e.target.value })}
            />
            <input
              aria-label="Review to"
              type="date"
              value={s.to}
              onChange={(e) => s.set({ to: e.target.value })}
            />
          </div>
        </div>
        <Status loading={data.isLoading} error={data.error} />
        <div className="virtual-list" ref={parent}>
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((v) => {
              const r = filtered[v.index];
              return (
                <button
                  key={r.id}
                  className={
                    "flux-item " +
                    (r.id === s.selected ? "selected " : "") +
                    (r.excluded ? "excluded" : "")
                  }
                  style={{
                    position: "absolute",
                    top: 0,
                    transform: "translateY(" + v.start + "px)",
                    height: v.size,
                    width: "100%",
                  }}
                  onClick={() => s.set({ selected: r.id })}
                >
                  <span>
                    <strong>
                      #{r.id} · {r.plotLabel}
                    </strong>
                    <small>
                      {date(r.time)} · {r.side}
                    </small>
                  </span>
                  <span className="flux-item-right">
                    <strong>{fmt(r.N2O_flux, 1)}</strong>
                    <small>
                      {r.excluded
                        ? "Excluded"
                        : r.reviewed
                          ? "Reviewed"
                          : r.N2O_qc === "OK"
                            ? "Unreviewed"
                            : "⚑ Check fit"}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
          {!filtered.length && <Empty>No matching fluxes</Empty>}
        </div>
        <div className="queue-footer">
          {(
            data.data?.rows.filter((r) => r.reviewed).length ?? 0
          ).toLocaleString()}{" "}
          of {data.data?.rows.length.toLocaleString()} reviewed
        </div>
      </aside>
      <main className="review-main">
        <div className="review-heading">
          <div>
            {s.back && (
              <button className="back" onClick={s.goBack}>
                ← Back to {s.back}
              </button>
            )}
            <h2>
              {d?.flux.plotLabel ?? "Measurement"}{" "}
              <span className="muted">/ {d?.flux.treatmentName}</span>
            </h2>
            <p>
              Flux #{s.selected} · {d && date(d.flux.time)} · {d?.flux.side}{" "}
              chamber{" "}
              <span className="badge">
                {d?.isOverridden ? "Overridden" : "Project defaults"}
              </span>
            </p>
          </div>
          <div className="button-group">
            <button aria-label="Previous flux" onClick={() => step(-1)}>
              ←
            </button>
            <button aria-label="Next flux" onClick={() => step(1)}>
              →
            </button>
          </div>
        </div>
        <Status loading={detail.isLoading} error={detail.error} />
        {d && o && (
          <>
            <div className="legend">
              <span className="dot left" /> Left chamber{" "}
              <span className="dot right" /> Right chamber{" "}
              <span className="dot discarded" /> Cut / discarded{" "}
              <span className="muted">Drag window handles to refit</span>
            </div>
            {d.traces.length === 0 ? (
              <Empty>Manual measurement · no raw trace</Empty>
            ) : (
              ["N2O", s.gas === "N2O" ? "CO2" : s.gas].map((gas) => (
                <TraceChart
                  key={gas}
                  detail={d}
                  gas={gas as Gas}
                  options={o}
                  preview={changePreview}
                  commit={commit}
                />
              ))
            )}
            <div className="toolbar">
              <span>Secondary gas</span>
              <select
                aria-label="Secondary gas"
                value={s.gas}
                onChange={(e) => s.set({ gas: e.target.value as Gas })}
              >
                {["N2O", "CO2", "CO", "H2O", "licor_H2O"].map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
              <button
                onClick={() =>
                  void action(() =>
                    api.setFluxFlags([s.selected], {
                      excluded: !d.flux.excluded,
                    }),
                  )
                }
              >
                {d.flux.excluded ? "Include flux" : "Exclude flux"} <kbd>X</kbd>
              </button>
              <button
                className="primary"
                onClick={() =>
                  void action(async () => {
                    await api.setFluxFlags([s.selected], { reviewed: true });
                    step(1);
                  })
                }
              >
                Reviewed & next <kbd>A</kbd>
              </button>
            </div>
            <div className="shortcut-strip">
              ← → Navigate <span>X Exclude</span>
              <span>R Reset</span>
              <span>A Reviewed & next</span>
              <span>G Go to</span>
              <span>Ctrl Z / Y Undo / redo</span>
            </div>
          </>
        )}
        {showGoto && (
          <div className="toolbar">
            <input
              autoFocus
              aria-label="Go to flux or date"
              placeholder="Flux number or YYYY-MM-DD"
              value={goto}
              onChange={(e) => setGoto(e.target.value)}
            />
            <button
              onClick={() => {
                const r = goto.includes("-")
                  ? data.data?.rows.find((r) => r.time >= Date.parse(goto))
                  : data.data?.rows.find((r) => r.id === Number(goto));
                if (r) {
                  s.set({ selected: r.id });
                  setShowGoto(false);
                } else toastFn("No matching measurement");
              }}
            >
              Go
            </button>
            <button onClick={() => setShowGoto(false)}>Cancel</button>
          </div>
        )}
      </main>
      <aside className="results">
        {d && o && (
          <>
            <Panel
              title="Regression results"
              extra={
                <span className="badge">
                  {d.flux.excluded
                    ? "EXCLUDED"
                    : d.flux.reviewed
                      ? "REVIEWED"
                      : "TO REVIEW"}
                </span>
              }
            >
              {d.regressions
                .filter((r) =>
                  ["N2O", s.gas === "N2O" ? "CO2" : s.gas].includes(r.gas),
                )
                .map((r) => (
                  <div key={r.gas} className="result">
                    <div className="result-title">
                      <strong>{r.gas === "N2O" ? "N2O" : "CO2"}</strong>
                      <span className={r.qc === "OK" ? "good" : "warning"}>
                        {r.qc}
                      </span>
                    </div>
                    <div className="big-number">{fmt(r.flux, 1)}</div>
                    <small>{r.fluxUnit}</small>
                    <dl>
                      <dt>Slope · ppm s⁻¹</dt>
                      <dd>{r.slope.toExponential(3)}</dd>
                      <dt>R² / p</dt>
                      <dd>
                        {fmt(r.rsq, 4)} / {r.pval.toExponential(1)}
                      </dd>
                      <dt>Points / SE slope</dt>
                      <dd>
                        {r.n} / {r.seSlope.toExponential(1)}
                      </dd>
                    </dl>
                  </div>
                ))}
            </Panel>
            <Panel title="Analysis options">
              <Field label="Regression mode">
                <select
                  value={o.mode}
                  onChange={(e) =>
                    commit({
                      ...o,
                      mode: e.target.value as AnalysisOptions["mode"],
                    })
                  }
                >
                  <option value="fixed">Fixed window</option>
                  <option value="auto">Auto window</option>
                  <option value="manual">Manual slope</option>
                </select>
              </Field>
              <div className="two">
                {(["start", "stop"] as const).map((key) => (
                  <Field
                    key={key}
                    label={key === "start" ? "Start · s" : "Stop · s"}
                  >
                    <input
                      aria-label={key + " seconds"}
                      type="number"
                      min="0"
                      max="185"
                      value={o[key]}
                      onChange={(e) =>
                        changePreview({ ...o, [key]: Number(e.target.value) })
                      }
                      onBlur={() => commit(o)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commit(o);
                      }}
                    />
                  </Field>
                ))}
              </div>
              {o.mode === "manual" && (
                <Field label="Slope · ppm/s">
                  <input
                    type="number"
                    step="any"
                    value={o.slope ?? 0}
                    onChange={(e) =>
                      changePreview({ ...o, slope: Number(e.target.value) })
                    }
                    onBlur={() => commit(o)}
                  />
                </Field>
              )}
              {o.mode === "auto" && (
                <>
                  <Field label="Interval · s">
                    <input
                      type="number"
                      value={o.interval}
                      onChange={(e) =>
                        changePreview({
                          ...o,
                          interval: Number(e.target.value),
                        })
                      }
                      onBlur={() => commit(o)}
                    />
                  </Field>
                  <select
                    aria-label="Auto criterion"
                    value={o.crit}
                    onChange={(e) =>
                      commit({
                        ...o,
                        crit: e.target.value as AnalysisOptions["crit"],
                      })
                    }
                  >
                    <option value="steepest">Steepest slope</option>
                    <option value="mse">Lowest MSE</option>
                  </select>
                  <label>
                    <input
                      type="checkbox"
                      checked={o.co2Guides}
                      onChange={(e) =>
                        commit({ ...o, co2Guides: e.target.checked })
                      }
                    />{" "}
                    CO2 guides other gases
                  </label>
                </>
              )}
              <div className="two">
                {(["cutBeginnings", "cutEnds"] as const).map((k) => (
                  <Field
                    key={k}
                    label={
                      k === "cutBeginnings"
                        ? "Cut beginning · s"
                        : "Cut end · s"
                    }
                  >
                    <input
                      type="number"
                      min="0"
                      max="9"
                      value={o[k]}
                      onChange={(e) =>
                        changePreview({ ...o, [k]: Number(e.target.value) })
                      }
                      onBlur={() => commit(o)}
                    />
                  </Field>
                ))}
              </div>
              <button
                className="full"
                onClick={() =>
                  void action(() => api.setFluxOptions([s.selected], null))
                }
              >
                Reset to project defaults <kbd>R</kbd>
              </button>
            </Panel>
            <Panel title="Field context">
              <dl>
                <dt>Air temperature</dt>
                <dd>{fmt(d.flux.airTemp, 1)} °C</dd>
                <dt>Precipitation</dt>
                <dd>{fmt(d.flux.precip, 1)} mm</dd>
                <dt>Position</dt>
                <dd>
                  {fmt(d.flux.x, 1)}, {fmt(d.flux.y, 1)}
                </dd>
              </dl>
              <Field label="Plot assignment">
                <select
                  value={d.flux.plotId}
                  onChange={(e) =>
                    void action(() =>
                      api.setFluxFlags([s.selected], {
                        plotOverride: Number(e.target.value),
                      }),
                    )
                  }
                >
                  {Array.from({ length: 36 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      P{String(i + 1).padStart(2, "0")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Review note">
                <textarea
                  key={d.flux.id + "-" + d.flux.note}
                  defaultValue={d.flux.note}
                  placeholder="Add a note…"
                  onBlur={(e) => {
                    if (e.target.value !== d.flux.note)
                      void action(() =>
                        api.setFluxFlags([s.selected], {
                          note: e.target.value,
                        }),
                      );
                  }}
                />
              </Field>
              {d.siblingFluxId && (
                <button onClick={() => s.set({ selected: d.siblingFluxId! })}>
                  Open {d.flux.side === "left" ? "right" : "left"} chamber →
                </button>
              )}
            </Panel>
          </>
        )}
      </aside>
    </div>
  );
}
function TraceChart({
  detail,
  gas,
  options,
  preview,
  commit,
}: {
  detail: FluxDetail;
  gas: Gas;
  options: AnalysisOptions;
  preview: (o: AnalysisOptions) => void;
  commit: (o: AnalysisOptions) => void;
}) {
  const tr = detail.traces.find((t) => t.gas === gas)!,
    r = detail.regressions.find((r) => r.gas === gas)!,
    sib = detail.sibling.find((r) => r.gas === gas),
    drag = useRef(options);
  drag.current = options;
  const series: object[] = [0, 1, 2].map((side) => ({
    name: side === 0 ? "Discarded" : side === 1 ? "Left" : "Right",
    type: "scatter",
    symbolSize: side === 0 ? 3 : 5,
    itemStyle: {
      color: ["#9aa7b3", "#0072b2", "#d55e00"][side],
      opacity: detail.flux.excluded
        ? 0.25
        : side === (detail.flux.side === "left" ? 1 : 2)
          ? 1
          : 0.35,
    },
    data: tr.t.flatMap((v, i) => (tr.side[i] === side ? [[v, tr.y[i]]] : [])),
  }));
  series.push({
    name: "Used in fit",
    type: "scatter",
    symbolSize: 7,
    itemStyle: {
      color: detail.flux.side === "left" ? "#0072b2" : "#d55e00",
      opacity: detail.flux.excluded ? 0.25 : 1,
    },
    data: tr.t.flatMap((v, i) => (tr.used[i] ? [[v, tr.y[i]]] : [])),
  });
  series.push({
    name: "Fit",
    type: "line",
    showSymbol: false,
    lineStyle: { width: 2, color: "#168b7c" },
    data: [
      [r.start, r.intercept + r.slope * r.start],
      [r.stop, r.intercept + r.slope * r.stop],
    ],
    markArea: {
      silent: true,
      itemStyle: { color: "rgba(100,145,145,.06)" },
      data: detail.switches.map((sw) => [
        {
          xAxis: sw.t,
          itemStyle: {
            color:
              sw.side === "left"
                ? "rgba(0,114,178,.035)"
                : "rgba(213,94,0,.035)",
          },
        },
        { xAxis: sw.t + 20 },
      ]),
    },
  });
  if (sib)
    series.push({
      name: "Sibling fit",
      type: "line",
      showSymbol: false,
      lineStyle: { width: 1, type: "dashed", opacity: 0.3, color: "#d55e00" },
      data: [
        [sib.start, sib.intercept + sib.slope * sib.start],
        [sib.stop, sib.intercept + sib.slope * sib.stop],
      ],
    });
  return (
    <Panel
      title={gas + " concentration"}
      extra={<span className="muted">ppm · 1 Hz · {tr.t.length} samples</span>}
    >
      <div className="trace-wrap">
        <Chart
          label={gas + " raw concentration trace"}
          height={240}
          option={
            { ...plotBase, animation: false, series } as EChartsCoreOption
          }
        />
        <div className="handle-space">
          {(["start", "stop"] as const).map((k) => (
            <div
              key={k}
              role="slider"
              tabIndex={0}
              aria-label={gas + " " + k + " handle"}
              aria-valuemin={0}
              aria-valuemax={185}
              aria-valuenow={options[k]}
              className={"window-handle " + k}
              style={{ left: (options[k] / 185) * 100 + "%" }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const v = {
                    ...options,
                    [k]: Math.max(
                      k === "stop" ? options.start + 1 : 0,
                      Math.min(
                        k === "start" ? options.stop - 1 : 185,
                        options[k] + (e.key === "ArrowRight" ? 1 : -1),
                      ),
                    ),
                  };
                  preview(v);
                  commit(v);
                }
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const box =
                    e.currentTarget.parentElement!.getBoundingClientRect(),
                  v = Math.round(
                    Math.max(
                      0,
                      Math.min(185, ((e.clientX - box.left) / box.width) * 185),
                    ),
                  );
                const next = {
                  ...drag.current,
                  [k]:
                    k === "start"
                      ? Math.min(v, drag.current.stop - 1)
                      : Math.max(v, drag.current.start + 1),
                };
                drag.current = next;
                preview(next);
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId);
                commit(drag.current);
              }}
            >
              <span>
                {k} {options[k]}s
              </span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function Treatments() {
  const allFluxes = useRows();
  const s = useStore(),
    [log, setLog] = useState(false);
  const q = {
    gas: s.gas,
    from: s.from ? Date.parse(s.from) : undefined,
    to: s.to ? Date.parse(s.to) + 86400000 : undefined,
    sources: s.sources,
    fluxIds: s.subset,
  };
  const result = useQuery({
      queryKey: ["summary", q],
      queryFn: () => api.treatmentSummary(q),
    }),
    weather = useQuery({
      queryKey: ["weather", s.from, s.to],
      queryFn: () =>
        api.getSeries([1, 2], q.from, q.to, 20000).then((series) =>
          series.map((s) => {
            const days = new Map<number, number[]>();
            s.points.forEach((p) => {
              const day = Math.floor(p.time / 86400000) * 86400000;
              days.set(day, [...(days.get(day) ?? []), p.value]);
            });
            return {
              id: s.id,
              points: [...days].map(([time, v]) => ({
                time,
                value:
                  s.id === 2
                    ? v.reduce((a, b) => a + b, 0)
                    : v.reduce((a, b) => a + b, 0) / v.length,
              })),
            };
          }),
        ),
    });
  const d = result.data,
    ts = d?.treatments.filter((t) => !s.focus || t.id === s.focus) ?? [],
    ps = d?.plots.filter((p) => !s.focus || p.treatmentId === s.focus) ?? [];
  const colour = (id: number) => d?.treatments.find((t) => t.id === id)?.colour;
  const seriesTime = {
    grid: { left: 65, right: 30, top: 25, bottom: 65 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "time" },
    yAxis: { type: "value", scale: true },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 10 }],
  };
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h2>Treatment comparison</h2>
          <p>From individual fluxes to cumulative field response.</p>
        </div>
        <span className="badge">Excluded fluxes omitted from summaries</span>
      </div>
      <div className="toolbar panel">
        <Field label="Gas">
          <select
            value={s.gas}
            onChange={(e) => s.set({ gas: e.target.value as Gas })}
          >
            {["N2O", "CO2", "CO", "H2O", "licor_H2O"].map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input
            aria-label="Summary from"
            type="date"
            value={s.from}
            onChange={(e) => s.set({ from: e.target.value })}
          />
        </Field>
        <Field label="To">
          <input
            aria-label="Summary to"
            type="date"
            value={s.to}
            onChange={(e) => s.set({ to: e.target.value })}
          />
        </Field>
        {(["robot", "manual"] as const).map((source) => (
          <label key={source}>
            <input
              type="checkbox"
              checked={s.sources.includes(source)}
              onChange={(e) =>
                s.set({
                  sources: e.target.checked
                    ? [...s.sources, source]
                    : s.sources.filter((v) => v !== source),
                })
              }
            />
            {source}
          </label>
        ))}
        <button
          onClick={() =>
            s.set({ focus: null, from: "", to: "", subset: undefined })
          }
        >
          Reset view
        </button>
        <span className="muted">
          {s.subset ? s.subset.length + " selected fluxes" : "All plots"}
        </span>
      </div>
      <Status loading={result.isLoading} error={result.error} />
      {d && (
        <>
          <div className="toolbar brush">
            <span>Date-range brush</span>
            <input
              aria-label="Brush start date"
              type="range"
              min="0"
              max="728"
              value={
                s.from
                  ? Math.round(
                      (Date.parse(s.from) - Date.UTC(2023, 0, 4)) / 86400000,
                    )
                  : 0
              }
              onChange={(e) =>
                s.set({
                  from: new Date(
                    Date.UTC(2023, 0, 4) + Number(e.target.value) * 86400000,
                  )
                    .toISOString()
                    .slice(0, 10),
                })
              }
            />
            <input
              aria-label="Brush end date"
              type="range"
              min="0"
              max="728"
              value={
                s.to
                  ? Math.round(
                      (Date.parse(s.to) - Date.UTC(2023, 0, 4)) / 86400000,
                    )
                  : 728
              }
              onChange={(e) =>
                s.set({
                  to: new Date(
                    Date.UTC(2023, 0, 4) + Number(e.target.value) * 86400000,
                  )
                    .toISOString()
                    .slice(0, 10),
                })
              }
            />
          </div>
          <div className="treatment-legend">
            {d.treatments.map((t) => (
              <button
                key={t.id}
                className={s.focus === t.id ? "active" : ""}
                onClick={() => s.set({ focus: s.focus === t.id ? null : t.id })}
              >
                <span className="dot" style={{ background: t.colour }} />
                {t.name}
              </button>
            ))}
          </div>
          <div className="two charts">
            <Panel
              title="Cumulative total by treatment"
              extra={<small>{d.cumulativeUnit} · mean ± population SD</small>}
            >
              <Chart
                label="Treatment cumulative totals"
                height={280}
                onClick={(p) => {
                  if (p.dataIndex != null)
                    s.set({ focus: ts[p.dataIndex]?.id ?? null });
                }}
                option={
                  {
                    grid: { left: 65, right: 20, top: 25, bottom: 80 },
                    tooltip: { trigger: "axis" },
                    xAxis: {
                      type: "category",
                      data: ts.map((t) => t.name),
                      axisLabel: { rotate: 40, fontSize: 10 },
                    },
                    yAxis: { type: "value", name: "kg ha⁻¹" },
                    series: [
                      {
                        type: "bar",
                        data: ts.map((t) => ({
                          value: t.mean,
                          itemStyle: { color: t.colour },
                        })),
                        barMaxWidth: 34,
                      },
                      {
                        type: "custom",
                        data: ts.map((t, i) => [
                          i,
                          t.mean - t.sd,
                          t.mean + t.sd,
                        ]),
                        renderItem: (
                          _p: unknown,
                          a: {
                            value: (i: number) => number;
                            coord: (v: number[]) => number[];
                          },
                        ) => {
                          const lo = a.coord([a.value(0), a.value(1)]),
                            hi = a.coord([a.value(0), a.value(2)]);
                          return {
                            type: "group",
                            children: [
                              {
                                type: "line",
                                shape: {
                                  x1: lo[0],
                                  y1: lo[1],
                                  x2: hi[0],
                                  y2: hi[1],
                                },
                                style: { stroke: "#73838e" },
                              },
                              ...[lo, hi].map((v) => ({
                                type: "line",
                                shape: {
                                  x1: v[0] - 5,
                                  y1: v[1],
                                  x2: v[0] + 5,
                                  y2: v[1],
                                },
                                style: { stroke: "#73838e" },
                              })),
                            ],
                          };
                        },
                      },
                    ],
                  } as EChartsCoreOption
                }
              />
            </Panel>
            <Panel
              title="Distribution of daily means"
              extra={
                <label>
                  <input
                    type="checkbox"
                    checked={log}
                    onChange={(e) => setLog(e.target.checked)}
                  />{" "}
                  Log scale
                </label>
              }
            >
              <Chart
                label="Daily means box plot"
                height={280}
                option={
                  {
                    grid: { left: 65, right: 20, top: 25, bottom: 80 },
                    tooltip: { trigger: "item" },
                    xAxis: {
                      type: "category",
                      data: ts.map((t) => t.name),
                      axisLabel: { rotate: 40, fontSize: 10 },
                    },
                    yAxis: { type: log ? "log" : "value", scale: true },
                    series: [
                      {
                        type: "boxplot",
                        data: ts.map((t) => ({
                          value: log
                            ? t.box.map((v) => Math.max(0.001, v))
                            : t.box,
                          itemStyle: {
                            color: t.colour + "55",
                            borderColor: t.colour,
                          },
                        })),
                      },
                    ],
                  } as EChartsCoreOption
                }
              />
            </Panel>
          </div>
          <Panel
            title="Cumulative curves by plot"
            extra={
              <small>
                Trapezoid integration between measured days · kg ha⁻¹
              </small>
            }
          >
            <Chart
              label="Cumulative plot curves"
              option={
                {
                  ...seriesTime,
                  series: ps.map((p) => ({
                    type: "line",
                    name: p.label,
                    showSymbol: false,
                    lineStyle: { color: colour(p.treatmentId), width: 1.5 },
                    data: p.daily.map((v) => [v.time, v.cumulative]),
                  })),
                } as EChartsCoreOption
              }
            />
          </Panel>
          <Panel
            title="Individual fluxes"
            extra={<small>Click any point to open its trace →</small>}
          >
            <Chart
              label="Individual fluxes over time"
              height={290}
              onClick={(p) => {
                const value = p.value as number[];
                if (value?.[2]) s.openFlux(value[2]);
              }}
              option={
                {
                  ...seriesTime,
                  tooltip: {
                    trigger: "item",
                    formatter: (p: { value: number[]; seriesName: string }) =>
                      p.seriesName +
                      " · " +
                      date(p.value[0]) +
                      "<br/>Flux #" +
                      p.value[2] +
                      ": " +
                      fmt(p.value[1], 1),
                  },
                  series: [
                    ...ps.map((p) => ({
                      name: p.label,
                      type: "scatter",
                      symbolSize: 5,
                      itemStyle: {
                        color: colour(p.treatmentId),
                        opacity: 0.65,
                      },
                      data: p.points.map((v) => [v.time, v.value, v.fluxId]),
                    })),
                    {
                      name: "Excluded",
                      type: "scatter",
                      symbolSize: 5,
                      itemStyle: { color: "#8b969e", opacity: 0.25 },
                      data:
                        allFluxes.data?.rows
                          .filter(
                            (r) =>
                              r.excluded &&
                              (!s.focus || r.treatmentId === s.focus) &&
                              s.sources.includes(r.source) &&
                              (!q.from || r.time >= q.from) &&
                              (!q.to || r.time <= q.to),
                          )
                          .map((r) => [r.time, r[s.gas + "_flux"], r.id]) ?? [],
                    },
                  ],
                } as EChartsCoreOption
              }
            />
            <div className="point-links">
              {ps.slice(0, 6).map(
                (p) =>
                  p.points[0] && (
                    <button
                      key={p.plotId}
                      onClick={() => s.openFlux(p.points[0].fluxId)}
                    >
                      Open {p.label} · #{p.points[0].fluxId} ?
                    </button>
                  ),
              )}
            </div>
          </Panel>
          <Panel
            title="Weather context"
            extra={
              <small>
                Daily temperature and precipitation · shared date range above
              </small>
            }
          >
            <Chart
              label="Weather precipitation and temperature"
              height={190}
              option={
                {
                  ...seriesTime,
                  yAxis: [
                    { type: "value", name: "°C" },
                    { type: "value", name: "mm", splitLine: { show: false } },
                  ],
                  series: weather.data?.map((w, i) => ({
                    name: i ? "Precipitation" : "Temperature",
                    type: i ? "bar" : "line",
                    yAxisIndex: i,
                    showSymbol: false,
                    itemStyle: { color: i ? "#708ebd" : "#bd7d3e" },
                    areaStyle: i ? undefined : { opacity: 0.1 },
                    data: w.points.map((p) => [p.time, p.value]),
                  })),
                } as EChartsCoreOption
              }
            />
          </Panel>
          {!ps.some((p) => p.points.length) && (
            <Empty>No fluxes match this date range and source selection.</Empty>
          )}
        </>
      )}
    </div>
  );
}
function Data() {
  const s = useStore(),
    data = useRows(),
    action = useAction(),
    parent = useRef<HTMLDivElement>(null),
    [sorting, setSorting] = useState<SortingState>([]),
    [filters, setFilters] = useState<ColumnFiltersState>([]),
    [visible, setVisible] = useState<Record<string, boolean>>({
      filename: false,
      measurementId: false,
      x: false,
      y: false,
      note: false,
      CO_slope: false,
      H2O_slope: false,
      licor_H2O_slope: false,
    }),
    [chooser, setChooser] = useState(false),
    [selection, setSelection] = useState<Record<string, boolean>>({}),
    [exporting, setExporting] = useState(false),
    [mode, setMode] = useState<"flat" | "sheetPerPlot" | "dailyPerPlot">(
      "flat",
    ),
    [preset, setPreset] = useState(""),
    [presets, setPresets] = useState<Record<string, ColumnFiltersState>>(() =>
      JSON.parse(localStorage.getItem("ffr-presets") ?? "{}"),
    );
  const columns = useMemo<ColumnDef<FluxRow>[]>(
    () =>
      data.data?.columns.map((c) => ({
        id: c.key,
        accessorKey: c.key,
        header: c.label,
        filterFn: (row, id, value: string) => {
          const cell = row.getValue<Cell>(id);
          if (c.type === "number" || c.type === "time") {
            const [a, b] = value.split("..");
            const parse = (v: string) =>
              c.type === "time" ? Date.parse(v) : Number(v);
            return (
              (!a || Number(cell) >= parse(a)) &&
              (!b || Number(cell) <= parse(b))
            );
          }
          return String(cell ?? "")
            .toLowerCase()
            .includes(value.toLowerCase());
        },
        cell: (info) =>
          c.type === "time"
            ? date(Number(info.getValue()))
            : typeof info.getValue() === "number"
              ? fmt(
                  info.getValue(),
                  c.key === "id" ? 0 : c.key.endsWith("slope") ? 6 : 2,
                )
              : String(info.getValue() ?? "—"),
      })) ?? [],
    [data.data],
  );
  const defaultVisible = useMemo(() => {
    const v = { ...visible };
    data.data?.columns.forEach((c) => {
      if (
        !(c.key in v) &&
        ![
          "id",
          "source",
          "time",
          "side",
          "plotLabel",
          "treatmentName",
          "excluded",
          "reviewed",
          "overridden",
          "N2O_flux",
          "CO2_flux",
          "N2O_qc",
        ].includes(c.key)
      )
        v[c.key] = false;
    });
    return v;
  }, [data.data, visible]);
  const table = useReactTable({
    data: data.data?.rows ?? [],
    columns,
    state: {
      sorting,
      columnFilters: filters,
      columnVisibility: defaultVisible,
      globalFilter: s.dataSearch,
      rowSelection: selection,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setFilters,
    onColumnVisibilityChange: setVisible,
    onRowSelectionChange: setSelection,
    onGlobalFilterChange: (v) => s.set({ dataSearch: String(v) }),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (r) => String(r.id),
  });
  const rs = table.getRowModel().rows,
    virt = useVirtualizer({
      count: rs.length,
      getScrollElement: () => parent.current,
      estimateSize: () => 39,
      overscan: 12,
    }),
    ids = Object.keys(selection)
      .filter((k) => selection[k])
      .map(Number),
    exportIds = ids.length ? ids : rs.map((r) => r.original.id);
  const doExport = (csv: boolean) =>
    void action(
      async () => {
        const args: ExportArgs = {
          path: csv ? "fluxes.csv" : "fluxes.xlsx",
          fluxIds: exportIds,
          columns: table.getVisibleLeafColumns().map((c) => c.id),
        };
        if (isTauri) {
          const p = await save({ defaultPath: args.path });
          if (!p) return;
          args.path = p;
        }
        await (csv ? api.exportCsv(args) : api.exportXlsx({ ...args, mode }));
        setExporting(false);
      },
      mockMode ? "Downloaded synthetic CSV" : "Export complete",
    );
  return (
    <div className="page data-page">
      <div className="page-heading">
        <div>
          <h2>Measurement data</h2>
          <p>Filter, inspect and export the complete analysis table.</p>
        </div>
        <button className="primary" onClick={() => setExporting(true)}>
          Export data ↗
        </button>
      </div>
      <div className="toolbar panel">
        <input
          aria-label="Search table"
          placeholder="Search all columns…"
          value={s.dataSearch}
          onChange={(e) => s.set({ dataSearch: e.target.value })}
        />
        <button onClick={() => setChooser(!chooser)}>Columns</button>
        <button
          onClick={() => {
            s.set({ subset: exportIds });
            s.nav("Treatments");
          }}
        >
          Show in Treatments →
        </button>
        <span>
          {rs.length.toLocaleString()} matching · {ids.length} selected
        </span>
        <button
          onClick={() => {
            setFilters([]);
            s.set({ dataSearch: "" });
            setSelection({});
          }}
        >
          Clear filters
        </button>
      </div>
      <div className="toolbar">
        <input
          aria-label="Preset name"
          placeholder="Filter preset name"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
        />
        <button
          disabled={!preset}
          onClick={() => {
            const p = { ...presets, [preset]: filters };
            setPresets(p);
            localStorage.setItem("ffr-presets", JSON.stringify(p));
          }}
        >
          Save preset
        </button>
        <select
          aria-label="Load preset"
          onChange={(e) => setFilters(presets[e.target.value] ?? [])}
        >
          <option value="">Load preset…</option>
          {Object.keys(presets).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <small>
          Numeric / date ranges: minimum..maximum · Click headers to sort
        </small>
      </div>
      {chooser && (
        <Panel title="Visible columns">
          <div className="column-groups">
            {[...new Set(data.data?.columns.map((c) => c.group))].map(
              (group) => (
                <div key={group}>
                  <h4>{group}</h4>
                  {table
                    .getAllLeafColumns()
                    .filter(
                      (col) =>
                        data.data?.columns.find((c) => c.key === col.id)
                          ?.group === group,
                    )
                    .map((col) => (
                      <label key={col.id}>
                        <input
                          type="checkbox"
                          checked={col.getIsVisible()}
                          onChange={col.getToggleVisibilityHandler()}
                        />
                        {col.id}
                      </label>
                    ))}
                </div>
              ),
            )}
          </div>
        </Panel>
      )}
      <Status loading={data.isLoading} error={data.error} />
      <div className="table-scroll panel" ref={parent}>
        <table>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                <th>
                  <input
                    aria-label="Select all matching rows"
                    type="checkbox"
                    checked={rs.length > 0 && rs.every((r) => selection[r.id])}
                    onChange={(e) =>
                      setSelection(
                        e.target.checked
                          ? Object.fromEntries(rs.map((r) => [r.id, true]))
                          : {},
                      )
                    }
                  />
                </th>
                {hg.headers.map((h) => (
                  <th key={h.id}>
                    <button onClick={h.column.getToggleSortingHandler()}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === "asc"
                        ? " ?"
                        : h.column.getIsSorted() === "desc"
                          ? " ?"
                          : ""}
                    </button>
                    <input
                      aria-label={"Filter " + h.id}
                      placeholder={
                        data.data?.columns.find((c) => c.key === h.id)?.type ===
                        "number"
                          ? "min..max"
                          : "Filter…"
                      }
                      value={String(h.column.getFilterValue() ?? "")}
                      onChange={(e) => h.column.setFilterValue(e.target.value)}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            <tr style={{ height: virt.getVirtualItems()[0]?.start ?? 0 }}>
              <td colSpan={columns.length + 1} />
            </tr>
            {virt.getVirtualItems().map((v) => {
              const r = rs[v.index];
              return (
                <tr
                  key={r.id}
                  className={r.original.excluded ? "excluded" : ""}
                  style={{ height: 39 }}
                >
                  <td>
                    <input
                      aria-label={"Select flux " + r.id}
                      type="checkbox"
                      checked={!!selection[r.id]}
                      onChange={r.getToggleSelectedHandler()}
                    />
                  </td>
                  {r.getVisibleCells().map((c) => (
                    <td key={c.id}>
                      <button
                        className="cell"
                        onClick={() => s.openFlux(r.original.id)}
                      >
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </button>
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr
              style={{
                height: Math.max(
                  0,
                  virt.getTotalSize() -
                    (virt.getVirtualItems().at(-1)?.end ?? 0),
                ),
              }}
            >
              <td colSpan={columns.length + 1} />
            </tr>
          </tbody>
        </table>
        {!rs.length && (
          <Empty>No rows match. Clear filters to see all measurements.</Empty>
        )}
      </div>
      {exporting && (
        <div className="modal-shade">
          <section
            role="dialog"
            aria-label="Export data"
            className="modal panel"
          >
            <h2>Export measurements</h2>
            <p>
              {exportIds.length.toLocaleString()} fluxes ·{" "}
              {table.getVisibleLeafColumns().length} visible columns
            </p>
            <Field label="Workbook layout">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="flat">Flat table</option>
                <option value="sheetPerPlot">Sheet per plot</option>
                <option value="dailyPerPlot">Daily means per plot</option>
              </select>
            </Field>
            {mockMode && (
              <p className="muted">
                Browser demo downloads CSV. Grouped and daily layouts use the
                selected mode.
              </p>
            )}
            <div className="toolbar">
              <button className="primary" onClick={() => doExport(false)}>
                {mockMode ? "Download selected layout" : "Export Excel"}
              </button>
              <button onClick={() => doExport(true)}>Flat CSV</button>
              <button onClick={() => setExporting(false)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function External() {
  const action = useAction(),
    series = useQuery({
      queryKey: ["series"],
      queryFn: () => api.listSeries(),
    }),
    [selected, setSelected] = useState(1),
    [wizard, setWizard] = useState<"series" | "manual" | null>(null),
    [path, setPath] = useState(""),
    [sheet, setSheet] = useState("Measurements"),
    [header, setHeader] = useState(0),
    [timeCol, setTimeCol] = useState("date"),
    [values, setValues] = useState(["temperature"]),
    [aggregate, setAggregate] = useState<"mean" | "sum" | "none">("mean"),
    [preview, setPreview] =
      useState<Awaited<ReturnType<typeof api.previewTable>>>(),
    [station, setStation] = useState("SN17850"),
    [client, setClient] = useState(""),
    [from, setFrom] = useState("2023-01-01"),
    [to, setTo] = useState("2024-12-31");
  const points = useQuery({
    queryKey: ["series-points", selected],
    queryFn: () => api.getSeries([selected]),
  });
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h2>External data</h2>
          <p>
            Weather, soil conditions and manual chamber campaigns alongside your
            fluxes.
          </p>
        </div>
        <div className="button-group">
          <button onClick={() => setWizard("manual")}>
            Import manual fluxes
          </button>
          <button className="primary" onClick={() => setWizard("series")}>
            Import series +
          </button>
        </div>
      </div>
      <Status loading={series.isLoading} error={series.error} />
      <div className="external-grid">
        <Panel title="Connected series">
          {series.data?.map((v) => (
            <div
              className={"series-row " + (selected === v.id ? "active" : "")}
              key={v.id}
            >
              <button onClick={() => setSelected(v.id)}>
                <strong>{v.name}</strong>
                <small>
                  {v.source} · {v.count.toLocaleString()} hourly values ·{" "}
                  {v.unit}
                </small>
              </button>
              <button
                aria-label={"Delete " + v.name}
                onClick={() => void action(() => api.deleteSeries(v.id))}
              >
                ×
              </button>
            </div>
          ))}
          {!series.data?.length && (
            <Empty>No series yet. Import a logger or fetch weather.</Empty>
          )}
        </Panel>
        <Panel
          title={
            series.data?.find((v) => v.id === selected)?.name ??
            "Series preview"
          }
        >
          <Status loading={points.isLoading} error={points.error} />
          <Chart
            label="External series preview"
            height={290}
            option={
              {
                grid: { left: 55, right: 25, top: 20, bottom: 65 },
                tooltip: { trigger: "axis" },
                xAxis: { type: "time" },
                yAxis: { type: "value", scale: true },
                dataZoom: [{ type: "inside" }, { type: "slider", height: 18 }],
                series: points.data?.map((p) => ({
                  type: "line",
                  showSymbol: false,
                  lineStyle: { color: "#24877b", width: 1 },
                  areaStyle: { opacity: 0.08 },
                  data: p.points.map((v) => [v.time, v.value]),
                })),
              } as EChartsCoreOption
            }
          />
        </Panel>
      </div>
      {wizard && (
        <Panel
          title={
            wizard === "manual" ? "Import manual fluxes" : "Import time series"
          }
          extra={
            <button
              onClick={() => {
                setWizard(null);
                setPreview(undefined);
              }}
            >
              Close
            </button>
          }
        >
          <div className="form-grid">
            <Field label="Excel / CSV path">
              <input value={path} onChange={(e) => setPath(e.target.value)} />
            </Field>
            <button onClick={() => void pick().then((p) => p && setPath(p))}>
              Browse file
            </button>
            <button
              onClick={() =>
                void action(async () =>
                  setPreview(
                    await api.previewTable(path, { headerRow: header, sheet }),
                  ),
                )
              }
            >
              Preview table
            </button>
          </div>
          {preview && (
            <>
              <div className="form-grid">
                <Field label="Sheet">
                  <select
                    value={sheet}
                    onChange={(e) => setSheet(e.target.value)}
                  >
                    {preview.sheets.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Header row (zero based)">
                  <input
                    type="number"
                    min="0"
                    value={header}
                    onChange={(e) => setHeader(Number(e.target.value))}
                  />
                </Field>
                <Field label="Time column">
                  <select
                    value={timeCol}
                    onChange={(e) => setTimeCol(e.target.value)}
                  >
                    {preview.columns.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Aggregation">
                  <select
                    value={aggregate}
                    onChange={(e) =>
                      setAggregate(e.target.value as typeof aggregate)
                    }
                  >
                    <option>mean</option>
                    <option>sum</option>
                    <option>none</option>
                  </select>
                </Field>
              </div>
              <p>Value columns</p>
              <div className="toolbar">
                {preview.columns
                  .filter((c) => c !== timeCol)
                  .map((c) => (
                    <label key={c}>
                      <input
                        type="checkbox"
                        checked={values.includes(c)}
                        onChange={(e) =>
                          setValues(
                            e.target.checked
                              ? [...values, c]
                              : values.filter((v) => v !== c),
                          )
                        }
                      />
                      {c}
                    </label>
                  ))}
              </div>
              <div className="preview-table">
                <table>
                  <thead>
                    <tr>
                      {preview.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i}>
                        {r.map((v, j) => (
                          <td key={j}>{String(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {wizard === "manual" && (
                <p>
                  Manual mapping: date ? {timeCol}, plot → plot, N2O ? N2O, CO2
                  ? CO2; +12 h offset.
                </p>
              )}
              <button
                className="primary"
                disabled={!values.length}
                onClick={() =>
                  void action(async () => {
                    if (wizard === "manual")
                      await api.importManualFluxes({
                        path,
                        sheet,
                        headerRow: header,
                        dateColumn: timeCol,
                        plotColumn: "plot",
                        gasColumns: { N2O: "N2O", CO2: "CO2" },
                        offsetHours: 12,
                      });
                    else
                      await api.importSeries({
                        path,
                        sheet,
                        headerRow: header,
                        timeColumn: timeCol,
                        valueColumns: values,
                        aggregate,
                      });
                    setWizard(null);
                  }, "Synthetic import complete")
                }
              >
                Import mapped data
              </button>
            </>
          )}
        </Panel>
      )}
      <Panel title="met.no weather">
        <p className="muted">
          Hourly temperature and precipitation. Client ID stays outside the
          project.
        </p>
        <div className="form-grid">
          <Field label="Station">
            <input
              value={station}
              onChange={(e) => setStation(e.target.value)}
            />
          </Field>
          <Field label="Frost client ID">
            <input
              type="password"
              autoComplete="off"
              value={client}
              onChange={(e) => setClient(e.target.value)}
            />
          </Field>
          <Field label="From">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
        <button
          onClick={() =>
            void action(async () => {
              await api.metnoSetClientId(client);
              setClient("");
              await api.metnoFetch({
                station,
                from: Date.parse(from),
                to: Date.parse(to),
              });
            }, "Weather updated")
          }
        >
          {mockMode ? "Simulate weather fetch" : "Fetch weather"}
        </button>
      </Panel>
    </div>
  );
}
function Project() {
  const navigation = useStore();
  const action = useAction(),
    q = useQuery({ queryKey: ["config"], queryFn: () => api.getConfig() }),
    l = useQuery({ queryKey: ["layout"], queryFn: () => api.getLayout() }),
    h = useQuery({ queryKey: ["history"], queryFn: () => api.history(15) }),
    [draft, setDraft] = useState<ProjectConfig | null>(null),
    [edited, setEdited] = useState<Awaited<
      ReturnType<typeof api.getLayout>
    > | null>(null);
  const cfg = draft ?? q.data,
    layout = edited ?? l.data;
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h2>Project settings</h2>
          <p>One portable project. Every decision recorded.</p>
        </div>
        <div className="button-group">
          <button
            onClick={() =>
              void pick().then((p) =>
                p
                  ? action(
                      () => api.importRawFiles([p]),
                      "Robot files imported",
                    )
                  : undefined,
              )
            }
          >
            Add robot files...
          </button>
          <button
            onClick={() =>
              void action(async () => {
                await api.projectClose();
                navigation.nav("Start");
              })
            }
          >
            Close project
          </button>
          <button
            onClick={() =>
              void pick(false, true).then((p) =>
                p
                  ? action(() => api.projectSaveCopy(p), "Backup copy saved")
                  : undefined,
              )
            }
          >
            Save backup copy…
          </button>
        </div>
      </div>
      <Status loading={q.isLoading} error={q.error} />
      {cfg && (
        <div className="two">
          <Panel title="Project & analysis defaults">
            <div className="form-grid">
              <Field label="Project name">
                <input
                  value={cfg.name}
                  onChange={(e) => setDraft({ ...cfg, name: e.target.value })}
                />
              </Field>
              <Field label="Time zone">
                <input
                  value={cfg.timeZone}
                  onChange={(e) =>
                    setDraft({ ...cfg, timeZone: e.target.value })
                  }
                />
              </Field>
              {(["start", "stop", "cutBeginnings", "cutEnds"] as const).map(
                (k) => (
                  <Field key={k} label={k + " · s"}>
                    <input
                      type="number"
                      value={cfg.defaults[k]}
                      onChange={(e) =>
                        setDraft({
                          ...cfg,
                          defaults: {
                            ...cfg.defaults,
                            [k]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                ),
              )}
              <Field label="Fallback temperature · °C">
                <input
                  type="number"
                  value={cfg.fallbackTemperature}
                  onChange={(e) =>
                    setDraft({
                      ...cfg,
                      fallbackTemperature: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Chamber height · m">
                <input
                  type="number"
                  step="0.1"
                  value={cfg.chamberHeight}
                  onChange={(e) =>
                    setDraft({ ...cfg, chamberHeight: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <p className="muted">
              Gases: {cfg.gases.join(", ")} · N2O as µg N m⁻² h⁻¹ · CO2 as µg C
              m⁻² h⁻¹
            </p>
            <button
              className="primary"
              onClick={() =>
                void action(async () => {
                  await api.setConfig(cfg);
                  setDraft(null);
                }, "Project settings saved")
              }
            >
              Save & recompute
            </button>
          </Panel>
          <Panel
            title="Field layout"
            extra={<small>36 plots · 3 replicates per treatment</small>}
          >
            <Chart
              label="Field plot map"
              height={330}
              option={
                {
                  grid: { left: 35, right: 20, top: 20, bottom: 35 },
                  tooltip: { trigger: "item" },
                  xAxis: {
                    type: "value",
                    name: "East",
                    nameLocation: "middle",
                    nameGap: 25,
                    min: -1,
                    max: 6,
                  },
                  yAxis: {
                    type: "value",
                    name: "North",
                    nameLocation: "middle",
                    nameGap: 25,
                    min: -1,
                    max: 6,
                  },
                  series: [
                    {
                      type: "scatter",
                      symbol: "rect",
                      symbolSize: 36,
                      data: layout?.plots.map((p, i) => ({
                        name: p.label,
                        value: [i % 6, 5 - Math.floor(i / 6)],
                        itemStyle: {
                          color: layout.treatments.find(
                            (t) => t.id === p.treatmentId,
                          )?.colour,
                        },
                        label: {
                          show: true,
                          formatter: p.label,
                          color: "#fff",
                          fontSize: 10,
                        },
                      })),
                    },
                  ],
                } as EChartsCoreOption
              }
            />
          </Panel>
        </div>
      )}
      {layout && (
        <Panel
          title="Treatments & plots"
          extra={
            <button
              onClick={() =>
                void action(async () => {
                  await api.setLayout(layout);
                  setEdited(null);
                }, "Field layout saved")
              }
            >
              Save field layout
            </button>
          }
        >
          <div className="layout-editor">
            {layout.treatments.map((t, i) => (
              <div key={t.id} className="treatment-edit">
                <input
                  aria-label={"Colour " + t.name}
                  type="color"
                  value={t.colour}
                  onChange={(e) => {
                    const next = structuredClone(layout);
                    next.treatments[i].colour = e.target.value;
                    setEdited(next);
                  }}
                />
                <input
                  aria-label={"Treatment " + t.id}
                  value={t.name}
                  onChange={(e) => {
                    const next = structuredClone(layout);
                    next.treatments[i].name = e.target.value;
                    setEdited(next);
                  }}
                />
                <small>
                  {layout.plots
                    .filter((p) => p.treatmentId === t.id)
                    .map((p) => p.label)
                    .join(" · ")}
                </small>
              </div>
            ))}
          </div>
          <details style={{ marginTop: 20 }}>
            <summary>Edit plot labels and treatment assignments</summary>
            <div className="layout-editor" style={{ marginTop: 15 }}>
              {layout.plots.map((p, i) => (
                <div className="two" key={p.id}>
                  <input
                    aria-label={"Plot label " + p.id}
                    value={p.label}
                    onChange={(e) => {
                      const next = structuredClone(layout);
                      next.plots[i].label = e.target.value;
                      setEdited(next);
                    }}
                  />
                  <select
                    aria-label={"Plot treatment " + p.id}
                    value={p.treatmentId}
                    onChange={(e) => {
                      const next = structuredClone(layout);
                      next.plots[i].treatmentId = Number(e.target.value);
                      setEdited(next);
                    }}
                  >
                    {layout.treatments.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </details>
        </Panel>
      )}
      <Panel title="Change history">
        {h.data?.length ? (
          h.data.map((c) => (
            <div className="history-row" key={c.id}>
              <span>{new Date(c.time).toLocaleTimeString()}</span>
              <strong>{c.kind}</strong>
              <span>
                {c.fluxIds.length ? "Flux " + c.fluxIds.join(", ") : "Project"}
              </span>
            </div>
          ))
        ) : (
          <p className="muted">
            Edits will appear here. All edits can be undone.
          </p>
        )}
      </Panel>
    </div>
  );
}
export default function App() {
  const s = useStore(),
    action = useAction(),
    [toast, setToast] = useState(""),
    [progress, setProgress] = useState<Progress | null>(null);
  const info = useQuery({
    queryKey: ["project"],
    queryFn: () => api.projectInfo(),
  });
  useEffect(() => {
    toastFn = setToast;
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = s.theme;
    localStorage.setItem("ffr-theme", s.theme);
  }, [s.theme]);
  useEffect(() => {
    let disposed = false,
      off: (() => void) | undefined;
    void api
      .onProgress((p) => {
        setProgress(p);
        if (p.done === p.total) setTimeout(() => setProgress(null), 1500);
      })
      .then((fn) => {
        if (disposed) fn();
        else off = fn;
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  const screens: Screen[] = [
      "Start",
      "Review",
      "Treatments",
      "Data",
      "External data",
      "Project",
    ],
    icons = ["⌂", "∿", "▥", "▦", "☁", "⚙"];
  return (
    <div className="app-shell">
      <nav className="rail">
        <div className="brand">
          <span className="brand-mark">f</span>
          <div>
            FFR <strong>Analyzer</strong>
            <small>FIELD SCIENCE / 02</small>
          </div>
        </div>
        <div className="nav-group">WORKSPACE</div>
        {screens.map((screen, i) => (
          <button
            key={screen}
            disabled={screen !== "Start" && !info.data}
            className={s.screen === screen ? "active" : ""}
            onClick={() => s.nav(screen)}
          >
            <span aria-hidden="true">{icons[i]}</span>
            {screen}
          </button>
        ))}
        <div className="rail-bottom">
          <div className="project-state">
            <span className="dot" style={{ background: "#259b7c" }} />
            {info.data ? "Project open" : "No project open"}
            <small>
              {mockMode ? "Synthetic browser demo" : "Tauri desktop"}
            </small>
          </div>
          <button
            aria-label="Toggle theme"
            onClick={() =>
              s.set({ theme: s.theme === "light" ? "dark" : "light" })
            }
          >
            {s.theme === "light" ? "☾ Dark theme" : "☀ Light theme"}
          </button>
        </div>
      </nav>
      <div className="workspace">
        <header className="topbar">
          <span>
            {info.data?.name ?? "FFR Analyzer"}{" "}
            <span className="muted">/ {s.screen}</span>
          </span>
          <div className="button-group">
            {mockMode && <span className="demo-label">SYNTHETIC DATA</span>}
            <button
              onClick={() => void action(() => api.undo())}
              title="Undo (Ctrl+Z)"
            >
              ↶ Undo
            </button>
            <button
              onClick={() => void action(() => api.redo())}
              title="Redo (Ctrl+Y)"
            >
              ↷ Redo
            </button>
          </div>
        </header>
        <div className="screen-body">
          {screens.map((screen) => (
            <div
              key={screen}
              hidden={s.screen !== screen}
              className="screen-slot"
            >
              {screen === "Start" ? (
                <Start />
              ) : info.data ? (
                screen === "Review" ? (
                  <Review />
                ) : screen === "Treatments" ? (
                  <Treatments />
                ) : screen === "Data" ? (
                  <Data />
                ) : screen === "External data" ? (
                  <External />
                ) : (
                  <Project />
                )
              ) : (
                <Empty>Open a project to begin.</Empty>
              )}
            </div>
          ))}
        </div>
        <footer className="statusbar">
          <span>
            ? {mockMode ? "Demo session" : "Ready"} ·{" "}
            {info.data?.timeZone ?? "Europe/Oslo"}
          </span>
          <span>
            {progress
              ? progress.task +
                " · " +
                Math.round((progress.done / progress.total) * 100) +
                "%"
              : info.data
                ? "Edits saved automatically · Undo available"
                : "A complete field analysis workspace"}
          </span>
        </footer>
      </div>
      {toast && (
        <div role="status" className="toast">
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
