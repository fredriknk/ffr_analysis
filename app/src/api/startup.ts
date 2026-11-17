import type { FfrApi } from "./types";
export async function openStartupProject(
  api: Pick<FfrApi, "startupPath" | "projectOpen">,
  opened: () => void,
) {
  const path = await api.startupPath();
  if (!path) return false;
  await api.projectOpen(path);
  opened();
  return true;
}
