import { ipcMain } from "electron";
import type { AppConfigOverrides, TodoItem } from "../../core/types";
import { log } from "../../core/logger";
import type { EnsureSession, IpcDeps } from "./types";

type TodoInsightDeps = IpcDeps & {
  ensureSession: EnsureSession;
};

export function registerTodoInsightHandlers({
  db,
  ensureSession,
  sessionRef,
}: TodoInsightDeps) {
  const buildTodoClassifierInput = (title: string, details?: string) => {
    const trimmedTitle = title.trim();
    const trimmedDetails = details?.trim();
    if (!trimmedDetails) return trimmedTitle;
    return `${trimmedTitle}\n\nContext:\n${trimmedDetails}`;
  };

  const classifyAsLarge = (reason: string) => ({
    size: "large" as const,
    confidence: 0,
    reason,
  });

  const classifyTodo = async (
    text: string,
    sessionId?: string,
    appConfig?: AppConfigOverrides,
  ) => {
    if (!sessionId) return classifyAsLarge("Missing session id for classifier");

    const ensured = await ensureSession(sessionId, appConfig);
    if (ensured.ok === false) {
      const message = ensured.error;
      log("WARN", `Todo classifier fallback (ensure session failed): ${message}`);
      return classifyAsLarge("Could not initialize classifier session");
    }

    if (!sessionRef.current) {
      return classifyAsLarge("Classifier session unavailable");
    }

    return sessionRef.current.classifyTodoSize(text);
  };

  ipcMain.handle("get-todos", () => {
    return db.getTodos();
  });

  ipcMain.handle("get-session-todos", (_event, sessionId: string) => {
    return db.getTodosForSession(sessionId);
  });

  ipcMain.handle("add-todo", async (_event, todo: TodoItem, appConfig?: AppConfigOverrides) => {
    const text = todo.text.trim();
    if (!text) return { ok: false, error: "Todo text is required" };
    const details = todo.details?.trim();

    const classification = await classifyTodo(
      buildTodoClassifierInput(text, details),
      todo.sessionId,
      appConfig,
    );
    const persistedTodo: TodoItem = {
      ...todo,
      text,
      details: details || undefined,
      size: classification.size,
    };

    db.insertTodo(persistedTodo);
    return { ok: true, todo: persistedTodo };
  });

  ipcMain.handle(
    "update-todo-text",
    async (_event, id: string, text: string, appConfig?: AppConfigOverrides) => {
      const existing = db.getTodo(id);
      if (!existing) return { ok: false, error: "Todo not found" };

      const trimmed = text.trim();
      if (!trimmed) return { ok: false, error: "Todo text is required" };

      const classification = await classifyTodo(
        buildTodoClassifierInput(trimmed, existing.details),
        existing.sessionId,
        appConfig,
      );
      db.updateTodoText(id, trimmed, classification.size);

      return {
        ok: true,
        todo: {
          ...existing,
          text: trimmed,
          size: classification.size,
        },
      };
    },
  );

  ipcMain.handle("toggle-todo", (_event, id: string) => {
    const todos = db.getTodos();
    const todo = todos.find((item) => item.id === id);
    if (!todo) return { ok: false, error: "Todo not found" };
    db.updateTodo(id, !todo.completed);
    return { ok: true };
  });

  ipcMain.handle("delete-todo", (_event, id: string) => {
    const todo = db.getTodo(id);
    if (!todo) return { ok: false, error: "Todo not found" };
    db.deleteTodo(id);
    return { ok: true };
  });

  ipcMain.handle(
    "extract-todo-from-selection-in-session",
    async (
      _event,
      sessionId: string,
      selectedText: string,
      userIntentText?: string,
      appConfig?: AppConfigOverrides,
    ) => {
      const trimmedSelection = selectedText.trim();
      if (!trimmedSelection) return { ok: false, error: "Selected text is required" };

      const ensured = await ensureSession(sessionId, appConfig);
      if (!ensured.ok) return ensured;
      if (!sessionRef.current) return { ok: false, error: "Could not load session" };
      return sessionRef.current.extractTodoFromSelection(trimmedSelection, userIntentText);
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
