import { describe, expect, it } from "vitest";
import { useStore } from "../../store";
describe("new review navigation", () => {
  it("defaults a fresh Review to attention and preserves subsequent queue state", () => {
    useStore.setState({
      reviewVisited: false,
      quick: "all",
      queueSort: "time",
    });
    useStore.getState().nav("Review");
    expect(useStore.getState().quick).toBe("attention");
    expect(useStore.getState().queueSort).toBe("attention");
    useStore.setState({ queueSort: "plot" });
    useStore.getState().nav("Data");
    useStore.getState().nav("Review");
    expect(useStore.getState().queueSort).toBe("plot");
  });
});
