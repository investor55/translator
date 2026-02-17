import { useRef, useCallback } from "react";
import type { LanguageCode } from "../../../core/types";
import { useSession } from "../hooks/use-session";
import { useKeyboard } from "../hooks/use-keyboard";
import { Header } from "../components/header";
import { SummaryPanel } from "../components/summary-panel";
import { TranscriptArea } from "../components/transcript-area";
import { Footer } from "../components/footer";

type MainScreenProps = {
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  onBack: () => void;
};

export function MainScreen({ sourceLang, targetLang, onBack }: MainScreenProps) {
  const session = useSession(sourceLang, targetLang);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const scrollUp = useCallback(() => {
    transcriptRef.current?.scrollBy({ top: -60, behavior: "smooth" });
  }, []);

  const scrollDown = useCallback(() => {
    transcriptRef.current?.scrollBy({ top: 60, behavior: "smooth" });
  }, []);

  useKeyboard({
    onToggleRecording: session.toggleRecording,
    onQuit: onBack,
    onScrollUp: scrollUp,
    onScrollDown: scrollDown,
  });

  return (
    <div className="flex flex-col h-screen bg-background">
      <Header uiState={session.uiState} />
      <SummaryPanel summary={session.summary} />
      <TranscriptArea
        ref={transcriptRef}
        blocks={session.blocks}
      />
      {session.errorText && (
        <div className="px-4 py-2 text-destructive text-xs border-t border-destructive/20 bg-destructive/5">
          {session.errorText}
        </div>
      )}
      <Footer statusText={session.statusText} />
    </div>
  );
}
