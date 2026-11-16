import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useStore } from "../../store";
import { TraceChart } from "./TraceChart";
export function Review() {
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
