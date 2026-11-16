import { open, save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "../api";
export async function pick(folder = false, write = false) {
  if (!isTauri) return folder ? "synthetic-demo/" : "synthetic-demo.csv";
  const p = write
    ? await save({ filters: [{ name: "FFR project", extensions: ["ffr"] }] })
    : await open({ directory: folder, multiple: false });
  return typeof p === "string" ? p : null;
}
