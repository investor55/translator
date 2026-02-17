import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { Agent, AppConfig, Language, LanguageCode, TodoItem, TodoSuggestion, Insight, SessionMeta } from "../../core/types";
import { DEFAULT_APP_CONFIG, normalizeAppConfig } from "../../core/types";
import { useSession } from "./hooks/use-session";
import type { ResumeData } from "./hooks/use-session";
import { useMicCapture } from "./hooks/use-mic-capture";
import { useAgents } from "./hooks/use-agents";
import { useKeyboard } from "./hooks/use-keyboard";
import { ToolbarHeader } from "./components/toolbar-header";
import { TranscriptArea } from "./components/transcript-area";
import { LeftSidebar } from "./components/left-sidebar";
import { RightSidebar } from "./components/right-sidebar";
import { AgentDetailPanel } from "./components/agent-detail-panel";
import { Footer } from "./components/footer";
import { SettingsPage } from "./components/settings-page";

function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onComplete, 600);
    }, 1400);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div
      className={`flex-1 flex items-center justify-center bg-[#0a0a0a] transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <h1 className="font-serif text-[clamp(4rem,12vw,8rem)] font-normal text-[#e8e4dc] leading-[0.9] tracking-[-0.02em]">
        Ambient
      </h1>
    </div>
  );
}

export function App() {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [sourceLang, setSourceLang] = useLocalStorage<LanguageCode>("rosetta-source-lang", "ko");
  const [targetLang, setTargetLang] = useLocalStorage<LanguageCode>("rosetta-target-lang", "en");
  const [storedAppConfig, setStoredAppConfig] = useLocalStorage<AppConfig>("rosetta-app-config", DEFAULT_APP_CONFIG);
  const [sessionActive, setSessionActive] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [langError, setLangError] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const appConfig = useMemo(() => normalizeAppConfig(storedAppConfig), [storedAppConfig]);

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [suggestions, setSuggestions] = useState<TodoSuggestion[]>([]);
  const [scanningTodos, setScanningTodos] = useState(false);
  const [scanFeedback, setScanFeedback] = useState("");
  const [insights, setInsights] = useState<Insight[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.getSessions().then((loaded) => {
      setSessions(loaded);
      const last = loaded[0];
      if (last?.sourceLang) setSourceLang(last.sourceLang);
      if (last?.targetLang) setTargetLang(last.targetLang);
    });
  }, []);

  const micCapture = useMicCapture();
  const { agents, selectedAgentId, selectedAgent, selectAgent, seedAgents } = useAgents();

  const handleResumed = useCallback((data: ResumeData) => {
    setTodos(data.todos);
    setInsights(data.insights);
    seedAgents(data.agents);
  }, [seedAgents]);

  const session = useSession(sourceLang, targetLang, sessionActive, appConfig, resumeSessionId, { onResumed: handleResumed });

  useEffect(() => {
    window.electronAPI.getLanguages().then(setLanguages);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      document.documentElement.classList.remove("dark");
      document.body.classList.remove("dark");
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const shouldUseDark =
        appConfig.themeMode === "dark" ||
        (appConfig.themeMode === "system" && media.matches);
      document.documentElement.classList.toggle("dark", shouldUseDark);
      document.body.classList.toggle("dark", shouldUseDark);
    };

    applyTheme();
    if (appConfig.themeMode !== "system") return;
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", applyTheme);
      return () => media.removeEventListener("change", applyTheme);
    }
    media.addListener(applyTheme);
    return () => media.removeListener(applyTheme);
  }, [appConfig.themeMode]);

  useEffect(() => {
    const status = session.statusText?.trim();
    if (!status) return;
    if (status.toLowerCase().startsWith("todo scan")) {
      setScanFeedback(status);
      if (
        status.toLowerCase().includes("complete")
        || status.toLowerCase().includes("failed")
        || status.toLowerCase().includes("skipped")
      ) {
        setScanningTodos(false);
      }
    }
  }, [session.statusText]);

  // Listen for AI-generated suggestions and insights.
  // Keep these listeners active so manual scans in viewed sessions also surface results.
  useEffect(() => {
    const cleanups = [
      window.electronAPI.onTodoSuggested((suggestion) => {
        setSuggestions((prev) => [suggestion, ...prev]);
      }),
      window.electronAPI.onInsightAdded((insight) => {
        setInsights((prev) => [...prev, insight]);
      }),
    ];
    return () => cleanups.forEach((fn) => fn());
  }, []);

  const handleToggleMic = useCallback(async () => {
    const result = await window.electronAPI.toggleMic();
    if (result.ok && result.captureInRenderer) {
      await micCapture.start();
    } else if (result.ok && !result.micEnabled) {
      micCapture.stop();
    }
  }, [micCapture]);

  const handleStart = useCallback(() => {
    setLangError("");
    setSplashDone(true);
    setSettingsOpen(false);
    setResumeSessionId(null);
    setTodos([]);
    setSuggestions([]);
    setInsights([]);
    seedAgents([]);
    setSessionActive(true);
  }, [seedAgents]);

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true);
  }, []);

  const handleStop = useCallback(() => {
    micCapture.stop();
    setSessionActive(false);
    setResumeSessionId(null);
    window.electronAPI.getSessions().then(setSessions);
  }, [micCapture]);

  const handleNewSession = useCallback(() => {
    micCapture.stop();
    setSessionActive(false);
    setSettingsOpen(false);
    setTimeout(() => {
      setResumeSessionId(null);
      setTodos([]);
      setSuggestions([]);
      setInsights([]);
      seedAgents([]);
      setSessionActive(true);
    }, 100);
    window.electronAPI.getSessions().then(setSessions);
  }, [micCapture, seedAgents]);

  const scrollUp = useCallback(() => {
    transcriptRef.current?.scrollBy({ top: -60, behavior: "smooth" });
  }, []);

  const scrollDown = useCallback(() => {
    transcriptRef.current?.scrollBy({ top: 60, behavior: "smooth" });
  }, []);

  const handleAddTodo = useCallback((text: string) => {
    const todo: TodoItem = {
      id: crypto.randomUUID(),
      text,
      completed: false,
      source: "manual",
      createdAt: Date.now(),
      sessionId: session.sessionId ?? undefined,
    };
    setTodos((prev) => [todo, ...prev]);
    window.electronAPI.addTodo(todo);
  }, [session.sessionId]);

  const handleToggleTodo = useCallback((id: string) => {
    setTodos((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, completed: !t.completed, completedAt: !t.completed ? Date.now() : undefined }
          : t
      )
    );
    window.electronAPI.toggleTodo(id);
  }, []);

  const handleAcceptSuggestion = useCallback(async (suggestion: TodoSuggestion) => {
    const todo: TodoItem = {
      id: suggestion.id,
      text: suggestion.text,
      completed: false,
      source: "ai",
      createdAt: suggestion.createdAt,
      sessionId: suggestion.sessionId,
    };
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
    setTodos((prev) => [todo, ...prev]);
    window.electronAPI.addTodo(todo);
    const result = await window.electronAPI.launchAgent(suggestion.id, suggestion.text);
    if (result.ok && result.agent) {
      selectAgent(result.agent.id);
    }
  }, [selectAgent]);

  const handleDismissSuggestion = useCallback((id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleScanTodos = useCallback(async () => {
    const targetSessionId = session.sessionId;
    if (!targetSessionId) {
      setScanFeedback("No session selected.");
      console.warn("Todo scan failed: No selected session");
      return;
    }
    setScanFeedback("Scanning todos...");
    setScanningTodos(true);
    try {
      const result = await window.electronAPI.scanTodosInSession(targetSessionId, appConfig);
      if (!result.ok) {
        setScanFeedback(`Scan failed: ${result.error ?? "Unknown error"}`);
        console.warn(`Todo scan failed: ${result.error ?? "Unknown error"}`);
      } else if (result.queued) {
        setScanFeedback("Scan queued...");
      }
    } finally {
      setTimeout(() => {
        setScanningTodos(false);
      }, 500);
    }
  }, [appConfig, session.sessionId]);

  const handleLaunchAgent = useCallback(async (todoId: string, task: string) => {
    const sessionId = session.sessionId;
    if (!sessionId) return;

    const result = sessionActive
      ? await window.electronAPI.launchAgent(todoId, task)
      : await window.electronAPI.launchAgentInSession(sessionId, todoId, task, appConfig);

    if (result.ok && result.agent) {
      selectAgent(result.agent.id);
      return;
    }
    console.warn(`Failed to launch agent: ${result.error ?? "Unknown error"}`);
  }, [appConfig, selectAgent, session.sessionId, sessionActive]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    micCapture.stop();
    setSettingsOpen(false);
    setSessionActive(false);
    setResumeSessionId(null);
    setSuggestions([]);

    const api = window.electronAPI;
    const [todos, insights, agents] = await Promise.all([
      api.getSessionTodos(sessionId),
      api.getSessionInsights(sessionId),
      api.getSessionAgents(sessionId),
    ]);

    setTodos(todos);
    setInsights(insights);
    seedAgents(agents);
    await session.viewSession(sessionId);
  }, [micCapture, session, seedAgents]);

  const handleDeleteSession = useCallback((id: string) => {
    window.electronAPI.deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (session.sessionId === id) {
      micCapture.stop();
      setSessionActive(false);
      setResumeSessionId(null);
    }
  }, [session.sessionId, micCapture]);

  const handleFollowUp = useCallback(async (agent: Agent, question: string) => {
    const targetSessionId = agent.sessionId ?? session.sessionId ?? null;
    if (!targetSessionId) {
      return { ok: false, error: "Missing session id for this agent" };
    }
    return window.electronAPI.followUpAgentInSession(targetSessionId, agent.id, question, appConfig);
  }, [session.sessionId, appConfig]);

  const handleCancelAgent = useCallback(async (agentId: string) => {
    await window.electronAPI.cancelAgent(agentId);
  }, []);

  const handleToggleTranslation = useCallback(async () => {
    await window.electronAPI.toggleTranslation();
  }, []);

  const handleAppConfigChange = useCallback((next: AppConfig) => {
    setStoredAppConfig(normalizeAppConfig(next));
  }, [setStoredAppConfig]);

  useKeyboard({
    onToggleRecording: sessionActive ? session.toggleRecording : handleStart,
    onQuit: sessionActive ? handleStop : () => window.close(),
    onScrollUp: sessionActive ? scrollUp : undefined,
    onScrollDown: sessionActive ? scrollDown : undefined,
  });

  const educationalInsights = insights.filter((i) => i.kind !== "key-point");

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
        onStop={handleStop}
        onNewSession={handleNewSession}
        onTogglePause={session.toggleRecording}
        uiState={session.uiState}
        langError={langError}
        onToggleTranslation={handleToggleTranslation}
        onToggleMic={handleToggleMic}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((prev) => !prev)}
      />

      <div className="flex flex-1 min-h-0">
        {settingsOpen ? (
          <SettingsPage
            config={appConfig}
            languages={languages}
            sourceLang={sourceLang}
            targetLang={targetLang}
            onSourceLangChange={(lang) => { setSourceLang(lang); setLangError(""); }}
            onTargetLangChange={(lang) => { setTargetLang(lang); setLangError(""); }}
            sessionActive={sessionActive}
            onConfigChange={handleAppConfigChange}
            onReset={() => setStoredAppConfig(DEFAULT_APP_CONFIG)}
          />
        ) : (
          <>
            <LeftSidebar
              rollingKeyPoints={session.rollingKeyPoints}
              insights={educationalInsights}
              sessions={sessions}
              activeSessionId={session.sessionId}
              onSelectSession={handleSelectSession}
              onDeleteSession={handleDeleteSession}
            />
            <main className="flex-1 flex flex-col min-h-0 min-w-0 relative">
              <TranscriptArea ref={transcriptRef} blocks={session.blocks} />
            </main>
            {selectedAgent && (
              <AgentDetailPanel
                agent={selectedAgent}
                agents={agents}
                onSelectAgent={selectAgent}
                onClose={() => selectAgent(null)}
                onFollowUp={handleFollowUp}
                onCancel={handleCancelAgent}
              />
            )}
            <RightSidebar
              todos={todos}
              suggestions={suggestions}
              agents={agents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={selectAgent}
              onLaunchAgent={handleLaunchAgent}
              onAddTodo={handleAddTodo}
              onToggleTodo={handleToggleTodo}
              onScanTodos={handleScanTodos}
              scanningTodos={scanningTodos}
              scanFeedback={scanFeedback}
              onAcceptSuggestion={handleAcceptSuggestion}
              onDismissSuggestion={handleDismissSuggestion}
            />
          </>
        )}
      </div>

      {session.errorText && (
        <div className="px-4 py-2 text-destructive text-xs border-t border-destructive/20 bg-destructive/5">
          {session.errorText}
        </div>
      )}

      <Footer sessionActive={sessionActive} statusText={session.statusText} />
    </div>
  );
}
