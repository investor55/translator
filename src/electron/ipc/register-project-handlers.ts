import { ipcMain } from "electron";
import type { IpcDeps } from "./types";

export function registerProjectHandlers({ db }: Pick<IpcDeps, "db">) {
  ipcMain.handle("get-projects", () => {
    return db.getProjects();
  });

  ipcMain.handle("create-project", (_event, name: string, instructions?: string) => {
    if (!name?.trim()) {
      return { ok: false, error: "Project name is required" };
    }
    const project = db.createProject(crypto.randomUUID(), name.trim(), instructions?.trim() || undefined);
    return { ok: true, project };
  });

  ipcMain.handle("update-project", (_event, id: string, patch: { name?: string; instructions?: string }) => {
    const project = db.updateProject(id, patch);
    if (!project) {
      return { ok: false, error: "Project not found" };
    }
    return { ok: true, project };
  });

  ipcMain.handle("delete-project", (_event, id: string) => {
    db.deleteProject(id);
    return { ok: true };
  });
}
