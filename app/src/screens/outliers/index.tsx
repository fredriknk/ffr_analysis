import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../api";
import { hasFinding } from "../../api/findingLevels";
import type { FluxRow, Gas } from "../../api/types";
import { Status, unit, useAction, useRows } from "../../shared/common";
import { useDiagnostics } from "../../shared/hooks/useDiagnostics";
import { useStore } from "../../store";
import { ScatterPlot, type ScatterSpec } from "./ScatterPlot";
import { quantile, type AxisScale } from "./axes";
export function Outliers() {
  const visible = useStore((s) => s.screen === "Outliers");
  const s = useStore(
      useShallow(({ openFlux, reviewThese }) => ({ openFlux, reviewThese })),
    ),
    data = useRows(),
    action = useAction(),
    [selected, setSelected] = useState<number[]>([]),
    [includeInfo, setIncludeInfo] = useState(false),
    [diagnostic, setDiagnostic] = useState<string | null>(null),
    [excluded, setExcluded] = useState(false),
    [gas, setGas] = useState<Gas>("N2O"),
    [lagGas, setLagGas] = useState<"N2O" | "CO2">("CO2"),
    [scale, setScale] = useState<AxisScale>("asinh"),
    [full, setFull] = useState(false),
    [colour, setColour] = useState<"severity" | "treatment">("severity");
  const counts = useDiagnostics(visible),
    layout = useQuery({
      queryKey: ["layout"],
      enabled: visible,
      queryFn: () => api.getLayout(),
    });
  const rows = useMemo(() => {
    const raw = data.data?.rows ?? [],
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: useStore.getState().timeZone,
      }),
      days = new Map<string, number[]>();
    raw
      .filter((r) => !r.excluded && typeof r.CO2_flux === "number")
      .forEach((r) => {
        const day = formatter.format(r.time);
        let values = days.get(day);
        if (!values) {
          values = [];
          days.set(day, values);
        }
        values.push(Number(r.CO2_flux));
      });
    const medians = new Map([...days].map(([d, vs]) => [d, quantile(vs, 0.5)]));
    return raw
      .filter(
        (r) =>
          (excluded || !r.excluded) &&
          (!diagnostic || hasFinding(r, diagnostic, includeInfo)),
      )
      .map((r) => ({
        ...r,
        dayMedian: medians.get(formatter.format(r.time)) ?? null,
      }));
  }, [data.data, excluded, diagnostic, includeInfo, counts.data]);
  const specs = useMemo<ScatterSpec[]>(
    () => [
      {
        label: "N₂O versus CO₂",
        x: "CO2_flux",
        y: "N2O_flux",
        xLabel: unit("CO2-C · ug m^-2 h^-1"),
        yLabel: unit("N2O-N · ug m^-2 h^-1"),
      },
      {
        label: "Impact versus flux",
        x: gas + "_flux",
        y: gas + "_impact",
        xLabel: gas + " flux",
        yLabel: "Impact · fraction",
      },
      {
        label: "CO₂ flux versus day median",
        x: "dayMedian",
        y: "CO2_flux",
        xLabel: "Day median CO₂ flux",
        yLabel: "CO₂ flux",
      },
      {
        label: "Valve lag over time",
        x: "time",
        y: lagGas === "N2O" ? "N2O_lagS" : "valveLagS",
        xLabel: "Date",
        yLabel: lagGas + " lag · s",
        time: true,
      },
      {
        label: "Fit quality versus flux",
        x: gas + "_rsq",
        y: gas + "_flux",
        xLabel: "R²",
        yLabel: gas + " flux",
      },
      {
        label: "Fluxes by treatment",
        x: "time",
        y: gas + "_flux",
        xLabel: "Date",
        yLabel: gas + " flux",
        time: true,
      },
    ],
    [gas, lagGas],
  );
  const onSelect = useCallback(
    (ids: number[]) =>
      setSelected((prev) => (prev.join(",") === ids.join(",") ? prev : ids)),
    [],
  );
  const available = new Set(rows.map((r) => r.id)),
    selectedIds = selected.filter((id) => available.has(id));
  return (
    <div className="page outliers-page">
      <div className="page-heading">
        <div>
          <h2>Outlier hunting</h2>
          <p>
            Find changes that matter: amber = warning, red = bad, faint circles
            = unflagged.
          </p>
        </div>
        <span className="badge">{rows.length.toLocaleString()} fluxes</span>
      </div>
      <div className="toolbar panel">
        <label>
          Gas{" "}
          <select
            aria-label="Outlier gas"
            value={gas}
            onChange={(e) => setGas(e.target.value as Gas)}
          >
            <option>N2O</option>
            <option>CO2</option>
          </select>
        </label>
        <label>
          Axes{" "}
          <select
            aria-label="Outlier scale"
            value={scale}
            onChange={(e) => setScale(e.target.value as AxisScale)}
          >
            <option value="asinh">Symmetric log (asinh)</option>
            <option value="linear">Linear</option>
            <option value="log">Log (positive only)</option>
          </select>
        </label>
        <label>
          Colour by{" "}
          <select
            aria-label="Colour by"
            value={colour}
            onChange={(e) => setColour(e.target.value as typeof colour)}
          >
            <option value="severity">Severity</option>
            <option value="treatment">Treatment</option>
          </select>
        </label>
        <label>
          Lag{" "}
          <select
            aria-label="Lag gas"
            value={lagGas}
            onChange={(e) => setLagGas(e.target.value as typeof lagGas)}
          >
            <option>CO2</option>
            <option>N2O</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={full}
            onChange={(e) => setFull(e.target.checked)}
          />
          Full range
        </label>
        <label>
          <input
            type="checkbox"
            checked={excluded}
            onChange={(e) => setExcluded(e.target.checked)}
          />
          Show excluded
        </label>
      </div>
      <div className="toolbar">
        <strong data-testid="outlier-selection">
          {selectedIds.length} selected
        </strong>
        <button onClick={() => setSelected(rows.map((r) => r.id))}>
          Select all visible
        </button>
        <button
          className="primary"
          disabled={!selectedIds.length}
          onClick={() => s.reviewThese(selectedIds)}
        >
          Review these →
        </button>
        <button
          disabled={!selectedIds.length}
          onClick={() =>
            void action(() => api.setFluxFlags(selectedIds, { excluded: true }))
          }
        >
          Exclude selected
        </button>
        <button
          disabled={!selectedIds.length}
          onClick={() =>
            void action(() => api.setFluxFlags(selectedIds, { reviewed: true }))
          }
        >
          Mark selected reviewed
        </button>
        <button
          onClick={() => {
            setSelected([]);
            setDiagnostic(null);
          }}
        >
          Clear selection & filter
        </button>
      </div>
      <Status loading={data.isLoading} error={data.error} />
      <Status loading={layout.isLoading} error={layout.error} />
      <div className="outliers-layout">
        <aside className="panel diagnostic-bars">
          <h3>Findings</h3>
          <label>
            <input
              type="checkbox"
              checked={includeInfo}
              onChange={(e) => setIncludeInfo(e.target.checked)}
            />
            Include info
          </label>
          <Status loading={counts.isLoading} error={counts.error} />
          {counts.data
            ?.filter((c) => c.count)
            .map((c) => (
              <button
                className={diagnostic === c.code ? "active" : ""}
                key={c.code}
                title={c.description}
                onClick={() => {
                  setDiagnostic(diagnostic === c.code ? null : c.code);
                  setSelected([]);
                }}
              >
                <span>{c.label}</span>
                <strong>
                  {c.warnBad ?? 0}
                  {c.pending ? "…" : ""}
                  <small className="muted">
                    {" "}
                    · {(c.info ?? 0).toLocaleString()} info
                  </small>
                </strong>
                <i
                  style={{
                    width:
                      (c.count /
                        Math.max(1, ...counts.data!.map((d) => d.count))) *
                        100 +
                      "%",
                  }}
                />
              </button>
            ))}
        </aside>
        <div className="outlier-plots two">
          {specs.map((spec) => (
            <ScatterPlot
              key={spec.label}
              spec={spec}
              rows={rows as FluxRow[]}
              layout={layout.data}
              scale={scale}
              full={full}
              colour={colour}
              selected={selectedIds}
              onSelect={onSelect}
              onOpen={s.openFlux}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
