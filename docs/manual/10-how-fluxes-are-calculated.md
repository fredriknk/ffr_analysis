# How fluxes are calculated

The Field Flux Robot measures two chambers with one analyser stream per instrument. A valve alternates between the left and right chambers. FFR Analyzer fits concentration against time separately for each chamber and converts the slope to a flux. This chapter describes the calculation and the settings to record when reporting a method.

## Raw files and time alignment

A robot file contains a valve log and instrument readings. Files may be Python pickle files or gzip-compressed JSON. The valve log (`aux`) records events with absolute timestamps. Instrument records contain their own start time (`t0`), a nominal sampling interval (`dt`) and readings sampled at elapsed times (`ty`). A typical file lasts about 185 s and samples about once a second. Instrument records can be missing.

| Record | Contents |
| --- | --- |
| `aux` | Valve number and open or closed state at each event. Empty entries are ignored. |
| `li-cor` | CO₂, water vapour, pressure and instrument temperature. CO₂ and **licor_H2O** are used for regressions. |
| `dlt` | Multi-channel analyser readings. Zero-based channels 10, 8 and 6 supply dry N₂O, dry CO and **H2O**, respectively. |
| `wind` | Wind components when present. |

A file name such as `2022-09-01-13-07-15-x599233_533097-y6615294_3131-z0_0-h-1_13308241114_both_Plot_15_` encodes the local start time, robot position (UTM x, y and z), heading in radians, measured sides (`left`, `right` or `both`), and waypoint name. Underscores inside the position and heading numbers are decimal points. The heading can be negative or absent.

The time axis uses each instrument’s elapsed sample times exactly as stored. To place the valves on that axis, the app subtracts the absolute file-name start time from each valve timestamp. It interprets the file-name time in the **Time zone** stored in the project, which defaults to `Europe/Oslo`. At a repeated local time during the autumn clock change, it uses the earlier occurrence. The alignment ignores the instrument `t0` fields. The legacy cuts were tuned with this convention.

## Attribute points to each chamber

In a two-valve file, valve 1 opens the left chamber and valve 2 opens the right. The logged opening and closing must form a valid pair less than 2 s apart. The switch is placed halfway between the two events and starts a segment for the opening chamber. The app validates the order, timing and sides of the pairs. A file with an invalid valve sequence is recorded as an error.

NitroScope files can log several valve closures after an opening. Closures less than 2 s after the opening belong to the same switch. Its time is the midpoint between the opening and the first closure, or the opening time when there is no closure in the group. Valve 1 and valve 2 still start left and right segments. An opening of another valve or a group of closures alone starts a segment for neither chamber. Consecutive switches to the same side are combined into a single segment.

By default the app trims 4 s at the beginning and 3 s at the end of each segment to reduce switching transients. It maps the trimmed boundaries to sample indices using the legacy search, which generally picks the first sample at or after each boundary on an increasing time axis, capped at the last sample. It includes both of those boundary indices in the chamber segment. For the final segment the end is based on the last sample time. The regression window is applied separately.

In **Review**, **Valve timing** → **Shift · s** adds the stated number of seconds to the logged switches before selecting chamber points. A positive offset shifts them later. The default is 0 s. Per-gas overrides can set a different offset, cut or window for a gas.

## Select a window and fit a slope

The fit drops zero readings, non-finite readings and analyser error values with magnitude at least `1e30`. Valid negative concentrations stay in the fit. The result for each gas uses one line through all the selected points for that chamber, even though they come from several separate valve segments.

| **Mode** in **Review** | How the slope is obtained |
| --- | --- |
| **Fixed** | Select the eligible sample indices nearest **Start · s** and **Stop · s**. If two points are equally close, use the earlier one. Fit from the start index up to but excluding the stop index (`x[i:j]`). If the stop reaches or exceeds the last eligible sample, the last sample is the stop index and is left out. New projects start with a 0–180 s window. |
| **Auto** | Search within **Start · s** and **Stop · s** for a window of the requested **Interval · s**, 100 s by default. Each candidate starts at an eligible point and ends at the last eligible point at or before the target end time. The ending index is left out of the fit. **Steepest** maximises the signed slope times a span weight. **Lowest MSE** minimises MSE times the same weight. The weight is the candidate span minus 30% of the requested duration, with a tiny positive lower bound. With **CO₂ guides** on, other gases in auto mode reuse CO₂’s chosen bounds when available. |
| **Manual slope** | Use the entered slope in ppm/s without fitting a line to the observations. The displayed line passes through the first eligible point. Fit statistics in this mode do not measure goodness of fit. |

Ordinary least squares, labelled **Linear** in **Review** and **Least squares (legacy)** in **Project**, minimises the sum of squared concentration residuals about a straight line. **Robust** in **Review**, or **Robust refit** in **Project**, can replace this result for N₂O and CO₂ when a refit is available. It keeps the selected window bounds. It uses a separate valve lag estimate for each gas if the chamber contrast, improvement and minimum-lag tests pass. By default, the search spans ±10 s in 0.5 s steps, the chamber contrast must exceed four robust noise SDs, the combined squared residuals of both chambers must fall by at least 30%, and the extra shift must have magnitude at least 1 s.

The robust calculation trims a further 3 s from each end of each chamber segment. In up to two passes it removes points whose residuals differ from the median by more than four scaled median absolute deviations. The scale is the median absolute deviation multiplied by 1.4826. The final slope comes from least squares on the remaining points. With **Least squares (legacy)** selected, this refit is a diagnostic comparison. Choosing **Robust refit** uses the robust slope in the flux calculation. See [Diagnostic thresholds](08-project.md#diagnostic-thresholds) for the configurable defaults.

### Regression statistics

For a fitted line `y = intercept + slope × t`, the app records the fitted slope (ppm/s), intercept, number of points `n`, selected time bounds, and the minimum, maximum and first retained concentrations.

| Statistic | Calculation |
| --- | --- |
| `MSE` | Residual sum of squares divided by `n − 2`. Its square root is the residual SD. |
| `r²` | Squared Pearson correlation between elapsed time and concentration. |
| `p` | Two-sided Pearson test of zero correlation. A flat concentration series has no defined p-value. |
| Slope standard error | `sqrt(MSE / Sxx)`, where `Sxx` is the sum of squared deviations from the mean sample time. |
| Intercept standard error | `sqrt(MSE × (1/n + mean(t)²/Sxx))`. |

A fit needs at least three points with varying sample times. The flux standard error is the slope standard error multiplied by the same conversion factor as the slope. The legacy N₂O quality check is retained as an informational finding.

## Convert slope to flux

Calculate the chamber flux `F` in mol m⁻² s⁻¹ as follows.

`F = slope × 10⁻⁶ × p × h / (R × (T + 273.15))`

| Term | Value used |
| --- | --- |
| `slope` | Concentration slope in ppm/s. |
| `p` | Project pressure, by default 101,000 Pa. |
| `h` | Project **Chamber height · m**, by default 0.5 m. |
| `R` | Gas constant, 8.314 J mol⁻¹ K⁻¹. |
| `T` | Air temperature in °C at the measurement time. The app linearly interpolates the project’s `air_temperature` series. Outside the series it uses the nearest endpoint. If there are no usable values it uses **Fallback temperature · °C**, which defaults to 20 °C, and flags that flux. |

For N₂O–N, multiply `F` by `2 × 14 × 10⁶ × 3600` to obtain µg N m⁻² h⁻¹. This counts the two nitrogen atoms in each N₂O molecule. For CO₂–C, multiply `F` by `12 × 10⁶ × 3600` to obtain µg C m⁻² h⁻¹. CO and the water-vapour channels remain in mol m⁻² s⁻¹.

## Locate the chamber and assign the plot

The app starts from the robot coordinates in the file name. By default, it offsets the chamber 2 m perpendicular to the heading on the measured side and 0.2 m forward along the heading. If the heading is missing, it uses the robot position. With coordinates available, it assigns the robot flux to the first plot whose waypoint-number and side pair matches or whose polygon contains the calculated chamber position. It tests both for each plot in layout order. A saved per-flux plot override takes precedence. Plots supply the treatment assignments. See [Waypoints and robot routes](09-waypoints.md#make-plots-from-a-route).

## Summarise treatments

The summary uses the selected gas, date range, sources and flux subset. It omits excluded fluxes and any flux where the selected gas is excluded. Only observations with a plot and a value for the selected gas contribute to plot totals.

1. For each plot, group observations by calendar day in the project’s time zone. Take the arithmetic mean of the available fluxes on each measured day.
2. For N₂O–N and CO₂–C, multiply µg m⁻² h⁻¹ by `10,000 / 10⁹ = 10⁻⁵` to convert to kg ha⁻¹ h⁻¹.
3. Integrate by the trapezoid rule between consecutive measured days. Multiply the average of their two rates by 24 hours times the difference in calendar days. Unmeasured days are bridged by that trapezoid. The first measured day starts at zero. The app treats each calendar day as 24 hours, including daylight saving transitions.
4. Sum the trapezoids to get the cumulative plot total in kg ha⁻¹. For a treatment, take the arithmetic mean of its plot totals and the population SD, dividing the sum of squared deviations by the number of contributing plots.

The summary applies the same `10⁻⁵` factor and kg ha⁻¹ label to every gas. The mass units above apply to the N₂O–N and CO₂–C rates. CO and water-vapour rates enter the summary in mol m⁻² s⁻¹, so their integrated values need a separate unit conversion.

The geometric mean is `exp(mean(ln(flux)))` over positive individual fluxes for a treatment. Its geometric SD is `exp(sample SD(ln(flux)))`, with `n − 1` in the variance denominator. The daily-means box plot on **Treatments** pools the per-plot daily means within each treatment. Its whiskers are the 5th and 95th percentiles, with the box spanning the 25th to 75th percentiles and a line at the median. See [Treatments](04-treatments.md).

## Compare with the original program

The legacy least-squares results are designed to match the original program for the same supported raw files, analysis options and temperature inputs. The parity checks compare results with reference outputs from the original. The slope and intercept standard errors use the corrected formulas above. Robust refits, newer multi-valve files and analyser error-code filtering extend the original method. When reporting results, record the fit method, window and cuts, any valve offset, the temperature source and fallback, and any changes to the chamber height or pressure. The original method was developed by Lars Molstad. [Original ffr_analysis program](https://github.com/larsmolstad/ffr_analysis)
