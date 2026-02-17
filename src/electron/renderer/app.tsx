import { useState, useEffect, useRef, useCallback } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { Language, LanguageCode } from "../../core/types";
import { useSession } from "./hooks/use-session";
import { useKeyboard } from "./hooks/use-keyboard";
import { ToolbarHeader } from "./components/toolbar-header";
import { SummaryStrip } from "./components/summary-strip";
import { TranscriptArea } from "./components/transcript-area";
import { Footer } from "./components/footer";

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <h1 className="text-3xl font-mono font-bold text-foreground tracking-wider">
        ROSETTA
      </h1>
      <p className="text-muted-foreground text-sm mt-1">
        Real-time Audio Translation
      </p>
      <p className="text-muted-foreground text-xs mt-4">
        Select languages above and press Start
      </p>
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

  const session = useSession(sourceLang, targetLang, sessionActive);

  useEffect(() => {
    window.electronAPI.getLanguages().then(setLanguages);
  }, []);

  const handleStart = useCallback(() => {
    if (sourceLang === targetLang) {
      setLangError("Source and target languages must be different");
      return;
    }
    setLangError("");
    setSessionActive(true);
  }, [sourceLang, targetLang]);

  const handleStop = useCallback(() => {
    setSessionActive(false);
  }, []);

  const handleSwap = useCallback(() => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    setLangError("");
  }, [sourceLang, targetLang, setSourceLang, setTargetLang]);

  const scrollUp = useCallback(() => {
    transcriptRef.current?.scrollBy({ top: -60, behavior: "smooth" });
  }, []);

  const scrollDown = useCallback(() => {
    transcriptRef.current?.scrollBy({ top: 60, behavior: "smooth" });
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
        onSwapLangs={handleSwap}
        sessionActive={sessionActive}
        onStart={handleStart}
        onStop={handleStop}
        onTogglePause={session.toggleRecording}
        uiState={session.uiState}
        langError={langError}
      />

      {sessionActive ? (
        <>
          <SummaryStrip summary={session.summary} />
          <TranscriptArea ref={transcriptRef} blocks={session.blocks} />
        </>
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
