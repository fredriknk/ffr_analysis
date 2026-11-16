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
    <label className="field">
      <span>{label} · Ctrl / ⌘ to select several</span>
      <select
        multiple
        aria-label={label}
        value={value}
        onChange={(e) =>
          onChange(Array.from(e.target.selectedOptions, (o) => o.value))
        }
      >
        {counts.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label} ({c.count.toLocaleString()};{" "}
            {c.unreviewed.toLocaleString()} unreviewed)
          </option>
        ))}
      </select>
      {!!value.length && (
        <button onClick={() => onChange([])}>Clear diagnostic filter</button>
      )}
    </label>
  );
}
