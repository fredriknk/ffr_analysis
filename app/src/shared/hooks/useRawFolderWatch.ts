import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../../api";
import { error, toastFn } from "../feedback";

const every = 5 * 60 * 1000;
let scanning: Promise<void> | null = null;

/**
 * Imports the raw-data folder's new files. Only one check runs at a time.
 * `report` shows a message even when nothing was new (a click on "Import new
 * files now"); automatic checks speak up only when files were imported.
 */
export function scanRawFolder(client: QueryClient, report = false) {
  scanning ??= (async () => {
    try {
      const r = await api.rawFolderScan();
      if (r.imported) {
        toastFn(
          r.imported.toLocaleString() +
            " new robot file" +
            (r.imported === 1 ? "" : "s") +
            " imported from the data folder",
        );
        // New measurements touch every screen: refresh them all.
        await client.invalidateQueries({
          predicate: (q) => String(q.queryKey[0]) !== "recent",
        });
      } else if (report) toastFn("No new robot files in the data folder");
      void client.invalidateQueries({ queryKey: ["rawFolder"] });
      if (r.errors.length && report)
        error({
          message: r.errors.length + " file(s) could not be read",
        });
    } finally {
      scanning = null;
    }
  })();
  return scanning;
}

/** While a project is open, checks its raw-data folder on opening and every 5 minutes. */
export function useRawFolderWatch(projectPath: string | null) {
  const client = useQueryClient();
  useEffect(() => {
    if (!projectPath) return;
    let warned = false;
    const check = async () => {
      try {
        const folder = await api.rawFolderGet();
        if (folder?.auto && folder.path) await scanRawFolder(client);
      } catch (e) {
        // A folder that is missing on this computer is reported once.
        if (!warned) error(e);
        warned = true;
      }
    };
    void check();
    const timer = setInterval(() => void check(), every);
    return () => clearInterval(timer);
  }, [projectPath, client]);
}
