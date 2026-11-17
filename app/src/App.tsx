import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, mockMode } from "./api";
import { openStartupProject } from "./api/startup";
import type { Progress } from "./api/types";
import { Start } from "./screens/start";
import { Empty, error, setToastHandler, useAction } from "./shared/common";
import { useStore, type Screen } from "./store";
const Data = lazy(() =>
  import("./screens/data").then((m) => ({ default: m.Data })),
);
const External = lazy(() =>
  import("./screens/external").then((m) => ({ default: m.External })),
);
const Outliers = lazy(() =>
  import("./screens/outliers").then((m) => ({ default: m.Outliers })),
);
const Project = lazy(() =>
  import("./screens/project").then((m) => ({ default: m.Project })),
);
const Review = lazy(() =>
  import("./screens/review").then((m) => ({ default: m.Review })),
);
const Waypoints = lazy(() =>
  import("./screens/waypoints").then((m) => ({ default: m.Waypoints })),
);
const Treatments = lazy(() =>
  import("./screens/treatments").then((m) => ({ default: m.Treatments })),
);
/** "project_open" / "recomputeAll" → "Project open" / "Recompute all". */
function taskLabel(task: string) {
  const words = task
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export default function App() {
  const s = useStore(
      useShallow(({ screen, theme, nav, set, timeZone }) => ({
        screen,
        theme,
        nav,
        set,
        timeZone,
      })),
    ),
    action = useAction(),
    [toast, setToast] = useState(""),
    [progress, setProgress] = useState<Progress | null>(null);
  const [visited, setVisited] = useState(new Set(["Start"]));
  const [startupError, setStartupError] = useState("");
  useEffect(() => setVisited((v) => new Set([...v, s.screen])), [s.screen]);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void action(async () => {
      try {
        await openStartupProject(api, () => s.nav("Review"));
      } catch (e) {
        s.nav("Start");
        setStartupError(
          "Could not open the startup project: " +
            (typeof e === "object" && e && "message" in e
              ? String(e.message)
              : String(e)),
        );
        throw {
          message:
            "Could not open the startup project: " +
            (typeof e === "object" && e && "message" in e
              ? String(e.message)
              : String(e)),
        };
      }
    });
  }, []);
  const info = useQuery({
    queryKey: ["project"],
    queryFn: () => api.projectInfo(),
  });
  useEffect(() => {
    if (info.data?.timeZone)
      useStore.getState().set({ timeZone: info.data.timeZone });
  }, [info.data?.timeZone]);
  useEffect(() => {
    setToastHandler(setToast);
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
      })
      .catch(error);
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    const show = (e: Event) => error((e as CustomEvent<unknown>).detail);
    window.addEventListener("ffr-api-error", show);
    return () => window.removeEventListener("ffr-api-error", show);
  }, []);
  const screens: Screen[] = [
      "Start",
      "Review",
      "Treatments",
      "Outliers",
      "Data",
      "External data",
      "Waypoints",
      "Project",
    ],
    icons = ["⌂", "∿", "▥", "◇", "▦", "☁", "⌖", "⚙"],
    // Screens that work without an open project.
    standalone = new Set<Screen>(["Start", "Waypoints"]);
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
            disabled={!standalone.has(screen) && !info.data}
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
        {progress && (
          <div className="operation-progress" role="status">
            <strong>{taskLabel(progress.task)}</strong>
            <progress value={progress.done} max={progress.total} />
            <span>
              {progress.message ?? "Processing…"} · {progress.done}/
              {progress.total}
            </span>
          </div>
        )}
        {startupError && s.screen === "Start" && (
          <div role="alert" className="startup-error">
            {startupError}
          </div>
        )}
        <Suspense fallback={<div role="status">Loading workspace…</div>}>
          <div className="screen-body">
            {screens.map((screen) => (
              <div
                key={screen}
                hidden={s.screen !== screen}
                className="screen-slot"
              >
                {!visited.has(screen) && s.screen !== screen ? null : screen ===
                  "Start" ? (
                  <Start />
                ) : screen === "Waypoints" ? (
                  <Waypoints />
                ) : info.data ? (
                  screen === "Review" ? (
                    <Review />
                  ) : screen === "Treatments" ? (
                    <Treatments />
                  ) : screen === "Outliers" ? (
                    <Outliers />
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
        </Suspense>
        <footer className="statusbar">
          <span>
            ● {mockMode ? "Demo session" : "Ready"} ·{" "}
            {info.data?.timeZone ?? "Europe/Oslo"}
          </span>
          <span>
            {progress
              ? taskLabel(progress.task) +
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
