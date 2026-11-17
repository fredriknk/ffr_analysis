import { useState } from "react";
import { api } from "../../api";
import type { PlotGenOptions, PlotProposal, Waypoint } from "../../api/types";
import { error, pick, significant, useAction } from "../../shared/common";
import { useStore } from "../../store";

export const defaultPlotOptions: PlotGenOptions = {
  clusterDistance: 1.5,
  shape: "auto",
  size: 3,
  width: 2,
  height: 4,
  angle: null,
  labelPrefix: "P",
};

/** Plots from the route's chamber positions → project layout. */
export function PlotsPanel({
  points,
  sourcePath,
  options,
  setOptions,
  proposal,
  loading,
  projectName,
}: {
  points: Waypoint[];
  sourcePath: string | null;
  options: PlotGenOptions;
  setOptions: (o: PlotGenOptions) => void;
  proposal: PlotProposal | undefined;
  loading: boolean;
  /** Open project, if any. */
  projectName: string | null;
}) {
  const action = useAction(),
    nav = useStore((s) => s.nav),
    [confirm, setConfirm] = useState(false);
  const plots = proposal?.plots ?? [],
    visits = plots.reduce((n, p) => n + p.visits.length, 0),
    repeated = plots.filter((p) => p.visits.length > 1).length,
    unnamed = plots.reduce(
      (n, p) => n + p.visits.filter((v) => v.waypoint === null).length,
      0,
    );
  const num = (key: "clusterDistance" | "size" | "width" | "height") => (
    <input
      type="number"
      min="0.1"
      step="0.1"
      aria-label={key}
      value={options[key]}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (v > 0) setOptions({ ...options, [key]: v });
      }}
    />
  );
  const args = () => ({
    points,
    sourcePath,
    plots: plots.map((p) => ({
      label: p.label,
      polygon: p.polygon,
      treatmentId: null,
      waypoints: p.visits
        .filter((v) => v.waypoint !== null)
        .map((v) => ({ waypoint: v.waypoint!, side: v.side })),
    })),
  });
  async function createProject() {
    const path = await pick(false, true);
    if (!path) return;
    const name =
      (sourcePath ?? "Field trial")
        .split(/[\\/]/)
        .pop()!
        .replace(/\.csv$/i, "")
        .replace(/[_-]+/g, " ")
        .trim() || "Field trial";
    await action(
      async () => {
        await api.projectCreate(path, name);
        await api.applyWaypointLayout(args());
        nav("Project");
      },
      "Project created with " + plots.length + " plots",
    );
  }
  return (
    <section className="wp-section plots-panel">
      <h3>Plots from route</h3>
      <p className="muted small">
        Chambers that land within the grouping distance are one plot, so a
        two-way route that measures every plot twice gives each plot two
        measurements.
      </p>
      <div className="wp-form">
        <label>Grouping distance · m {num("clusterDistance")}</label>
        <label>
          Shape
          <select
            aria-label="Plot shape"
            value={options.shape}
            onChange={(e) =>
              setOptions({
                ...options,
                shape: e.target.value as PlotGenOptions["shape"],
              })
            }
          >
            <option value="auto">Auto square (touching)</option>
            <option value="square">Fixed square</option>
            <option value="rectangle">Fixed rectangle</option>
          </select>
        </label>
        {options.shape === "square" && <label>Side · m {num("size")}</label>}
        {options.shape === "rectangle" && (
          <>
            <label>Width · m (along field) {num("width")}</label>
            <label>Length · m (across) {num("height")}</label>
          </>
        )}
        <label>
          Field direction · °
          <input
            type="number"
            step="0.5"
            aria-label="Field direction degrees"
            placeholder={
              proposal
                ? "auto " + significant((proposal.angle * 180) / Math.PI, 4)
                : "auto"
            }
            value={
              options.angle === null
                ? ""
                : Math.round(((options.angle * 180) / Math.PI) * 100) / 100
            }
            onChange={(e) =>
              setOptions({
                ...options,
                angle:
                  e.target.value === ""
                    ? null
                    : (Number(e.target.value) * Math.PI) / 180,
              })
            }
          />
        </label>
        <label>
          Label prefix
          <input
            aria-label="Plot label prefix"
            value={options.labelPrefix}
            onChange={(e) =>
              setOptions({ ...options, labelPrefix: e.target.value })
            }
          />
        </label>
      </div>
      <p className="plots-summary" aria-busy={loading}>
        <b>{plots.length}</b> plots · {visits} chamber measurements · {repeated}{" "}
        measured more than once
        {unnamed > 0 && (
          <span className="warn-text">
            {" "}
            · {unnamed} chambers have no waypoint number in their name and can
            only be matched by position
          </span>
        )}
      </p>
      {projectName ? (
        confirm ? (
          <div className="inline-confirm">
            <span>
              Replace the plots of <b>{projectName}</b> with these{" "}
              {plots.length}? Treatments are kept; the new plots start as
              “Unassigned”. Every flux is re-assigned. Undo restores the old
              layout.
            </span>
            <button
              className="primary"
              disabled={!plots.length}
              onClick={() =>
                void action(async () => {
                  await api.applyWaypointLayout(args());
                  setConfirm(false);
                  nav("Project");
                }, "Project layout replaced").catch(error)
              }
            >
              Replace layout
            </button>
            <button onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        ) : (
          <button
            className="primary"
            disabled={!plots.length}
            onClick={() => setConfirm(true)}
          >
            Use as project layout…
          </button>
        )
      ) : (
        <button
          className="primary"
          disabled={!plots.length}
          onClick={() => void createProject().catch(error)}
        >
          Create project from route…
        </button>
      )}
    </section>
  );
}
