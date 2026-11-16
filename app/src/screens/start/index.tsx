import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api";
import { Field, Panel, Status, pick, useAction } from "../../shared/common";
import { useStore } from "../../store";
export function Start() {
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
