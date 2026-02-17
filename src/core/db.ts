import Database from "better-sqlite3";
import type { TodoItem, Insight, InsightKind, SessionMeta, TranscriptBlock, AudioSource, LanguageCode } from "./types";

export type AppDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(dbPath: string) {
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  // Prepared statements
  const stmts = {
    insertSession: db.prepare(
      "INSERT INTO sessions (id, started_at, title, source_lang, target_lang) VALUES (?, ?, ?, ?, ?)"
    ),
    endSession: db.prepare(
      "UPDATE sessions SET ended_at = ?, block_count = (SELECT COUNT(*) FROM blocks WHERE session_id = ?) WHERE id = ?"
    ),
    getSessions: db.prepare(
      "SELECT id, started_at, ended_at, title, block_count, source_lang, target_lang FROM sessions ORDER BY started_at DESC LIMIT ?"
    ),
    deleteSessionBlocks: db.prepare("DELETE FROM blocks WHERE session_id = ?"),
    deleteSessionInsights: db.prepare("DELETE FROM insights WHERE session_id = ?"),
    deleteSessionRow: db.prepare("DELETE FROM sessions WHERE id = ?"),
    insertBlock: db.prepare(
      "INSERT INTO blocks (session_id, source_label, source_text, target_label, translation, audio_source, partial, new_topic, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ),
    getBlocksForSession: db.prepare(
      "SELECT * FROM blocks WHERE session_id = ? ORDER BY created_at ASC"
    ),
    insertTodo: db.prepare(
      "INSERT INTO todos (id, text, completed, source, created_at) VALUES (?, ?, ?, ?, ?)"
    ),
    updateTodo: db.prepare(
      "UPDATE todos SET completed = ?, completed_at = ? WHERE id = ?"
    ),
    getTodos: db.prepare(
      "SELECT id, text, completed, source, created_at, completed_at FROM todos ORDER BY created_at DESC"
    ),
    insertInsight: db.prepare(
      "INSERT INTO insights (id, kind, text, session_id, created_at) VALUES (?, ?, ?, ?, ?)"
    ),
    getRecentInsights: db.prepare(
      "SELECT id, kind, text, session_id, created_at FROM insights ORDER BY created_at DESC LIMIT ?"
    ),
    getRecentKeyPoints: db.prepare(
      "SELECT text FROM insights WHERE kind = 'key-point' ORDER BY created_at DESC LIMIT ?"
    ),
    searchBlocks: db.prepare(
      `SELECT b.id, b.session_id, b.source_label, b.source_text, b.target_label, b.translation,
              b.audio_source, b.partial, b.new_topic, b.created_at
       FROM blocks_fts f
       JOIN blocks b ON b.id = f.rowid
       WHERE blocks_fts MATCH ?
       ORDER BY b.created_at DESC
       LIMIT ?`
    ),
  };

  return {
    createSession(id: string, sourceLang?: LanguageCode, targetLang?: LanguageCode, title?: string) {
      stmts.insertSession.run(id, Date.now(), title ?? null, sourceLang ?? null, targetLang ?? null);
    },

    endSession(id: string) {
      stmts.endSession.run(Date.now(), id, id);
    },

    deleteSession(id: string) {
      db.transaction(() => {
        stmts.deleteSessionBlocks.run(id);
        stmts.deleteSessionInsights.run(id);
        stmts.deleteSessionRow.run(id);
      })();
    },

    getSessions(limit = 20): SessionMeta[] {
      const rows = stmts.getSessions.all(limit) as Array<{
        id: string; started_at: number; ended_at: number | null; title: string | null; block_count: number;
        source_lang: string | null; target_lang: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id,
        startedAt: r.started_at,
        endedAt: r.ended_at ?? undefined,
        title: r.title ?? undefined,
        blockCount: r.block_count,
        sourceLang: (r.source_lang as LanguageCode) ?? undefined,
        targetLang: (r.target_lang as LanguageCode) ?? undefined,
      }));
    },

    insertBlock(sessionId: string, block: TranscriptBlock) {
      stmts.insertBlock.run(
        sessionId,
        block.sourceLabel,
        block.sourceText,
        block.targetLabel,
        block.translation ?? null,
        block.audioSource,
        block.partial ? 1 : 0,
        block.newTopic ? 1 : 0,
        block.createdAt
      );
    },

    getBlocksForSession(sessionId: string): TranscriptBlock[] {
      const rows = stmts.getBlocksForSession.all(sessionId) as Array<{
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

    insertTodo(todo: TodoItem) {
      stmts.insertTodo.run(todo.id, todo.text, todo.completed ? 1 : 0, todo.source, todo.createdAt);
    },

    updateTodo(id: string, completed: boolean) {
      stmts.updateTodo.run(completed ? 1 : 0, completed ? Date.now() : null, id);
    },

    getTodos(): TodoItem[] {
      const rows = stmts.getTodos.all() as Array<{
        id: string; text: string; completed: number; source: string; created_at: number; completed_at: number | null;
      }>;
      return rows.map((r) => ({
        id: r.id,
        text: r.text,
        completed: r.completed === 1,
        source: r.source as "ai" | "manual",
        createdAt: r.created_at,
        completedAt: r.completed_at ?? undefined,
      }));
    },

    insertInsight(insight: Insight) {
      stmts.insertInsight.run(insight.id, insight.kind, insight.text, insight.sessionId ?? null, insight.createdAt);
    },

    getRecentInsights(limit = 50): Insight[] {
      const rows = stmts.getRecentInsights.all(limit) as Array<{
        id: string; kind: string; text: string; session_id: string | null; created_at: number;
      }>;
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind as InsightKind,
        text: r.text,
        sessionId: r.session_id ?? undefined,
        createdAt: r.created_at,
      }));
    },

    getRecentKeyPoints(limit = 20): string[] {
      const rows = stmts.getRecentKeyPoints.all(limit) as Array<{ text: string }>;
      return rows.map((r) => r.text);
    },

    searchBlocks(query: string, limit = 50): TranscriptBlock[] {
      const rows = stmts.searchBlocks.all(query, limit) as Array<{
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

    close() {
      db.close();
    },

    /** Expose raw db for tests or advanced use */
    raw: db,
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

    CREATE INDEX IF NOT EXISTS idx_blocks_session ON blocks(session_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_created ON blocks(created_at);
    CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(completed);
    CREATE INDEX IF NOT EXISTS idx_insights_created ON insights(created_at);

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

  // Add language columns to existing sessions table
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("source_lang")) {
    db.exec("ALTER TABLE sessions ADD COLUMN source_lang TEXT");
  }
  if (!colNames.has("target_lang")) {
    db.exec("ALTER TABLE sessions ADD COLUMN target_lang TEXT");
  }
}
