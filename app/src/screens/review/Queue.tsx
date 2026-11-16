import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import type { FluxRow, Gas } from "../../api/types";
import { date, Empty, fmt, Status } from "../../shared/common";
import {
  codes,
  DiagnosticPicker,
  ReasonChips,
  severity,
} from "../../shared/diagnostics";
import { useStore } from "../../store";
export function useQueue(rows: FluxRow[]) {
  const s = useStore();
  return useMemo(() => {
    const ids = s.reviewIds ? new Set(s.reviewIds) : null;
    return rows
      .filter(
        (r) =>
          (!ids || ids.has(r.id)) &&
          (!s.search ||
            [r.id, r.filename, r.plotLabel, r.treatmentName]
              .join(" ")
              .toLowerCase()
              .includes(s.search.toLowerCase())) &&
          (s.quick === "all" ||
            (s.quick === "attention" &&
              r.attention >= 30 &&
              !r.reviewed &&
              !r.excluded) ||
            (s.quick === "unreviewed" && !r.reviewed) ||
            (s.quick === "flagged" && r.attention >= 30) ||
            (s.quick === "overridden" && r.overridden) ||
            (s.quick === "excluded" && r.excluded)) &&
          (!s.treatment || r.treatmentId === Number(s.treatment)) &&
          (!s.plot || r.plotId === Number(s.plot)) &&
          (!s.reviewFrom || r.time >= Date.parse(s.reviewFrom)) &&
          (!s.reviewTo || r.time < Date.parse(s.reviewTo) + 86400000) &&
          (!s.diagnosticCodes.length ||
            s.diagnosticCodes.some((c) => codes(r.diag).includes(c))),
      )
      .sort((a, b) =>
        s.queueSort === "attention"
          ? b.attention - a.attention || a.time - b.time
          : s.queueSort === "plot"
            ? a.plotLabel.localeCompare(b.plotLabel) || a.time - b.time
            : a.time - b.time,
      );
  }, [
    rows,
    s.reviewIds,
    s.search,
    s.quick,
    s.treatment,
    s.plot,
    s.reviewFrom,
    s.reviewTo,
    s.queueSort,
    s.diagnosticCodes,
  ]);
}
export function QueueFilters({ rows }: { rows: FluxRow[] }) {
  const s = useStore(),
    counts = useQuery({
      queryKey: ["diagnostics"],
      queryFn: () => api.diagnosticsSummary(),
    });
  const unique = (
    key: "treatmentId" | "plotId",
    name: "treatmentName" | "plotLabel",
  ) =>
    [...new Map(rows.map((r) => [r[key], String(r[name])])).entries()].sort(
      (a, b) => a[1].localeCompare(b[1]),
    );
  return (
    <div className="queue-filters">
      <input
        aria-label="Search fluxes"
        placeholder="Search plot, treatment, file…"
        value={s.search}
        onChange={(e) => s.set({ search: e.target.value })}
      />
      <select
        aria-label="Quick filter"
        value={s.quick}
        onChange={(e) => s.set({ quick: e.target.value })}
      >
        <option value="attention">Needs attention, unreviewed</option>
        <option value="all">All measurements</option>
        <option value="unreviewed">Unreviewed</option>
        <option value="flagged">Needs attention</option>
        <option value="overridden">Overridden</option>
        <option value="excluded">Excluded</option>
      </select>
      <select
        aria-label="Queue sort"
        value={s.queueSort}
        onChange={(e) =>
          s.set({ queueSort: e.target.value as typeof s.queueSort })
        }
      >
        <option value="attention">Highest attention first</option>
        <option value="time">Measurement time</option>
        <option value="plot">Plot, then time</option>
      </select>
      <div className="two">
        <select
          aria-label="Treatment filter"
          value={s.treatment}
          onChange={(e) => s.set({ treatment: e.target.value })}
        >
          <option value="">All treatments</option>
          {unique("treatmentId", "treatmentName").map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Plot filter"
          value={s.plot}
          onChange={(e) => s.set({ plot: e.target.value })}
        >
          <option value="">All plots</option>
          {unique("plotId", "plotLabel").map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="two">
        <input
          aria-label="Review from"
          type="date"
          value={s.reviewFrom}
          onChange={(e) => s.set({ reviewFrom: e.target.value })}
        />
        <input
          aria-label="Review to"
          type="date"
          value={s.reviewTo}
          onChange={(e) => s.set({ reviewTo: e.target.value })}
        />
      </div>
      <Status loading={counts.isLoading} error={counts.error} />
      <DiagnosticPicker
        counts={(counts.data ?? []).filter((c) => c.count)}
        value={s.diagnosticCodes}
        onChange={(diagnosticCodes) => s.set({ diagnosticCodes })}
      />
      {s.reviewIds && (
        <button onClick={() => s.set({ reviewIds: undefined })}>
          Clear custom queue ({s.reviewIds.length})
        </button>
      )}
    </div>
  );
}
export function QueueList({ rows }: { rows: FluxRow[] }) {
  const s = useStore(),
    ref = useRef<HTMLDivElement>(null),
    v = useVirtualizer({
      count: rows.length,
      getScrollElement: () => ref.current,
      estimateSize: () => 90,
      overscan: 8,
    });
  useEffect(() => {
    const i = rows.findIndex((r) => r.id === s.selected);
    if (i >= 0 && s.screen === "Review") v.scrollToIndex(i, { align: "auto" });
  }, [s.selected, s.screen, rows, v]);
  return (
    <div ref={ref} className="virtual-list">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((item) => {
          const r = rows[item.index];
          return (
            <button
              key={r.id}
              onClick={() => s.set({ selected: r.id })}
              className={
                "flux-item triage-row " +
                (r.id === s.selected ? "selected " : "") +
                (r.excluded ? "excluded" : "")
              }
              style={{
                position: "absolute",
                top: item.start,
                height: item.size,
                width: "100%",
              }}
            >
              <div className="triage-row-title">
                <span className={"severity-dot " + severity(r.attention)} />
                <strong>
                  #{r.id} · {r.plotLabel}
                </strong>
                <span className="badge">{r.attention}</span>
                <span>{fmt(r.N2O_flux, 1)}</span>
              </div>
              <small>
                {date(r.time)} · {r.side} ·{" "}
                {r.reviewed ? "Reviewed" : "Unreviewed"}
              </small>
              <ReasonChips diag={r.diag} />
            </button>
          );
        })}
      </div>
      {!rows.length && <Empty>No fluxes match this queue.</Empty>}
    </div>
  );
}
export function ContactSheet({
  rows,
  selected,
  onSelect,
}: {
  rows: FluxRow[];
  selected: number[];
  onSelect: (ids: number[]) => void;
}) {
  const s = useStore(),
    ref = useRef<HTMLDivElement>(null),
    anchor = useRef(0),
    [width, setWidth] = useState(900),
    [gas, setGas] = useState<Gas>("N2O");
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((es) => setWidth(es[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const columns = Math.max(1, Math.floor(width / 240)),
    v = useVirtualizer({
      count: Math.ceil(rows.length / columns),
      getScrollElement: () => ref.current,
      estimateSize: () => 192,
      overscan: 2,
    });
  const indices = v
      .getVirtualItems()
      .flatMap((v) =>
        Array.from({ length: columns }, (_, i) => v.index * columns + i),
      )
      .filter((i) => i < rows.length),
    ids = indices.map((i) => rows[i].id);
  const thumbs = useQuery({
    queryKey: ["thumbs", ids, gas],
    queryFn: () => api.getFluxThumbs(ids, gas, 60),
    enabled: !!ids.length,
  });
  return (
    <>
      <div className="toolbar">
        <label>
          Thumbnail gas{" "}
          <select
            aria-label="Thumbnail gas"
            value={gas}
            onChange={(e) => setGas(e.target.value as Gas)}
          >
            <option>N2O</option>
            <option>CO2</option>
          </select>
        </label>
        <span>
          {rows.length.toLocaleString()} fluxes · {selected.length} selected
        </span>
        <small>
          Click to inspect · Ctrl/Cmd toggles · Shift selects a range
        </small>
      </div>
      <Status loading={thumbs.isLoading} error={thumbs.error} />
      <div className="contact-scroll" ref={ref}>
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((item) => (
            <div
              key={item.index}
              className="contact-row"
              style={{
                position: "absolute",
                top: item.start,
                height: item.size,
                gridTemplateColumns: "repeat(" + columns + ",minmax(0,1fr))",
              }}
            >
              {Array.from({ length: columns }, (_, j) => {
                const i = item.index * columns + j,
                  r = rows[i];
                if (!r) return null;
                const thumb = thumbs.data?.find((t) => t.fluxId === r.id);
                const min = thumb?.y.length ? Math.min(...thumb.y) : 0,
                  max = thumb?.y.length ? Math.max(...thumb.y) : 1,
                  py = (y: number) => 94 - ((y - min) / (max - min || 1)) * 78;
                return (
                  <button
                    key={r.id}
                    aria-label={"Inspect flux " + r.id}
                    aria-pressed={selected.includes(r.id)}
                    className={
                      "contact-card " +
                      severity(r.attention) +
                      (selected.includes(r.id) ? " picked" : "") +
                      (s.selected === r.id ? " focused" : "") +
                      (r.excluded ? " excluded" : "")
                    }
                    onClick={(e) => {
                      s.set({ selected: r.id });
                      if (e.shiftKey) {
                        const range = rows
                          .slice(
                            Math.min(anchor.current, i),
                            Math.max(anchor.current, i) + 1,
                          )
                          .map((r) => r.id);
                        onSelect([...new Set([...selected, ...range])]);
                      } else if (e.ctrlKey || e.metaKey) {
                        anchor.current = i;
                        onSelect(
                          selected.includes(r.id)
                            ? selected.filter((id) => id !== r.id)
                            : [...selected, r.id],
                        );
                      } else {
                        anchor.current = i;
                        s.set({ contactSheet: false });
                      }
                    }}
                  >
                    <div className="triage-row-title">
                      <span
                        className={"severity-dot " + severity(r.attention)}
                      />
                      <strong>
                        #{r.id} · {r.plotLabel}
                      </strong>
                      <span className="badge">{r.attention}</span>
                    </div>
                    <svg
                      viewBox="0 0 220 100"
                      role="img"
                      aria-label={gas + " thumbnail"}
                    >
                      {thumb?.t.map((t, k) => (
                        <circle
                          key={k}
                          cx={8 + (t / 185) * 204}
                          cy={py(thumb.y[k])}
                          r={thumb.used[k] ? 1.9 : 1.2}
                          fill={thumb.used[k] ? "var(--accent)" : "#91a0aa"}
                        />
                      ))}
                      {!thumb?.t.length && (
                        <text x="12" y="55" fill="currentColor" fontSize="11">
                          No trace / validation failed
                        </text>
                      )}
                    </svg>
                    <ReasonChips diag={r.diag} />
                    <small>
                      {date(r.time)} · {r.side} · {fmt(r[gas + "_flux"], 1)}
                    </small>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {!rows.length && <Empty>No matching traces.</Empty>}
      </div>
    </>
  );
}
