import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api";
import type { RawFolder } from "../../api/types";
import { dateTime } from "../../shared/format";
import { Panel, Status, error, pick } from "../../shared/common";
import { scanRawFolder } from "../../shared/hooks/useRawFolderWatch";

/** Where the project's robot raw files arrive, imported automatically. */
export function RawFolderPanel({ visible }: { visible: boolean }) {
  const client = useQueryClient(),
    folder = useQuery({
      queryKey: ["rawFolder"],
      enabled: visible,
      queryFn: () => api.rawFolderGet(),
    }),
    [draft, setDraft] = useState<RawFolder | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (folder.data !== undefined)
      setDraft(
        folder.data ?? {
          path: "",
          fieldOnly: true,
          auto: true,
          lastScan: null,
        },
      );
  }, [folder.data]);
  const stored = folder.data,
    report = stored?.lastReport,
    changed =
      !!draft &&
      (draft.path !== (stored?.path ?? "") ||
        draft.fieldOnly !== (stored?.fieldOnly ?? true) ||
        draft.auto !== (stored?.auto ?? true));
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
        whose chambers fall outside every plot are left out and looked at again
        later, so drawing more plots picks them up. The folder is kept for this
        computer; on another computer, choose it again.
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
                  await api.rawFolderSet(draft);
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
        </>
      )}
    </Panel>
  );
}
