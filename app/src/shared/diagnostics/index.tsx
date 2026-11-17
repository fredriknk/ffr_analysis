import { codes, diagnosticLabels } from "../../api/diagnosticMeta";
import type { DiagnosticCount } from "../../api/types";
export {
  codes,
  diagnosticLabels,
  score,
  severity,
} from "../../api/diagnosticMeta";
export function ReasonChips({
  diag,
  definitions,
  limit = 2,
}: {
  diag: unknown;
  definitions?: DiagnosticCount[];
  limit?: number;
}) {
  const list = codes(diag);
  return (
    <span className="reason-chips">
      {list.slice(0, limit).map((c) => (
        <span
          key={c}
          title={
            definitions?.find((d) => d.code === c)?.description ??
            diagnosticLabels[c] ??
            c
          }
        >
          {definitions?.find((d) => d.code === c)?.label ??
            diagnosticLabels[c] ??
            c.replaceAll("_", " ")}
        </span>
      ))}
      {list.length > limit && <span>+{list.length - limit}</span>}
    </span>
  );
}
export function DiagnosticPicker({
  counts,
  value,
  onChange,
  label = "Diagnostic code",
}: {
  counts: DiagnosticCount[];
  value: string[];
  onChange: (v: string[]) => void;
  label?: string;
}) {
  return (
    <div className="field diagnostic-picker" role="group" aria-label={label}>
      <span>{label}</span>
      {counts.map((c) => (
        <label key={c.code}>
          <input
            type="checkbox"
            checked={value.includes(c.code)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, c.code]
                  : value.filter((v) => v !== c.code),
              )
            }
          />
          <span>
            {c.label} <b>{(c.warnBad ?? 0).toLocaleString()}</b>
            <small className="muted">
              {" "}
              · {(c.info ?? 0).toLocaleString()} info
            </small>
          </span>
        </label>
      ))}
      {!!value.length && (
        <button onClick={() => onChange([])}>Clear diagnostic filter</button>
      )}
    </div>
  );
}
