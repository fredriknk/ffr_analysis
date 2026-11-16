import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { AnalysisOptions, FluxDetail, Gas } from "../../api/types";
import {
  Empty,
  Field,
  Panel,
  Status,
  date,
  error,
  fmt,
  toastFn,
  useAction,
  useRows,
} from "../../shared/common";
import { diagnosticLabels } from "../../shared/diagnostics";
import { useStore } from "../../store";
import { ContactSheet, QueueFilters, QueueList, useQueue } from "./Queue";
import { TraceChart } from "./TraceChart";
export function Review() {
  const s = useStore(),
    action = useAction(),
    data = useRows(),
    [multi, setMulti] = useState<number[]>([]),
    [hint, setHint] = useState(
      () => localStorage.getItem("ffr-shortcuts") !== "hidden",
    ),
    [scope, setScope] = useState<"flux" | "file" | "day">("flux"),
    [goto, setGoto] = useState(""),
    [showGoto, setShowGoto] = useState(false);
  const layoutQuery = useQuery({
    queryKey: ["layout"],
    queryFn: () => api.getLayout(),
  });
  const detail = useQuery({
    queryKey: ["detail", s.selected],
    queryFn: () => api.getFluxDetail(s.selected),
    enabled: !!data.data?.rows.some((r) => r.id === s.selected),
  });
  const [preview, setPreview] = useState<FluxDetail | null>(null),
    [draft, setDraft] = useState<AnalysisOptions | null>(null),
    serial = useRef(0);
  useEffect(() => {
    setPreview(null);
    setDraft(null);
    serial.current++;
  }, [detail.data]);
  const d = data.data?.rows.some((r) => r.id === s.selected)
      ? (preview ?? detail.data)
      : undefined,
    o = draft ?? d?.options;
  const filtered = useQueue(data.data?.rows ?? []);
  useEffect(() => {
    if (
      s.screen === "Review" &&
      filtered.length &&
      !filtered.some((r) => r.id === s.selected)
    )
      s.set({ selected: filtered[0].id });
  }, [filtered, s.screen, s.selected]);
  const targets = s.contactSheet && multi.length ? multi : [s.selected];
  const index = filtered.findIndex((r) => r.id === s.selected);
  function step(n: number) {
    const next =
      filtered[Math.max(0, Math.min(filtered.length - 1, index + n))];
    if (next) s.set({ selected: next.id });
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (s.screen !== "Review") return;
      if (
        (e.target as HTMLElement).matches("input,textarea,select,[role=slider]")
      )
        return;
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
          api.setFluxFlags(targets, {
            excluded: !targets.every(
              (id) => data.data?.rows.find((r) => r.id === id)?.excluded,
            ),
          }),
        );
      else if (key === "r")
        void action(() => api.setFluxOptions([s.selected], null));
      else if (key === "a")
        void action(async () => {
          await api.setFluxFlags(targets, { reviewed: true });
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
  if (s.contactSheet)
    return (
      <div className="contact-page">
        <div className="page-heading">
          <div>
            <h2>Contact sheet</h2>
            <p>
              Scan the current review queue. Select several traces to act on
              them together.
            </p>
          </div>
          <button onClick={() => s.set({ contactSheet: false })}>
            List & detail view
          </button>
        </div>
        <div className="contact-layout">
          <aside className="panel">
            <QueueFilters rows={data.data?.rows ?? []} />
          </aside>
          <section className="contact-main">
            <div className="toolbar">
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
                  void action(() =>
                    api.setFluxFlags(multi, { excluded: false }),
                  )
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
            <ContactSheet
              rows={filtered}
              selected={multi}
              onSelect={setMulti}
            />
          </section>
        </div>
      </div>
    );
  return (
    <div className="review">
      <aside className="queue panel">
        <div className="panel-title">
          <h3>Review queue</h3>
          <span className="badge">{filtered.length.toLocaleString()}</span>
        </div>
        <button
          className="sheet-toggle"
          onClick={() => s.set({ contactSheet: true })}
        >
          Contact sheet ▦
        </button>
        <QueueFilters rows={data.data?.rows ?? []} />
        <Status loading={data.isLoading} error={data.error} />
        <QueueList rows={filtered} />
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
        <Status
          loading={detail.isLoading && !!data.data?.rows.length}
          error={detail.error}
        />
        {!data.isLoading && !data.data?.rows.length && (
          <Empty>
            No measurements yet. Import robot or manual data to begin.
          </Empty>
        )}
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
                    await api.setFluxFlags(targets, { reviewed: true });
                    step(1);
                  })
                }
              >
                Reviewed & next <kbd>A</kbd>
              </button>
            </div>
            <div className="shortcut-strip" hidden={!hint}>
              ← → Navigate <span>X Exclude</span>
              <span>R Reset</span>
              <span>A Reviewed & next</span>
              <span>G Go to</span>
              <span>Ctrl Z / Y Undo / redo</span>
              <button
                aria-label="Dismiss shortcut hints"
                onClick={() => {
                  setHint(false);
                  localStorage.setItem("ffr-shortcuts", "hidden");
                }}
              >
                ?
              </button>
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
                  s.set({
                    selected: r.id,
                    quick: "all",
                    reviewIds: undefined,
                    search: "",
                    diagnosticCodes: [],
                    plot: "",
                    treatment: "",
                    from: "",
                    to: "",
                  });
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
            <Panel title="Findings">
              <div className="findings">
                {d.diagnostics.length ? (
                  d.diagnostics.map((finding, i) => (
                    <div
                      key={finding.code + "-" + i}
                      className={"finding " + finding.severity}
                    >
                      <strong>
                        {finding.gas ? finding.gas + " · " : ""}
                        {diagnosticLabels[finding.code] ??
                          finding.code.replaceAll("_", " ")}
                      </strong>
                      <p>{finding.message}</p>
                      {finding.value !== undefined && (
                        <small>
                          Value:{" "}
                          {Math.abs(finding.value) < 0.001
                            ? finding.value.toExponential(3)
                            : fmt(finding.value, 3)}
                          {finding.code === "valve_timing" ? " s" : ""}
                        </small>
                      )}
                    </div>
                  ))
                ) : (
                  <p>No diagnostic findings for this flux.</p>
                )}
              </div>
            </Panel>
            <Panel title="Valve alignment">
              <p>
                Estimated lag: <strong>{fmt(d.valveLagS, 1)} s</strong>
              </p>
              <Field label="Valve offset · s">
                <input
                  aria-label="Valve offset seconds"
                  type="number"
                  min="-10"
                  max="10"
                  step=".5"
                  value={o.valveOffset}
                  onChange={(e) =>
                    changePreview({ ...o, valveOffset: Number(e.target.value) })
                  }
                  onBlur={() => commit(o)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit(o);
                  }}
                />
              </Field>
              <Field label="Apply offset scope">
                <select
                  aria-label="Offset scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as typeof scope)}
                >
                  <option value="flux">This flux</option>
                  <option value="file">This file · both chambers</option>
                  <option value="day">This measurement day</option>
                </select>
              </Field>
              <button
                className="full"
                onClick={() =>
                  void action(() => {
                    const day = (t: number) =>
                      new Intl.DateTimeFormat("en-CA", {
                        timeZone: s.timeZone,
                      }).format(t);
                    const ids = (data.data?.rows ?? [])
                      .filter((r) =>
                        scope === "flux"
                          ? r.id === s.selected
                          : scope === "file"
                            ? r.measurementId !== null &&
                              r.measurementId === d.flux.measurementId
                            : r.source === "robot" &&
                              day(r.time) === day(d.flux.time),
                      )
                      .map((r) => r.id);
                    return api.patchFluxOptions(ids, {
                      valveOffset: d.valveLagS,
                    });
                  }, "Valve offset applied in one undo step")
                }
              >
                Apply estimated offset
              </button>
            </Panel>
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
                      <strong>{r.gas}</strong>
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
              <Status
                loading={layoutQuery.isLoading}
                error={layoutQuery.error}
              />
              <Field label="Plot assignment">
                <select
                  disabled={!layoutQuery.data?.plots.length}
                  value={d.flux.plotId}
                  onChange={(e) =>
                    void action(() =>
                      api.setFluxFlags([s.selected], {
                        plotOverride: Number(e.target.value),
                      }),
                    )
                  }
                >
                  {!layoutQuery.data?.plots.some(
                    (p) => p.id === d.flux.plotId,
                  ) && (
                    <option value={d.flux.plotId} disabled>
                      Unassigned plot
                    </option>
                  )}
                  {layoutQuery.data?.plots.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
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
