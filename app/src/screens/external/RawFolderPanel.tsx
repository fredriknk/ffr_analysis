import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api";
import type { RawFolder } from "../../api/types";
import { dateTime } from "../../shared/format";
import { Field, Panel, Status, error, pick } from "../../shared/common";
import { scanRawFolder } from "../../shared/hooks/useRawFolderWatch";

/** The editable part of a folder setting, as a stable key (JSON). */
function settings(f: RawFolder | null): string {
  return JSON.stringify({
    path: f?.path ?? "",
    fieldOnly: f?.fieldOnly ?? true,
    auto: f?.auto ?? true,
    from: f?.from ?? null,
    to: f?.to ?? null,
  });
}

/** Where the project's robot raw files arrive, imported automatically. */
export function RawFolderPanel({ visible }: { visible: boolean }) {
  const client = useQueryClient(),
    folder = useQuery({
      queryKey: ["rawFolder"],
      enabled: visible,
      queryFn: () => api.rawFolderGet(),
    }),
    [draft, setDraft] = useState<RawFolder | null>(null),
    [busy, setBusy] = useState(false),
    loaded = folder.data !== undefined,
    saved = settings(folder.data ?? null);
  // Follow the saved settings, not every refetch: a scan's new report must
  // not wipe dates being typed in.
  useEffect(() => {
    if (loaded) setDraft(JSON.parse(saved) as RawFolder);
  }, [loaded, saved]);
  const stored = folder.data,
    report = stored?.lastReport,
    changed =
      !!draft &&
      (draft.path !== (stored?.path ?? "") ||
        draft.fieldOnly !== (stored?.fieldOnly ?? true) ||
        draft.auto !== (stored?.auto ?? true) ||
        (draft.from ?? "") !== (stored?.from ?? "") ||
        (draft.to ?? "") !== (stored?.to ?? ""));
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
      void client.invalidateQueries({ queryKey: ["rawFolder"] });
    }
  }
  return (
    <Panel title="Robot data folder">
      <p className="muted">
        New robot files in this folder (and its subfolders) are imported into
        the project: when it opens and every 5 minutes while it is open. Files
        whose chambers fall outside every plot, or that were measured outside
        the dates, are left out and looked at again later, so drawing more plots
        picks them up. A folder shared by several projects needs the plots or
        the dates to tell this project&apos;s files apart. The folder is kept
        for this computer; on another computer, choose it again.
      </p>
      <Status loading={folder.isLoading} error={folder.error} />
      {draft && (
        <>
          <div className="raw-folder-row">
            <textarea
              className="path-input"
              rows={1}
              spellCheck={false}
              aria-label="Robot data folder"
              placeholder="Folder the robot's raw files are copied to"
              value={draft.path}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  path: e.target.value.replace(/[\r\n]+/g, ""),
                })
              }
            />
            <button
              onClick={() =>
                void pick(true).then(
                  (p) => p && setDraft({ ...draft, path: p }),
                )
              }
            >
              Browse folder
            </button>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.fieldOnly}
              onChange={(e) =>
                setDraft({ ...draft, fieldOnly: e.target.checked })
              }
            />
            Only files measured inside the project&apos;s plots
          </label>
          <div className="form-grid">
            <Field label="Measured from (optional)">
              <input
                type="date"
                value={draft.from ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, from: e.target.value || null })
                }
              />
            </Field>
            <Field label="Measured to (optional)">
              <input
                type="date"
                value={draft.to ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, to: e.target.value || null })
                }
              />
            </Field>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.auto}
              onChange={(e) => setDraft({ ...draft, auto: e.target.checked })}
            />
            Check automatically (on opening and every 5 minutes)
          </label>
          <div className="button-group">
            <button
              className="primary"
              disabled={busy || !changed || !draft.path.trim()}
              onClick={() =>
                void run(async () => {
                  await api.rawFolderSet(
                    JSON.parse(settings(draft)) as RawFolder,
                  );
                  await client.invalidateQueries({ queryKey: ["rawFolder"] });
                  if (draft.auto) await scanRawFolder(client);
                })
              }
            >
              Save folder
            </button>
            <button
              disabled={busy || !stored || changed}
              title={changed ? "Save the folder first" : undefined}
              onClick={() => void run(() => scanRawFolder(client, true))}
            >
              {busy ? "Checking…" : "Import new files now"}
            </button>
            {stored && (
              <button
                disabled={busy}
                onClick={() => void run(() => api.rawFolderSet(null))}
              >
                Forget folder
              </button>
            )}
          </div>
          {report && stored?.lastScan && (
            <p className="raw-folder-report">
              Last checked {dateTime(stored.lastScan)}:{" "}
              {report.files.toLocaleString()} robot files ·{" "}
              {report.known.toLocaleString()} already in the project ·{" "}
              {report.outsideField.toLocaleString()} outside the plots ·{" "}
              {(report.outsideDates ?? 0) > 0 && (
                <>{report.outsideDates.toLocaleString()} outside the dates · </>
              )}
              <b>{report.imported.toLocaleString()} imported</b>
              {report.errors.length > 0 && (
                <>
                  {" "}
                  · {report.errors.length} could not be read (
                  {report.errors
                    .slice(0, 3)
                    .map((e) => e.path.split(/[\\/]/).pop())
                    .join(", ")}
                  {report.errors.length > 3 ? ", …" : ""})
                </>
              )}
            </p>
          )}
          {(report?.waiting ?? 0) > 0 &&
            !changed &&
            stored?.fieldOnly &&
            !stored.from &&
            !stored.to && (
              <div className="raw-folder-waiting">
                <p>
                  <b>
                    {report!.waiting.toLocaleString()} new files are waiting.
                  </b>{" "}
                  The project has no plots and no date range, so nothing tells
                  its files apart from other projects&apos; files in this
                  folder. Draw the plots or set the dates, or import everything.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => scanRawFolder(client, true, true))
                  }
                >
                  Import all {report!.waiting.toLocaleString()} files
                </button>
              </div>
            )}
        </>
      )}
    </Panel>
  );
}
