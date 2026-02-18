import { useEffect, useRef, useState } from "react";
import type { Insight, ProjectMeta, SessionMeta } from "../../../core/types";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Trash2Icon } from "lucide-react";

type LeftSidebarProps = {
  rollingKeyPoints: string[];
  insights: Insight[];
  sessions: SessionMeta[];
  activeSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  projects: ProjectMeta[];
  activeProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onCreateProject: (name: string, instructions: string) => void;
  onEditProject: (project: ProjectMeta) => void;
  onDeleteProject: (id: string) => void;
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const INSIGHT_ICONS: Record<string, string> = {
  "definition": "📖",
  "context": "🔗",
  "fact": "💡",
  "tip": "✦",
};

type ProjectFormMode =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; project: ProjectMeta };

export function LeftSidebar({
  rollingKeyPoints,
  insights,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onEditProject,
  onDeleteProject,
}: LeftSidebarProps) {
  const summaryBottomRef = useRef<HTMLDivElement>(null);
  const insightsBottomRef = useRef<HTMLDivElement>(null);
  const [formMode, setFormMode] = useState<ProjectFormMode>({ kind: "none" });
  const [formName, setFormName] = useState("");
  const [formInstructions, setFormInstructions] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    summaryBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [rollingKeyPoints.length]);

  useEffect(() => {
    insightsBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [insights.length]);

  useEffect(() => {
    if (formMode.kind !== "none") {
      nameInputRef.current?.focus();
    }
  }, [formMode.kind]);

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;

  function openCreateForm() {
    setFormName("");
    setFormInstructions("");
    setFormMode({ kind: "create" });
  }

  function openEditForm(project: ProjectMeta) {
    setFormName(project.name);
    setFormInstructions(project.instructions ?? "");
    setFormMode({ kind: "edit", project });
  }

  function cancelForm() {
    setFormMode({ kind: "none" });
  }

  function submitForm() {
    const name = formName.trim();
    if (!name) return;
    if (formMode.kind === "create") {
      onCreateProject(name, formInstructions.trim());
    } else if (formMode.kind === "edit") {
      onEditProject({ ...formMode.project, name, instructions: formInstructions.trim() || undefined });
    }
    setFormMode({ kind: "none" });
  }

  return (
    <div className="w-full h-full shrink-0 border-r border-border flex flex-col min-h-0 bg-sidebar">
      {/* Project selector */}
      <div className="px-3 pt-2.5 pb-2 shrink-0">
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 justify-between h-7 px-2 text-xs font-medium text-left truncate"
              >
                <span className="truncate">{activeProject ? activeProject.name : "All Sessions"}</span>
                <span className="text-muted-foreground ml-1 shrink-0">▾</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuItem onSelect={() => onSelectProject(null)}>
                All Sessions
              </DropdownMenuItem>
              {projects.length > 0 && <DropdownMenuSeparator />}
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => onSelectProject(p.id)}>
                  <span className="flex-1 truncate">{p.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={openCreateForm}>
                New Project…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {activeProject && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Edit project"
              onClick={() => openEditForm(activeProject)}
            >
              ✎
            </Button>
          )}
        </div>

        {/* Inline project form */}
        {formMode.kind !== "none" && (
          <div className="mt-2 space-y-1.5">
            <Input
              ref={nameInputRef}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Project name"
              className="h-7 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") submitForm();
                if (e.key === "Escape") cancelForm();
              }}
            />
            <textarea
              value={formInstructions}
              onChange={(e) => setFormInstructions(e.target.value)}
              placeholder="Agent instructions (optional)"
              rows={3}
              className="w-full resize-none rounded-none border border-input bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelForm();
              }}
            />
            <div className="flex gap-1.5">
              <Button size="sm" className="h-6 text-xs px-2" onClick={submitForm} disabled={!formName.trim()}>
                {formMode.kind === "create" ? "Create" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={cancelForm}>
                Cancel
              </Button>
              {formMode.kind === "edit" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs px-2 ml-auto text-destructive hover:text-destructive"
                  onClick={() => { onDeleteProject(formMode.project.id); cancelForm(); }}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Summary section — scrollable, takes remaining space */}
      <div className="px-3 pt-2.5 pb-2 flex-1 min-h-0 flex flex-col">
        <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 shrink-0">
          Summary
        </h2>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {rollingKeyPoints.length > 0 ? (
            <ul className="space-y-1">
              {rollingKeyPoints.map((point, i) => (
                <li key={i} className="text-xs text-foreground leading-relaxed">
                  <span className="text-muted-foreground mr-1">•</span>
                  {point}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Summary will appear during recording...
            </p>
          )}
          <div ref={summaryBottomRef} />
        </div>
      </div>

      <Separator />

      {/* Insights feed — bounded height */}
      <div className="px-3 pt-2.5 pb-2 shrink-0 max-h-48 overflow-y-auto">
        <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Insights
        </h2>
        {insights.length > 0 ? (
          <ul className="space-y-1.5">
            {insights.map((insight) => (
              <li key={insight.id} className="text-xs leading-relaxed flex gap-1.5">
                <span className="text-muted-foreground shrink-0 w-3 text-center font-mono">
                  {INSIGHT_ICONS[insight.kind] ?? "•"}
                </span>
                <span className="text-foreground">{insight.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            AI insights will appear here...
          </p>
        )}
        <div ref={insightsBottomRef} />
      </div>

      <Separator />

      {/* Session timeline */}
      <div className="px-3 pt-2.5 pb-2 shrink-0 max-h-40 overflow-y-auto">
        <h2 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Sessions
        </h2>
        {sessions.length > 0 ? (
          <ul className="space-y-1">
            {sessions.map((session) => (
              <li key={session.id} className="group">
                <button
                  type="button"
                  onClick={() => onSelectSession?.(session.id)}
                  className={`w-full text-left px-2 py-1.5 rounded-none text-xs transition-colors ${activeSessionId === session.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground font-medium truncate">
                      {session.title ?? "Untitled Session"}
                    </span>
                    <span className="shrink-0 flex items-center justify-end w-5">
                      {onDeleteSession ? (
                        <>
                          <span className="text-muted-foreground text-[11px] font-mono group-hover:hidden">
                            {session.blockCount}
                          </span>
                          <span
                            role="button"
                            onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                            className="hidden group-hover:flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                            title="Delete session"
                          >
                            <Trash2Icon className="size-3" />
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-[11px] font-mono">
                          {session.blockCount}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-[11px] font-mono">
                    {formatDate(session.startedAt)} · {formatTime(session.startedAt)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            No previous sessions
          </p>
        )}
      </div>
    </div>
  );
}
