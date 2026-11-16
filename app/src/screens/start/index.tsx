import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, mockMode } from "../../api";
import { Field, Panel, Status, pick, useAction } from "../../shared/common";
import { useStore } from "../../store";
export function Start() {
  const action = useAction(),
    s = useStore(useShallow(({ nav }) => ({ nav })));
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
            <Field label="Manual flux file (optional)">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
            </Field>
            <Field label="Logger file (optional)">
              <input
                value={logger}
                onChange={(e) => setLogger(e.target.value)}
              />
            </Field>
            <Field label="Weather pickle (optional)">
              <input
                value={weather}
                onChange={(e) => setWeather(e.target.value)}
              />
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
