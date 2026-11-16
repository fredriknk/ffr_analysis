use super::*;
/// Stable data keys are kept independently of display names and units.
pub(super) fn column_spec(key: &str) -> (String, String) {
    let pair = match key {
        "id" => ("Flux ID", "—"),
        "measurementId" => ("Measurement ID", "—"),
        "source" => ("Source", "—"),
        "time" => ("Measurement time", "UTC"),
        "filename" => ("Raw file", "—"),
        "side" => ("Chamber", "—"),
        "plotId" => ("Plot ID", "—"),
        "plotLabel" => ("Plot", "—"),
        "treatmentId" => ("Treatment ID", "—"),
        "treatmentName" => ("Treatment", "—"),
        "excluded" => ("Excluded", "—"),
        "reviewed" => ("Reviewed", "—"),
        "overridden" => ("Custom analysis options", "—"),
        "note" => ("Note", "—"),
        "airTemp" => ("Air temperature (flux interpolation)", "°C"),
        "air_temperature" => ("Air temperature (weather series)", "°C"),
        "precip" => ("Precipitation (flux interpolation)", "mm/h"),
        "sum(precipitation_amount PT1H)" => ("Precipitation (weather series)", "mm/h"),
        "max(air_temperature PT1H)" => ("Hourly maximum air temperature", "°C"),
        "min(air_temperature PT1H)" => ("Hourly minimum air temperature", "°C"),
        "VWC_GROUND" => ("Soil water content", "m³/m³"),
        "TEMPC_GROUND" => ("Soil temperature", "°C"),
        "ECC_GROUND" => ("Soil electrical conductivity", "mS/cm"),
        "x" => ("Chamber easting", "m"),
        "y" => ("Chamber northing", "m"),
        "attention" => ("Review attention", "0–100"),
        "diag" => ("Diagnostic codes", "—"),
        "valveLagS" => ("Estimated CO2 lag", "s"),
        "N2O_lagS" => ("Estimated N2O lag", "s"),
        "N2O_qc" => ("Legacy N2O quality check", "—"),
        "temperatureFallback" => ("Fallback temperature used", "—"),
        "valveImprovement" => ("CO2 lag SSE improvement", "1"),
        "plotOverride" => ("Manual plot assignment", "—"),
        _ => {
            for gas in regression::GASES {
                if let Some(suffix) = key.strip_prefix(&format!("{gas}_")) {
                    let unit = match suffix {
                        "flux" | "robustFlux" | "seFlux" => match gas {
                            "N2O" => "µg N m⁻² h⁻¹",
                            "CO2" => "µg C m⁻² h⁻¹",
                            _ => "mol m⁻² s⁻¹",
                        },
                        "slope" => "ppm/s",
                        "resid" => "ppm",
                        "n" => "points",
                        _ => "1",
                    };
                    let label = match suffix {
                        "flux" => "flux",
                        "robustFlux" => "robust flux",
                        "impact" => "robust fit impact",
                        "seFlux" => "flux standard error",
                        "slope" => "concentration slope",
                        "resid" => "residual SD",
                        "n" => "fit points",
                        "rsq" => "r²",
                        "pval" => "p-value",
                        _ => suffix,
                    };
                    return (format!("{gas} {label}"), unit.into());
                }
            }
            return (key.replace('_', " "), "—".into());
        }
    };
    (pair.0.into(), pair.1.into())
}
