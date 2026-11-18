import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { AnalysisOptions, FluxDetail, Gas } from "../../api/types";
import {
  Empty,
  Status,
  attention,
  dateTime,
  error,
  significant,
  toastFn,
  unit,
  useAction,
  useRows,
} from "../../shared/common";
import { diagnosticLabels } from "../../shared/diagnostics";
import { useDiagnostics } from "../../shared/hooks/useDiagnostics";
import { useStore } from "../../store";
import {
  ActiveFilters,
  ContactSheet,
  QueueFilters,
  QueueList,
  useQueue,
} from "./Queue";
import { TraceChart } from "./TraceChart";
import { nextQueueId } from "./navigation";
const gasNames: Gas[] = ["N2O", "CO2", "CO", "H2O", "licor_H2O"];
export function Review() {
  const s = useStore(),
    action = useAction(),
    data = useRows(),
    filtered = useQueue(data.data?.rows ?? []),
    initialized = useRef(false),
    previousQueue = useRef<number[]>([]);
  const [multi, setMulti] = useState<number[]>([]),
    [traces, setTraces] = useState<Gas[]>(["N2O", "CO2"]),
    [goto, setGoto] = useState(""),
    [showGoto, setShowGoto] = useState(false),
    [hint, setHint] = useState(
      () => localStorage.getItem("ffr-shortcuts") !== "hidden",
    );
  const [scope, setScope] = useState<"flux" | "file" | "day">("flux"),
    [offsetGas, setOffsetGas] = useState<"all" | "N2Oall" | "CO2" | "N2O">(
      "all",
    ),
    [editGas, setEditGas] = useState<Gas>("N2O"),
    [modeInfo, setModeInfo] = useState(false);
  const layout = useQuery({
      queryKey: ["layout"],
      enabled: s.screen === "Review",
      queryFn: () => api.getLayout(),
    }),
    definitions = useDiagnostics(s.screen === "Review");
  const detail = useQuery({
    queryKey: ["detail", s.selected],
    queryFn: () => api.getFluxDetail(s.selected),
    enabled:
      s.screen === "Review" &&
      !!data.data?.rows.some((r) => r.id === s.selected),
    placeholderData: keepPreviousData,
  });
  const [preview, setPreview] = useState<FluxDetail | null>(null),
    [draft, setDraft] = useState<AnalysisOptions | null>(null),
    serial = useRef(0),
    // At most one preview in flight; while it runs only the newest request waits.
    queued = useRef<{
      id: number;
      options: AnalysisOptions;
      request: number;
    } | null>(null),
    previewing = useRef(false),
    // Handle drags and arrow keys are saved once the user pauses, not per step.
    unsaved = useRef<{ id: number; options: AnalysisOptions } | null>(null),
    saveTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (data.isSuccess && !initialized.current) {
      initialized.current = true;
      if (!s.back && !s.reviewIds && filtered.length) {
        // Opening a project resumes at the flux last viewed in it.
        const last = lastViewed(s.projectPath);
        s.set({
          selected:
            last !== null && data.data.rows.some((r) => r.id === last)
              ? last
              : filtered[0].id,
        });
      }
    }
  }, [data.isSuccess, data.data, filtered, s]);
  useEffect(() => {
    if (initialized.current && detail.data?.flux.id === s.selected)
      rememberViewed(s.projectPath, s.selected);
  }, [s.projectPath, s.selected, detail.data]);
  useEffect(() => {
    if (filtered.some((r) => r.id === s.selected))
      previousQueue.current = filtered.map((r) => r.id);
  }, [filtered, s.selected]);
  useEffect(() => {
    // A background refresh must not throw away a change that is about to be saved.
    if (unsaved.current && unsaved.current.id === detail.data?.flux.id) return;
    setPreview(null);
    setDraft(null);
    serial.current++;
  }, [detail.data]);
  const d =
      preview?.flux.id === detail.data?.flux.id
        ? (preview ?? detail.data)
        : detail.data,
    active = d?.flux.id ?? s.selected;
  const base = d?.options,
    o =
      draft ??
      (base
        ? {
            ...base,
            valveOffset: base.valveOffset ?? 0,
            perGas: base.perGas ?? {},
          }
        : undefined);
  const displayedRow = data.data?.rows.find((r) => r.id === active),
    flux = d ? { ...displayedRow, ...d.flux } : undefined;
  const index = filtered.findIndex((r) => r.id === active),
    targets = s.contactSheet && multi.length ? multi : [active];
  const queueRows =
    filtered.some((r) => r.id === active) || !displayedRow
      ? filtered
      : [displayedRow, ...filtered];
  function step(direction: number) {
    const next = nextQueueId(
      active,
      direction,
      filtered.map((r) => r.id),
      previousQueue.current,
    );
    if (next !== undefined) s.set({ selected: next });
  }
  function markAndNext() {
    const next = nextQueueId(
        active,
        1,
        filtered.map((r) => r.id),
        previousQueue.current,
      ),
      ids = [...targets];
    void action(async () => {
      await api.setFluxFlags(ids, { reviewed: true });
      if (next !== undefined) s.set({ selected: next });
    });
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        s.screen !== "Review" ||
        (e.target as HTMLElement).matches("input,textarea,select,[role=slider]")
      )
        return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ["z", "y"].includes(key)) {
        e.preventDefault();
        // Undo applies to the adjustment just made, so save it first.
        void save().then(() =>
          action(() => (key === "z" ? api.undo() : api.redo())),
        );
      } else if (key === "arrowright" || key === "arrowdown") {
        e.preventDefault();
        step(1);
      } else if (key === "arrowleft" || key === "arrowup") {
        e.preventDefault();
        step(-1);
      } else if (key === "x" && d)
        void action(() =>
          api.setFluxFlags(targets, {
            excluded: !targets.every(
              (id) => data.data?.rows.find((r) => r.id === id)?.excluded,
            ),
          }),
        );
      else if (key === "a" && d) markAndNext();
      else if (key === "r" && d)
        void action(() => api.setFluxOptions([active], null));
      else if (key === "g") setShowGoto(true);
      else if (key === "s" && d?.siblingFluxId)
        s.set({ selected: d.siblingFluxId });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  async function pumpPreviews() {
    if (previewing.current) return;
    previewing.current = true;
    try {
      while (queued.current) {
        const job = queued.current;
        queued.current = null;
        try {
          const v = await api.previewFlux(job.id, job.options);
          if (job.request === serial.current) setPreview(v);
        } catch (e) {
          error(e);
        }
      }
    } finally {
      previewing.current = false;
    }
  }
  function changePreview(next: AnalysisOptions) {
    setDraft(next);
    // Still adjusting: postpone the save until the user pauses again.
    clearTimeout(saveTimer.current);
    if (unsaved.current) unsaved.current = { id: active, options: next };
    queued.current = { id: active, options: next, request: ++serial.current };
    void pumpPreviews();
  }
  function save(): Promise<void> {
    clearTimeout(saveTimer.current);
    const job = unsaved.current;
    unsaved.current = null;
    if (!job) return Promise.resolve();
    serial.current++;
    queued.current = null;
    return action(() => api.setFluxOptions([job.id], job.options));
  }
  /** Saves `next`; with `later`, waits for a pause so repeated drags cost one save. */
  function commit(next: AnalysisOptions, later = false) {
    unsaved.current = { id: active, options: next };
    clearTimeout(saveTimer.current);
    if (later) saveTimer.current = setTimeout(save, 600);
    else void save();
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  // Leaving a flux (or the screen) saves what was adjusted on it.
  useEffect(() => () => void saveRef.current(), [active]);
  const findings = [...(d?.diagnostics ?? [])].sort(
    (a, b) =>
      ({ bad: 0, warn: 1, info: 2 })[a.severity] -
      { bad: 0, warn: 1, info: 2 }[b.severity],
  );
  const definition = (code: string) =>
    definitions.data?.find((c) => c.code === code)?.label ??
    diagnosticLabels[code] ??
    code.replaceAll("_", " ");
  const editOptions = o ? { ...o, ...o.perGas?.[editGas] } : undefined;
  function setGasOption(
    key: "start" | "stop" | "cutBeginnings" | "cutEnds" | "valveOffset",
    value: number,
  ) {
    if (!o) return;
    const next = {
      ...o,
      perGas: {
        ...o.perGas,
        [editGas]: { ...o.perGas?.[editGas], [key]: value },
      },
    };
    changePreview(next);
    return next;
  }
  function applyLag(gas: "N2O" | "CO2" | "all" | "N2Oall") {
    if (!d || !o) return;
    const co2 = d.valveLagS,
      n2o = Number(d.flux.N2O_lagS);
    const delta = gas.startsWith("N2O") ? n2o : co2;
    if (!Number.isFinite(delta)) return;
    const day = (t: number) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: s.timeZone }).format(t),
      ids = (data.data?.rows ?? [])
        .filter((r) =>
          scope === "flux"
            ? r.id === active
            : scope === "file"
              ? r.measurementId !== null &&
                r.measurementId === d.flux.measurementId
              : r.source === "robot" && day(r.time) === day(d.flux.time),
        )
        .map((r) => r.id);
    const partial: Partial<AnalysisOptions> =
      gas === "all" || gas === "N2Oall"
        ? {
            valveOffset: delta,
            perGas: Object.fromEntries(
              gasNames.map((g) => [g, { valveOffset: delta }]),
            ),
          }
        : { perGas: { [gas]: { valveOffset: delta } } };
    void action(
      () => api.patchFluxOptions(ids, partial),
      "Valve offset applied",
    );
  }
  function go() {
    const rows = data.data?.rows ?? [],
      r = goto.includes("-")
        ? rows.find((r) => r.time >= Date.parse(goto))
        : rows.find((r) => r.id === Number(goto));
    if (r) {
      s.set({
        selected: r.id,
        quick: "all",
        reviewIds: undefined,
        diagnosticCodes: [],
        search: "",
        treatment: "",
        plot: "",
        reviewFrom: "",
        reviewTo: "",
      });
      setShowGoto(false);
    } else toastFn("No matching measurement");
  }
  if (s.contactSheet)
    return (
      <div className="contact-page">
        <div className="page-heading">
          <div>
            <h2>Contact sheet</h2>
            <p>
              Scan the current queue; Ctrl/Cmd or Shift selects traces for bulk
              actions.
            </p>
          </div>
          <button onClick={() => s.set({ contactSheet: false })}>
            List & detail view
          </button>
        </div>
        <div className="toolbar">
          <QueueFilters rows={data.data?.rows ?? []} />
          <ActiveFilters rows={data.data?.rows ?? []} />
          <button
            disabled={!multi.length}
            onClick={() =>
              void action(() => api.setFluxFlags(multi, { excluded: true }))
            }
          >
            Exclude selected
          </button>
          <button
            disabled={!multi.length}
            onClick={() =>
              void action(() => api.setFluxFlags(multi, { excluded: false }))
            }
          >
            Include selected
          </button>
          <button
            disabled={!multi.length}
            onClick={() =>
              void action(() => api.setFluxFlags(multi, { reviewed: true }))
            }
          >
            Mark selected reviewed
          </button>
          <button onClick={() => setMulti([])}>Clear selection</button>
        </div>
        <ContactSheet rows={filtered} selected={multi} onSelect={setMulti} />
      </div>
    );
  function result(gas: Gas) {
    const r = d?.regressions.find((r) => r.gas === gas),
      robust = d?.robust?.find((r) => r.gas === gas),
      value = flux?.[gas + "_robustFlux"] ?? robust?.flux,
      impact = flux?.[gas + "_impact"],
      gasExcluded = flux?.[gas + "_excluded"] === true,
      dropout = findings.find(
        (f) => f.code === "zero_readings" && f.gas === gas,
      ),
      zeros = Number(dropout?.value ?? 0);
    return (
      <section
        className={"compact-result" + (gasExcluded ? " gas-excluded" : "")}
        key={gas}
      >
        <div>
          <strong>{gas}</strong>
          <b>{significant(r?.flux)}</b>
          <small>{unit(r?.fluxUnit)}</small>
        </div>
        {(gasExcluded || dropout) && (
          <div className="gas-exclusion">
            <span>
              {gasExcluded
                ? gas + " excluded · not in summaries"
                : "Instrument dropout · " +
                  (zeros
                    ? zeros + " zero reading" + (zeros === 1 ? "" : "s")
                    : "missing readings") +
                  " left out of the fit"}
            </span>
            <button
              onClick={() =>
                void action(() =>
                  api.setFluxFlags([active], {
                    gasExcluded: { [gas]: !gasExcluded },
                  }),
                )
              }
            >
              {gasExcluded ? "Include " + gas : "Exclude " + gas}
            </button>
          </div>
        )}
        <div className="result-robust">
          <span>
            Robust <strong>{significant(value)}</strong>
          </span>
          <span>
            Impact{" "}
            <strong>
              {typeof impact === "number"
                ? Math.round(impact * 100) + "%"
                : "—"}
            </strong>
          </span>
        </div>
        <div className="result-stat">
          R² {significant(r?.rsq, 3)} · p{" "}
          {typeof r?.pval === "number" ? r.pval.toExponential(1) : "—"} · n{" "}
          {r?.n ?? "—"}
        </div>
      </section>
    );
  }
  return (
    <div className="review dense-review">
      <aside className="queue panel">
        <div className="queue-caption">
          <strong>Review queue</strong>
          <span>{filtered.length.toLocaleString()}</span>
          <button onClick={() => s.set({ contactSheet: true })}>
            Contact sheet ▦
          </button>
        </div>
        <QueueFilters rows={data.data?.rows ?? []} />
        <ActiveFilters rows={data.data?.rows ?? []} />
        <Status loading={data.isLoading} error={data.error} />
        <QueueList rows={queueRows} />
        <div className="queue-footer">
          {(
            data.data?.rows.filter((r) => r.reviewed).length ?? 0
          ).toLocaleString()}{" "}
          reviewed · Selected #{active}
          {index < 0 ? " · outside filter" : ""}
        </div>
      </aside>
      <main className="review-main">
        <header
          className="review-heading"
          data-flux-id={active}
          aria-busy={detail.isFetching}
        >
          <div>
            {s.back && (
              <button className="back" onClick={s.goBack}>
                ← Back to {s.back}
              </button>
            )}
            {flux ? (
              <>
                <h2>
                  {/^(plot\b|P\d)/i.test(flux.plotLabel)
                    ? flux.plotLabel
                    : "Plot " + flux.plotLabel}{" "}
                  · {flux.treatmentName} ·{" "}
                  {flux.source === "manual"
                    ? "manual measurement"
                    : flux.side + " chamber"}{" "}
                  · {dateTime(flux.time)}
                </h2>
                <small className="filename" title={flux.filename}>
                  {flux.filename}
                </small>
                <div className="review-flags">
                  <span>
                    Flux #{active} ·{" "}
                    {index >= 0
                      ? (index + 1).toLocaleString() +
                        " of " +
                        filtered.length.toLocaleString()
                      : "outside current queue"}
                  </span>
                  {flux.excluded && (
                    <span className="badge flag-excluded">EXCLUDED</span>
                  )}
                  {flux.reviewed && <span className="badge">Reviewed</span>}
                  {flux.overridden && <span className="badge">Overridden</span>}
                  {detail.isFetching && <span className="muted">Loading…</span>}
                </div>
              </>
            ) : (
              <h2>
                {data.isLoading || detail.isLoading
                  ? "Loading flux…"
                  : "No measurement selected"}
              </h2>
            )}
          </div>
          <div className="button-group">
            <button aria-label="Previous flux" onClick={() => step(-1)}>
              ←
            </button>
            <button aria-label="Next flux" onClick={() => step(1)}>
              →
            </button>
          </div>
        </header>
        <Status
          loading={!d && detail.isLoading && !!data.data?.rows.length}
          error={detail.error}
        />
        {!data.isLoading && !data.data?.rows.length && (
          <Empty>
            No measurements yet. Import robot or manual data to begin.
          </Empty>
        )}
        {d && o && flux && (
          <>
            <div className="trace-toolbar">
              <span className="dot left" />
              Left <span className="dot right" />
              Right
              <span
                className="fit-key"
                title={
                  o.fit === "robust"
                    ? "Reported flux: the robust refit. It drops points whose residual is over 4 MAD (two passes) and 3 s more at each valve-segment edge, and uses the estimated valve timing."
                    : "Reported flux: ordinary least squares over the shaded points (legacy method)."
                }
              >
                <i className="key-line solid" />
                {o.fit === "robust"
                  ? "Robust fit (reported)"
                  : "Linear fit (reported)"}
              </span>
              {o.fit !== "robust" && (
                <span
                  className="fit-key"
                  title="Diagnostic refit, not reported: drops residuals over 4 MAD and 3 s more at each segment edge, with the estimated valve timing. Impact is how far it moves the flux. Choose Fit: Robust in Analysis options to report it."
                >
                  <i className="key-line dashed" />
                  Robust fit (check)
                </span>
              )}
              <details className="trace-gas-menu">
                <summary>Traces: {traces.join(" + ")}</summary>
                <div className="filter-popover">
                  {gasNames.map((g) => (
                    <label key={g}>
                      <input
                        type="checkbox"
                        checked={traces.includes(g)}
                        onChange={(e) =>
                          setTraces(
                            e.target.checked
                              ? [...traces, g]
                              : traces.length > 1
                                ? traces.filter((x) => x !== g)
                                : traces,
                          )
                        }
                      />
                      {g}
                    </label>
                  ))}
                </div>
              </details>
              <button onClick={() => s.set({ traceZoom: [0, 185] })}>
                Reset zoom
              </button>
            </div>
            <div
              className={
                "trace-stack " + (flux.excluded ? "trace-excluded" : "")
              }
            >
              {flux.excluded && (
                <div className="excluded-banner">
                  EXCLUDED · does not contribute to treatment summaries
                </div>
              )}
              {d.traces.length ? (
                traces.map((g) => (
                  <TraceChart
                    key={g}
                    detail={{ ...d, flux }}
                    gas={g}
                    options={o}
                    preview={changePreview}
                    commit={(next) => commit(next, true)}
                  />
                ))
              ) : (
                <Empty>
                  {flux.source === "manual"
                    ? "Manual measurement · no raw trace"
                    : "No raw traces available"}
                </Empty>
              )}
            </div>
            <div className="review-actions">
              <button
                onClick={() =>
                  void action(() =>
                    api.setFluxFlags([active], { excluded: !flux.excluded }),
                  )
                }
              >
                {flux.excluded ? "Include flux" : "Exclude flux"} <kbd>X</kbd>
              </button>
              <button className="primary" onClick={markAndNext}>
                Reviewed & next <kbd>A</kbd>
              </button>
              {hint && (
                <span className="shortcut-strip">
                  ←/→ or ↑/↓ step · X exclude · A review · R reset · S sibling ·
                  G go to · Ctrl Z/Y
                  <button
                    aria-label="Dismiss shortcut hints"
                    onClick={() => {
                      setHint(false);
                      localStorage.setItem("ffr-shortcuts", "hidden");
                    }}
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
          </>
        )}
        {showGoto && (
          <form
            className="goto-bar"
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
          >
            <input
              autoFocus
              aria-label="Go to flux or date"
              placeholder="Flux ID or YYYY-MM-DD"
              value={goto}
              onChange={(e) => setGoto(e.target.value)}
            />
            <button>Go</button>
            <button type="button" onClick={() => setShowGoto(false)}>
              Cancel
            </button>
          </form>
        )}
      </main>
      <aside className="results compact-inspector">
        {d && o && flux && (
          <>
            <section>
              <h3>
                Flux & impact{" "}
                <span className="score">{attention(flux.attention)}</span>
              </h3>
              {result("N2O")}
              {result("CO2")}
              <details className="inspector-disclosure">
                <summary>Other gases</summary>
                <div>
                  {gasNames
                    .filter((g) => !["N2O", "CO2"].includes(g))
                    .map(result)}
                </div>
              </details>
            </section>
            <section className="compact-options">
              <h3>Analysis options</h3>
              <div className="options-grid">
                <label>
                  <span className="label-row">
                    Window
                    <button
                      type="button"
                      className="info-toggle"
                      aria-label="About the window modes"
                      aria-expanded={modeInfo}
                      onClick={() => setModeInfo(!modeInfo)}
                    >
                      ⓘ
                    </button>
                  </span>
                  <select
                    aria-label="Regression mode"
                    value={o.mode}
                    onChange={(e) =>
                      commit({
                        ...o,
                        mode: e.target.value as AnalysisOptions["mode"],
                      })
                    }
                  >
                    <option value="fixed">Fixed</option>
                    <option value="auto">Auto</option>
                    <option value="manual">Manual slope</option>
                  </select>
                </label>
                <label>
                  Fit
                  <select
                    aria-label="Fit method"
                    value={o.fit ?? "ols"}
                    disabled={o.mode === "manual"}
                    title="Which fit gives the reported N₂O and CO₂ flux. Other gases always use least squares."
                    onChange={(e) =>
                      commit({
                        ...o,
                        fit: e.target.value as "ols" | "robust",
                      })
                    }
                  >
                    <option value="ols">Linear</option>
                    <option value="robust">Robust</option>
                  </select>
                </label>
                {(["start", "stop", "cutBeginnings", "cutEnds"] as const).map(
                  (k) => (
                    <label key={k}>
                      {
                        {
                          start: "Start · s",
                          stop: "Stop · s",
                          cutBeginnings: "Cut begin · s",
                          cutEnds: "Cut end · s",
                        }[k]
                      }
                      <input
                        aria-label={
                          k === "start"
                            ? "start seconds"
                            : k === "stop"
                              ? "stop seconds"
                              : k
                        }
                        type="number"
                        step=".5"
                        value={o[k]}
                        onChange={(e) =>
                          changePreview({ ...o, [k]: Number(e.target.value) })
                        }
                        onBlur={() => draft && commit(draft)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commit(o);
                        }}
                      />
                    </label>
                  ),
                )}
                <button
                  onClick={() =>
                    void action(() => api.setFluxOptions([active], null))
                  }
                >
                  Reset <kbd>R</kbd>
                </button>
              </div>
              {modeInfo && <ModeInfo onOpenDefaults={() => s.nav("Project")} />}
              {o.mode === "manual" && (
                <label>
                  Slope
                  <input
                    type="number"
                    step="any"
                    value={o.slope ?? 0}
                    onChange={(e) =>
                      changePreview({ ...o, slope: Number(e.target.value) })
                    }
                    onBlur={() => commit(o)}
                  />
                </label>
              )}
              {o.mode === "auto" && (
                <div className="options-grid">
                  <label>
                    Interval · s
                    <input
                      aria-label="Auto interval seconds"
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
                  </label>
                  <label>
                    Criterion
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
                      <option value="steepest">Steepest</option>
                      <option value="mse">Lowest MSE</option>
                    </select>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={o.co2Guides}
                      onChange={(e) =>
                        commit({ ...o, co2Guides: e.target.checked })
                      }
                    />
                    CO₂ guides
                  </label>
                </div>
              )}
              <details className="inspector-disclosure">
                <summary>Per-gas overrides</summary>
                <div>
                  <select
                    aria-label="Override gas"
                    value={editGas}
                    onChange={(e) => setEditGas(e.target.value as Gas)}
                  >
                    {gasNames.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                  <div className="options-grid">
                    {(
                      [
                        "start",
                        "stop",
                        "cutBeginnings",
                        "cutEnds",
                        "valveOffset",
                      ] as const
                    ).map((k) => (
                      <label key={k}>
                        {k.replace(/([A-Z])/g, " $1")} · s
                        <input
                          aria-label={editGas + " " + k}
                          type="number"
                          step=".5"
                          value={editOptions?.[k] ?? 0}
                          onChange={(e) =>
                            setGasOption(k, Number(e.target.value))
                          }
                          onBlur={() => draft && commit(draft)}
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const next = { ...o, perGas: { ...o.perGas } };
                      delete next.perGas[editGas];
                      commit(next);
                    }}
                  >
                    Use common options for {editGas}
                  </button>
                </div>
              </details>
              {!!d.robust?.find((r) => r.options) && (
                <button
                  onClick={() => {
                    const candidate = d.robust?.find((r) => r.options);
                    if (candidate?.options)
                      void action(() =>
                        api.patchFluxOptions([active], {
                          perGas: { [candidate.gas]: candidate.options },
                        }),
                      );
                  }}
                >
                  Use robust settings
                </button>
              )}
            </section>
            <section className="compact-alignment">
              <h3>
                Valve timing{" "}
                <span
                  className="info-tip"
                  title={
                    "Shifts every valve switch, which decides which points belong to the " +
                    "left or right chamber. Drag the ⇆ line on a trace or type a value; " +
                    "positive means the switch happened later than the robot logged it. " +
                    "The estimate is the shift that best separates the two chambers."
                  }
                >
                  ⓘ
                </span>
              </h3>
              <div className="options-grid">
                <label>
                  Shift · s
                  <input
                    aria-label="Valve offset seconds"
                    type="number"
                    step=".5"
                    value={o.valveOffset ?? 0}
                    onChange={(e) =>
                      changePreview({
                        ...o,
                        valveOffset: Number(e.target.value),
                      })
                    }
                    onBlur={() => draft && commit(draft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit(o);
                    }}
                  />
                </label>
                <div className="lag-estimates">
                  Estimated from the trace
                  <span>
                    CO₂ <b>{significant(d.valveLagS, 3)} s</b> · N₂O{" "}
                    <b>{significant(flux.N2O_lagS, 3)} s</b>
                  </span>
                </div>
                <select
                  aria-label="Offset gas"
                  value={offsetGas}
                  onChange={(e) =>
                    setOffsetGas(e.target.value as typeof offsetGas)
                  }
                >
                  <option value="all">CO₂ estimate → all gases</option>
                  <option value="N2Oall">N₂O estimate → all gases</option>
                  <option value="CO2">CO₂ estimate → CO₂ only</option>
                  <option value="N2O">N₂O estimate → N₂O only</option>
                </select>
                <select
                  aria-label="Offset scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as typeof scope)}
                >
                  <option value="flux">This flux</option>
                  <option value="file">Both chambers of this file</option>
                  <option value="day">Every robot flux this day</option>
                </select>
                <button onClick={() => applyLag(offsetGas)}>
                  Apply estimate
                </button>
              </div>
            </section>
            <section className="compact-context">
              <h3>Context</h3>
              <div>
                {significant(flux.airTemp, 3)} °C ·{" "}
                {significant(flux.precip, 2)} mm ·{" "}
                {significant(flux.x ?? flux.chamberX, 6)},{" "}
                {significant(flux.y ?? flux.chamberY, 6)}
              </div>
              {d.siblingFluxId && (
                <button onClick={() => s.set({ selected: d.siblingFluxId! })}>
                  Sibling{" "}
                  {significant(d.sibling.find((r) => r.gas === "N2O")?.flux)}{" "}
                  <kbd>S</kbd>
                </button>
              )}
              <details className="inspector-disclosure">
                <summary>Plot assignment & note</summary>
                <div>
                  <Status loading={layout.isLoading} error={layout.error} />
                  <select
                    aria-label="Plot assignment"
                    value={flux.plotId}
                    onChange={(e) =>
                      void action(() =>
                        api.setFluxFlags([active], {
                          plotOverride: Number(e.target.value),
                        }),
                      )
                    }
                  >
                    {layout.data?.plots.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    aria-label="Review note"
                    key={active + "-" + flux.note}
                    placeholder="Add a note…"
                    defaultValue={flux.note}
                    onBlur={(e) => {
                      if (e.target.value !== flux.note)
                        void action(() =>
                          api.setFluxFlags([active], { note: e.target.value }),
                        );
                    }}
                  />
                </div>
              </details>
            </section>
            <section className="compact-findings">
              <h3>Findings · {findings.length}</h3>
              <div className="findings-scroll">
                {findings.length ? (
                  findings.slice(0, 2).map((f, i) => (
                    <p
                      key={i}
                      className={"finding-sentence " + f.severity}
                      title={f.message}
                    >
                      <b>
                        {f.gas ? f.gas + " · " : ""}
                        {definition(f.code)}
                      </b>{" "}
                      {f.message}
                    </p>
                  ))
                ) : (
                  <p className="muted">No diagnostic findings.</p>
                )}
                {findings.length > 2 && (
                  <details className="inspector-disclosure">
                    <summary>All {findings.length} findings</summary>
                    {findings.slice(2).map((f, i) => (
                      <p
                        key={i}
                        className={"finding-sentence open " + f.severity}
                      >
                        <b>
                          {f.gas ? f.gas + " · " : ""}
                          {definition(f.code)}
                        </b>{" "}
                        {f.message}
                      </p>
                    ))}
                  </details>
                )}
              </div>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
/** The flux last viewed in a project, kept per project file. */
function lastViewed(path: string) {
  const v = Number(localStorage.getItem("ffr-last-flux:" + path));
  return path && Number.isFinite(v) && v > 0 ? v : null;
}
function rememberViewed(path: string, id: number) {
  if (path) localStorage.setItem("ffr-last-flux:" + path, String(id));
}
/** What the window modes do; opens in place under the options. */
function ModeInfo({ onOpenDefaults }: { onOpenDefaults: () => void }) {
  return (
    <div className="mode-info">
      <p>
        <b>Fixed</b> fits every point of this chamber between Start and Stop,
        after Cut begin/end at each valve switch (the shaded bands).
      </p>
      <p>
        <b>Auto</b> searches between Start and Stop for the best window of{" "}
        <i>Interval</i> seconds: <i>Steepest</i> takes the steepest slope
        (legacy default), <i>Lowest MSE</i> the best-fitting window. With{" "}
        <i>CO₂ guides</i>, N₂O and the other gases reuse the window found for
        CO₂. Auto changes only the window, never the cuts or valve timing.
      </p>
      <p>
        <b>Manual slope</b> reports a slope you type, without a fit.
      </p>
      <p>
        <b>Fit</b>: <i>Linear</i> is ordinary least squares, the legacy method;{" "}
        <i>Robust</i> reports the robust refit (dashed line) for N₂O and CO₂.
      </p>
      <p>
        Fluxes use the project defaults until you change them here, for this
        flux only.
      </p>
      <button type="button" onClick={onOpenDefaults}>
        Project analysis defaults →
      </button>
    </div>
  );
}
