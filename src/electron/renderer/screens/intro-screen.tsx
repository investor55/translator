import { useState, useEffect, useCallback } from "react";
import { useEventListener, useLocalStorage } from "usehooks-ts";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDataTransferVerticalIcon, ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Language, LanguageCode } from "../../../core/types";

type IntroScreenProps = {
  onStart: (sourceLang: LanguageCode, targetLang: LanguageCode) => void;
};

export function IntroScreen({ onStart }: IntroScreenProps) {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [sourceLang, setSourceLang] = useLocalStorage<LanguageCode>("rosetta-source-lang", "ko");
  const [targetLang, setTargetLang] = useLocalStorage<LanguageCode>("rosetta-target-lang", "en");
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

  const handleSwap = useCallback(() => {
    const prev = sourceLang;
    setSourceLang(targetLang);
    setTargetLang(prev);
    setError("");
  }, [sourceLang, targetLang, setSourceLang, setTargetLang]);

  useEventListener("keydown", (e: KeyboardEvent) => {
    if (e.code === "Enter") handleStart();
    if (e.code === "KeyQ") window.close();
  });

  const renderLabel = (code: LanguageCode) => {
    const lang = languages.find((l) => l.code === code);
    if (!lang) return code.toUpperCase();
    return `${lang.name} (${lang.native})`;
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="titlebar-drag titlebar-safe shrink-0" />

      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-mono font-bold text-foreground tracking-wider">
            ROSETTA
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time Audio Translation
          </p>
        </div>

        <div className="w-full max-w-xs flex flex-col items-center gap-2">
          <div className="w-full">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Input Language
            </label>
            <Select
              value={sourceLang}
              onValueChange={(v) => { setSourceLang(v as LanguageCode); setError(""); }}
              disabled={loading}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{loading ? "Loading..." : renderLabel(sourceLang)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {languages.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    <span className="font-mono text-[10px] opacity-60 mr-1.5">{lang.code.toUpperCase()}</span>
                    {lang.name}
                    <span className="text-muted-foreground ml-1.5">({lang.native})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleSwap}
            disabled={loading}
            aria-label="Swap languages"
          >
            <HugeiconsIcon icon={ArrowDataTransferVerticalIcon} strokeWidth={2} className="size-4" />
          </Button>

          <div className="w-full">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
              Output Language
            </label>
            <Select
              value={targetLang}
              onValueChange={(v) => { setTargetLang(v as LanguageCode); setError(""); }}
              disabled={loading}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{loading ? "Loading..." : renderLabel(targetLang)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {languages.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    <span className="font-mono text-[10px] opacity-60 mr-1.5">{lang.code.toUpperCase()}</span>
                    {lang.name}
                    <span className="text-muted-foreground ml-1.5">({lang.native})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="text-destructive text-xs mt-1">{error}</p>
          )}

          <Button
            className="w-full mt-4"
            size="lg"
            onClick={handleStart}
            disabled={loading}
          >
            Start Translation
            <HugeiconsIcon icon={ArrowRight02Icon} data-icon="inline-end" strokeWidth={2} className="size-4" />
          </Button>
        </div>
      </div>

      <div className="border-t border-border px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground">
        <kbd className="px-1.5 py-0.5 rounded bg-secondary font-mono text-[10px] text-secondary-foreground">
          ⌘Q
        </kbd>
        <span>quit</span>
      </div>
    </div>
  );
}
