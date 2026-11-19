import { expect, it } from "vitest";
import { createMock } from "./mock";
import type { Plot } from "./types";

it("assigns a robot flux by override, then waypoint visit, then polygon", async () => {
  const api = createMock();
  await api.projectOpen("demo.ffr");
  const { flux } = await api.getFluxDetail(1);
  const { plots } = await api.getLayout();
  const visit = plots
    .find((p) => p.id === flux.plotId)!
    .waypoints!.find((v) => v.side === flux.side)!;
  const { x, y } = flux;
  const polygon: NonNullable<Plot["polygon"]> = [
    [x - 1, y - 1],
    [x + 1, y - 1],
    [x + 1, y + 1],
    [x - 1, y + 1],
  ];
  const layout = await api.applyWaypointLayout({
    points: [],
    plots: [
      { label: "First polygon", polygon, treatmentId: 1, waypoints: [] },
      { label: "Route plot", polygon, treatmentId: 2, waypoints: [visit] },
    ],
  });
  const plotId = async () => (await api.getFluxDetail(1)).flux.plotId;
  expect(await plotId()).toBe(2);
  await api.setFluxFlags([1], { plotOverride: 1 });
  await api.setLayout(layout);
  expect(await plotId()).toBe(1);
  await api.setFluxFlags([1], { plotOverride: null });
  expect(await plotId()).toBe(2);
  layout.plots[1].waypoints = [];
  await api.setLayout(layout);
  expect(await plotId()).toBe(1);
});
