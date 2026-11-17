import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "../api";
export async function pick(folder = false, write = false) {
  if (!isTauri) return folder ? "synthetic-demo/" : "synthetic-demo.csv";
  const p = write
    ? await save({ filters: [{ name: "FFR project", extensions: ["ffr"] }] })
    : await open({ directory: folder, multiple: false });
  return typeof p === "string" ? p : null;
}
/** Waypoint route CSVs: open, or choose a new file name to save as. */
export async function pickRoute(write = false, defaultPath?: string) {
  if (!isTauri) return write ? "route_edited.csv" : "synthetic-route.csv";
  const filters = [{ name: "Waypoint route", extensions: ["csv"] }];
  const p = write
    ? await save({ filters, defaultPath })
    : await open({ multiple: false, filters });
  return typeof p === "string" ? p : null;
}
