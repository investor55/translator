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
  TodoItem,
  TodoSuggestion,
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

type ResizeHandle = "left" | "agent" | "right";

const MIN_TRANSCRIPT_WIDTH = 360;
const LEFT_PANEL_MIN_WIDTH = 220;
const LEFT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_MIN_WIDTH = 240;
const RIGHT_PANEL_MAX_WIDTH = 560;
const AGENT_PANEL_MIN_WIDTH = 280;
const AGENT_PANEL_MAX_WIDTH = 680;

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function buildAiSuggestionDetails(suggestion: TodoSuggestion): string | undefined {
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
    startAgent: number;
    hasAgent: boolean;
  } | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useLocalStorage<number>("ambient-left-panel-width", 280);
  const [rightPanelWidth, setRightPanelWidth] = useLocalStorage<number>("ambient-right-panel-width", 300);
  const [agentPanelWidth, setAgentPanelWidth] = useLocalStorage<number>("ambient-agent-panel-width", 360);
  const appConfig = useMemo(() => normalizeAppConfig(storedAppConfig), [storedAppConfig]);

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [pendingApprovalTodo, setPendingApprovalTodo] = useState<TodoItem | null>(null);
  const [approvingLargeTodo, setApprovingLargeTodo] = useState(false);
  const [suggestions, setSuggestions] = useState<TodoSuggestion[]>([]);
  const [processingTodoIds, setProcessingTodoIds] = useState<string[]>([]);
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
  const { agents, selectedAgentId, selectedAgent, selectAgent, seedAgents } = useAgents();

  const handleResumed = useCallback((data: ResumeData) => {
    setSelectedSessionId(data.sessionId);
    setTodos(data.todos);
    setProcessingTodoIds([]);
    setInsights(data.insights);
    seedAgents(data.agents);
    setFinalSummaryState({ kind: "idle" });
    void refreshSessions();
    void window.electronAPI.getFinalSummary(data.sessionId).then((result) => {
      if (result.ok && result.summary) {
        setFinalSummaryState({ kind: "ready", summary: result.summary });
      }
    });
  }, [refreshSessions, seedAgents]);

  const session = useSession(
    sourceLang,
    targetLang,
    sessionActive,
    appConfig,
    resumeSessionId,
    { onResumed: handleResumed, projectId: activeProjectId },
    sessionRestartKey,
  );

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
      setTodos([]);
      setProcessingTodoIds([]);
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
      setTodos([]);
      setProcessingTodoIds([]);
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
    setTodos([]);
    setProcessingTodoIds([]);
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

  useThemeMode(appConfig.themeMode, appConfig.lightVariant, appConfig.fontSize, appConfig.fontFamily);

  const appendSuggestions = useCallback((incoming: TodoSuggestion[]) => {
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

  const handleTodoSuggested = useCallback((suggestion: TodoSuggestion) => {
    appendSuggestions([suggestion]);
  }, [appendSuggestions]);

  const handleInsightAdded = useCallback((insight: Insight) => {
    setInsights((prev) => [...prev, insight]);
  }, []);

  const handleFinalSummaryReady = useCallback((summary: FinalSummary) => {
    setFinalSummaryState({ kind: "ready", summary });
  }, []);

  const handleFinalSummaryError = useCallback((error: string) => {
    setFinalSummaryState({ kind: "error", message: error });
  }, []);

  // Keep these listeners active so todo suggestions and insights stream into the UI.
  useSessionEventStream({
    onTodoSuggested: handleTodoSuggested,
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
    setTodos([]);
    setProcessingTodoIds([]);
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
    setTodos([]);
    setProcessingTodoIds([]);
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
      startAgent: agentPanelWidth,
      hasAgent: !!selectedAgent,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [agentPanelWidth, leftPanelWidth, rightPanelWidth, selectedAgent]);

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
          - (activeResize.hasAgent ? activeResize.startAgent : 0)
          - MIN_TRANSCRIPT_WIDTH;
        setLeftPanelWidth(Math.round(clampWidth(
          activeResize.startLeft + delta,
          LEFT_PANEL_MIN_WIDTH,
          Math.min(LEFT_PANEL_MAX_WIDTH, maxLeft),
        )));
      } else if (activeResize.handle === "right") {
        const maxRight = totalWidth
          - activeResize.startLeft
          - (activeResize.hasAgent ? activeResize.startAgent : 0)
          - MIN_TRANSCRIPT_WIDTH;
        setRightPanelWidth(Math.round(clampWidth(
          activeResize.startRight - delta,
          RIGHT_PANEL_MIN_WIDTH,
          Math.min(RIGHT_PANEL_MAX_WIDTH, maxRight),
        )));
      } else if (activeResize.handle === "agent" && activeResize.hasAgent) {
        const maxAgent = totalWidth
          - activeResize.startLeft
          - activeResize.startRight
          - MIN_TRANSCRIPT_WIDTH;
        setAgentPanelWidth(Math.round(clampWidth(
          activeResize.startAgent - delta,
          AGENT_PANEL_MIN_WIDTH,
          Math.min(AGENT_PANEL_MAX_WIDTH, maxAgent),
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
  }, [endResize, setAgentPanelWidth, setLeftPanelWidth, setRightPanelWidth]);

  useEffect(() => {
    if (settingsOpen) return;

    const clampPanelsToLayout = () => {
      const layoutEl = panelLayoutRef.current;
      if (!layoutEl) return;

      const totalWidth = layoutEl.getBoundingClientRect().width;
      if (totalWidth <= 0) return;

      const hasAgent = !!selectedAgent;
      let nextLeft = clampWidth(leftPanelWidth, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH);
      let nextRight = clampWidth(rightPanelWidth, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH);
      let nextAgent = clampWidth(agentPanelWidth, AGENT_PANEL_MIN_WIDTH, AGENT_PANEL_MAX_WIDTH);

      let overflow = nextLeft + nextRight + (hasAgent ? nextAgent : 0) - (totalWidth - MIN_TRANSCRIPT_WIDTH);
      if (overflow > 0) {
        const consumeOverflow = (current: number, min: number) => {
          const spare = Math.max(0, current - min);
          const reduction = Math.min(spare, overflow);
          overflow -= reduction;
          return current - reduction;
        };
        nextRight = consumeOverflow(nextRight, RIGHT_PANEL_MIN_WIDTH);
        if (hasAgent) {
          nextAgent = consumeOverflow(nextAgent, AGENT_PANEL_MIN_WIDTH);
        }
        nextLeft = consumeOverflow(nextLeft, LEFT_PANEL_MIN_WIDTH);
      }

      if (nextLeft !== leftPanelWidth) setLeftPanelWidth(nextLeft);
      if (nextRight !== rightPanelWidth) setRightPanelWidth(nextRight);
      if (nextAgent !== agentPanelWidth) setAgentPanelWidth(nextAgent);
    };

    clampPanelsToLayout();
    window.addEventListener("resize", clampPanelsToLayout);
    return () => window.removeEventListener("resize", clampPanelsToLayout);
  }, [
    agentPanelWidth,
    leftPanelWidth,
    rightPanelWidth,
    selectedAgent,
    settingsOpen,
    setAgentPanelWidth,
    setLeftPanelWidth,
    setRightPanelWidth,
  ]);

  const persistTodo = useCallback(async ({
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
    source: TodoItem["source"];
    id?: string;
    createdAt?: number;
  }): Promise<{ ok: boolean; todo?: TodoItem; error?: string }> => {
    const todo: TodoItem = {
      id: id ?? crypto.randomUUID(),
      text,
      details,
      size: "large",
      completed: false,
      source,
      createdAt: createdAt ?? Date.now(),
      sessionId: targetSessionId,
    };
    const result = await window.electronAPI.addTodo(todo, appConfig);
    if (!result.ok) {
      return { ok: false, error: result.error ?? "Unknown error" };
    }
    return { ok: true, todo: result.todo ?? todo };
  }, [appConfig]);

  const handleAddTodo = useCallback(async (text: string, details?: string) => {
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      setRouteNotice("Select or start a session before adding todos.");
      return false;
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      return false;
    }

    const optimisticId = crypto.randomUUID();
    const optimisticTodo: TodoItem = {
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
    setTodos((prev) => [optimisticTodo, ...prev]);
    setProcessingTodoIds((prev) => (prev.includes(optimisticId) ? prev : [optimisticId, ...prev]));

    const result = await persistTodo({
      targetSessionId,
      text: trimmedText,
      details,
      source: "manual",
      id: optimisticId,
      createdAt: optimisticTodo.createdAt,
    });

    setProcessingTodoIds((prev) => prev.filter((id) => id !== optimisticId));
    if (!result.ok) {
      setTodos((prev) => prev.filter((todo) => todo.id !== optimisticId));
      setRouteNotice(`Failed to add todo: ${result.error ?? "Unknown error"}`);
      return false;
    }

    setTodos((prev) =>
      prev.map((todo) => (todo.id === optimisticId ? result.todo! : todo))
    );
    return true;
  }, [persistTodo, selectedSessionId, session.sessionId]);

  const handleCreateTodoFromSelection = useCallback(async (selectionText: string, userIntentText?: string) => {
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      const message = "Select or start a session before creating todos.";
      setRouteNotice(message);
      return { ok: false, message };
    }

    const placeholderId = `processing-${crypto.randomUUID()}`;
    const trimmedIntent = userIntentText?.trim() ?? "";
    const placeholderTodo: TodoItem = {
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
    setTodos((prev) => [placeholderTodo, ...prev]);
    setProcessingTodoIds((prev) => [placeholderId, ...prev]);
    setRouteNotice("Processing highlighted text into a todo...");

    void (async () => {
      const finalizeProcessing = () => {
        setProcessingTodoIds((prev) => prev.filter((id) => id !== placeholderId));
      };
      const removePlaceholder = () => {
        setTodos((prev) => prev.filter((todo) => todo.id !== placeholderId));
      };

      const extractResult = await window.electronAPI.extractTodoFromSelectionInSession(
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

      if (!extractResult.todoTitle) {
        removePlaceholder();
        finalizeProcessing();
        setRouteNotice(extractResult.reason ?? "No actionable todo found in selection.");
        return;
      }

      const persistResult = await persistTodo({
        targetSessionId,
        text: extractResult.todoTitle,
        details: [
          trimmedIntent
            ? `Requested todo intent:\n${trimmedIntent}`
            : "",
          extractResult.todoDetails?.trim()
            ? `Context summary:\n${extractResult.todoDetails.trim()}`
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
        setRouteNotice(`Failed to add todo: ${persistResult.error ?? "Unknown error"}`);
        return;
      }

      setTodos((prev) => [
        persistResult.todo!,
        ...prev.filter((todo) => todo.id !== placeholderId),
      ]);
      finalizeProcessing();
      setRouteNotice(`Todo created: ${persistResult.todo!.text}`);
    })();

    return { ok: true };
  }, [appConfig, persistTodo, selectedSessionId, session.sessionId]);

  const [transcriptRefs, setTranscriptRefs] = useState<string[]>([]);

  const handleAddTranscriptRef = useCallback((text: string) => {
    setTranscriptRefs((prev) => [...prev, text]);
  }, []);

  const handleRemoveTranscriptRef = useCallback((index: number) => {
    setTranscriptRefs((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmitTodoInput = useCallback(async (intentText: string, refs: string[]) => {
    const trimmedIntent = intentText.trim();
    if (!trimmedIntent && refs.length === 0) return;
    // Always route through AI extraction so todos get a proper title + context summary.
    // When refs exist, they are the "selection" and intentText is the user's framing.
    // When there are no refs, the typed text itself becomes the selection to extract from.
    const selectionText = refs.length > 0 ? refs.join("\n\n---\n\n") : trimmedIntent;
    await handleCreateTodoFromSelection(selectionText, refs.length > 0 ? (trimmedIntent || undefined) : undefined);
    setTranscriptRefs([]);
  }, [handleCreateTodoFromSelection]);

  const handleToggleTodo = useCallback((id: string) => {
    if (processingTodoIds.includes(id)) {
      return;
    }
    setTodos((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, completed: !t.completed, completedAt: !t.completed ? Date.now() : undefined }
          : t
      )
    );
    window.electronAPI.toggleTodo(id);
  }, [processingTodoIds]);

  const handleDeleteTodo = useCallback(async (id: string) => {
    if (processingTodoIds.includes(id)) {
      setProcessingTodoIds((prev) => prev.filter((itemId) => itemId !== id));
      setTodos((prev) => prev.filter((todo) => todo.id !== id));
      return;
    }

    let removedTodo: TodoItem | undefined;
    setTodos((prev) => {
      removedTodo = prev.find((todo) => todo.id === id);
      return prev.filter((todo) => todo.id !== id);
    });

    const result = await window.electronAPI.deleteTodo(id);
    if (result.ok) {
      setRouteNotice("");
      return;
    }

    if (removedTodo) {
      setTodos((prev) => [removedTodo!, ...prev]);
    }
    setRouteNotice(`Failed to delete todo: ${result.error ?? "Unknown error"}`);
  }, [processingTodoIds]);

  const handleUpdateTodo = useCallback(async (id: string, text: string) => {
    setTodos((prev) => prev.map((t) => t.id === id ? { ...t, text } : t));
    const result = await window.electronAPI.updateTodoText(id, text);
    if (!result.ok) {
      setRouteNotice(`Failed to update todo: ${result.error ?? "Unknown error"}`);
    }
  }, []);


  const handleAcceptSuggestion = useCallback(async (suggestion: TodoSuggestion) => {
    const targetSessionId = suggestion.sessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      setRouteNotice("Missing session id for suggestion.");
      return;
    }
    const suggestionDetails = buildAiSuggestionDetails(suggestion);

    const optimisticTodo: TodoItem = {
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
    setTodos((prev) => [optimisticTodo, ...prev.filter((todo) => todo.id !== suggestion.id)]);
    setProcessingTodoIds((prev) => (prev.includes(suggestion.id) ? prev : [suggestion.id, ...prev]));

    const result = await persistTodo({
      targetSessionId,
      text: suggestion.text,
      details: suggestionDetails,
      source: "ai",
      id: suggestion.id,
      createdAt: suggestion.createdAt,
    });

    setProcessingTodoIds((prev) => prev.filter((id) => id !== suggestion.id));
    if (!result.ok) {
      setTodos((prev) => prev.filter((todo) => todo.id !== suggestion.id));
      setSuggestions((prev) => [suggestion, ...prev.filter((item) => item.id !== suggestion.id)]);
      setRouteNotice(`Failed to add todo from suggestion: ${result.error ?? "Unknown error"}`);
      return;
    }

    setTodos((prev) =>
      prev.map((todo) => (todo.id === suggestion.id ? result.todo! : todo))
    );
    if (result.todo!.size === "large") {
      setRouteNotice("Suggestion accepted as large. Approval is required before running the agent.");
    }
  }, [persistTodo, selectedSessionId, session.sessionId]);

  const handleDismissSuggestion = useCallback((id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const launchTodoAgent = useCallback(async (todo: TodoItem, approvalToken?: string) => {
    const todoSessionId = todo.sessionId ?? null;
    const targetSessionId = todoSessionId ?? selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      setRouteNotice("Missing session id for this task.");
      return false;
    }

    const useActiveRuntime = sessionActive && session.sessionId === targetSessionId;
    const result = useActiveRuntime
      ? await window.electronAPI.launchAgent(todo.id, todo.text, todo.details, approvalToken)
      : await window.electronAPI.launchAgentInSession(
          targetSessionId,
          todo.id,
          todo.text,
          todo.details,
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

  const handleLaunchAgent = useCallback(async (todo: TodoItem) => {
    if (processingTodoIds.includes(todo.id)) {
      setRouteNotice("Todo is still processing. Wait a moment before launching.");
      return;
    }
    if (todo.size === "large") {
      setPendingApprovalTodo(todo);
      return;
    }
    await launchTodoAgent(todo);
  }, [launchTodoAgent, processingTodoIds]);

  const handleArchiveAgent = useCallback(async (agent: Agent) => {
    await window.electronAPI.archiveAgent(agent.id);
  }, []);

  const handleRelaunchAgent = useCallback(async (agent: Agent) => {
    const result = await window.electronAPI.relaunchAgent(agent.id);
    if (!result.ok) {
      setRouteNotice(`Failed to relaunch agent: ${result.error ?? "Unknown error"}`);
    }
  }, []);

  const handleApproveLargeTodo = useCallback(async () => {
    if (!pendingApprovalTodo) return;
    setApprovingLargeTodo(true);
    const approval = await window.electronAPI.approveLargeTodo(pendingApprovalTodo.id);
    if (!approval.ok || !approval.approvalToken) {
      setApprovingLargeTodo(false);
      setRouteNotice(`Failed to approve large todo: ${approval.error ?? "Unknown error"}`);
      return;
    }

    const launched = await launchTodoAgent(pendingApprovalTodo, approval.approvalToken);
    setApprovingLargeTodo(false);
    if (launched) {
      setPendingApprovalTodo(null);
    }
  }, [launchTodoAgent, pendingApprovalTodo]);

  const handleSelectSession = useCallback((sessionId: string) => {
    micCapture.stop();
    setSettingsOpen(false);
    setRouteNotice("");
    pushSessionPath(sessionId);
    setSelectedSessionId(sessionId);
    setResumeSessionId(sessionId);
    setSuggestions([]);
    setTodos([]);
    setProcessingTodoIds([]);
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
      setTodos([]);
      setProcessingTodoIds([]);
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
    setStoredAppConfig(normalizeAppConfig(next));
  }, [setStoredAppConfig]);

  const handleAcceptSummaryItems = useCallback((items: Array<{ text: string; details?: string }>) => {
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    if (!targetSessionId) return;
    void (async () => {
      for (const { text, details } of items) {
        const trimmed = text.trim();
        if (!trimmed) continue;
        const optimisticId = crypto.randomUUID();
        const optimisticTodo: TodoItem = {
          id: optimisticId,
          text: trimmed,
          details,
          size: "large",
          completed: false,
          source: "ai",
          createdAt: Date.now(),
          sessionId: targetSessionId,
        };
        setTodos((prev) => [optimisticTodo, ...prev]);
        setProcessingTodoIds((prev) => [optimisticId, ...prev]);
        const result = await persistTodo({ targetSessionId, text: trimmed, details, source: "ai", id: optimisticId, createdAt: optimisticTodo.createdAt });
        setProcessingTodoIds((prev) => prev.filter((id) => id !== optimisticId));
        if (!result.ok) {
          setTodos((prev) => prev.filter((t) => t.id !== optimisticId));
        } else {
          setTodos((prev) => prev.map((t) => (t.id === optimisticId ? result.todo! : t)));
        }
      }
    })();
  }, [persistTodo, selectedSessionId, session.sessionId]);

  const handleGenerateSummary = useCallback(async () => {
    if (finalSummaryState.kind === "loading") return;
    if (finalSummaryState.kind === "ready") return;
    const targetSessionId = selectedSessionId ?? session.sessionId ?? null;
    setFinalSummaryState({ kind: "loading" });
    if (targetSessionId) {
      const cached = await window.electronAPI.getFinalSummary(targetSessionId);
      if (cached.ok && cached.summary) {
        setFinalSummaryState({ kind: "ready", summary: cached.summary });
        return;
      }
    }
    void window.electronAPI.generateFinalSummary();
  }, [finalSummaryState.kind, selectedSessionId, session.sessionId]);

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

  const educationalInsights = insights.filter((i) => i.kind !== "key-point");
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
    <div className="flex flex-col h-screen bg-background">
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
        onGenerateSummary={sessionActive ? handleGenerateSummary : undefined}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((prev) => !prev)}
      />

      <div ref={panelLayoutRef} className="flex flex-1 min-h-0">
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
              />
            </div>
            <div
              role="separator"
              aria-label="Resize left panel"
              aria-orientation="vertical"
              className="group relative w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border/50"
              onMouseDown={handleResizeMouseDown("left")}
            >
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 transition-colors group-hover:bg-foreground/30" />
            </div>
            <main className="flex-1 flex flex-col min-h-0 min-w-0 relative">
              <TranscriptArea
                ref={transcriptRef}
                blocks={session.blocks}
                systemPartial={session.systemPartial}
                micPartial={session.micPartial}
                canTranslate={session.uiState?.canTranslate ?? false}
                onAddTranscriptRef={handleAddTranscriptRef}
              />
              <SessionSummaryPanel
                state={finalSummaryState}
                onClose={() => setFinalSummaryState({ kind: "idle" })}
                onAcceptItems={handleAcceptSummaryItems}
                onRegenerate={handleRegenerateSummary}
              />
            </main>
            {selectedAgent && (
              <>
                <div
                  role="separator"
                  aria-label="Resize transcript and agent panels"
                  aria-orientation="vertical"
                  className="group relative w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border/50"
                  onMouseDown={handleResizeMouseDown("agent")}
                >
                  <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 transition-colors group-hover:bg-foreground/30" />
                </div>
                <div className="shrink-0 min-h-0" style={{ width: agentPanelWidth }}>
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
                </div>
              </>
            )}
            <div
              role="separator"
              aria-label="Resize right panel"
              aria-orientation="vertical"
              className="group relative w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border/50"
              onMouseDown={handleResizeMouseDown("right")}
            >
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 transition-colors group-hover:bg-foreground/30" />
            </div>
            <div className="shrink-0 min-h-0" style={{ width: rightPanelWidth }}>
              <RightSidebar
                todos={todos}
                suggestions={suggestions}
                agents={agents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={selectAgent}
                onLaunchAgent={handleLaunchAgent}
                onAddTodo={handleAddTodo}
                onToggleTodo={handleToggleTodo}
                onDeleteTodo={handleDeleteTodo}
                onUpdateTodo={handleUpdateTodo}
                processingTodoIds={processingTodoIds}
                onAcceptSuggestion={handleAcceptSuggestion}
                onDismissSuggestion={handleDismissSuggestion}
                sessionId={selectedSessionId ?? session.sessionId ?? undefined}
                transcriptRefs={transcriptRefs}
                onRemoveTranscriptRef={handleRemoveTranscriptRef}
                onSubmitTodoInput={handleSubmitTodoInput}
              />
            </div>
          </>
        )}
      </div>

      <Dialog
        open={!!pendingApprovalTodo}
        onOpenChange={(open) => {
          if (!open && !approvingLargeTodo) {
            setPendingApprovalTodo(null);
          }
        }}
      >
        <DialogContent showCloseButton={!approvingLargeTodo}>
          <DialogHeader>
            <DialogTitle>Approve Large Todo</DialogTitle>
            <DialogDescription>
              This todo was classified as large and needs human approval before the agent can run.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-sm border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
            {pendingApprovalTodo?.text}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={approvingLargeTodo}
              onClick={() => setPendingApprovalTodo(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={approvingLargeTodo}
              onClick={() => void handleApproveLargeTodo()}
            >
              {approvingLargeTodo ? "Approving..." : "Approve & Run"}
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

      <Footer sessionActive={sessionActive} statusText={session.statusText} />
    </div>
  );
}
