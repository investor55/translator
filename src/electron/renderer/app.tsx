import { useState, useEffect, useRef, useCallback } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { Language, LanguageCode, TodoItem, TodoSuggestion, Insight, SessionMeta, TranscriptBlock } from "../../core/types";
import { useSession } from "./hooks/use-session";
import { useMicCapture } from "./hooks/use-mic-capture";
import { useKeyboard } from "./hooks/use-keyboard";
import { ToolbarHeader } from "./components/toolbar-header";
import { TranscriptArea } from "./components/transcript-area";
import { LeftSidebar } from "./components/left-sidebar";
import { RightSidebar } from "./components/right-sidebar";
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
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const [viewingBlocks, setViewingBlocks] = useState<TranscriptBlock[]>([]);
  const [viewingTodos, setViewingTodos] = useState<TodoItem[]>([]);
  const [viewingInsights, setViewingInsights] = useState<Insight[]>([]);

  useEffect(() => {
    window.electronAPI.getSessions().then((loaded) => {
      setSessions(loaded);
      const last = loaded[0];
      if (last?.sourceLang) setSourceLang(last.sourceLang);
      if (last?.targetLang) setTargetLang(last.targetLang);
    });
  }, []);

  const session = useSession(sourceLang, targetLang, sessionActive);
  const micCapture = useMicCapture();

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
        setInsights((prev) => [insight, ...prev]);
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
    setTodos([]);
    setSuggestions([]);
    setInsights([]);
    setSessionActive(true);
  }, []);

  const handleSplashComplete = useCallback(() => {
    setSplashDone(true);
    setSessionActive(true);
  }, []);

  const handleStop = useCallback(() => {
    micCapture.stop();
    setSessionActive(false);
    window.electronAPI.getSessions().then(setSessions);
  }, [micCapture]);

  const handleNewSession = useCallback(() => {
    micCapture.stop();
    setSessionActive(false);
    // Brief delay to let the old session teardown before starting fresh
    setTimeout(() => {
      setTodos([]);
      setSuggestions([]);
      setInsights([]);
      setViewingSessionId(null);
      setViewingBlocks([]);
      setViewingTodos([]);
      setViewingInsights([]);
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

  const handleAcceptSuggestion = useCallback((suggestion: TodoSuggestion) => {
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
  }, []);

  const handleDismissSuggestion = useCallback((id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const viewingKeyPoints = viewingInsights
    .filter((i) => i.kind === "key-point")
    .map((i) => i.text);
  const viewingEducationalInsights = viewingInsights.filter((i) => i.kind !== "key-point");

  const handleSelectSession = useCallback((sessionId: string) => {
    setViewingSessionId(sessionId);
    window.electronAPI.getSessionBlocks(sessionId).then(setViewingBlocks);
    window.electronAPI.getSessionTodos(sessionId).then(setViewingTodos);
    window.electronAPI.getSessionInsights(sessionId).then(setViewingInsights);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setViewingSessionId(null);
    setViewingBlocks([]);
    setViewingTodos([]);
    setViewingInsights([]);
  }, []);

  const handleDeleteSession = useCallback((id: string) => {
    window.electronAPI.deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (viewingSessionId === id) {
      setViewingSessionId(null);
      setViewingBlocks([]);
      setViewingTodos([]);
      setViewingInsights([]);
    }
  }, [viewingSessionId]);

  const handleToggleTranslation = useCallback(async () => {
    await window.electronAPI.toggleTranslation();
  }, []);

  useKeyboard({
    onToggleRecording: sessionActive ? session.toggleRecording : handleStart,
    onQuit: sessionActive ? handleStop : () => window.close(),
    onScrollUp: sessionActive ? scrollUp : undefined,
    onScrollDown: sessionActive ? scrollDown : undefined,
  });

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
          rollingKeyPoints={viewingSessionId ? viewingKeyPoints : session.rollingKeyPoints}
          insights={viewingSessionId ? viewingEducationalInsights : insights}
          sessions={sessions}
          activeSessionId={viewingSessionId}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
        />
        <main className="flex-1 flex flex-col min-h-0 min-w-0 relative">
          <TranscriptArea ref={transcriptRef} blocks={session.blocks} />
          {viewingSessionId && (
            <div className="absolute inset-0 bg-background/95 flex flex-col min-h-0 z-10">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
                <span className="text-xs font-medium text-muted-foreground">
                  Viewing past session
                </span>
                <button
                  type="button"
                  onClick={handleCloseViewer}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Close
                </button>
              </div>
              <TranscriptArea blocks={viewingBlocks} />
            </div>
          )}
        </main>
        <RightSidebar
          todos={viewingSessionId ? viewingTodos : todos}
          suggestions={viewingSessionId ? [] : suggestions}
          onAddTodo={viewingSessionId ? undefined : handleAddTodo}
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
