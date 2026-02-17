import { useState, useEffect, useRef, useCallback } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { Language, LanguageCode, TodoItem, Insight, SessionMeta, TranscriptBlock } from "../../core/types";
import { useSession } from "./hooks/use-session";
import { useKeyboard } from "./hooks/use-keyboard";
import { ToolbarHeader } from "./components/toolbar-header";
import { SummaryStrip } from "./components/summary-strip";
import { TranscriptArea } from "./components/transcript-area";
import { LeftSidebar } from "./components/left-sidebar";
import { RightSidebar } from "./components/right-sidebar";
import { Footer } from "./components/footer";

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.03)_0%,_transparent_70%)]" />
      <div className="relative z-10 flex flex-col items-center">
        <p className="text-[11px] font-sans font-medium tracking-[0.3em] uppercase text-[#8a8a7a] mb-6">
          Listening Platform
        </p>
        <h1 className="font-serif text-[clamp(4rem,10vw,7rem)] font-normal text-[#e8e4dc] leading-[0.9] tracking-[-0.02em]">
          Ambient
        </h1>
        <p className="text-[#6a6a60] text-sm mt-8 font-sans">
          Press Start to begin
        </p>
      </div>
    </div>
  );
}

export function App() {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [sourceLang, setSourceLang] = useLocalStorage<LanguageCode>("rosetta-source-lang", "ko");
  const [targetLang, setTargetLang] = useLocalStorage<LanguageCode>("rosetta-target-lang", "en");
  const [sessionActive, setSessionActive] = useState(false);
  const [langError, setLangError] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const [viewingBlocks, setViewingBlocks] = useState<TranscriptBlock[]>([]);

  useEffect(() => {
    window.electronAPI.getTodos().then(setTodos);
    window.electronAPI.getInsights().then(setInsights);
    window.electronAPI.getSessions().then(setSessions);
  }, []);

  const session = useSession(sourceLang, targetLang, sessionActive);

  useEffect(() => {
    window.electronAPI.getLanguages().then(setLanguages);
  }, []);

  // Listen for AI-generated todos and insights during active session
  useEffect(() => {
    if (!sessionActive) return;
    const cleanups = [
      window.electronAPI.onTodoAdded((todo) => {
        setTodos((prev) => [todo, ...prev]);
      }),
      window.electronAPI.onInsightAdded((insight) => {
        setInsights((prev) => [insight, ...prev]);
      }),
    ];
    return () => cleanups.forEach((fn) => fn());
  }, [sessionActive]);

  const handleStart = useCallback(() => {
    setLangError("");
    setSessionActive(true);
  }, []);

  const handleStop = useCallback(() => {
    setSessionActive(false);
    window.electronAPI.getSessions().then(setSessions);
  }, []);

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
    };
    setTodos((prev) => [todo, ...prev]);
    window.electronAPI.addTodo(todo);
  }, []);

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

  const handleSelectSession = useCallback((sessionId: string) => {
    setViewingSessionId(sessionId);
    window.electronAPI.getSessionBlocks(sessionId).then(setViewingBlocks);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setViewingSessionId(null);
    setViewingBlocks([]);
  }, []);

  const handleToggleTranslation = useCallback(async () => {
    await window.electronAPI.toggleTranslation();
  }, []);

  const handleToggleMic = useCallback(async () => {
    await window.electronAPI.toggleMic();
  }, []);

  useKeyboard({
    onToggleRecording: sessionActive ? session.toggleRecording : handleStart,
    onQuit: sessionActive ? handleStop : () => window.close(),
    onScrollUp: sessionActive ? scrollUp : undefined,
    onScrollDown: sessionActive ? scrollDown : undefined,
  });

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
        onTogglePause={session.toggleRecording}
        uiState={session.uiState}
        langError={langError}
        onToggleTranslation={handleToggleTranslation}
        onToggleMic={handleToggleMic}
      />

      {sessionActive ? (
        <div className="flex flex-1 min-h-0">
          <LeftSidebar
            summary={session.summary}
            insights={insights}
            sessions={sessions}
            activeSessionId={viewingSessionId}
            onSelectSession={handleSelectSession}
          />
          <main className="flex-1 flex flex-col min-h-0 min-w-0 relative">
            <SummaryStrip summary={session.summary} />
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
            todos={todos}
            onAddTodo={handleAddTodo}
            onToggleTodo={handleToggleTodo}
          />
        </div>
      ) : (
        <EmptyState />
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
