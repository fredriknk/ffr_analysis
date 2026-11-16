import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { describe, expect, it, vi } from "vitest";
import { tauriApi } from "./tauri";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
describe("diagnostic command adapter", () => {
  it("keeps the SPEC command names and one camelCase argument object", async () => {
    await tauriApi.patchFluxOptions([12, 13], { valveOffset: 4 });
    expect(invoke).toHaveBeenLastCalledWith("patch_flux_options", {
      fluxIds: [12, 13],
      partial: { valveOffset: 4 },
    });
    await tauriApi.getFluxThumbs([12, 13], "CO2");
    expect(invoke).toHaveBeenLastCalledWith("get_flux_thumbs", {
      fluxIds: [12, 13],
      gas: "CO2",
      maxPoints: 60,
    });
    await tauriApi.diagnosticsSummary();
    expect(invoke).toHaveBeenLastCalledWith("diagnostics_summary");
  });
  it("drops large history snapshots before exposing them to the UI", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([{id:3,time:0,kind:"flags",fluxIds:[2],before:"x".repeat(100000),after:{large:true}}]);
    expect(await tauriApi.history(20)).toEqual([{id:3,time:0,kind:"flags",fluxIds:[2]}]);
  });
  it("forwards progress payloads and returns an unsubscribe", async () => {
    const cb = vi.fn(),
      off = await tauriApi.onProgress(cb);
    expect(listen).toHaveBeenCalledWith("progress", expect.any(Function));
    const handler = vi.mocked(listen).mock.calls[0][1];
    if (typeof handler === "function")
      handler({
        event: "progress",
        id: 1,
        payload: {
          task: "Import",
          done: 4,
          total: 10,
          message: "Reading raw files",
        },
      });
    expect(cb).toHaveBeenCalledWith({
      task: "Import",
      done: 4,
      total: 10,
      message: "Reading raw files",
    });
    expect(typeof off).toBe("function");
  });
});
