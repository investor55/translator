import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type { AgentStep } from "../types";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  instructions: text("instructions"),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  title: text("title"),
  blockCount: integer("block_count").default(0),
  sourceLang: text("source_lang"),
  targetLang: text("target_lang"),
  projectId: text("project_id").references(() => projects.id),
  summaryNarrative: text("summary_narrative"),
  summaryActionItems: text("summary_action_items"),
  summaryGeneratedAt: integer("summary_generated_at"),
});

export const blocks = sqliteTable("blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id),
  sourceLabel: text("source_label").notNull(),
  sourceText: text("source_text").notNull(),
  targetLabel: text("target_label").notNull(),
  translation: text("translation"),
  audioSource: text("audio_source").notNull().default("system"),
  partial: integer("partial").default(0),
  newTopic: integer("new_topic").default(0),
  createdAt: integer("created_at").notNull(),
});

export const todos = sqliteTable("todos", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  details: text("details"),
  size: text("size").notNull().default("large"),
  completed: integer("completed").default(0),
  source: text("source").notNull().default("manual"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
  sessionId: text("session_id"),
});

export const insights = sqliteTable("insights", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  sessionId: text("session_id"),
  createdAt: integer("created_at").notNull(),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  todoId: text("todo_id").notNull(),
  sessionId: text("session_id").references(() => sessions.id),
  task: text("task").notNull(),
  taskContext: text("task_context"),
  status: text("status").notNull().default("running"),
  result: text("result"),
  steps: text("steps", { mode: "json" }).$type<AgentStep[]>().default([]),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
  archived: integer("archived").default(0),
});
