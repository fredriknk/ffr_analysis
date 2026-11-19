import { useId } from "react";
import type { DiagnosticsConfig, Gas } from "../../api/types";
import { Field } from "../../shared/common";

type ThresholdGroup = [
  title: string,
  fields: [key: keyof DiagnosticsConfig, label: string, hint: string][],
];

const groups: ThresholdGroup[] = [
  [
    "Noise floor",
    [
      [
        "noiseFloorMultiplier",
        "Noise floor multiplier · ×",
        "Multiplies each gas’s median flux standard error to set its noise floor.",
      ],
    ],
  ],
  [
    "Shape",
    [
      [
        "extraCutS",
        "Extra robust trim · s",
        "Trims this much time from each end of a chamber segment for the robust refit.",
      ],
      [
        "robustMad",
        "Robust refit residual cutoff · robust SD",
        "Drops points whose residual differs from the median by more than this in the robust refit.",
      ],
      [
        "shapeFloorMultiplier",
        "Minimum shape effect · noise floors",
        "Requires the robust and original fluxes to differ by more than this before rating the shape effect.",
      ],
      [
        "shapeWarnImpact",
        "Shape warning impact · fraction",
        "Sets the minimum effective impact for a shape warning.",
      ],
      [
        "shapeBadImpact",
        "Shape bad impact · fraction",
        "Sets the minimum effective impact for a shape finding rated bad.",
      ],
      [
        "edgeRatio",
        "Edge-to-interior residual ratio · ×",
        "Flags segment edges when their mean absolute residual exceeds this multiple of the interior mean.",
      ],
      [
        "spikeMad",
        "Spike residual cutoff · robust SD",
        "Flags a spike when a fitted point’s residual differs from the median by more than this.",
      ],
      [
        "noisyWarn",
        "High residual noise ratio · ×",
        "Flags high noise when residual SD exceeds this multiple of the gas’s baseline residual SD.",
      ],
      [
        "curvatureP",
        "Curvature p-value cutoff · probability",
        "Requires the quadratic F-test p-value to fall below this cutoff.",
      ],
      [
        "curvatureSlopeChange",
        "Curvature slope difference · fraction",
        "Requires slopes from the two halves of the fit to differ by more than this fraction of the larger absolute slope.",
      ],
      [
        "curvatureGases",
        "Gases checked for curvature",
        "Select which gas traces are checked for curvature.",
      ],
    ],
  ],
  [
    "Valve timing",
    [
      [
        "valveSearchS",
        "Valve lag search radius · s",
        "Searches this far before and after the current valve timing.",
      ],
      [
        "valveStepS",
        "Valve lag search step · s",
        "Sets the time between candidate lags.",
      ],
      [
        "valveEstimateCutS",
        "Valve lag search trim · s",
        "Trims this much time from each end of a segment during the lag search.",
      ],
      [
        "lagContrastSd",
        "Minimum chamber contrast · robust SD",
        "Requires the two chambers’ concentrations to differ by more than this many robust noise SDs.",
      ],
      [
        "valveMinImprovement",
        "Minimum valve lag improvement · fraction",
        "Requires this fractional reduction in squared residuals to use the estimated lag.",
      ],
      [
        "valveMinLagS",
        "Minimum valve lag · s",
        "Minimum difference between the estimated lag and the current shift that raises a valve timing finding and lets the robust refit use the estimate.",
      ],
    ],
  ],
  [
    "Chamber leak",
    [
      [
        "leakMinDayPoints",
        "Minimum daily leak observations · count",
        "Requires this many included robot observations for the daily CO₂ comparison.",
      ],
      [
        "leakReferenceFloor",
        "Minimum leak reference · noise floors",
        "Requires the reference flux for a leak comparison to exceed this many noise floors.",
      ],
      [
        "leakFraction",
        "Low flux leak cutoff · fraction",
        "Flags a possible leak when the flux is below this fraction of its reference.",
      ],
      [
        "leakDaySiblingFraction",
        "Other-chamber CO₂ leak cutoff · fraction",
        "Rates a daily CO₂ leak finding bad if the other chamber exceeds this fraction of the day’s CO₂ median.",
      ],
    ],
  ],
  [
    "Negative flux",
    [
      [
        "n2oNegativeP",
        "Negative flux p-value cutoff · probability",
        "Requires the slope p-value to be below this cutoff for falling N₂O or CO₂.",
      ],
      [
        "co2NegativeFloor",
        "Falling CO₂ bad cutoff · noise floors",
        "Rates significantly negative CO₂ bad when its magnitude exceeds this many noise floors.",
      ],
      [
        "negativeInfoFloor",
        "Falling N₂O info cutoff · noise floors",
        "Flags significantly negative N₂O when its magnitude exceeds this many noise floors.",
      ],
      [
        "negativeWarnFloor",
        "Falling N₂O warning cutoff · noise floors",
        "Raises a falling N₂O finding to warning when its magnitude exceeds this many noise floors.",
      ],
      [
        "negativeBadFloor",
        "Falling N₂O bad cutoff · noise floors",
        "Rates falling N₂O bad when its magnitude exceeds this many noise floors.",
      ],
    ],
  ],
  [
    "Neighbours",
    [
      [
        "neighbourDays",
        "Same-treatment search radius · days",
        "Looks this many days either side of the measurement for neighbours in the same treatment.",
      ],
      [
        "neighbourFallbackDays",
        "Same-plot search radius · days",
        "Looks this many days either side for same-plot neighbours when the treatment has too few.",
      ],
      [
        "minNeighbours",
        "Minimum neighbours · count",
        "Requires this many neighbours to score a flux.",
      ],
      [
        "neighbourAsinhMadMin",
        "Minimum transformed neighbour spread · asinh scale",
        "Sets a lower bound on the robust spread used to score fluxes after the asinh transform.",
      ],
      [
        "neighbourZ",
        "Transformed outlier cutoff · z-score",
        "Requires the outlier score on the asinh scale to exceed this cutoff.",
      ],
      [
        "neighbourRawZ",
        "Raw outlier cutoff · z-score",
        "Requires the outlier score on the original flux scale to also exceed this cutoff.",
      ],
      [
        "neighbourBadZ",
        "Transformed bad outlier cutoff · z-score",
        "Rates an outlier bad if its score on the asinh scale exceeds this cutoff.",
      ],
      [
        "neighbourBadRatio",
        "High-flux outlier ratio · ×",
        "Rates a high outlier bad above this multiple of the neighbours’ median absolute flux if it also clears the noise-floor cutoff.",
      ],
      [
        "neighbourBadFloor",
        "High-flux outlier cutoff · noise floors",
        "Requires a high outlier to clear this many noise floors to be rated bad by the ratio rule.",
      ],
    ],
  ],
  [
    "Valves and points",
    [
      [
        "normalSwitches",
        "Expected valve switch count · count",
        "Flags the valve sequence when the switch count differs from this value.",
      ],
      [
        "normalSegmentS",
        "Expected chamber segment duration · s",
        "Sets the reference duration used to check full chamber segments.",
      ],
      [
        "irregularFraction",
        "Segment duration tolerance · fraction",
        "Flags a chamber segment when its duration differs from the expected duration by more than this fraction.",
      ],
      [
        "minPoints",
        "Minimum fitted points · count",
        "Flags a fit that uses fewer points than this.",
      ],
      [
        "minWindowS",
        "Minimum fit span · s",
        "Flags a fit when its time span is shorter than this.",
      ],
    ],
  ],
  [
    "Dropouts",
    [
      [
        "dropoutGapS",
        "Maximum gap between readings · s",
        "Flags N₂O or CO₂ when readings within a chamber segment and fit window are further apart than this.",
      ],
    ],
  ],
];

const gasLabels: Partial<Record<string, string>> = {
  N2O: "N₂O",
  CO2: "CO₂",
  CO: "CO",
  H2O: "H₂O",
  licor_H2O: "H₂O (LI-COR)",
};

export function DiagnosticThresholds({
  diagnostics,
  gases,
  onChange,
}: {
  diagnostics: DiagnosticsConfig;
  gases: Gas[];
  onChange: (diagnostics: DiagnosticsConfig) => void;
}) {
  const id = useId();
  return (
    <details className="diagnostic-thresholds">
      <summary>Diagnostic thresholds</summary>
      {groups.map(([title, fields]) => (
        <section key={title} className="diagnostic-group">
          <h4>{title}</h4>
          <div className="form-grid">
            {fields.map(([key, label, hint]) => {
              const hintId = id + key;
              if (key === "curvatureGases") {
                const selected = diagnostics.curvatureGases;
                const choices = [...new Set([...gases, ...selected])];
                return (
                  <fieldset
                    key={key}
                    className="plain-fieldset curvature-gases"
                    aria-describedby={hintId}
                  >
                    <legend>{label}</legend>
                    <small id={hintId} className="muted">
                      {hint}
                    </small>
                    <div className="curvature-gas-options">
                      {choices.map((gas) => (
                        <label key={gas}>
                          <input
                            type="checkbox"
                            checked={selected.includes(gas)}
                            onChange={(e) =>
                              onChange({
                                ...diagnostics,
                                curvatureGases: e.target.checked
                                  ? [...selected, gas]
                                  : selected.filter((g) => g !== gas),
                              })
                            }
                          />
                          {gasLabels[gas] ?? gas}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              }
              return (
                <div key={key}>
                  <Field label={label}>
                    <input
                      type="number"
                      step="any"
                      aria-describedby={hintId}
                      value={diagnostics[key]}
                      onChange={(e) =>
                        onChange({
                          ...diagnostics,
                          [key]: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <small id={hintId} className="muted">
                    {hint}
                  </small>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </details>
  );
}
