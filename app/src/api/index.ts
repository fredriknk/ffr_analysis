import { createMock } from "./mock";
import { tauriApi } from "./tauri";
export const isTauri = "__TAURI_INTERNALS__" in window;
export const api =
  isTauri && import.meta.env.VITE_FFR_MOCK !== "1" ? tauriApi : createMock();
export const mockMode = !isTauri || import.meta.env.VITE_FFR_MOCK === "1";
