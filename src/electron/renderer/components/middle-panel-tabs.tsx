import { useState, useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import type { Agent } from "../../../core/types";
import type { SummaryModalState } from "./session-summary-modal";

type TabId = "transcript" | "summary" | "agent";

type MiddlePanelTabsProps = {
  transcriptContent: ReactNode;
  summaryContent: ReactNode;
  agentContent: ReactNode;
  summaryState: SummaryModalState;
  hasAgent: boolean;
  onCloseAgent: () => void;
  onGenerateSummary?: () => void;
  selectedAgent?: Agent | null;
  agents?: Agent[];
};

function TabButton({
  active,
  label,
  onClick,
  onClose,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  onClose?: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`group relative flex items-center gap-1 px-3 h-8 text-xs font-medium transition-colors shrink-0 ${
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground/70"
      }`}
    >
      <span className="truncate max-w-[200px]">{label}</span>
      {onClose && (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Close ${label} tab`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onClose();
            }
          }}
          className="ml-0.5 rounded-sm p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
        >
          <XIcon className="size-2.5" />
        </span>
      )}
      {active && (
        <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-foreground rounded-full" />
      )}
    </button>
  );
}

function truncateTask(task: string, maxLen = 30): string {
  const trimmed = task.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const boundary = trimmed.lastIndexOf(" ", maxLen);
  return (boundary > 10 ? trimmed.slice(0, boundary) : trimmed.slice(0, maxLen)).trim() + "...";
}

export function MiddlePanelTabs({
  transcriptContent,
  summaryContent,
  agentContent,
  summaryState,
  hasAgent,
  onCloseAgent,
  onGenerateSummary,
  selectedAgent,
  agents,
}: MiddlePanelTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("transcript");
  const prevSummaryKindRef = useRef(summaryState.kind);
  const prevAgentIdRef = useRef(selectedAgent?.id);

  const showAgent = hasAgent;

  // Derive valid tab — fall back to transcript if current tab disappeared
  const validTab =
    (activeTab === "agent" && !showAgent)
      ? "transcript"
      : activeTab;

  // Auto-switch to summary when it becomes non-idle
  useEffect(() => {
    if (prevSummaryKindRef.current === "idle" && summaryState.kind !== "idle") {
      setActiveTab("summary");
    }
    prevSummaryKindRef.current = summaryState.kind;
  }, [summaryState.kind]);

  // Auto-switch to agent when selectedAgent changes
  useEffect(() => {
    const agentId = selectedAgent?.id;
    if (agentId && agentId !== prevAgentIdRef.current) {
      setActiveTab("agent");
    }
    prevAgentIdRef.current = agentId;
  }, [selectedAgent?.id]);

  const handleCloseAgent = () => {
    onCloseAgent();
    setActiveTab("transcript");
  };

  // Build agent tab label with task name and count
  const agentTabLabel = (() => {
    if (!selectedAgent) return "Agent";
    const count = agents?.length ?? 0;
    const name = truncateTask(selectedAgent.task);
    return count > 1 ? `${name} (${count})` : name;
  })();

  return (
    <main className="flex-1 flex flex-col min-h-0 min-w-0 relative">
      {/* Tab bar */}
      <div
        role="tablist"
        className="shrink-0 flex items-center h-9 border-b border-border bg-background px-1 gap-0.5 overflow-x-auto"
      >
        <TabButton
          active={validTab === "transcript"}
          label="Transcript"
          onClick={() => setActiveTab("transcript")}
        />
        <TabButton
          active={validTab === "summary"}
          label="Summary"
          onClick={() => {
            if (summaryState.kind === "idle" && onGenerateSummary) {
              onGenerateSummary();
            }
            setActiveTab("summary");
          }}
        />
        {showAgent && (
          <TabButton
            active={validTab === "agent"}
            label={agentTabLabel}
            onClick={() => setActiveTab("agent")}
            onClose={handleCloseAgent}
          />
        )}
      </div>

      {/* Transcript — always mounted, hidden via CSS to preserve scroll */}
      <div className={`flex-1 flex flex-col min-h-0 ${validTab === "transcript" ? "" : "hidden"}`}>
        {transcriptContent}
      </div>

      {/* Summary */}
      {validTab === "summary" && (
        <div className="flex-1 flex flex-col min-h-0">
          {summaryContent}
        </div>
      )}

      {/* Agent — conditionally rendered */}
      {showAgent && validTab === "agent" && (
        <div className="flex-1 flex flex-col min-h-0">
          {agentContent}
        </div>
      )}
    </main>
  );
}
