import { useState, useEffect, useRef, useCallback } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { Agent, Language, LanguageCode, TodoItem, TodoSuggestion, Insight, SessionMeta } from "../../core/types";
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
  const [sessionActive, setSessionActive] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [langError, setLangError] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [suggestions, setSuggestions] = useState<TodoSuggestion[]>([]);
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
  const { agents, selectedAgentId, selectedAgent, selectAgent, seedAgents } = useAgents(sessionActive);

  const handleResumed = useCallback((data: ResumeData) => {
    setTodos(data.todos);
    setInsights(data.insights);
    seedAgents(data.agents);
  }, [seedAgents]);

  const session = useSession(sourceLang, targetLang, sessionActive, resumeSessionId, { onResumed: handleResumed });

  useEffect(() => {
    window.electronAPI.getLanguages().then(setLanguages);
  }, []);

  // Listen for AI-generated suggestions and insights during active session
  useEffect(() => {
    if (!sessionActive) return;
    const cleanups = [
      window.electronAPI.onTodoSuggested((suggestion) => {
        setSuggestions((prev) => [suggestion, ...prev]);
      }),
      window.electronAPI.onInsightAdded((insight) => {
        setInsights((prev) => [...prev, insight]);
      }),
    ];
    return () => cleanups.forEach((fn) => fn());
  }, [sessionActive]);

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
    setResumeSessionId(null);
    setTodos([]);
    setSuggestions([]);
    setInsights([]);
    setSessionActive(true);
  }, []);

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
    setTimeout(() => {
      setResumeSessionId(null);
      setTodos([]);
      setSuggestions([]);
      setInsights([]);
      setSessionActive(true);
    }, 100);
    window.electronAPI.getSessions().then(setSessions);
  }, [micCapture]);

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

  const handleLaunchAgent = useCallback(async (todoId: string, task: string) => {
    const result = await window.electronAPI.launchAgent(todoId, task);
    if (result.ok && result.agent) {
      selectAgent(result.agent.id);
    }
  }, [selectAgent]);

  const handleSelectSession = useCallback((sessionId: string) => {
    micCapture.stop();
    setSessionActive(false);
    setTimeout(() => {
      setTodos([]);
      setSuggestions([]);
      setInsights([]);
      setResumeSessionId(sessionId);
      setSessionActive(true);
    }, 100);
  }, [micCapture]);

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
    await window.electronAPI.followUpAgent(agent.id, question);
  }, []);

  const handleCancelAgent = useCallback(async (agentId: string) => {
    await window.electronAPI.cancelAgent(agentId);
  }, []);

  const handleToggleTranslation = useCallback(async () => {
    await window.electronAPI.toggleTranslation();
  }, []);

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
      />

      <div className="flex flex-1 min-h-0">
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
          onAcceptSuggestion={handleAcceptSuggestion}
          onDismissSuggestion={handleDismissSuggestion}
        />
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
