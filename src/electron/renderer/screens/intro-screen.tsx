import { useState, useEffect, useCallback } from "react";
import type { Language, LanguageCode } from "../../../core/types";
import { LanguagePicker } from "../components/language-picker";

type IntroScreenProps = {
  onStart: (sourceLang: LanguageCode, targetLang: LanguageCode) => void;
};

export function IntroScreen({ onStart }: IntroScreenProps) {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [sourceLang, setSourceLang] = useState<LanguageCode>("ko");
  const [targetLang, setTargetLang] = useState<LanguageCode>("en");
  const [focusedPanel, setFocusedPanel] = useState<"source" | "target">("source");
  const [error, setError] = useState("");

  useEffect(() => {
    window.electronAPI.getLanguages().then(setLanguages);
  }, []);

  const handleStart = useCallback(() => {
    if (sourceLang === targetLang) {
      setError("Source and target languages must be different");
      return;
    }
    setError("");
    onStart(sourceLang, targetLang);
  }, [sourceLang, targetLang, onStart]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
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
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleStart]);

  return (
    <div className="flex flex-col h-screen bg-slate-900">
      {/* Titlebar drag region */}
      <div className="titlebar-drag h-8 shrink-0" />

      {/* Logo */}
      <div className="text-center py-4">
        <h1 className="text-3xl font-bold text-cyan-400 tracking-wider">
          ROSETTA
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Real-time Audio Translation
        </p>
      </div>

      {/* Language pickers */}
      <div className="flex-1 flex gap-4 px-6 pb-4 min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <h2 className="text-xs font-semibold text-cyan-400 mb-2 uppercase tracking-wider">
            Input Language (what you hear)
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
          <h2 className="text-xs font-semibold text-cyan-400 mb-2 uppercase tracking-wider">
            Output Language (translation)
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

      {/* Status bar */}
      <div className="text-center py-2">
        <span className="text-slate-300">
          {languages.find((l) => l.code === sourceLang)?.name ?? sourceLang}
        </span>
        <span className="text-cyan-400 mx-3">{"\u2192"}</span>
        <span className="text-slate-300">
          {languages.find((l) => l.code === targetLang)?.name ?? targetLang}
        </span>
      </div>
      {error && (
        <div className="text-center text-red-400 text-sm pb-1">{error}</div>
      )}

      {/* Footer */}
      <div className="border-t border-slate-700 px-4 py-2 text-center text-xs text-slate-500">
        <span className="text-slate-400">{"\u2190\u2192"}</span> switch panels
        <span className="mx-2 text-slate-600">|</span>
        <span className="text-slate-400">{"\u2191\u2193"}</span> navigate
        <span className="mx-2 text-slate-600">|</span>
        <span className="text-slate-400">ENTER</span> start
        <span className="mx-2 text-slate-600">|</span>
        <span className="text-slate-400">Q</span> quit
      </div>
    </div>
  );
}
