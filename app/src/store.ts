import { create } from "zustand";
export type Screen =
  | "Start"
  | "Review"
  | "Treatments"
  | "Outliers"
  | "Data"
  | "External data"
  | "Project";
interface State {
  screen: Screen;
  timeZone: string;
  reviewFrom: string;
  reviewTo: string;
  selected: number;
  reviewIds: number[] | undefined;
  diagnosticCodes: string[];
  queueSort: "attention" | "time" | "plot";
  contactSheet: boolean;
  treatmentZoom: [number, number] | null;
  traceZoom: [number, number];
  reviewThese: (ids: number[]) => void;
  back: Screen | null;
  theme: "light" | "dark";
  search: string;
  quick: string;
  treatment: string;
  plot: string;
  from: string;
  to: string;
  gas: "N2O" | "CO2" | "CO" | "H2O" | "licor_H2O";
  sources: ("robot" | "manual")[];
  focus: number | null;
  dataSearch: string;
  subset: number[] | undefined;
  nav: (s: Screen) => void;
  openFlux: (id: number) => void;
  goBack: () => void;
  set: (v: Partial<State>) => void;
}
export const useStore = create<State>((set, get) => ({
  screen: "Start",
  timeZone: "Europe/Oslo",
  reviewFrom: "",
  reviewTo: "",
  selected: 1,
  reviewIds: undefined,
  diagnosticCodes: [],
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
  treatment: "",
  plot: "",
  from: "",
  to: "",
  gas: "N2O",
  sources: ["robot", "manual"],
  focus: null,
  dataSearch: "",
  subset: undefined,
  nav: (screen) => set({ screen, back: null }),
  openFlux: (selected) =>
    set({
      selected,
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
  set: (v) => set(v),
}));
