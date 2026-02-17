import { useState, useEffect, useCallback } from "react";
import { useEventListener, useLocalStorage } from "usehooks-ts";
import { Separator } from "@/components/ui/separator";
import type { Language, LanguageCode } from "../../../core/types";
import { LanguagePicker } from "../components/language-picker";

type IntroScreenProps = {
  onStart: (sourceLang: LanguageCode, targetLang: LanguageCode) => void;
};

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded bg-secondary font-mono text-[10px] text-secondary-foreground">
      {children}
    </kbd>
  );
}

export function IntroScreen({ onStart }: IntroScreenProps) {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [sourceLang, setSourceLang] = useLocalStorage<LanguageCode>("rosetta-source-lang", "ko");
  const [targetLang, setTargetLang] = useLocalStorage<LanguageCode>("rosetta-target-lang", "en");
  const [focusedPanel, setFocusedPanel] = useState<"source" | "target">("source");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.electronAPI.getLanguages().then((langs) => {
      setLanguages(langs);
      setLoading(false);
    });
  }, []);

  const handleStart = useCallback(() => {
    if (sourceLang === targetLang) {
      setError("Source and target languages must be different");
      return;
    }
    setError("");
    onStart(sourceLang, targetLang);
  }, [sourceLang, targetLang, onStart]);

  useEventListener("keydown", (e: KeyboardEvent) => {
    switch (e.code) {
      case "ArrowLeft":
      case "ArrowRight":
        setFocusedPanel((p) => (p === "source" ? "target" : "source"));
        break;
      case "Enter":
        handleStart();
        break;
      case "KeyQ":
        window.close();
        break;
    }
  });

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="titlebar-drag h-8 shrink-0" />

      <div className="text-center py-4">
        <h1 className="text-3xl font-mono font-bold text-foreground tracking-wider">
          ROSETTA
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Real-time Audio Translation
        </p>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm animate-pulse">
            Loading languages...
          </p>
        </div>
      ) : (
        <div className="flex-1 flex gap-4 px-6 pb-4 min-h-0">
          <div className="flex-1 flex flex-col min-h-0">
            <h2 className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">
              Input Language
            </h2>
            <LanguagePicker
              languages={languages}
              selected={sourceLang}
              onSelect={setSourceLang}
              focused={focusedPanel === "source"}
              onFocus={() => setFocusedPanel("source")}
            />
          </div>
          <div className="flex-1 flex flex-col min-h-0">
            <h2 className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wider">
              Output Language
            </h2>
            <LanguagePicker
              languages={languages}
              selected={targetLang}
              onSelect={setTargetLang}
              focused={focusedPanel === "target"}
              onFocus={() => setFocusedPanel("target")}
            />
          </div>
        </div>
      )}

      <div className="text-center py-2">
        <span className="text-foreground font-medium">
          {languages.find((l) => l.code === sourceLang)?.name ?? sourceLang}
        </span>
        <span className="text-muted-foreground mx-3">{"\u2192"}</span>
        <span className="text-foreground font-medium">
          {languages.find((l) => l.code === targetLang)?.name ?? targetLang}
        </span>
      </div>
      {error && (
        <div className="text-center text-destructive text-sm pb-1">{error}</div>
      )}

      <div className="border-t border-border px-4 py-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Kbd>{"\u2190\u2192"}</Kbd>
        <span>switch panels</span>
        <Separator orientation="vertical" className="h-3 mx-1" />
        <Kbd>{"\u2191\u2193"}</Kbd>
        <span>navigate</span>
        <Separator orientation="vertical" className="h-3 mx-1" />
        <Kbd>Enter</Kbd>
        <span>start</span>
        <Separator orientation="vertical" className="h-3 mx-1" />
        <Kbd>Q</Kbd>
        <span>quit</span>
      </div>
    </div>
  );
}
