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
  const toggle = (code: string) =>
    onChange(
      value.includes(code) ? value.filter((v) => v !== code) : [...value, code],
    );
  return (
    <div className="field diagnostic-picker" role="group" aria-label={label}>
      <span>
        {label}
        <small className="muted">
          {" "}
          · warn/bad count, info count · any selected code matches
        </small>
      </span>
      <div className="diagnostic-chips">
        {counts.map((c) => (
          <button
            key={c.code}
            type="button"
            className={
              "diagnostic-chip" + (value.includes(c.code) ? " on" : "")
            }
            aria-pressed={value.includes(c.code)}
            title={c.description}
            onClick={() => toggle(c.code)}
          >
            <span>{c.label}</span>
            <b>{(c.warnBad ?? 0).toLocaleString()}</b>
            <small>{(c.info ?? 0).toLocaleString()} info</small>
          </button>
        ))}
      </div>
      {!!value.length && (
        <button type="button" onClick={() => onChange([])}>
          Clear diagnostic filter
        </button>
      )}
    </div>
  );
}
