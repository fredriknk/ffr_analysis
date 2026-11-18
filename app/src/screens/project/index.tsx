import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../api";
import type { Layout, ProjectConfig, Treatment } from "../../api/types";
import {
  Field,
  Panel,
  Status,
  pick,
  useAction,
  useRows,
} from "../../shared/common";
import { PlotMap } from "./PlotMap";
import { useStore } from "../../store";
/** Colours for new treatments (distinct, readable on the map in both themes). */
const PALETTE = [
  "#2a9d8f",
  "#e76f51",
  "#457b9d",
  "#e9c46a",
  "#8e5ea2",
  "#6a994e",
  "#d62828",
  "#f4a261",
  "#264653",
  "#b5838d",
  "#118ab2",
  "#a7c957",
];
export function Project() {
  const navigation = useStore(
    useShallow(({ nav, screen }) => ({ nav, screen })),
  );
  const action = useAction(),
    q = useQuery({
      queryKey: ["config"],
      enabled: navigation.screen === "Project",
      queryFn: () => api.getConfig(),
    }),
    l = useQuery({
      queryKey: ["layout"],
      enabled: navigation.screen === "Project",
      queryFn: () => api.getLayout(),
    }),
    h = useQuery({
      queryKey: ["history"],
      queryFn: () => api.history(15),
      enabled: navigation.screen === "Project",
    }),
    [draft, setDraft] = useState<ProjectConfig | null>(null),
    [edited, setEdited] = useState<Layout | null>(null),
    // Settings and layout are read-only until explicitly unlocked.
    [locked, setLocked] = useState(true);
  const cfg = draft ?? q.data,
    layout = edited ?? l.data;
  const rows = useRows(),
    dirty = draft !== null || edited !== null;
  function addTreatment() {
    if (!layout) return;
    const used = new Set(layout.treatments.map((t) => t.colour.toLowerCase())),
      id = Math.max(0, ...layout.treatments.map((t) => t.id)) + 1,
      treatment: Treatment = {
        id,
        name: "Treatment " + id,
        shortName: "T" + id,
        colour:
          PALETTE.find((c) => !used.has(c)) ??
          PALETTE[layout.treatments.length % PALETTE.length],
        sortOrder:
          Math.max(0, ...layout.treatments.map((t) => t.sortOrder)) + 1,
      };
    setEdited({ ...layout, treatments: [...layout.treatments, treatment] });
  }
  const saveLayout = () =>
    void action(async () => {
      if (layout) await api.setLayout(layout);
      setEdited(null);
    }, "Field layout saved");
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h2>Project settings</h2>
          <p>One portable project. Every decision recorded.</p>
        </div>
        <div className="button-group">
          <button
            className={"lock-toggle" + (locked ? "" : " unlocked")}
            aria-pressed={!locked}
            disabled={!locked && dirty}
            title={
              locked
                ? "Allow changes to project settings, treatments and plots"
                : dirty
                  ? "Save or discard your changes before locking"
                  : "Make settings and layout read-only again"
            }
            onClick={() => setLocked(!locked)}
          >
            {locked
              ? "\u{1F512} Locked \u00b7 Unlock to edit"
              : "\u{1F513} Unlocked \u00b7 Lock"}
          </button>
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
      {!locked && (
        <p className="unlock-banner">
          Editing is unlocked. Settings and the field layout change only when
          you save them, and every save can be undone. Lock again when done.
        </p>
      )}
      <Status loading={q.isLoading} error={q.error} />
      <Status loading={l.isLoading} error={l.error} />
      <Status loading={h.isLoading} error={h.error} />
      {!l.isLoading && !layout?.plots.length && (
        <p className="muted">
          No field layout yet. Load the robot's waypoint list to make plots from
          its chamber positions, or import a project layout.
        </p>
      )}
      {layout && (
        <Panel
          title="Field map"
          extra={
            <small>
              {layout.plots.length} plots / {layout.treatments.length}{" "}
              treatments
            </small>
          }
        >
          <PlotMap
            layout={layout}
            crs={cfg?.crs || "EPSG:32632"}
            rows={rows.data?.rows}
            onChange={setEdited}
            dirty={edited !== null}
            onSave={saveLayout}
            onDiscard={() => setEdited(null)}
            locked={locked}
          />
        </Panel>
      )}
      {cfg && (
        <div className="two">
          <Panel title="Project & analysis defaults">
            <fieldset className="plain-fieldset" disabled={locked}>
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
                <Field label="Fit method (N₂O, CO₂)">
                  <select
                    aria-label="Default fit method"
                    value={cfg.defaults.fit ?? "ols"}
                    onChange={(e) =>
                      setDraft({
                        ...cfg,
                        defaults: {
                          ...cfg.defaults,
                          fit: e.target.value as "ols" | "robust",
                        },
                      })
                    }
                  >
                    <option value="ols">Least squares (legacy)</option>
                    <option value="robust">Robust refit</option>
                  </select>
                </Field>
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
                      setDraft({
                        ...cfg,
                        chamberHeight: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <p className="muted">
                Gases: {cfg.gases.join(", ")} · N2O as µg N m⁻² h⁻¹ · CO2 as µg
                C m⁻² h⁻¹
              </p>
              <details className="diagnostic-thresholds">
                <summary>Diagnostic thresholds</summary>
                <div className="form-grid">
                  {Object.entries(cfg.diagnostics ?? {}).map(([key, value]) => (
                    <Field key={key} label={key.replace(/([A-Z])/g, " $1")}>
                      <input
                        type="number"
                        step="any"
                        aria-label={"Diagnostic threshold " + key}
                        value={value}
                        onChange={(e) =>
                          setDraft({
                            ...cfg,
                            diagnostics: {
                              ...cfg.diagnostics,
                              [key]: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  ))}
                </div>
              </details>
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
              {draft && (
                <button onClick={() => setDraft(null)}>Discard changes</button>
              )}
            </fieldset>
          </Panel>
          {layout && (
            <Panel
              title="Treatments & plots"
              extra={
                <div className="button-group">
                  <button disabled={locked} onClick={addTreatment}>
                    Add treatment
                  </button>
                  <button
                    className="primary"
                    disabled={edited === null}
                    onClick={saveLayout}
                  >
                    Save field layout
                  </button>
                </div>
              }
            >
              <fieldset className="plain-fieldset" disabled={locked}>
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
                      {(() => {
                        const n = layout.plots.filter(
                          (p) => p.treatmentId === t.id,
                        ).length;
                        return (
                          <button
                            className="icon-button"
                            aria-label={"Remove treatment " + t.name}
                            disabled={n > 0}
                            title={
                              n
                                ? "Used by " +
                                  n +
                                  " plots; move them to another treatment first"
                                : "Remove this treatment"
                            }
                            onClick={() =>
                              setEdited({
                                ...layout,
                                treatments: layout.treatments.filter(
                                  (x) => x.id !== t.id,
                                ),
                              })
                            }
                          >
                            {"×"}
                          </button>
                        );
                      })()}
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
              </fieldset>
            </Panel>
          )}
        </div>
      )}
      <Panel title="Change history">
        {h.data?.length ? (
          h.data.map((c) => (
            <div className="history-row" key={c.id}>
              <span>{new Date(c.time).toLocaleTimeString()}</span>
              <strong>{c.kind}</strong>
              <span>
                {c.fluxIds.length
                  ? c.fluxIds.length +
                    " fluxes · " +
                    c.fluxIds.slice(0, 3).join(", ") +
                    (c.fluxIds.length > 3 ? "—" : "")
                  : "Project"}
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
