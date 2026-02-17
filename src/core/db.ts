import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq, desc, sql, count } from "drizzle-orm";
import { sessions, blocks, todos, insights, agents } from "./schema";
import type {
  TodoItem,
  Insight,
  InsightKind,
  SessionMeta,
  TranscriptBlock,
  AudioSource,
  LanguageCode,
  Agent,
  AgentStep,
} from "./types";

export type AppDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  runMigrations(sqlite);

  const orm: BetterSQLite3Database = drizzle({ client: sqlite });

  return {
    createSession(id: string, sourceLang?: LanguageCode, targetLang?: LanguageCode, title?: string) {
      orm.insert(sessions).values({
        id,
        startedAt: Date.now(),
        title: title ?? null,
        sourceLang: sourceLang ?? null,
        targetLang: targetLang ?? null,
      }).run();
    },

    endSession(id: string) {
      const [blockRow] = orm
        .select({ n: count() })
        .from(blocks)
        .where(eq(blocks.sessionId, id))
        .all();
      const [agentRow] = orm
        .select({ n: count() })
        .from(agents)
        .where(eq(agents.sessionId, id))
        .all();
      const blockCount = blockRow?.n ?? 0;
      const agentCount = agentRow?.n ?? 0;
      const isEmpty = blockCount === 0 && agentCount === 0;

      orm.update(sessions)
        .set({
          endedAt: isEmpty ? null : Date.now(),
          blockCount,
        })
        .where(eq(sessions.id, id))
        .run();
    },

    deleteSession(id: string) {
      orm.transaction((tx) => {
        tx.delete(blocks).where(eq(blocks.sessionId, id)).run();
        tx.delete(agents).where(eq(agents.sessionId, id)).run();
        tx.delete(insights).where(eq(insights.sessionId, id)).run();
        tx.delete(todos).where(eq(todos.sessionId, id)).run();
        tx.delete(sessions).where(eq(sessions.id, id)).run();
      });
    },

    getSessions(limit = 20): SessionMeta[] {
      const rows = orm
        .select()
        .from(sessions)
        .orderBy(desc(sessions.startedAt))
        .limit(limit)
        .all();
      return rows.map((r) => ({
        id: r.id,
        startedAt: r.startedAt,
        endedAt: r.endedAt ?? undefined,
        title: r.title ?? undefined,
        blockCount: r.blockCount ?? 0,
        sourceLang: (r.sourceLang as LanguageCode) ?? undefined,
        targetLang: (r.targetLang as LanguageCode) ?? undefined,
      }));
    },

    getMostRecentSession(): SessionMeta | null {
      const [row] = orm
        .select()
        .from(sessions)
        .orderBy(desc(sessions.startedAt))
        .limit(1)
        .all();
      if (!row) return null;
      return {
        id: row.id,
        startedAt: row.startedAt,
        endedAt: row.endedAt ?? undefined,
        title: row.title ?? undefined,
        blockCount: row.blockCount ?? 0,
        sourceLang: (row.sourceLang as LanguageCode) ?? undefined,
        targetLang: (row.targetLang as LanguageCode) ?? undefined,
      };
    },

    getSession(id: string): SessionMeta | null {
      const [row] = orm
        .select()
        .from(sessions)
        .where(eq(sessions.id, id))
        .limit(1)
        .all();
      if (!row) return null;
      return {
        id: row.id,
        startedAt: row.startedAt,
        endedAt: row.endedAt ?? undefined,
        title: row.title ?? undefined,
        blockCount: row.blockCount ?? 0,
        sourceLang: (row.sourceLang as LanguageCode) ?? undefined,
        targetLang: (row.targetLang as LanguageCode) ?? undefined,
      };
    },

    reuseSession(id: string, sourceLang?: LanguageCode, targetLang?: LanguageCode) {
      orm.update(sessions)
        .set({
          startedAt: Date.now(),
          endedAt: null,
          sourceLang: sourceLang ?? null,
          targetLang: targetLang ?? null,
        })
        .where(eq(sessions.id, id))
        .run();
    },

    insertBlock(sessionId: string, block: TranscriptBlock) {
      orm.insert(blocks).values({
        sessionId,
        sourceLabel: block.sourceLabel,
        sourceText: block.sourceText,
        targetLabel: block.targetLabel,
        translation: block.translation ?? null,
        audioSource: block.audioSource,
        partial: block.partial ? 1 : 0,
        newTopic: block.newTopic ? 1 : 0,
        createdAt: block.createdAt,
      }).run();
    },

    getBlocksForSession(sessionId: string): TranscriptBlock[] {
      const rows = orm
        .select()
        .from(blocks)
        .where(eq(blocks.sessionId, sessionId))
        .orderBy(blocks.createdAt)
        .all();
      return rows.map((r) => ({
        id: r.id,
        sourceLabel: r.sourceLabel,
        sourceText: r.sourceText,
        targetLabel: r.targetLabel,
        translation: r.translation ?? undefined,
        audioSource: r.audioSource as AudioSource,
        partial: r.partial === 1,
        newTopic: r.newTopic === 1,
        createdAt: r.createdAt,
        sessionId: r.sessionId,
      }));
    },

    insertTodo(todo: TodoItem) {
      orm.insert(todos).values({
        id: todo.id,
        text: todo.text,
        completed: todo.completed ? 1 : 0,
        source: todo.source,
        createdAt: todo.createdAt,
        sessionId: todo.sessionId ?? null,
      }).run();
    },

    updateTodo(id: string, completed: boolean) {
      orm.update(todos)
        .set({ completed: completed ? 1 : 0, completedAt: completed ? Date.now() : null })
        .where(eq(todos.id, id))
        .run();
    },

    getTodos(): TodoItem[] {
      const rows = orm
        .select()
        .from(todos)
        .orderBy(desc(todos.createdAt))
        .all();
      return rows.map(mapTodoRow);
    },

    getTodosForSession(sessionId: string): TodoItem[] {
      const rows = orm
        .select()
        .from(todos)
        .where(eq(todos.sessionId, sessionId))
        .orderBy(desc(todos.createdAt))
        .all();
      return rows.map(mapTodoRow);
    },

    insertInsight(insight: Insight) {
      orm.insert(insights).values({
        id: insight.id,
        kind: insight.kind,
        text: insight.text,
        sessionId: insight.sessionId ?? null,
        createdAt: insight.createdAt,
      }).run();
    },

    getRecentInsights(limit = 50): Insight[] {
      const rows = orm
        .select()
        .from(insights)
        .orderBy(desc(insights.createdAt))
        .limit(limit)
        .all();
      return rows.map(mapInsightRow);
    },

    getInsightsForSession(sessionId: string): Insight[] {
      const rows = orm
        .select()
        .from(insights)
        .where(eq(insights.sessionId, sessionId))
        .orderBy(desc(insights.createdAt))
        .all();
      return rows.map(mapInsightRow);
    },

    getRecentKeyPoints(limit = 20): string[] {
      const rows = orm
        .select({ text: insights.text })
        .from(insights)
        .where(eq(insights.kind, "key-point"))
        .orderBy(desc(insights.createdAt))
        .limit(limit)
        .all();
      return rows.map((r) => r.text);
    },

    searchBlocks(query: string, limit = 50): TranscriptBlock[] {
      // FTS5 requires raw SQL — Drizzle doesn't support virtual tables
      const rows = sqlite
        .prepare(
          `SELECT b.id, b.session_id, b.source_label, b.source_text, b.target_label, b.translation,
                  b.audio_source, b.partial, b.new_topic, b.created_at
           FROM blocks_fts f
           JOIN blocks b ON b.id = f.rowid
           WHERE blocks_fts MATCH ?
           ORDER BY b.created_at DESC
           LIMIT ?`
        )
        .all(query, limit) as Array<{
        id: number; session_id: string; source_label: string; source_text: string;
        target_label: string; translation: string | null; audio_source: string;
        partial: number; new_topic: number; created_at: number;
      }>;
      return rows.map((r) => ({
        id: r.id,
        sourceLabel: r.source_label,
        sourceText: r.source_text,
        targetLabel: r.target_label,
        translation: r.translation ?? undefined,
        audioSource: r.audio_source as AudioSource,
        partial: r.partial === 1,
        newTopic: r.new_topic === 1,
        createdAt: r.created_at,
        sessionId: r.session_id,
      }));
    },

    // Agent persistence
    insertAgent(agent: Agent) {
      orm.insert(agents).values({
        id: agent.id,
        todoId: agent.todoId,
        sessionId: agent.sessionId ?? null,
        task: agent.task,
        status: agent.status,
        result: agent.result ?? null,
        steps: agent.steps,
        createdAt: agent.createdAt,
        completedAt: agent.completedAt ?? null,
      }).run();
    },

    updateAgent(id: string, fields: { status?: string; result?: string; steps?: AgentStep[]; completedAt?: number }) {
      const set: Record<string, unknown> = {};
      if (fields.status !== undefined) set.status = fields.status;
      if (fields.result !== undefined) set.result = fields.result;
      if (fields.steps !== undefined) set.steps = fields.steps;
      if (fields.completedAt !== undefined) set.completedAt = fields.completedAt;
      orm.update(agents).set(set).where(eq(agents.id, id)).run();
    },

    getAgentsForSession(sessionId: string): Agent[] {
      const rows = orm
        .select()
        .from(agents)
        .where(eq(agents.sessionId, sessionId))
        .orderBy(desc(agents.createdAt))
        .all();
      return rows.map((r) => ({
        id: r.id,
        todoId: r.todoId,
        task: r.task,
        status: r.status as Agent["status"],
        result: r.result ?? undefined,
        steps: (r.steps ?? []) as AgentStep[],
        createdAt: r.createdAt,
        completedAt: r.completedAt ?? undefined,
        sessionId: r.sessionId ?? undefined,
      }));
    },

    failStaleRunningAgents(reason: string): number {
      const completedAt = Date.now();
      const result = sqlite
        .prepare(`
          UPDATE agents
          SET status = 'failed',
              result = COALESCE(result, @reason),
              completed_at = COALESCE(completed_at, @completedAt)
          WHERE status = 'running'
        `)
        .run({ reason, completedAt });
      return result.changes;
    },

    close() {
      sqlite.close();
    },

    raw: sqlite,
  };
}

function mapTodoRow(r: typeof todos.$inferSelect): TodoItem {
  return {
    id: r.id,
    text: r.text,
    completed: r.completed === 1,
    source: r.source as "ai" | "manual",
    createdAt: r.createdAt,
    completedAt: r.completedAt ?? undefined,
    sessionId: r.sessionId ?? undefined,
  };
}

function mapInsightRow(r: typeof insights.$inferSelect): Insight {
  return {
    id: r.id,
    kind: r.kind as InsightKind,
    text: r.text,
    sessionId: r.sessionId ?? undefined,
    createdAt: r.createdAt,
  };
}

function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      title TEXT,
      block_count INTEGER DEFAULT 0,
      source_lang TEXT,
      target_lang TEXT
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      source_label TEXT NOT NULL,
      source_text TEXT NOT NULL,
      target_label TEXT NOT NULL,
      translation TEXT,
      audio_source TEXT NOT NULL DEFAULT 'system',
      partial INTEGER DEFAULT 0,
      new_topic INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS insights (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      session_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      todo_id TEXT NOT NULL,
      session_id TEXT REFERENCES sessions(id),
      task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      result TEXT,
      steps TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_session ON blocks(session_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_created ON blocks(created_at);
    CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(completed);
    CREATE INDEX IF NOT EXISTS idx_insights_created ON insights(created_at);
    CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
      source_text,
      translation,
      content='blocks',
      content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS blocks_ai AFTER INSERT ON blocks BEGIN
      INSERT INTO blocks_fts(rowid, source_text, translation)
      VALUES (new.id, new.source_text, COALESCE(new.translation, ''));
    END;
  `);

  // Backward-compat migrations for existing DBs
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("source_lang")) {
    db.exec("ALTER TABLE sessions ADD COLUMN source_lang TEXT");
  }
  if (!colNames.has("target_lang")) {
    db.exec("ALTER TABLE sessions ADD COLUMN target_lang TEXT");
  }

  const todoCols = db.prepare("PRAGMA table_info(todos)").all() as Array<{ name: string }>;
  const todoColNames = new Set(todoCols.map((c) => c.name));
  if (!todoColNames.has("session_id")) {
    db.exec("ALTER TABLE todos ADD COLUMN session_id TEXT");
  }
}
