import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, mockMode } from "../../api";
import {
  Field,
  Panel,
  Status,
  error,
  pick,
  pickRoute,
  useAction,
} from "../../shared/common";
import { useStore } from "../../store";
export function Start() {
  const visible = useStore((s) => s.screen === "Start");
  const action = useAction(),
    s = useStore(useShallow(({ nav, set }) => ({ nav, set })));
  const [wizard, setWizard] = useState(false),
    [dir, setDir] = useState(""),
    [raw, setRaw] = useState(""),
    [manual, setManual] = useState(""),
    [logger, setLogger] = useState(""),
    [weather, setWeather] = useState(""),
    [out, setOut] = useState("trial.ffr"),
    [scan, setScan] = useState<Awaited<ReturnType<typeof api.legacyScan>>>();
  const recent = useQuery({
    queryKey: ["recent"],
    enabled: visible,
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
        {mockMode && (
          <button className="primary" onClick={() => openProject("demo.ffr")}>
            Open demo project <span>→</span>
          </button>
        )}
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
        <button
          title="Create the project's plots from a robot route (waypoint CSV)"
          onClick={() =>
            void pickRoute()
              .then(async (path) => {
                if (!path) return;
                const points = await api.waypointsRead(path);
                s.set({
                  routeRequest: { points, sourcePath: path, plots: true },
                });
                s.nav("Waypoints");
              })
              .catch(error)
          }
        >
          New project from waypoint list…
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
                <small>
                  {p.path}
                  {mockMode ? " - Synthetic demonstration" : ""}
                </small>
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
              <PathInput value={dir} onChange={setDir} />
            </Field>
            <button onClick={() => void pick(true).then((p) => p && setDir(p))}>
              Browse folder
            </button>
            <Field label="Raw data folder">
              <PathInput value={raw} onChange={setRaw} />
            </Field>
            <Field label="Output project">
              <PathInput value={out} onChange={setOut} />
            </Field>
            <Field label="Manual flux file (optional)">
              <PathInput value={manual} onChange={setManual} />
            </Field>
            <Field label="Logger file (optional)">
              <PathInput value={logger} onChange={setLogger} />
            </Field>
            <Field label="Weather pickle (optional)">
              <PathInput value={weather} onChange={setWeather} />
            </Field>
          </div>
          <button
            onClick={() =>
              action(async () => {
                const found = await api.legacyScan(dir);
                setScan(found);
                setRaw(
                  found.rawDir ??
                    found.configPaths.find((p) =>
                      /raw[_ -]|raw_data/i.test(p),
                    ) ??
                    raw,
                );
                setManual(
                  found.manualPath ??
                    found.configPaths.find((p) => /manual/i.test(p)) ??
                    "",
                );
                setLogger(
                  found.loggerPath ??
                    found.configPaths.find((p) => /logger/i.test(p)) ??
                    "",
                );
                setWeather(
                  found.metnoPicklePath ??
                    found.configPaths.find((p) => /metno.*pickle/i.test(p)) ??
                    "",
                );
              })
            }
          >
            Scan inputs
          </button>
          {scan && (
            <>
              <p>
                {scan.rawFiles.toLocaleString()} robot files · Manual{" "}
                {scan.manualExists ? "Yes" : "—"} · Logger{" "}
                {scan.loggerExists ? "Yes" : "—"} · Weather{" "}
                {scan.weatherExists ? "Yes" : "—"}
              </p>
              <p>{scan.warnings.join(" ")}</p>
              <button
                className="primary"
                onClick={() =>
                  action(async () => {
                    await api.legacyImport({
                      legacyDir: dir,
                      rawDir: raw,
                      manualPath: manual || undefined,
                      loggerPath: logger || undefined,
                      metnoPicklePath: weather || undefined,
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
      {mockMode && (
        <div className="start-foot">
          <span>7,638 synthetic fluxes</span>
          <span>12 treatments · 36 plots</span>
          <span>Two years in the field</span>
        </div>
      )}
    </div>
  );
}
/** A path field that wraps (anywhere) so the whole path stays visible. */
function PathInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <textarea
      className="path-input"
      rows={1}
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ""))}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
    />
  );
}
