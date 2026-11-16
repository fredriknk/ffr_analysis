import type { ColumnMeta, FluxRow } from "../../api/types";
export function ColumnFilter({
  meta,
  rows,
  value,
  onChange,
}: {
  meta: ColumnMeta;
  rows: FluxRow[];
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = meta.label;
  if (meta.type === "category" || meta.type === "boolean") {
    const values =
        meta.type === "boolean"
          ? ["true", "false"]
          : [...new Set(rows.map((r) => String(r[meta.key] ?? "")))]
              .filter(Boolean)
              .sort(),
      selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <details className="column-filter">
        <summary>
          {selected.length ? selected.length + " selected" : "Filter values"}
        </summary>
        <div className="filter-popover">
          <select
            aria-label={"Filter " + label}
            multiple
            size={Math.min(7, values.length || 2)}
            value={selected}
            onChange={(e) =>
              onChange(Array.from(e.target.selectedOptions, (o) => o.value))
            }
          >
            {values.map((v) => (
              <option key={v} value={v}>
                {meta.type === "boolean" ? (v === "true" ? "Yes" : "No") : v}
              </option>
            ))}
          </select>
          <button onClick={() => onChange([])}>Clear</button>
        </div>
      </details>
    );
  }
  if (meta.type === "number" || meta.type === "time") {
    const [min = "", max = ""] =
        typeof value === "string" ? value.split("..") : [],
      type = meta.type === "time" ? "date" : "number";
    return (
      <div className="range-filter">
        <input
          aria-label={"Minimum " + label}
          type={type}
          step="any"
          placeholder="Min"
          value={min}
          onChange={(e) => onChange(e.target.value + ".." + max)}
        />
        <input
          aria-label={"Maximum " + label}
          type={type}
          step="any"
          placeholder="Max"
          value={max}
          onChange={(e) => onChange(min + ".." + e.target.value)}
        />
      </div>
    );
  }
  return (
    <input
      aria-label={"Filter " + label}
      placeholder="Contains…"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
