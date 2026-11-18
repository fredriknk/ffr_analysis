import { useQuery } from "@tanstack/react-query";
import { memo, useMemo, useState } from "react";
import { api } from "../../api";
import type { FluxRow, TreatmentSummary } from "../../api/types";
import { Empty, Field, Panel, Status } from "../../shared/common";
import { significant, unit } from "../../shared/format";
import { FieldMap } from "../../shared/map/FieldMap";
import { useStore } from "../../store";

const emissionColours = ["#f4e2a6", "#eeb768", "#df824a", "#bf4c43", "#8f2147"];
const noData = "#808e95";

export const EmissionMap = memo(function EmissionMap({
  summary,
  rows,
  updating,
  visible,
}: {
  summary: TreatmentSummary;
  rows: FluxRow[];
  updating: boolean;
  visible: boolean;
}) {
  const layout = useQuery({
    queryKey: ["layout"],
    queryFn: () => api.getLayout(),
    enabled: visible,
  });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
    enabled: visible,
  });
  const [mode, setMode] = useState("treatment");
  const [selected, setSelected] = useState<number | null>(null);
  const plots = useMemo(() => {
    const positions = new Map<number, [number, number, number]>();
    for (const { plotId, x, y } of rows) {
      if (
        plotId == null ||
        typeof x !== "number" ||
        typeof y !== "number" ||
        !Number.isFinite(x + y)
      )
        continue;
      const [sx, sy, count] = positions.get(plotId) ?? [0, 0, 0];
      positions.set(plotId, [sx + x, sy + y, count + 1]);
    }
    return (layout.data?.plots ?? []).flatMap((p) => {
      const polygon = p.polygon && p.polygon.length >= 3 ? p.polygon : null;
      const position = positions.get(p.id);
      if (!polygon && !position) return [];
      const centre: [number, number] = polygon
        ? [
            polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length,
            polygon.reduce((sum, [, y]) => sum + y, 0) / polygon.length,
          ]
        : [position![0] / position![2], position![1] / position![2]];
      return [{ ...p, polygon, centre }];
    });
  }, [layout.data, rows]);
  const fit = useMemo(
    () => plots.flatMap((p) => p.polygon ?? [p.centre]),
    [plots],
  );
  const fitKey = useMemo(
    () => fit.map(([x, y]) => x + "," + y).join("|"),
    [fit],
  );
  const treatments = useMemo(
    () => new Map(layout.data?.treatments.map((t) => [t.id, t])),
    [layout.data],
  );
  const totals = useMemo(
    () =>
      new Map(
        summary.plots.filter((p) => p.points.length).map((p) => [p.plotId, p]),
      ),
    [summary.plots],
  );
  const values = plots.flatMap((p) => {
    const total = totals.get(p.id)?.total;
    return total === undefined ? [] : [total];
  });
  const min = Math.min(...values),
    max = Math.max(...values);
  const cumulativeUnit = unit(summary.cumulativeUnit);
  const selectedPlot = plots.find((p) => p.id === selected);
  const result = selectedPlot ? totals.get(selectedPlot.id) : undefined;
  function colour(plot: (typeof plots)[number]) {
    if (mode === "treatment")
      return treatments.get(plot.treatmentId)?.colour ?? noData;
    const total = totals.get(plot.id)?.total;
    if (total === undefined) return noData;
    const fraction = min === max ? 0.5 : (total - min) / (max - min);
    return emissionColours[
      Math.min(
        emissionColours.length - 1,
        Math.floor(fraction * emissionColours.length),
      )
    ];
  }

  return (
    <Panel
      title="Cumulative emissions map"
      extra={
        <Field label="Colour by">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="treatment">Treatment</option>
            <option value="emission">Cumulative emission</option>
          </select>
        </Field>
      }
    >
      <Status
        loading={layout.isLoading || config.isLoading}
        error={layout.error ?? config.error}
      />
      {layout.data &&
        config.data &&
        (plots.length ? (
          <>
            <FieldMap
              label="Treatment plot map"
              className="treatments-map"
              crs={config.data.crs}
              fit={fit}
              fitKey={fitKey}
              onPointerDown={({ event }) => {
                const hit = (event.target as Element).closest("[data-plot-id]");
                if (!hit) return false;
                setSelected(Number(hit.getAttribute("data-plot-id")));
                return true;
              }}
              onBackgroundClick={() => setSelected(null)}
            >
              {({ toScreen }) =>
                plots.map((p) => {
                  const { x, y } = toScreen(...p.centre);
                  const fill = colour(p);
                  const points = p.polygon
                    ?.map(([px, py]) => {
                      const v = toScreen(px, py);
                      return v.x + "," + v.y;
                    })
                    .join(" ");
                  return (
                    <g
                      key={p.id}
                      data-plot-id={p.id}
                      className={selected === p.id ? "selected" : undefined}
                    >
                      <title>
                        {p.label} · {treatments.get(p.treatmentId)?.name}
                      </title>
                      {points ? (
                        <polygon points={points} fill={fill} />
                      ) : (
                        <circle cx={x} cy={y} r={11} fill={fill} />
                      )}
                      <text
                        x={x}
                        y={y}
                        className="plot-label"
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {p.label}
                      </text>
                    </g>
                  );
                })
              }
            </FieldMap>
            {mode === "emission" && (
              <div className="treatments-controls treatments-map-legend">
                <span>
                  {summary.gas} · {cumulativeUnit}
                </span>
                {values.length > 0 &&
                  (min !== max ? (
                    <>
                      <span>{significant(min)}</span>
                      <span className="treatments-map-scale" aria-hidden="true">
                        {emissionColours.map((fill) => (
                          <span key={fill} style={{ background: fill }} />
                        ))}
                      </span>
                      <span>{significant(max)}</span>
                    </>
                  ) : (
                    <span>
                      <span
                        className="dot"
                        style={{ background: emissionColours[2] }}
                      />{" "}
                      {significant(min)}
                    </span>
                  ))}
                <span>
                  <span className="dot" style={{ background: noData }} /> No
                  matching fluxes
                </span>
              </div>
            )}
            <div className="treatments-controls">
              <Field label="Map plot">
                <select
                  value={selectedPlot?.id ?? ""}
                  onChange={(e) =>
                    setSelected(e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">Select a plot</option>
                  {plots.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              {selectedPlot && (
                <>
                  <span>
                    {treatments.get(selectedPlot.treatmentId)?.name} ·{" "}
                    {updating
                      ? "Updating total…"
                      : result
                        ? significant(result.total) + " " + cumulativeUnit
                        : "No matching fluxes"}
                  </span>
                  {result && (
                    <button
                      disabled={updating}
                      onClick={() =>
                        useStore
                          .getState()
                          .reviewThese(result.points.map((p) => p.fluxId))
                      }
                    >
                      Review {result.points.length} fluxes
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <Empty>No plot locations are available for this project.</Empty>
        ))}
    </Panel>
  );
});
