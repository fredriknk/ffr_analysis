import { useQueries } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { hasFinding } from "../../api/findingLevels";
import type { FluxRow, Gas } from "../../api/types";
import {
  attention,
  dateTime,
  Empty,
  significant,
  Status,
} from "../../shared/common";
import {
  DiagnosticPicker,
  ReasonChips,
  severity,
} from "../../shared/diagnostics";
import { useDiagnostics } from "../../shared/hooks/useDiagnostics";
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
            (s.quick === "attention" && r.attention >= 30 && !r.reviewed) ||
            (s.quick === "unreviewed" && !r.reviewed) ||
            (s.quick === "flagged" && r.attention >= 30) ||
            (s.quick === "overridden" && r.overridden) ||
            (s.quick === "excluded" && r.excluded)) &&
          (!s.treatment || r.treatmentId === Number(s.treatment)) &&
          (!s.plot || r.plotId === Number(s.plot)) &&
          (!s.reviewFrom || r.time >= Date.parse(s.reviewFrom)) &&
          (!s.reviewTo || r.time < Date.parse(s.reviewTo) + 86400000) &&
          (!s.diagnosticCodes.length ||
            s.diagnosticCodes.some((c) => hasFinding(r, c, s.includeInfo))),
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
    s.includeInfo,
  ]);
}
export function QueueFilters({ rows }: { rows: FluxRow[] }) {
  const s = useStore(),
    counts = useDiagnostics(s.screen === "Review");
  const unique = (
    key: "treatmentId" | "plotId",
    name: "treatmentName" | "plotLabel",
  ) =>
    [...new Map(rows.map((r) => [r[key], String(r[name])])).entries()].sort(
      (a, b) => a[1].localeCompare(b[1]),
    );
  const active =
    Number(s.quick !== "attention") +
    Number(!!s.treatment) +
    Number(!!s.plot) +
    Number(!!s.reviewFrom) +
    Number(!!s.reviewTo) +
    s.diagnosticCodes.length +
    Number(!!s.reviewIds);
  return (
    <div className="queue-toolbar">
      <input
        aria-label="Search fluxes"
        placeholder="Search fluxes…"
        value={s.search}
        onChange={(e) => s.set({ search: e.target.value })}
      />
      <details className="filter-menu">
        <summary>Filters {active > 0 && <b>{active}</b>}</summary>
        <div className="filter-popover queue-filter-popover">
          <label>
            Queue
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
          </label>
          <label>
            Treatment
            <select
              aria-label="Treatment filter"
              value={s.treatment}
              onChange={(e) => s.set({ treatment: e.target.value })}
            >
              <option value="">All treatments</option>
              {unique("treatmentId", "treatmentName").map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Plot
            <select
              aria-label="Plot filter"
              value={s.plot}
              onChange={(e) => s.set({ plot: e.target.value })}
            >
              <option value="">All plots</option>
              {unique("plotId", "plotLabel").map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className="two">
            <label>
              From
              <input
                aria-label="Review from"
                type="date"
                value={s.reviewFrom}
                onChange={(e) => s.set({ reviewFrom: e.target.value })}
              />
            </label>
            <label>
              To
              <input
                aria-label="Review to"
                type="date"
                value={s.reviewTo}
                onChange={(e) => s.set({ reviewTo: e.target.value })}
              />
            </label>
          </div>
          <Status loading={counts.isLoading} error={counts.error} />
          <label>
            <input
              type="checkbox"
              checked={s.includeInfo}
              onChange={(e) => s.set({ includeInfo: e.target.checked })}
            />
            Include info findings
          </label>
          <DiagnosticPicker
            counts={(counts.data ?? []).filter((c) => c.count)}
            value={s.diagnosticCodes}
            onChange={(diagnosticCodes) =>
              s.set({ diagnosticCodes, quick: "all" })
            }
          />
          <button
            onClick={() =>
              s.set({
                quick: "attention",
                treatment: "",
                plot: "",
                reviewFrom: "",
                reviewTo: "",
                diagnosticCodes: [],
                reviewIds: undefined,
              })
            }
          >
            Reset filters
          </button>
        </div>
      </details>
      <select
        aria-label="Queue sort"
        title="Queue sort"
        value={s.queueSort}
        onChange={(e) =>
          s.set({ queueSort: e.target.value as typeof s.queueSort })
        }
      >
        <option value="attention">Score ↓</option>
        <option value="time">Time ↑</option>
        <option value="plot">Plot ↑</option>
      </select>
    </div>
  );
}
export function QueueList({ rows }: { rows: FluxRow[] }) {
  const s = useStore(),
    ref = useRef<HTMLDivElement>(null),
    v = useVirtualizer({
      count: rows.length,
      getScrollElement: () => ref.current,
      estimateSize: () => 30,
      overscan: 4,
    }),
    counts = useDiagnostics(s.screen === "Review");
  useEffect(() => {
    const i = rows.findIndex((r) => r.id === s.selected);
    if (i >= 0 && s.screen === "Review") v.scrollToIndex(i, { align: "auto" });
  }, [s.selected, s.screen, rows, v]);
  return (
    <div className="virtual-list dense-queue" ref={ref}>
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((item) => {
          const r = rows[item.index];
          return (
            <button
              key={r.id}
              data-flux-id={r.id}
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
              title={
                "#" + r.id + " · " + dateTime(r.time) + " · " + r.treatmentName
              }
              onClick={() => s.set({ selected: r.id })}
            >
              <span className={"severity-dot " + severity(r.attention)} />
              <time>{dateTime(r.time, true)}</time>
              <strong>{r.plotLabel}</strong>
              <span>{r.side === "left" ? "L" : "R"}</span>
              <b className="queue-value">{significant(r.N2O_flux, 3)}</b>
              <ReasonChips diag={r.diag} definitions={counts.data} limit={2} />
              <span className="score">{attention(r.attention)}</span>
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
  const counts = useDiagnostics(s.screen === "Review");
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
      overscan: 1,
    });
  useEffect(() => {
    const i = rows.findIndex((r) => r.id === s.selected);
    if (i >= 0 && s.screen === "Review")
      v.scrollToIndex(Math.floor(i / columns), { align: "auto" });
  }, [s.selected, s.screen, columns, rows, v]);
  const indices = v
    .getVirtualItems()
    .flatMap((item) =>
      Array.from({ length: columns }, (_, i) => item.index * columns + i),
    )
    .filter((i) => i < rows.length);
  const batchIndices = [...new Set(indices.map((i) => Math.floor(i / 8)))],
    batches = batchIndices.map((batch) =>
      rows.slice(batch * 8, batch * 8 + 8).map((r) => r.id),
    );
  const queries = useQueries({
    queries: batches.map((ids) => ({
      queryKey: ["thumbBatch", gas, ids],
      enabled: s.screen === "Review" && s.contactSheet,
      queryFn: () => api.getFluxThumbs(ids, gas, 60),
      staleTime: 60000,
    })),
  });
  const thumbs = new Map(
    queries.flatMap((q) => q.data ?? []).map((t) => [t.fluxId, t]),
  );
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
      {queries.some((q) => q.error) && (
        <Status
          loading={false}
          error={queries.find((q) => q.error)?.error ?? null}
        />
      )}
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
                const thumb = thumbs.get(r.id),
                  query = queries[batchIndices.indexOf(Math.floor(i / 8))],
                  pending = !thumb && !query?.isSuccess && !query?.isError,
                  min = thumb?.y.length ? Math.min(...thumb.y) : 0,
                  max = thumb?.y.length ? Math.max(...thumb.y) : 1,
                  minT = Math.min(0, ...(thumb?.t ?? [])),
                  maxT = Math.max(1, ...(thumb?.t ?? [])),
                  px = (t: number) => 8 + ((t - minT) / (maxT - minT)) * 204,
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
                      if (e.shiftKey)
                        onSelect([
                          ...new Set([
                            ...selected,
                            ...rows
                              .slice(
                                Math.min(anchor.current, i),
                                Math.max(anchor.current, i) + 1,
                              )
                              .map((r) => r.id),
                          ]),
                        ]);
                      else if (e.ctrlKey || e.metaKey) {
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
                      <span className="badge">{attention(r.attention)}</span>
                    </div>
                    {pending ? (
                      <div
                        className="trace-skeleton"
                        role="status"
                        aria-label="Loading trace"
                      />
                    ) : (
                      <svg
                        viewBox="0 0 220 100"
                        role="img"
                        aria-label={gas + " thumbnail"}
                      >
                        {thumb?.t.map((t, k) => (
                          <circle
                            key={k}
                            cx={px(t)}
                            cy={py(thumb.y[k])}
                            r={thumb.used[k] ? 1.9 : 1.2}
                            fill={thumb.used[k] ? "var(--accent)" : "#91a0aa"}
                          />
                        ))}
                        {!!thumb?.t.length && (
                          <line
                            x1={px(thumb.t[0])}
                            x2={px(thumb.t.at(-1)!)}
                            y1={py(thumb.intercept + thumb.slope * thumb.t[0])}
                            y2={py(
                              thumb.intercept + thumb.slope * thumb.t.at(-1)!,
                            )}
                            stroke="var(--accent)"
                            strokeWidth="1.5"
                          />
                        )}
                        {!thumb?.t.length && (
                          <text x="12" y="55" fill="currentColor" fontSize="11">
                            {query?.isError
                              ? "Could not load trace"
                              : r.source === "manual"
                                ? "Manual measurement / no raw trace"
                                : "No trace returned / validation failed"}
                          </text>
                        )}
                      </svg>
                    )}
                    <ReasonChips diag={r.diag} definitions={counts.data} />
                    <small>
                      {dateTime(r.time)} · {r.side} ·{" "}
                      {significant(r[gas + "_flux"])}
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
