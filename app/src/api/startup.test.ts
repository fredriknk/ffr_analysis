import { describe, expect, it, vi } from "vitest";
import { openStartupProject } from "./startup";
describe("startup project", () => {
  it("opens the launch path before navigating", async () => {
    const opened = vi.fn(),
      api = {
        startupPath: vi.fn().mockResolvedValue("launch.ffr"),
        projectOpen: vi.fn().mockResolvedValue({}),
      };
    expect(await openStartupProject(api, opened)).toBe(true);
    expect(api.projectOpen).toHaveBeenCalledWith("launch.ffr");
    expect(opened).toHaveBeenCalledOnce();
  });
  it("leaves Start available without a launch path", async () => {
    const opened = vi.fn(),
      api = {
        startupPath: vi.fn().mockResolvedValue(null),
        projectOpen: vi.fn(),
      };
    expect(await openStartupProject(api, opened)).toBe(false);
    expect(api.projectOpen).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });
  it.each(["File missing", "Project is locked", "Invalid project"])(
    "preserves the actionable error: %s",
    async (message) => {
      const opened = vi.fn(),
        api = {
          startupPath: vi.fn().mockResolvedValue("launch.ffr"),
          projectOpen: vi.fn().mockRejectedValue({ message }),
        };
      await expect(openStartupProject(api, opened)).rejects.toEqual({
        message,
      });
      expect(opened).not.toHaveBeenCalled();
    },
  );
});
