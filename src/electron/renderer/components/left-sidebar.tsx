import { useEffect, useRef } from "react";
import type { Insight, SessionMeta } from "../../../core/types";
import { Separator } from "@/components/ui/separator";

type LeftSidebarProps = {
  rollingKeyPoints: string[];
  insights: Insight[];
  sessions: SessionMeta[];
  activeSessionId?: string | null;
  onSelectSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
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

export function LeftSidebar({ rollingKeyPoints, insights, sessions, activeSessionId, onSelectSession, onDeleteSession }: LeftSidebarProps) {
  const summaryBottomRef = useRef<HTMLDivElement>(null);
  const insightsBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    summaryBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [rollingKeyPoints.length]);

  useEffect(() => {
    insightsBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [insights.length]);

  return (
    <div className="w-[280px] shrink-0 border-r border-border flex flex-col min-h-0 bg-sidebar">
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
              <li key={session.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelectSession?.(session.id)}
                  className={`w-full text-left px-2 py-1.5 rounded-none text-xs transition-colors ${activeSessionId === session.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-foreground font-medium truncate">
                      {session.title ?? "Untitled Session"}
                    </span>
                    <span className="text-muted-foreground text-[11px] font-mono shrink-0 ml-2">
                      {session.blockCount}
                    </span>
                  </div>
                  <div className="text-muted-foreground text-[11px] font-mono">
                    {formatDate(session.startedAt)} · {formatTime(session.startedAt)}
                  </div>
                </button>
                {onDeleteSession && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                    className="absolute right-1 top-1 hidden group-hover:flex items-center justify-center w-5 h-5 rounded-none text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Delete session"
                  >
                    ×
                  </button>
                )}
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
