import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import type {
  Agent,
  AppConfig,
  CustomMcpStatus,
  FinalSummary,
  Language,
  LanguageCode,
  McpProviderToolSummary,
  TaskItem,
  TaskSuggestion,
  Insight,
  ProjectMeta,
  SessionMeta,
  AgentQuestionSelection,
  AgentToolApprovalResponse,
  McpIntegrationStatus,
} from "../../core/types";
import { DEFAULT_APP_CONFIG, normalizeAppConfig } from "../../core/types";
import { useSession } from "./hooks/use-session";
import type { ResumeData } from "./hooks/use-session";
import { useMicCapture } from "./hooks/use-mic-capture";
import { useAgents } from "./hooks/use-agents";
import { useKeyboard } from "./hooks/use-keyboard";
import { useThemeMode } from "./hooks/use-theme-mode";
import { useAppBootstrap } from "./hooks/use-app-bootstrap";
import { useSessionEventStream } from "./hooks/use-session-event-stream";
import { buildSessionPath, parseSessionRoute, pushSessionPath, replaceSessionPath } from "./lib/session-route";
import { initializeWhisperGpuClient } from "./lib/whisper-gpu-client";
import { ToolbarHeader } from "./components/toolbar-header";
import { TranscriptArea } from "./components/transcript-area";
import { LeftSidebar } from "./components/left-sidebar";
import { RightSidebar } from "./components/right-sidebar";
import { AgentDetailPanel } from "./components/agent-detail-panel";
import { NewAgentPanel } from "./components/new-agent-panel";
import { MiddlePanelTabs } from "./components/middle-panel-tabs";
import { Footer } from "./components/footer";
import { SettingsPage } from "./components/settings-page";
import { SplashScreen } from "./components/splash-screen";
import { SessionSummaryPanel } from "./components/session-summary-modal";
import type { SummaryModalState } from "./components/session-summary-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ResizeHandle = "left" | "right";

const MIN_TRANSCRIPT_WIDTH = 360;
const LEFT_PANEL_MIN_WIDTH = 220;
const LEFT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_MIN_WIDTH = 240;
const RIGHT_PANEL_MAX_WIDTH = 560;
const MAX_INSIGHTS = 240;

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function buildAiSuggestionDetails(suggestion: TaskSuggestion): string | undefined {
  const sections = [
    suggestion.details?.trim()
      ? `Context summary:\n${suggestion.details.trim()}`
      : "",
    suggestion.transcriptExcerpt?.trim()
      ? `Original transcript excerpt:\n${suggestion.transcriptExcerpt.trim()}`
      : "",
  ].filter(Boolean);

  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

function normalizeAgentTaskTitle(text: string): string {
  const collapsed = text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[-*0-9.)\s]+/, "")
    .replace(/[.!?]+$/g, "");
  if (!collapsed) return "";

  const splitOnMultiStep = collapsed.split(/\s(?:and|then|while)\s/i);
  const primaryStep = splitOnMultiStep[0]?.trim() || collapsed;
  if (primaryStep.length <= 110) return primaryStep;

  const clipped = primaryStep.slice(0, 110);
  const boundary = clipped.lastIndexOf(" ");
  return (boundary > 50 ? clipped.slice(0, boundary) : clipped).trim();
}

function summarySourceTitle(source?: "agreement" | "missed" | "question" | "action"): string {
  switch (source) {
    case "agreement":
      return "Agreements";
    case "missed":
      return "What We Might Have Missed";
    case "question":
      return "Unanswered Questions";
    case "action":
      return "General Action Items";
    default:
      return "Session Summary";
  }
}

function buildSummarySelectionText(item: {
  text: string;
  details?: string;
  source?: "agreement" | "missed" | "question" | "action";
}): string {
  const sections = [
    `Suggested task:\n${item.text.trim()}`,
    item.source ? `Section:\n${summarySourceTitle(item.source)}` : "",
    item.details?.trim() ? item.details.trim() : "",
  ].filter(Boolean);
  return sections.join("\n\n");
}

function buildSummaryTaskIntent(
  userIntent?: string,
  source?: "agreement" | "missed" | "question" | "action",
): string {
  const trimmedIntent = userIntent?.trim() ?? "";
  const sections = [
    trimmedIntent ? `User requested outcome:\n${trimmedIntent}` : "",
    source ? `Summary section:\n${summarySourceTitle(source)}` : "",
    "Create one narrow, agent-executable task focused on the highest-impact next step.",
    "Ensure taskDetails include rough thinking, a rough plan, clarifying questions for the user, done-when criteria, and constraints.",
    "Avoid combining multiple actions.",
  ].filter(Boolean);
  return sections.join("\n\n");
}

function normalizeInsightText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "")
    .toLowerCase();
}

function mergeInsights(existing: readonly Insight[], incoming: readonly Insight[]): Insight[] {
  const dedupe = new Set<string>();
  const ordered = [...existing, ...incoming]
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id.localeCompare(b.id);
    });
  const next: Insight[] = [];
  for (const insight of ordered) {
    const text = insight.text.trim().replace(/\s+/g, " ");
    if (!text) continue;
    const key = `${insight.kind}:${normalizeInsightText(text)}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    next.push({ ...insight, text });
  }
  if (next.length <= MAX_INSIGHTS) return next;
  return next.slice(-MAX_INSIGHTS);
}

export function App() {
  useEffect(() => {
    initializeWhisperGpuClient();
  }, []);

  const [languages, setLanguages] = useState<Language[]>([]);
  const [sourceLang, setSourceLang] = useLocalStorage<LanguageCode>("ambient-source-lang", "ko");
  const [targetLang, setTargetLang] = useLocalStorage<LanguageCode>("ambient-target-lang", "en");
  const [storedAppConfig, setStoredAppConfig] = useLocalStorage<AppConfig>("ambient-app-config", DEFAULT_APP_CONFIG);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionRestartKey, setSessionRestartKey] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [splashDone, setSplashDone] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [langError, setLangError] = useState("");
  const [routeNotice, setRouteNotice] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const panelLayoutRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{
    handle: ResizeHandle;
    startX: number;
    startLeft: number;
    startRight: number;
  } | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useLocalStorage<number>("ambient-left-panel-width", 280);
  const [rightPanelWidth, setRightPanelWidth] = useLocalStorage<number>("ambient-right-panel-width", 300);
  const appConfig = useMemo(() => normalizeAppConfig(storedAppConfig), [storedAppConfig]);

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [pendingApprovalTask, setPendingApprovalTask] = useState<TaskItem | null>(null);
  const [approvingLargeTask, setApprovingLargeTask] = useState(false);
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);
  const [processingTaskIds, setProcessingTaskIds] = useState<string[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [mcpIntegrations, setMcpIntegrations] = useState<McpIntegrationStatus[]>([]);
  const [customMcpServers, setCustomMcpServers] = useState<CustomMcpStatus[]>([]);
  const [mcpToolsByProvider, setMcpToolsByProvider] = useState<Record<string, McpProviderToolSummary>>({});
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProjectId, setActiveProjectId] = useLocalStorage<string | null>("ambient-active-project-id", null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [finalSummaryState, setFinalSummaryState] = useState<SummaryModalState>({ kind: "idle" });
  const pendingNewSessionRouteRef = useRef(false);
  const { refreshSessions, sessionsRef } = useAppBootstrap({
    setSessions,
    setSourceLang,
    setTargetLang,
  });

  const micCapture = useMicCapture();
  const { agents, selectedAgentId, selectedAgent, selectAgent: _selectAgent, seedAgents } = useAgents();
  const [newAgentMode, setNewAgentMode] = useState(false);
  const selectAgent = useCallback((id: string | null) => {
    setNewAgentMode(false);
    _selectAgent(id);
  }, [_selectAgent]);

  const handleResumed = useCallback((data: ResumeData) => {
    setSelectedSessionId(data.sessionId);
    setTasks(data.tasks);
    setProcessingTaskIds([]);
    setInsights(mergeInsights([], data.insights));
    seedAgents(data.agents);
    setFinalSummaryState({ kind: "idle" });
    void refreshSessions();
    void window.electronAPI.getFinalSummary(data.sessionId).then((result) => {
      if (
        result.ok &&
        result.summary &&
        result.summary.modelId === appConfig.synthesisModelId
      ) {
        setFinalSummaryState({ kind: "ready", summary: result.summary });
      }
    });
  }, [appConfig.synthesisModelId, refreshSessions, seedAgents]);

  const session = useSession(
    sourceLang,
    targetLang,
    sessionActive,
    appConfig,
    resumeSessionId,
    { onResumed: handleResumed, projectId: activeProjectId },
    sessionRestartKey,
  );

  // Auto-start mic when a new session starts
  useEffect(() => {
    if (!session.micAutoStartPending) return;
    session.clearMicAutoStart();

    void (async () => {
      const result = await window.electronAPI.toggleMic();
      if (result.ok && result.captureInRenderer) {
        await micCapture.start();
      }
    })();
  }, [session.micAutoStartPending, session.clearMicAutoStart, micCapture]);

  const applyRoutePath = useCallback((routeInput: string, availableSessions: SessionMeta[]) => {
    const parsed = parseSessionRoute(routeInput);
    if (window.location.hash !== `#${parsed.normalizedPath}`) {
      replaceSessionPath(parsed.sessionId);
    }

    if (!parsed.sessionId) {
      setRouteNotice(parsed.valid ? "" : "Unknown route. Showing empty state.");
      micCapture.stop();
      setSelectedSessionId(null);
      setSessionActive(false);
      setResumeSessionId(null);
      setTasks([]);
      setProcessingTaskIds([]);
      setSuggestions([]);
      setInsights([]);
      seedAgents([]);
      setFinalSummaryState({ kind: "idle" });
      session.clearSession();
      return;
    }

    const exists = availableSessions.some((entry) => entry.id === parsed.sessionId);
    if (!exists) {
      setRouteNotice(`Session ${parsed.sessionId} not found. Showing empty state.`);
      micCapture.stop();
      replaceSessionPath(null);
      setSelectedSessionId(null);
      setSessionActive(false);
      setResumeSessionId(null);
      setTasks([]);
      setProcessingTaskIds([]);
      setSuggestions([]);
      setInsights([]);
      seedAgents([]);
      setFinalSummaryState({ kind: "idle" });
      session.clearSession();
      return;
    }

    setRouteNotice("");
    setSplashDone(true);
    setSettingsOpen(false);
    setSuggestions([]);
    setTasks([]);
    setProcessingTaskIds([]);
    setInsights([]);
    seedAgents([]);
    setFinalSummaryState({ kind: "idle" });
    setSelectedSessionId(parsed.sessionId);
    setResumeSessionId(parsed.sessionId);
    setSessionActive(true);
  }, [micCapture, seedAgents, session.clearSession]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await refreshSessions();
      if (cancelled) return;
      applyRoutePath(window.location.hash || window.location.pathname, loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyRoutePath, refreshSessions]);

  useEffect(() => {
    const onLocationChange = () => {
      const available = sessionsRef.current;
      applyRoutePath(window.location.hash || window.location.pathname, available);
    };
    window.addEventListener("popstate", onLocationChange);
    window.addEventListener("hashchange", onLocationChange);
    return () => {
      window.removeEventListener("popstate", onLocationChange);
      window.removeEventListener("hashchange", onLocationChange);
    };
  }, [applyRoutePath]);

  useEffect(() => {
    window.electronAPI.getLanguages().then(setLanguages);
  }, []);

  const refreshMcpIntegrations = useCallback(async () => {
    const statuses = await window.electronAPI.getMcpIntegrationsStatus();
    setMcpIntegrations(statuses);
  }, []);

  const refreshCustomMcpServers = useCallback(async () => {
    const servers = await window.electronAPI.getCustomMcpServersStatus();
    setCustomMcpServers(servers);
  }, []);

  const refreshMcpToolsInfo = useCallback(async () => {
    const summaries = await window.electronAPI.getMcpToolsInfo();
    const byProvider: Record<string, McpProviderToolSummary> = {};
    for (const s of summaries) byProvider[s.provider] = s;
    setMcpToolsByProvider(byProvider);
  }, []);

  useEffect(() => {
    void refreshMcpIntegrations();
    void refreshCustomMcpServers();
    void refreshMcpToolsInfo();
  }, [refreshMcpIntegrations, refreshCustomMcpServers, refreshMcpToolsInfo]);

  const refreshProjects = useCallback(async () => {
    const list = await window.electronAPI.getProjects();
    setProjects(list);
    return list;
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    if (!session.sessionId) return;

    setSelectedSessionId(session.sessionId);
    const currentPath = buildSessionPath(session.sessionId);
    if (pendingNewSessionRouteRef.current) {
      pushSessionPath(session.sessionId);
      pendingNewSessionRouteRef.current = false;
    } else if (parseSessionRoute(window.location.hash).normalizedPath !== currentPath) {
      replaceSessionPath(session.sessionId);
    }
    void refreshSessions();
  }, [refreshSessions, session.sessionId]);

  useThemeMode(appConfig.themeMode, appConfig.lightVariant, appConfig.darkVariant, appConfig.fontSize, appConfig.fontFamily);

  const appendSuggestions = useCallback((incoming: TaskSuggestion[]) => {
    if (incoming.length === 0) return;
    setSuggestions((prev) => {
      const existingIds = new Set(prev.map((item) => item.id));
      const next = [...prev];
      for (const suggestion of incoming) {
        if (existingIds.has(suggestion.id)) continue;
        next.unshift(suggestion);
        existingIds.add(suggestion.id);
      }
      return next;
    });
  }, []);

  const handleTaskSuggested = useCallback((suggestion: TaskSuggestion) => {
    appendSuggestions([suggestion]);
  }, [appendSuggestions]);

  const handleInsightAdded = useCallback((insight: Insight) => {
    setInsights((prev) => mergeInsights(prev, [insight]));
  }, []);

  const handleFinalSummaryReady = useCallback((summary: FinalSummary) => {
    setFinalSummaryState({ kind: "ready", summary });
  }, []);

  const handleFinalSummaryError = useCallback((error: string) => {
    setFinalSummaryState({ kind: "error", message: error });
  }, []);

  // Keep these listeners active so task suggestions and insights stream into the UI.
  useSessionEventStream({
    onTaskSuggested: handleTaskSuggested,
    onInsightAdded: handleInsightAdded,
    onFinalSummaryReady: handleFinalSummaryReady,
    onFinalSummaryError: handleFinalSummaryError,
  });

  useEffect(() => {
    return window.electronAPI.onSessionTitleGenerated((sessionId, title) => {
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)));
    });
  }, []);

  const handleToggleMic = useCallback(async () => {
    const result = await window.electronAPI.toggleMic();
    if (result.ok && result.captureInRenderer) {
      await micCapture.start();
    } else if (result.ok && !result.micEnabled) {
      micCapture.stop();
    }
  }, [micCapture]);

  const handleConnectNotionMcp = useCallback(async () => {
    setMcpBusy(true);
    try {
      const result = await window.electronAPI.connectNotionMcp();
      if (!result.ok) {
        setRouteNotice(`Notion connection failed: ${result.error ?? "Unknown error"}`);
      } else {
        setRouteNotice("Notion MCP connected.");
      }
    } finally {
      await Promise.all([refreshMcpIntegrations(), refreshMcpToolsInfo()]);
      setMcpBusy(false);
    }
  }, [refreshMcpIntegrations, refreshMcpToolsInfo]);

  const handleDisconnectNotionMcp = useCallback(async () => {
    setMcpBusy(true);
    try {
      const result = await window.electronAPI.disconnectNotionMcp();
      if (!result.ok) {
        setRouteNotice(`Could not disconnect Notion: ${result.error ?? "Unknown error"}`);
      } else {
        setRouteNotice("Notion MCP disconnected.");
      }
    } finally {
      await Promise.all([refreshMcpIntegrations(), refreshMcpToolsInfo()]);
      setMcpBusy(false);
    }
  }, [refreshMcpIntegrations, refreshMcpToolsInfo]);

  const handleSetLinearToken = useCallback(async (token: string) => {
    setMcpBusy(true);
    try {
      const result = await window.electronAPI.setLinearMcpToken(token);
      if (!result.ok) {
        setRouteNotice(`Linear connection failed: ${result.error ?? "Unknown error"}`);
      } else {
        setRouteNotice("Linear MCP connected.");
      }
      return result;
    } finally {
      await Promise.all([refreshMcpIntegrations(), refreshMcpToolsInfo()]);
      setMcpBusy(false);
    }
  }, [refreshMcpIntegrations, refreshMcpToolsInfo]);

  const handleClearLinearToken = useCallback(async () => {
    setMcpBusy(true);
    try {
      const result = await window.electronAPI.clearLinearMcpToken();
      if (!result.ok) {
        setRouteNotice(`Could not disconnect Linear: ${result.error ?? "Unknown error"}`);
      } else {
        setRouteNotice("Linear MCP disconnected.");
      }
      return result;
    } finally {
      await Promise.all([refreshMcpIntegrations(), refreshMcpToolsInfo()]);
      setMcpBusy(false);
    }
  }, [refreshMcpIntegrations, refreshMcpToolsInfo]);

  const handleAddCustomServer = useCallback(async (cfg: { name: string; url: string; transport: "streamable" | "sse"; bearerToken?: string }) => {
    setMcpBusy(true);
    try {
      const result = await window.electronAPI.addCustomMcpServer(cfg);
      if (!result.ok) {
        setRouteNotice(`Custom MCP server add failed: ${result.error ?? "Unknown error"}`);
      }
      return result;
    } finally {
      await Promise.all([refreshCustomMcpServers(), refreshMcpToolsInfo()]);
      setMcpBusy(false);
    }
  }, [refreshCustomMcpServers, refreshMcpToolsInfo]);

  const handleRemoveCustomServer = useCallback(async (id: string) => {
    setMcpBusy(true);
    try {
      const result = await window.electronAPI.removeCustomMcpServer(id);
      if (!result.ok) {
        setRouteNotice(`Could not remove custom server: ${result.error ?? "Unknown error"}`);
      }
      return result;
    } finally {
      await Promise.all([refreshCustomMcpServers(), refreshMcpToolsInfo()]);
      setMcpBusy(false);
    }
  }, [refreshCustomMcpServers, refreshMcpToolsInfo]);

  const handleConnectCustomServer = useCallback(async (id: string) => {
    setMcpBusy(true);
    try {
      const result = await window.electronAPI.connectCustomMcpServer(id);
      if (!result.ok) {
        setRouteNotice(`Custom MCP server connect failed: ${result.error ?? "Unknown error"}`);
      }
      return result;
    } finally {
      await Promise.all([refreshCustomMcpServers(), refreshMcpToolsInfo()]);
      setMcpBusy(false);
    }
  }, [refreshCustomMcpServers, refreshMcpToolsInfo]);

  const handleDisconnectCustomServer = useCallback(async (id: string) => {
    setMcpBusy(true);
    try {
      const result = await window.electronAPI.disconnectCustomMcpServer(id);
      if (!result.ok) {
        setRouteNotice(`Could not disconnect custom server: ${result.error ?? "Unknown error"}`);
      }
      return result;
    } finally {
      await Promise.all([refreshCustomMcpServers(), refreshMcpToolsInfo()]);
      setMcpBusy(false);
    }
  }, [refreshCustomMcpServers, refreshMcpToolsInfo]);

  const handleSelectProject = useCallback((id: string | null) => {
    setActiveProjectId(id);
  }, [setActiveProjectId]);

  const handleCreateProject = useCallback(async (name: string, instructions: string) => {
    const result = await window.electronAPI.createProject(name, instructions || undefined);
    if (result.ok) {
      await refreshProjects();
      if (result.project) {
        setActiveProjectId(result.project.id);
      }
    }
  }, [refreshProjects, setActiveProjectId]);

  const handleEditProject = useCallback(async (project: ProjectMeta) => {
    const result = await window.electronAPI.updateProject(project.id, {
      name: project.name,
      instructions: project.instructions,
    });
    if (result.ok) {
      await refreshProjects();
    }
  }, [refreshProjects]);

  const handleDeleteProject = useCallback(async (id: string) => {
    await window.electronAPI.deleteProject(id);
    if (activeProjectId === id) {
      setActiveProjectId(null);
    }
    await refreshProjects();
  }, [activeProjectId, refreshProjects, setActiveProjectId]);

  const handleMoveSessionToProject = useCallback(async (sessionId: string, projectId: string | null) => {
    const result = await window.electronAPI.updateSessionProject(sessionId, projectId);
    if (!result.ok) {
      setRouteNotice(`Failed to move session: ${result.error ?? "Unknown error"}`);
      return;
    }

    setRouteNotice("");
    const nextProjectId = result.session?.projectId ?? (projectId ?? undefined);
    setSessions((prev) => prev.map((sessionMeta) => (
      sessionMeta.id === sessionId
        ? { ...sessionMeta, projectId: nextProjectId }
        : sessionMeta
    )));
    sessionsRef.current = sessionsRef.current.map((sessionMeta) => (
      sessionMeta.id === sessionId
        ? { ...sessionMeta, projectId: nextProjectId }
        : sessionMeta
    ));
  }, [sessionsRef]);

  const handleStart = useCallback(() => {
    setLangError("");
    setSplashDone(true);
    setSettingsOpen(false);
    setRouteNotice("");
    setSuggestions([]);

    if (selectedSessionId) {
      setResumeSessionId(selectedSessionId);
      setSessionActive(true);
      return;
    }

    pendingNewSessionRouteRef.current = true;
    replaceSessionPath(null);
    setSelectedSessionId(null);
    setResumeSessionId(null);
    setTasks([]);
    setProcessingTaskIds([]);
    setInsights([]);
    seedAgents([]);
    setFinalSummaryState({ kind: "idle" });
    setSessionActive(true);
  }, [seedAgents, selectedSessionId]);

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true);
  }, []);

  const handleStop = useCallback(() => {
    micCapture.stop();
    setSessionActive(false);
    setResumeSessionId(null);
    setRouteNotice("");
    void refreshSessions();
  }, [micCapture, refreshSessions]);

  const handleNewSession = useCallback(() => {
    micCapture.stop();
    setSettingsOpen(false);
    setRouteNotice("");
    pendingNewSessionRouteRef.current = true;
    setSelectedSessionId(null);
    setResumeSessionId(null);
    setTasks([]);
    setProcessingTaskIds([]);
    setSuggestions([]);
    setInsights([]);
    seedAgents([]);
    setFinalSummaryState({ kind: "idle" });
    session.clearSession();
    setSessionRestartKey((prev) => prev + 1);
    setSessionActive(true);
    void refreshSessions();
  }, [micCapture, refreshSessions, seedAgents, session.clearSession]);

  const scrollUp = useCallback(() => {
    transcriptRef.current?.scrollBy({ top: -60, behavior: "smooth" });
  }, []);

  const scrollDown = useCallback(() => {
    transcriptRef.current?.scrollBy({ top: 60, behavior: "smooth" });
  }, []);

  const startResize = useCallback((handle: ResizeHandle, clientX: number) => {
    resizeStateRef.current = {
      handle,
      startX: clientX,
      startLeft: leftPanelWidth,
      startRight: rightPanelWidth,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [leftPanelWidth, rightPanelWidth]);

  const endResize = useCallback(() => {
    if (!resizeStateRef.current) return;
    resizeStateRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const handleResizeMouseDown = useCallback((handle: ResizeHandle) => (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    startResize(handle, event.clientX);
  }, [startResize]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const activeResize = resizeStateRef.current;
      const layoutEl = panelLayoutRef.current;
      if (!activeResize || !layoutEl) return;

      const totalWidth = layoutEl.getBoundingClientRect().width;
      if (totalWidth <= 0) return;
      const delta = event.clientX - activeResize.startX;

      if (activeResize.handle === "left") {
        const maxLeft = totalWidth
          - activeResize.startRight
          - MIN_TRANSCRIPT_WIDTH;
        setLeftPanelWidth(Math.round(clampWidth(
          activeResize.startLeft + delta,
          LEFT_PANEL_MIN_WIDTH,
          Math.min(LEFT_PANEL_MAX_WIDTH, maxLeft),
        )));
      } else if (activeResize.handle === "right") {
        const maxRight = totalWidth
          - activeResize.startLeft
          - MIN_TRANSCRIPT_WIDTH;
        setRightPanelWidth(Math.round(clampWidth(
          activeResize.startRight - delta,
          RIGHT_PANEL_MIN_WIDTH,
          Math.min(RIGHT_PANEL_MAX_WIDTH, maxRight),
        )));
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", endResize);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", endResize);
      endResize();
    };
  }, [endResize, setLeftPanelWidth, setRightPanelWidth]);

  useEffect(() => {
    if (settingsOpen) return;

    const clampPanelsToLayout = () => {
      const layoutEl = panelLayoutRef.current;
      if (!layoutEl) return;

      const totalWidth = layoutEl.getBoundingClientRect().width;
      if (totalWidth <= 0) return;

      let nextLeft = clampWidth(leftPanelWidth, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH);
      let nextRight = clampWidth(rightPanelWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH);

      let overflow = nextLeft + nextRight - (totalWidth - MIN_TRANSCRIPT_WIDTH);
      if (overflow > 0) {
        const consumeOverflow = (current: number, min: number) => {
          const spare = Math.max(0, current - min);
          const reduction = Math.min(spare, overflow);
          overflow -= reduction;
          return current - reduction;
        };
        nextRight = consumeOverflow(nextRight, RIGHT_PANEL_MIN_WIDTH);
        nextLeft = consumeOverflow(nextLeft, LEFT_PANEL_MIN_WIDTH);
      }

      if (nextLeft !== leftPanelWidth) setLeftPanelWidth(nextLeft);
      if (nextRight !== rightPanelWidth) setRightPanelWidth(nextRight);
    };

    clampPanelsToLayout();
    window.addEventListener("resize", clampPanelsToLayout);
    return () => window.removeEventListener("resize", clampPanelsToLayout);
  }, [
    leftPanelWidth,
    rightPanelWidth,
    settingsOpen,
    setLeftPanelWidth,
    setRightPanelWidth,
  ]);

  const persistTask = useCallback(async ({
    targetSessionId,
    text,
    details,
    source,
    id,
    createdAt,
  }: {
    targetSessionId: string;
    text: string;
    details?: string;
    source: TaskItem["source"];
    id?: string;
    createdAt?: number;
  }): Promise<{ ok: boolean; task?: TaskItem; error?: string }> => {
    const task: TaskItem = {
      id: id ?? crypto.randomUUID(),
      text,
      details,
      size: "large",
      completed: false,
      source,
      createdAt: createdAt ?? Date.now(),
      sessionId: targetSessionId,
    };
    const result = await window.electronAPI.addTask(task, appConfig);
    if (!result.ok) {
      return { ok: false, error: result.error ?? "Unknown error" };
    }
    return { ok: true, task: result.task ?? task };
  }, [appConfig]);

  const handleAddTask = useCallback(async (text: string, details?: string) => {
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      setRouteNotice("Select or start a session before adding tasks.");
      return false;
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      return false;
    }

    const optimisticId = crypto.randomUUID();
    const optimisticTask: TaskItem = {
      id: optimisticId,
      text: trimmedText,
      details,
      size: "large",
      completed: false,
      source: "manual",
      createdAt: Date.now(),
      sessionId: targetSessionId,
    };

    setRouteNotice("");
    setTasks((prev) => [optimisticTask, ...prev]);
    setProcessingTaskIds((prev) => (prev.includes(optimisticId) ? prev : [optimisticId, ...prev]));

    const result = await persistTask({
      targetSessionId,
      text: trimmedText,
      details,
      source: "manual",
      id: optimisticId,
      createdAt: optimisticTask.createdAt,
    });

    setProcessingTaskIds((prev) => prev.filter((id) => id !== optimisticId));
    if (!result.ok) {
      setTasks((prev) => prev.filter((t) => t.id !== optimisticId));
      setRouteNotice(`Failed to add task: ${result.error ?? "Unknown error"}`);
      return false;
    }

    setTasks((prev) =>
      prev.map((t) => (t.id === optimisticId ? result.task! : t))
    );
    return true;
  }, [persistTask, selectedSessionId, session.sessionId]);

  const handleCreateTaskFromSelection = useCallback(async (selectionText: string, userIntentText?: string) => {
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      const message = "Select or start a session before creating tasks.";
      setRouteNotice(message);
      return { ok: false, message };
    }

    const placeholderId = `processing-${crypto.randomUUID()}`;
    const trimmedIntent = userIntentText?.trim() ?? "";
    const placeholderTask: TaskItem = {
      id: placeholderId,
      text: trimmedIntent
        ? `Processing: ${trimmedIntent}`
        : "Processing highlighted text...",
      size: "large",
      completed: false,
      source: "manual",
      createdAt: Date.now(),
      sessionId: targetSessionId,
    };
    setTasks((prev) => [placeholderTask, ...prev]);
    setProcessingTaskIds((prev) => [placeholderId, ...prev]);
    setRouteNotice("Processing highlighted text into a task...");

    void (async () => {
      const finalizeProcessing = () => {
        setProcessingTaskIds((prev) => prev.filter((id) => id !== placeholderId));
      };
      const removePlaceholder = () => {
        setTasks((prev) => prev.filter((t) => t.id !== placeholderId));
      };

      const extractResult = await window.electronAPI.extractTaskFromSelectionInSession(
        targetSessionId,
        selectionText,
        trimmedIntent || undefined,
        appConfig,
      );

      if (!extractResult.ok) {
        removePlaceholder();
        finalizeProcessing();
        setRouteNotice(`Could not process selection: ${extractResult.error ?? "Unknown error"}`);
        return;
      }

      if (!extractResult.taskTitle) {
        removePlaceholder();
        finalizeProcessing();
        setRouteNotice(extractResult.reason ?? "No actionable task found in selection.");
        return;
      }

      const persistResult = await persistTask({
        targetSessionId,
        text: extractResult.taskTitle,
        details: [
          trimmedIntent
            ? `Requested task intent:\n${trimmedIntent}`
            : "",
          extractResult.taskDetails?.trim()
            ? `Context summary:\n${extractResult.taskDetails.trim()}`
            : "",
          `Original transcript excerpt:\n${selectionText.trim()}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        source: "manual",
      });
      if (!persistResult.ok) {
        removePlaceholder();
        finalizeProcessing();
        setRouteNotice(`Failed to add task: ${persistResult.error ?? "Unknown error"}`);
        return;
      }

      setTasks((prev) => [
        persistResult.task!,
        ...prev.filter((t) => t.id !== placeholderId),
      ]);
      finalizeProcessing();
      setRouteNotice(`Task created: ${persistResult.task!.text}`);
    })();

    return { ok: true };
  }, [appConfig, persistTask, selectedSessionId, session.sessionId]);

  const [transcriptRefs, setTranscriptRefs] = useState<string[]>([]);

  const handleAddTranscriptRef = useCallback((text: string) => {
    setTranscriptRefs((prev) => [...prev, text]);
  }, []);

  const handleRemoveTranscriptRef = useCallback((index: number) => {
    setTranscriptRefs((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmitTaskInput = useCallback(async (intentText: string, refs: string[]) => {
    const trimmedIntent = intentText.trim();
    if (!trimmedIntent && refs.length === 0) return;
    // Always route through AI extraction so tasks get a proper title + context summary.
    // When refs exist, they are the "selection" and intentText is the user's framing.
    // When there are no refs, the typed text itself becomes the selection to extract from.
    const selectionText = refs.length > 0 ? refs.join("\n\n---\n\n") : trimmedIntent;
    await handleCreateTaskFromSelection(selectionText, refs.length > 0 ? (trimmedIntent || undefined) : undefined);
    setTranscriptRefs([]);
  }, [handleCreateTaskFromSelection]);

  const handleAddTaskFromDebrief = useCallback(async (text: string, details?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const selectionText = [
      `Agent next step:\n${trimmed}`,
      details?.trim() ? `Agent debrief context:\n${details.trim()}` : "",
    ].filter(Boolean).join("\n\n");
    await handleCreateTaskFromSelection(
      selectionText,
      "Convert this into one atomic executable task with rough thinking, a rough plan, and clarifying questions for the user.",
    );
  }, [handleCreateTaskFromSelection]);

  const handleToggleTask = useCallback((id: string) => {
    if (processingTaskIds.includes(id)) {
      return;
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, completed: !t.completed, completedAt: !t.completed ? Date.now() : undefined }
          : t
      )
    );
    window.electronAPI.toggleTask(id);
  }, [processingTaskIds]);

  const handleDeleteTask = useCallback(async (id: string) => {
    if (processingTaskIds.includes(id)) {
      setProcessingTaskIds((prev) => prev.filter((itemId) => itemId !== id));
      setTasks((prev) => prev.filter((t) => t.id !== id));
      return;
    }

    let removedTask: TaskItem | undefined;
    setTasks((prev) => {
      removedTask = prev.find((t) => t.id === id);
      return prev.filter((t) => t.id !== id);
    });

    const result = await window.electronAPI.deleteTask(id);
    if (result.ok) {
      setRouteNotice("");
      return;
    }

    if (removedTask) {
      setTasks((prev) => [removedTask!, ...prev]);
    }
    setRouteNotice(`Failed to delete task: ${result.error ?? "Unknown error"}`);
  }, [processingTaskIds]);

  const handleUpdateTask = useCallback(async (id: string, text: string) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, text } : t));
    const result = await window.electronAPI.updateTaskText(id, text);
    if (!result.ok) {
      setRouteNotice(`Failed to update task: ${result.error ?? "Unknown error"}`);
    }
  }, []);


  const handleAcceptSuggestion = useCallback(async (suggestion: TaskSuggestion) => {
    const targetSessionId = suggestion.sessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      setRouteNotice("Missing session id for suggestion.");
      return;
    }
    const suggestionDetails = buildAiSuggestionDetails(suggestion);

    const optimisticTask: TaskItem = {
      id: suggestion.id,
      text: suggestion.text,
      details: suggestionDetails,
      size: "large",
      completed: false,
      source: "ai",
      createdAt: suggestion.createdAt,
      sessionId: targetSessionId,
    };

    setRouteNotice("");
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
    setTasks((prev) => [optimisticTask, ...prev.filter((t) => t.id !== suggestion.id)]);
    setProcessingTaskIds((prev) => (prev.includes(suggestion.id) ? prev : [suggestion.id, ...prev]));

    const result = await persistTask({
      targetSessionId,
      text: suggestion.text,
      details: suggestionDetails,
      source: "ai",
      id: suggestion.id,
      createdAt: suggestion.createdAt,
    });

    setProcessingTaskIds((prev) => prev.filter((id) => id !== suggestion.id));
    if (!result.ok) {
      setTasks((prev) => prev.filter((t) => t.id !== suggestion.id));
      setSuggestions((prev) => [suggestion, ...prev.filter((item) => item.id !== suggestion.id)]);
      setRouteNotice(`Failed to add task from suggestion: ${result.error ?? "Unknown error"}`);
      return;
    }

    setTasks((prev) =>
      prev.map((t) => (t.id === suggestion.id ? result.task! : t))
    );
    if (result.task!.size === "large") {
      setRouteNotice("Suggestion accepted as large. Approval is required before running the agent.");
    }
  }, [persistTask, selectedSessionId, session.sessionId]);

  const handleDismissSuggestion = useCallback((id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const launchTaskAgent = useCallback(async (task: TaskItem, approvalToken?: string) => {
    const taskSessionId = task.sessionId ?? null;
    const targetSessionId = taskSessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      setRouteNotice("Missing session id for this task.");
      return false;
    }

    const useActiveRuntime = sessionActive && session.sessionId === targetSessionId;
    const result = useActiveRuntime
      ? await window.electronAPI.launchAgent(task.id, task.text, task.details, approvalToken)
      : await window.electronAPI.launchAgentInSession(
          targetSessionId,
          task.id,
          task.text,
          task.details,
          appConfig,
          approvalToken,
        );

    if (result.ok && result.agent) {
      setRouteNotice("");
      selectAgent(result.agent.id);
      return true;
    }
    setRouteNotice(`Failed to launch agent: ${result.error ?? "Unknown error"}`);
    return false;
  }, [appConfig, selectAgent, selectedSessionId, session.sessionId, sessionActive]);

  const handleLaunchAgent = useCallback(async (task: TaskItem) => {
    if (processingTaskIds.includes(task.id)) {
      setRouteNotice("Task is still processing. Wait a moment before launching.");
      return;
    }
    if (task.size === "large") {
      setPendingApprovalTask(task);
      return;
    }
    await launchTaskAgent(task);
  }, [launchTaskAgent, processingTaskIds]);

  const handleNewAgent = useCallback(() => {
    selectAgent(null);
    setNewAgentMode(true);
  }, [selectAgent]);

  const handleLaunchCustomAgent = useCallback(async (task: string) => {
    setNewAgentMode(false);
    const result = await window.electronAPI.launchCustomAgent(task);
    if (result.ok && result.agent) {
      selectAgent(result.agent.id);
    } else {
      setRouteNotice(`Failed to launch agent: ${result.error ?? "Unknown error"}`);
    }
  }, [selectAgent]);

  const handleArchiveAgent = useCallback(async (agent: Agent) => {
    await window.electronAPI.archiveAgent(agent.id);
  }, []);

  const handleRelaunchAgent = useCallback(async (agent: Agent) => {
    const result = await window.electronAPI.relaunchAgent(agent.id);
    if (!result.ok) {
      setRouteNotice(`Failed to relaunch agent: ${result.error ?? "Unknown error"}`);
    }
  }, []);

  const handleApproveLargeTask = useCallback(async () => {
    if (!pendingApprovalTask) return;
    setApprovingLargeTask(true);
    const approval = await window.electronAPI.approveLargeTask(pendingApprovalTask.id);
    if (!approval.ok || !approval.approvalToken) {
      setApprovingLargeTask(false);
      setRouteNotice(`Failed to approve large task: ${approval.error ?? "Unknown error"}`);
      return;
    }

    const launched = await launchTaskAgent(pendingApprovalTask, approval.approvalToken);
    setApprovingLargeTask(false);
    if (launched) {
      setPendingApprovalTask(null);
    }
  }, [launchTaskAgent, pendingApprovalTask]);

  const handleSelectSession = useCallback((sessionId: string) => {
    micCapture.stop();
    setSettingsOpen(false);
    setRouteNotice("");
    pushSessionPath(sessionId);
    // Force session hook re-init on the first click even if values are unchanged.
    setSessionRestartKey((k) => k + 1);
    setSelectedSessionId(sessionId);
    setResumeSessionId(sessionId);
    setSuggestions([]);
    setTasks([]);
    setProcessingTaskIds([]);
    setInsights([]);
    seedAgents([]);
    setSessionActive(true);
  }, [micCapture, seedAgents]);

  const handleDeleteSession = useCallback(async (id: string) => {
    await window.electronAPI.deleteSession(id);
    const isDeletedSelected = selectedSessionId === id || session.sessionId === id;
    if (isDeletedSelected) {
      micCapture.stop();
      replaceSessionPath(null);
      setSelectedSessionId(null);
      setSessionActive(false);
      setResumeSessionId(null);
      setSuggestions([]);
      setTasks([]);
      setProcessingTaskIds([]);
      setInsights([]);
      seedAgents([]);
      session.clearSession();
    }
    await refreshSessions();
  }, [micCapture, refreshSessions, seedAgents, selectedSessionId, session.clearSession, session.sessionId]);

  const handleFollowUp = useCallback(async (agent: Agent, question: string) => {
    const targetSessionId = agent.sessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      return { ok: false, error: "Missing session id for this agent" };
    }
    return window.electronAPI.followUpAgentInSession(targetSessionId, agent.id, question, appConfig);
  }, [appConfig, selectedSessionId, session.sessionId]);

  const handleAnswerAgentQuestion = useCallback(async (agent: Agent, answers: AgentQuestionSelection[]) => {
    const targetSessionId = agent.sessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      return { ok: false, error: "Missing session id for this agent" };
    }
    return window.electronAPI.answerAgentQuestionInSession(
      targetSessionId,
      agent.id,
      answers,
      appConfig,
    );
  }, [appConfig, selectedSessionId, session.sessionId]);

  const handleAnswerAgentToolApproval = useCallback(async (agent: Agent, response: AgentToolApprovalResponse) => {
    const targetSessionId = agent.sessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      return { ok: false, error: "Missing session id for this agent" };
    }
    return window.electronAPI.respondAgentToolApprovalInSession(
      targetSessionId,
      agent.id,
      response,
      appConfig,
    );
  }, [appConfig, selectedSessionId, session.sessionId]);

  const handleCancelAgent = useCallback(async (agentId: string) => {
    await window.electronAPI.cancelAgent(agentId);
  }, []);

  const handleToggleTranslation = useCallback(async () => {
    await window.electronAPI.toggleTranslation();
  }, []);

  const handleAppConfigChange = useCallback((next: AppConfig) => {
    const prev = storedAppConfig;
    const normalized = normalizeAppConfig(next);
    setStoredAppConfig(normalized);
    const modelChanged =
      prev.analysisModelId !== normalized.analysisModelId ||
      prev.analysisProvider !== normalized.analysisProvider ||
      prev.taskModelId !== normalized.taskModelId ||
      prev.utilityModelId !== normalized.utilityModelId ||
      prev.synthesisModelId !== normalized.synthesisModelId ||
      prev.transcriptionProvider !== normalized.transcriptionProvider ||
      prev.transcriptionModelId !== normalized.transcriptionModelId;
    if (modelChanged && sessionActive) {
      setSessionRestartKey((k) => k + 1);
    }
  }, [setStoredAppConfig, storedAppConfig, sessionActive]);

  const handleAcceptSummaryItems = useCallback((
    items: Array<{
      text: string;
      details?: string;
      source?: "agreement" | "missed" | "question" | "action";
      userIntent?: string;
    }>,
  ) => {
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) return;
    void (async () => {
      for (const { text, details, source, userIntent } of items) {
        const trimmed = text.trim();
        if (!trimmed) continue;
        const trimmedUserIntent = userIntent?.trim();

        const placeholderText = normalizeAgentTaskTitle(trimmed) || trimmed;
        const optimisticId = crypto.randomUUID();
        const optimisticTask: TaskItem = {
          id: optimisticId,
          text: placeholderText,
          details: details?.trim() || undefined,
          size: "large",
          completed: false,
          source: "ai",
          createdAt: Date.now(),
          sessionId: targetSessionId,
        };

        setTasks((prev) => [optimisticTask, ...prev]);
        setProcessingTaskIds((prev) => [optimisticId, ...prev]);

        let refinedTitle = trimmed;
        let refinedDetails = details?.trim() || undefined;

        const extractResult = await window.electronAPI.extractTaskFromSelectionInSession(
          targetSessionId,
          buildSummarySelectionText({ text: trimmed, details, source }),
          buildSummaryTaskIntent(trimmedUserIntent, source),
          appConfig,
        );

        if (extractResult.ok && extractResult.taskTitle?.trim()) {
          refinedTitle = extractResult.taskTitle.trim();
          const extractedDetails = extractResult.taskDetails?.trim();
          const mergedDetails = [
            trimmedUserIntent ? `Requested outcome:\n${trimmedUserIntent}` : "",
            extractedDetails ? `Task context:\n${extractedDetails}` : "",
          ].filter(Boolean);
          refinedDetails = mergedDetails.length > 0
            ? mergedDetails.join("\n\n")
            : refinedDetails;
        }

        const finalTitle = normalizeAgentTaskTitle(refinedTitle) || placeholderText;
        const result = await persistTask({
          targetSessionId,
          text: finalTitle,
          details: refinedDetails,
          source: "ai",
          id: optimisticId,
          createdAt: optimisticTask.createdAt,
        });
        setProcessingTaskIds((prev) => prev.filter((id) => id !== optimisticId));
        if (!result.ok) {
          setTasks((prev) => prev.filter((t) => t.id !== optimisticId));
        } else {
          setTasks((prev) => prev.map((t) => (t.id === optimisticId ? result.task! : t)));
        }
      }
    })();
  }, [appConfig, persistTask, selectedSessionId, session.sessionId]);

  const handleGenerateSummary = useCallback(async () => {
    if (finalSummaryState.kind === "loading") return;
    if (finalSummaryState.kind === "ready") return;
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    setFinalSummaryState({ kind: "loading" });
    if (targetSessionId) {
      const cached = await window.electronAPI.getFinalSummary(targetSessionId);
      if (
        cached.ok &&
        cached.summary &&
        cached.summary.modelId === appConfig.synthesisModelId
      ) {
        setFinalSummaryState({ kind: "ready", summary: cached.summary });
        return;
      }
    }
    void window.electronAPI.generateFinalSummary();
  }, [appConfig.synthesisModelId, finalSummaryState.kind, selectedSessionId, session.sessionId]);

  const handleRegenerateSummary = useCallback(() => {
    if (finalSummaryState.kind === "loading") return;
    setFinalSummaryState({ kind: "loading" });
    void window.electronAPI.generateFinalSummary();
  }, [finalSummaryState.kind]);

  useKeyboard({
    onToggleRecording: sessionActive ? session.toggleRecording : handleStart,
    onQuit: sessionActive ? handleStop : () => window.close(),
    onScrollUp: sessionActive ? scrollUp : undefined,
    onScrollDown: sessionActive ? scrollDown : undefined,
    onGenerateSummary: sessionActive ? handleGenerateSummary : undefined,
  });

  useEffect(() => {
    if (!selectedAgent) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        selectAgent(null);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectAgent, selectedAgent]);

  const educationalInsights = useMemo(
    () => insights.filter((i) => i.kind !== "key-point"),
    [insights],
  );
  const visibleSessions = activeProjectId
    ? sessions.filter((s) => s.projectId === activeProjectId)
    : sessions;

  if (!splashDone) {
    return (
      <div className="flex flex-col h-screen">
        <SplashScreen onComplete={handleSplashComplete} />
      </div>
    );
  }

  return (
    <div className="aqua-window-shell flex flex-col h-screen bg-background">
      <ToolbarHeader
        languages={languages}
        sourceLang={sourceLang}
        targetLang={targetLang}
        onSourceLangChange={(lang) => { setSourceLang(lang); setLangError(""); }}
        onTargetLangChange={(lang) => { setTargetLang(lang); setLangError(""); }}
        sessionActive={sessionActive}
        onStart={handleStart}
        onNewSession={handleNewSession}
        onTogglePause={session.toggleRecording}
        uiState={session.uiState}
        langError={langError}
        onToggleTranslation={handleToggleTranslation}
        onToggleMic={handleToggleMic}
        onEndSession={sessionActive ? handleStop : undefined}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((prev) => !prev)}
      />

      <div ref={panelLayoutRef} className="aqua-main-panel flex flex-1 min-h-0">
        {settingsOpen ? (
          <SettingsPage
            config={appConfig}
            languages={languages}
            sourceLang={sourceLang}
            targetLang={targetLang}
            onSourceLangChange={(lang) => { setSourceLang(lang); setLangError(""); }}
            onTargetLangChange={(lang) => { setTargetLang(lang); setLangError(""); }}
            isRecording={session.uiState?.status === "recording" || session.uiState?.status === "connecting"}
            onConfigChange={handleAppConfigChange}
            onReset={() => setStoredAppConfig(DEFAULT_APP_CONFIG)}
            mcpIntegrations={mcpIntegrations}
            mcpBusy={mcpBusy}
            onConnectNotionMcp={handleConnectNotionMcp}
            onDisconnectNotionMcp={handleDisconnectNotionMcp}
            onSetLinearToken={handleSetLinearToken}
            onClearLinearToken={handleClearLinearToken}
            customMcpServers={customMcpServers}
            onAddCustomServer={handleAddCustomServer}
            onRemoveCustomServer={handleRemoveCustomServer}
            onConnectCustomServer={handleConnectCustomServer}
            onDisconnectCustomServer={handleDisconnectCustomServer}
            mcpToolsByProvider={mcpToolsByProvider}
          />
        ) : (
          <>
            <div className="shrink-0 min-h-0" style={{ width: leftPanelWidth }}>
              <LeftSidebar
                rollingKeyPoints={session.rollingKeyPoints}
                insights={educationalInsights}
                sessions={visibleSessions}
                activeSessionId={selectedSessionId}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                projects={projects}
                activeProjectId={activeProjectId}
                onSelectProject={handleSelectProject}
                onCreateProject={(name, instructions) => void handleCreateProject(name, instructions)}
                onEditProject={(project) => void handleEditProject(project)}
                onDeleteProject={(id) => void handleDeleteProject(id)}
                onMoveSessionToProject={(sessionId, projectId) => void handleMoveSessionToProject(sessionId, projectId)}
              />
            </div>
            <div
              role="separator"
              aria-label="Resize left panel"
              aria-orientation="vertical"
              className="aqua-resizer group relative w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border/50"
              onMouseDown={handleResizeMouseDown("left")}
            >
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 transition-colors group-hover:bg-foreground/30" />
            </div>
            <MiddlePanelTabs
              summaryState={finalSummaryState}
              hasAgent={!!selectedAgent || newAgentMode}
              selectedAgent={selectedAgent}
              agents={agents}
              onCloseAgent={() => {
                selectAgent(null);
                setNewAgentMode(false);
              }}
              onGenerateSummary={handleGenerateSummary}
              transcriptContent={
                <TranscriptArea
                  ref={transcriptRef}
                  blocks={session.blocks}
                  systemPartial={session.systemPartial}
                  micPartial={session.micPartial}
                  canTranslate={session.uiState?.canTranslate ?? false}
                  translationEnabled={session.uiState?.translationEnabled ?? false}
                  onAddTranscriptRef={handleAddTranscriptRef}
                />
              }
              summaryContent={
                <SessionSummaryPanel
                  state={finalSummaryState}
                  onClose={() => setFinalSummaryState({ kind: "idle" })}
                  onAcceptItems={handleAcceptSummaryItems}
                  onRegenerate={handleRegenerateSummary}
                  asTabbedPanel
                />
              }
              agentContent={
                newAgentMode ? (
                  <NewAgentPanel
                    onLaunch={handleLaunchCustomAgent}
                    onClose={() => setNewAgentMode(false)}
                  />
                ) : selectedAgent ? (
                  <AgentDetailPanel
                    agent={selectedAgent}
                    agents={agents}
                    onSelectAgent={selectAgent}
                    onClose={() => selectAgent(null)}
                    onFollowUp={handleFollowUp}
                    onAnswerQuestion={handleAnswerAgentQuestion}
                    onAnswerToolApproval={handleAnswerAgentToolApproval}
                    onCancel={handleCancelAgent}
                    onRelaunch={handleRelaunchAgent}
                    onArchive={handleArchiveAgent}
                  />
                ) : null
              }
            />
            <div
              role="separator"
              aria-label="Resize right panel"
              aria-orientation="vertical"
              className="aqua-resizer group relative w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border/50"
              onMouseDown={handleResizeMouseDown("right")}
            >
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 transition-colors group-hover:bg-foreground/30" />
            </div>
            <div className="shrink-0 min-h-0" style={{ width: rightPanelWidth }}>
              <RightSidebar
                tasks={tasks}
                suggestions={suggestions}
                agents={agents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={selectAgent}
                onLaunchAgent={handleLaunchAgent}
                onNewAgent={handleNewAgent}
                onAddTask={handleAddTaskFromDebrief}
                onToggleTask={handleToggleTask}
                onDeleteTask={handleDeleteTask}
                onUpdateTask={handleUpdateTask}
                processingTaskIds={processingTaskIds}
                onAcceptSuggestion={handleAcceptSuggestion}
                onDismissSuggestion={handleDismissSuggestion}
                sessionId={selectedSessionId ?? session.sessionId ?? undefined}
                synthesisModelId={appConfig.synthesisModelId}
                sessionActive={sessionActive}
                transcriptRefs={transcriptRefs}
                onRemoveTranscriptRef={handleRemoveTranscriptRef}
                onSubmitTaskInput={handleSubmitTaskInput}
              />
            </div>
          </>
        )}
      </div>

      <Dialog
        open={!!pendingApprovalTask}
        onOpenChange={(open) => {
          if (!open && !approvingLargeTask) {
            setPendingApprovalTask(null);
          }
        }}
      >
        <DialogContent showCloseButton={!approvingLargeTask}>
          <DialogHeader>
            <DialogTitle>Approve Large Task</DialogTitle>
            <DialogDescription>
              This task was classified as large and needs human approval before the agent can run.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-sm border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
            {pendingApprovalTask?.text}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={approvingLargeTask}
              onClick={() => setPendingApprovalTask(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={approvingLargeTask}
              onClick={() => void handleApproveLargeTask()}
            >
              {approvingLargeTask ? "Approving..." : "Approve & Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {routeNotice && (
        <div className="px-4 py-2 text-muted-foreground text-xs border-t border-border bg-muted/40">
          {routeNotice}
        </div>
      )}

      {session.errorText && (
        <div className="px-4 py-2 text-destructive text-xs border-t border-destructive/20 bg-destructive/5">
          {session.errorText}
        </div>
      )}

      <Footer
        sessionActive={sessionActive}
        statusText={session.statusText}
        onQuit={sessionActive ? handleStop : () => window.close()}
      />
    </div>
  );
}
