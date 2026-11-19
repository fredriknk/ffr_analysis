# Project settings and field layout

Open **Project** to set the analysis defaults, manage treatments and plots, or make a backup. The screen opens locked. You can inspect and select plots while it is locked. Choose **Unlock to edit** at the top of the page to make changes. Save or discard both the settings draft and the layout draft before choosing **Lock** again.

![Project screen with a plot selected on the field map](../images/project.png)

*The selected plot’s label, treatment and block appear beside the field map.*

## Set the project and analysis defaults

In **Project & analysis defaults**, check the time zone before analysing robot files. The date and time in each file name are local to the field site. The app uses the project time zone to turn that time into an absolute timestamp and align the valve log with the concentration traces. It also uses the zone to display times and group measurements into local days.

| Setting | Default for a new project | What it controls |
| --- | --- | --- |
| **Project name** | Name given when you create the project | The name shown in the app. |
| **Time zone** | `Europe/Oslo` | Use a region name such as `Europe/Oslo` so daylight saving rules are applied for the measurement date. |
| **start · s** | 0 s | Start of the regression window, measured from the start of the trace. |
| **stop · s** | 180 s | End of the regression window. The ending sample is left out of a fixed-window fit. |
| **cutBeginnings · s** | 4 s | Trim at the beginning of each chamber segment while the gas signal settles after a switch. |
| **cutEnds · s** | 3 s | Trim at the end of each chamber segment before the next switch. |
| **Fit method (N₂O, CO₂)** | **Least squares (legacy)** | Choose **Robust refit** to report the refit for these two gases when available. |
| **Fallback temperature · °C** | 20 °C | Temperature used to convert the slope to flux when the project has no usable air temperature series. |
| **Chamber height · m** | 0.5 m | Effective chamber height used in the flux conversion. |

New projects start in fixed-window mode. Use **Review** for individual changes to the window, mode, valve offset or per-gas settings. **Project** displays the configured gases and reporting units for reference. N₂O is reported as µg N m⁻² h⁻¹ and CO₂ as µg C m⁻² h⁻¹. CO and the two water-vapour channels, **H2O** and **licor_H2O**, use mol m⁻² s⁻¹.

Choose **Save & recompute** to save the settings and recalculate robot regressions, fluxes, plot assignments and diagnostics. A time-zone change also reinterprets the file-name times of stored robot measurements. Robot fluxes with their own analysis options keep those options when they are recalculated. Imported manual flux values are already calculated. Use **Discard changes** beside the settings to abandon this draft. See [How fluxes are calculated](10-how-fluxes-are-calculated.md).

## Diagnostic thresholds

Expand **Diagnostic thresholds** in **Project & analysis defaults**. The thresholds control which findings appear and how they are ranked. The robust refit settings also affect the reported N₂O and CO₂ flux when **Robust refit** is selected. Findings never exclude a flux automatically. A gas’s noise floor is based on the median flux standard error from included robot measurements. A robust SD measures scatter using the median absolute deviation, or MAD.

| Field | Default | Meaning |
| --- | --- | --- |
| **n2o Negative P** | 0.01 | P-value must be below this for the negative N₂O or decreasing CO₂ finding. |
| **extra Cut S** | 3 s | Extra time trimmed from each end of each chamber segment for the robust refit. |
| **robust Mad** | 4 | Maximum residual distance from the median, in robust SDs, for a point to stay in the robust refit. |
| **lag Contrast Sd** | 4 | Difference between chamber signals needed to use a lag estimate, in robust noise SDs. |
| **noisy Warn** | 4 | Residual SD above this multiple of the gas’s median residual SD triggers a noise finding. |
| **shape Floor Multiplier** | 1 | Change from the original to the robust flux must exceed this many noise floors to contribute to shape severity. |
| **shape Warn Impact** | 0.15 | Shape impact at or above this is a warning up to the bad threshold. |
| **shape Bad Impact** | 0.35 | Shape impact at or above this is rated bad. |
| **noise Floor Multiplier** | 3 | Multiplies the median flux standard error to give the noise floor. |
| **negative Info Floor** | 1 | Negative N₂O magnitude above this many floors can give an informational finding. |
| **co2 Negative Floor** | 1 | Negative CO₂ magnitude above this many floors can be rated bad. |
| **negative Warn Floor** | 3 | Negative N₂O magnitude above this many floors can give a warning. |
| **negative Bad Floor** | 5 | Negative N₂O magnitude above this many floors can be rated bad. |
| **leak Reference Floor** | 5 | The reference flux used in a leak comparison must exceed this many floors. |
| **leak Fraction** | 0.25 | A flux below this fraction of its reference can indicate a leak. |
| **leak Day Sibling Fraction** | 0.5 | In the daily CO₂ leak check, the other chamber exceeding this fraction of the day’s median can raise the finding to bad. |
| **neighbour Bad Z** | 10 | Transformed outlier score above which a neighbour finding is rated bad. |
| **neighbour Bad Ratio** | 10 | A high flux can be rated bad if it exceeds this multiple of neighbours’ median absolute flux and clears the bad-floor test. |
| **neighbour Bad Floor** | 5 | Noise-floor multiple that the high flux must also exceed in the bad-ratio test. |
| **neighbour Asinh Mad Min** | 0.15 | Minimum spread used to score neighbours after the inverse hyperbolic sine transformation. |
| **leak Min Day Points** | 6 | Minimum robot observations for the daily CO₂ leak comparison. |
| **neighbour Raw Z** | 8 | Minimum outlier score on the original scale. The transformed score must also clear its threshold. |
| **curvature P** | `1e-12` | P-value must be below this in the quadratic curvature test. |
| **curvature Gases** | N₂O, CO₂ | Gases checked for curvature. The current number field cannot edit this list. |
| **curvature Slope Change** | 0.4 | Relative difference required between slopes fitted to the two halves of the window for a curvature finding. |
| **valve Search S** | 10 s | Lag search distance on either side of the current valve timing. |
| **valve Step S** | 0.5 s | Step between candidate lags. |
| **valve Min Lag S** | 1 s | Minimum lag magnitude for the extra shift in the robust refit. |
| **valve Min Improvement** | 0.30 | Minimum fractional reduction in summed squared residuals for applying the estimated shift in the robust refit. |
| **valve Estimate Cut S** | 0.25 s | Trim from each end of a segment during the valve lag search. |
| **edge Ratio** | 2.5 | Ratio above which edge residuals are flagged compared with interior residuals. |
| **irregular Fraction** | 0.5 | Allowed fractional deviation from the normal segment duration. |
| **normal Segment S** | 20 s | Expected chamber segment duration. |
| **normal Switches** | 10 | Expected switch count for the valve sequence check. |
| **min Points** | 20 | Fits with fewer points get a short-fit finding. |
| **min Window S** | 60 s | Fits spanning less time get a short-fit finding. |
| **spike Mad** | 6 | A residual farther from the median than this many robust SDs can trigger a spike finding. |
| **neighbour Z** | 3.5 | Minimum transformed outlier score. The original-scale score must also clear its threshold. |
| **neighbour Days** | 3 days | Time radius for finding neighbours in the same treatment. |
| **neighbour Fallback Days** | 10 days | Time radius for the same-plot comparison when there are too few treatment neighbours. |
| **min Neighbours** | 6 | Minimum neighbours needed for a comparison. |
| **dropout Gap S** | 5 s | A longer gap between readings within a chamber segment can flag a dropout. |

See [Diagnostics](03-diagnostics.md) for how to inspect a finding in **Review**.

## Inspect the field map and plot assignments

The map draws plot boundaries in their treatment colours. Use **Labels**, **Measurements** and **Route** to show or hide the respective layers. The measurement dots show chamber positions. Red dots mark positions with an unassigned flux. A plot without a boundary, such as a plot imported with waypoint mappings alone, can still have assigned fluxes.

| Assignment | How it works |
| --- | --- |
| Polygon | The app checks whether the chamber position is inside a plot boundary. |
| Waypoint table | A plot can store pairs of waypoint number and chamber side. Route-generated plots and some legacy imports supply these pairs. |
| Per-flux override | In **Review**, open **Plot assignment & note** and choose the plot for that flux. |

A manual override takes precedence. Automatic assignment uses the first plot in layout order with a matching waypoint number and chamber side. If no visit matches, it uses the first plot whose polygon contains the chamber position.

| Key or mouse action | Result |
| --- | --- |
| Wheel | Zoom around the pointer. |
| Drag empty map, or drag with the right or middle button | Pan. |
| **Fit** or `F` with the map focused | Fit the field to the map. |
| Click a plot | Select that plot. |
| `Shift`-click or `Ctrl`-click | Add or remove a plot. |
| `Shift`-drag from empty map | Select plots with centres inside the box. Hold `Ctrl` as well to add them to the current selection. |
| Click empty map, press `Esc` with the map focused, or choose **None** | Clear the selection. |
| **All** or `Ctrl+A` with the map focused | Select all plots. |
| Drag a plot when unlocked | Move it. Drag a plot in a selection to move the whole selection. |
| `Ctrl+Z` or `Ctrl+Y` outside a form field | Undo or redo layout edits within the draft. |

## Edit treatments and plots

1. Unlock the project. In **Treatments & plots**, choose **Add treatment**. Edit the name in its text field and click the colour swatch to choose a colour. To remove a treatment, first move its plots to another treatment, then click **×** beside its name.
2. Select one plot on the map to change its **Label**. Select one or more to set **Treatment** or **Block** together. With editing unlocked, **Zoom to selection** fits the selected boundaries in the map. For plots without boundaries, use **Edit plot labels and treatment assignments** in **Treatments & plots**.
3. To change footprints, use **Plot size** and choose a shape from the table below. Then choose **Resize**. With an empty selection this applies to all plots with boundaries.
4. To renumber plots, set **Prefix** and **First number** under **Names**. Set **Fill** to **Rows**, **Columns** or **Current order**. For rows or columns, choose the starting corner as seen on the north-up map. Turn on **Snake** to reverse the direction on every other row or column. Choose **Rename** to apply to the selection, or to all plots if the selection is empty.
5. Choose **Save** above the map or **Save field layout** in **Treatments & plots**. This saves the entire layout draft, rechecks robot flux assignments and creates one project undo step. Use **Discard** above the map to abandon the draft.

| **Shape** | How to size it |
| --- | --- |
| **Rectangle** | Set **Width · m** along the plot’s first side and **Length · m** across it. |
| **Square** | Set **Side · m**. |
| **Auto square (touching)** | Size each square from the distance to the nearest other plot centre. The side equals that distance. A lone plot gets a 2 m side. |
| **Maximize** | Keep the width and set the length along travel to fit up to a neighbour. With no neighbour to set the length, the footprint stays as it is. Leave **Travel direction · °** blank to use the stored route, with the layout’s length direction as a fallback. |

Resizing keeps each plot centred. For the rectangle and square modes, leave **Direction · °** blank to keep the existing orientation, or enter an angle in degrees from grid east towards grid north.

## Open a route or add offline imagery

Choose **Load waypoint list…** to open a route CSV in **Waypoints**. Choose **Edit route** when a route is already stored in the project. Both open the route editor, where you can preview plots before applying them. See [Waypoints](09-waypoints.md).

To add a background to the field map, open **Waypoints**, then **Map setup** → **Imagery folder…**. Choose the root of a local Web Mercator XYZ tile folder with files such as `{z}/{x}/{y}.jpg` or `{z}/{x}/{y}.png`. Both maps use this app-wide preference. Choose **No imagery** to clear it. The maps can use a coarser local tile where available, and work offline.

The project map interprets positions and boundaries as WGS 84 / UTM in metres. The default is `EPSG:32632` (zone 32 north). Northern zones use `EPSG:32601` to `EPSG:32660`, and southern zones use `EPSG:32701` to `EPSG:32760`. The desktop project screen has no coordinate-system field. **Map setup** shows the project’s coordinate system while a project is open and lets you set the map coordinate system for route viewing without a project.

## Save a backup copy

Save any drafts you want included, then choose **Save backup copy…** and give the copy a new `.ffr` file name. The app makes a consistent copy of the saved project while you keep the original open.
