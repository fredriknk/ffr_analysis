import { create } from "zustand";
export type Screen =
  | "Start"
  | "Review"
  | "Treatments"
  | "Outliers"
  | "Data"
  | "External data"
  | "Waypoints"
  | "Project";
interface State {
  screen: Screen;
  /** Path of the open project; selections below belong to it. */
  projectPath: string;
  timeZone: string;
  reviewFrom: string;
  reviewTo: string;
  selected: number;
  reviewIds: number[] | undefined;
  diagnosticCodes: string[];
  includeInfo: boolean;
  reviewVisited: boolean;
  queueSort: "attention" | "time" | "plot";
  contactSheet: boolean;
  treatmentZoom: [number, number] | null;
  traceZoom: [number, number];
  reviewThese: (ids: number[]) => void;
  back: Screen | null;
  theme: "light" | "dark";
  search: string;
  quick: string;
  /** Review queue source filter: robot traces by default; manual fluxes have no trace. */
  reviewSource: "robot" | "manual" | "";
  treatment: string;
  plot: string;
  from: string;
  to: string;
  gas: "N2O" | "CO2" | "CO" | "H2O" | "licor_H2O";
  sources: ("robot" | "manual")[];
  focus: number | null;
  dataSearch: string;
  subset: number[] | undefined;
  /** A route for the Waypoints screen to open (consumed there). */
  routeRequest: {
    points: import("./api/types").Waypoint[];
    sourcePath: string | null;
    /** Open the "plots from route" panel, e.g. for a new project. */
    plots?: boolean;
  } | null;
  nav: (s: Screen) => void;
  /** A different project is open: forget everything selected in the last one. */
  projectOpened: (path: string) => void;
  openFlux: (id: number) => void;
  goBack: () => void;
  set: (v: Partial<State>) => void;
}
/** Selections and filters that belong to one project. */
const projectState = {
  reviewFrom: "",
  reviewTo: "",
  selected: -1,
  reviewIds: undefined,
  diagnosticCodes: [],
  includeInfo: false,
  reviewVisited: false,
  queueSort: "attention",
  contactSheet: false,
  traceZoom: [0, 185],
  treatmentZoom: null,
  back: null,
  search: "",
  quick: "attention",
  reviewSource: "robot",
  treatment: "",
  plot: "",
  from: "",
  to: "",
  focus: null,
  dataSearch: "",
  subset: undefined,
} satisfies Partial<State>;
export const useStore = create<State>((set, get) => ({
  screen: "Start",
  projectPath: "",
  timeZone: "Europe/Oslo",
  reviewFrom: "",
  reviewTo: "",
  selected: 1,
  reviewIds: undefined,
  diagnosticCodes: [],
  includeInfo: false,
  reviewVisited: false,
  queueSort: "attention",
  contactSheet: false,
  traceZoom: [0, 185],
  treatmentZoom: null,
  back: null,
  theme:
    (typeof localStorage !== "undefined"
      ? (localStorage.getItem("ffr-theme") as "light" | "dark")
      : null) ||
    (typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"),
  search: "",
  quick: "attention",
  reviewSource: "robot",
  treatment: "",
  plot: "",
  from: "",
  to: "",
  gas: "N2O",
  sources: ["robot", "manual"],
  focus: null,
  dataSearch: "",
  subset: undefined,
  routeRequest: null,
  nav: (screen) =>
    set({
      screen,
      back: null,
      ...(screen === "Review" && !get().reviewVisited
        ? { quick: "attention", queueSort: "attention", reviewVisited: true }
        : {}),
    }),
  openFlux: (selected) =>
    set({
      selected,
      reviewVisited: true,
      back: get().screen,
      screen: "Review",
      quick: "all",
      reviewIds: undefined,
      diagnosticCodes: [],
      search: "",
      treatment: "",
      plot: "",
      reviewFrom: "",
      reviewTo: "",
      contactSheet: false,
    }),
  reviewThese: (ids) => {
    if (ids.length)
      set({
        reviewIds: ids,
        // A picked set is shown whole, manual fluxes included.
        reviewSource: "",
        reviewVisited: true,
        selected: ids[0],
        screen: "Review",
        back: get().screen,
        quick: "all",
        search: "",
        treatment: "",
        plot: "",
        diagnosticCodes: [],
        reviewFrom: "",
        reviewTo: "",
        contactSheet: false,
      });
  },
  goBack: () => set({ screen: get().back ?? "Review", back: null }),
  projectOpened: (projectPath) =>
    set({ ...structuredClone(projectState), projectPath }),
  set: (v) => set(v),
}));
