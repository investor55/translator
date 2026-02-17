import { ipcMain } from "electron";
import type { AppConfigOverrides, TodoItem } from "../../core/types";
import type { EnsureSession, IpcDeps } from "./types";

type TodoInsightDeps = IpcDeps & {
  ensureSession: EnsureSession;
};

export function registerTodoInsightHandlers({
  db,
  ensureSession,
  sessionRef,
}: TodoInsightDeps) {
  ipcMain.handle("get-todos", () => {
    return db.getTodos();
  });

  ipcMain.handle("get-session-todos", (_event, sessionId: string) => {
    return db.getTodosForSession(sessionId);
  });

  ipcMain.handle("add-todo", (_event, todo: TodoItem) => {
    db.insertTodo(todo);
    return { ok: true };
  });

  ipcMain.handle("toggle-todo", (_event, id: string) => {
    const todos = db.getTodos();
    const todo = todos.find((item) => item.id === id);
    if (!todo) return { ok: false, error: "Todo not found" };
    db.updateTodo(id, !todo.completed);
    return { ok: true };
  });

  ipcMain.handle("scan-todos", async () => {
    if (!sessionRef.current) return { ok: false, error: "No active session" };
    return sessionRef.current.requestTodoScan();
  });

  ipcMain.handle(
    "scan-todos-in-session",
    async (_event, sessionId: string, appConfig?: AppConfigOverrides) => {
      const ensured = await ensureSession(sessionId, appConfig);
      if (!ensured.ok) return ensured;
      if (!sessionRef.current) return { ok: false, error: "Could not load session" };
      return sessionRef.current.requestTodoScan();
    },
  );

  ipcMain.handle("get-sessions", (_event, limit?: number) => {
    return db.getSessions(limit);
  });

  ipcMain.handle("get-session-blocks", (_event, sessionId: string) => {
    return db.getBlocksForSession(sessionId);
  });

  ipcMain.handle("delete-session", (_event, id: string) => {
    db.deleteSession(id);
    return { ok: true };
  });

  ipcMain.handle("get-insights", (_event, limit?: number) => {
    return db.getRecentInsights(limit);
  });

  ipcMain.handle("get-session-insights", (_event, sessionId: string) => {
    return db.getInsightsForSession(sessionId);
  });
}
