import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDataTransferVerticalIcon,
  PlayIcon,
  PauseIcon,
  StopIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Language, LanguageCode, UIState } from "../../../core/types";

type ToolbarHeaderProps = {
  languages: Language[];
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  onSourceLangChange: (lang: LanguageCode) => void;
  onTargetLangChange: (lang: LanguageCode) => void;
  onSwapLangs: () => void;
  sessionActive: boolean;
  onStart: () => void;
  onStop: () => void;
  onTogglePause: () => void;
  uiState: UIState | null;
  langError: string;
};

function StatusBadge({ status }: { status: UIState["status"] }) {
  const config = {
    idle: { color: "bg-status-idle", label: "Idle" },
    connecting: { color: "bg-status-connecting", label: "Connecting..." },
    recording: { color: "bg-status-recording", label: "Recording" },
    paused: { color: "bg-status-paused", label: "Paused" },
  }[status];

  return (
    <Badge variant="secondary" className="gap-1.5 font-normal">
      <span
        className={`inline-block w-2 h-2 rounded-full ${config.color} ${
          status === "recording" ? "animate-pulse" : ""
        }`}
      />
      {config.label}
    </Badge>
  );
}

function renderLabel(languages: Language[], code: LanguageCode) {
  const lang = languages.find((l) => l.code === code);
  return lang ? lang.native : code.toUpperCase();
}

export function ToolbarHeader({
  languages,
  sourceLang,
  targetLang,
  onSourceLangChange,
  onTargetLangChange,
  onSwapLangs,
  sessionActive,
  onStart,
  onStop,
  onTogglePause,
  uiState,
  langError,
}: ToolbarHeaderProps) {
  const isPaused = uiState?.status === "paused";
  const loading = languages.length === 0;

  return (
    <div className="shrink-0">
      <div className="titlebar-drag border-b border-border pl-20 pr-4 flex items-center gap-3 h-11 text-sm">
        {/* Logo */}
        <span className="font-mono font-bold text-foreground titlebar-no-drag">
          Rosetta
        </span>

        <Separator orientation="vertical" className="h-4" />

        {/* Language selectors */}
        <div className="flex items-center gap-1.5 titlebar-no-drag">
          <Select
            value={sourceLang}
            onValueChange={(v) => onSourceLangChange(v as LanguageCode)}
            disabled={loading || sessionActive}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue>
                {loading ? "..." : renderLabel(languages, sourceLang)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {languages.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  <span className="font-mono text-[10px] opacity-60 mr-1.5">
                    {lang.code.toUpperCase()}
                  </span>
                  {lang.name}
                  <span className="text-muted-foreground ml-1.5">({lang.native})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onSwapLangs}
            disabled={loading || sessionActive}
            aria-label="Swap languages"
          >
            <HugeiconsIcon
              icon={ArrowDataTransferVerticalIcon}
              strokeWidth={2}
              className="size-3.5"
            />
          </Button>

          <Select
            value={targetLang}
            onValueChange={(v) => onTargetLangChange(v as LanguageCode)}
            disabled={loading || sessionActive}
          >
            <SelectTrigger size="sm" className="w-28">
              <SelectValue>
                {loading ? "..." : renderLabel(languages, targetLang)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {languages.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  <span className="font-mono text-[10px] opacity-60 mr-1.5">
                    {lang.code.toUpperCase()}
                  </span>
                  {lang.name}
                  <span className="text-muted-foreground ml-1.5">({lang.native})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator orientation="vertical" className="h-4" />

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 titlebar-no-drag">
          {!sessionActive ? (
            <Button size="sm" onClick={onStart} disabled={loading}>
              <HugeiconsIcon icon={PlayIcon} strokeWidth={2} data-icon="inline-start" className="size-3.5" />
              Start
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={onTogglePause}
                aria-label={isPaused ? "Resume" : "Pause"}
              >
                <HugeiconsIcon
                  icon={isPaused ? PlayIcon : PauseIcon}
                  strokeWidth={2}
                  className="size-3.5"
                />
              </Button>
              <Button variant="destructive" size="sm" onClick={onStop}>
                <HugeiconsIcon icon={StopIcon} strokeWidth={2} data-icon="inline-start" className="size-3.5" />
                Stop
              </Button>
            </>
          )}
        </div>

        {/* Status info (right-aligned) */}
        {uiState && (
          <div className="ml-auto flex items-center gap-2 titlebar-no-drag">
            <StatusBadge status={uiState.status} />
            {uiState.cost != null && uiState.cost > 0 && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="font-mono text-muted-foreground text-xs">
                  ${uiState.cost.toFixed(4)}
                </span>
              </>
            )}
            {uiState.contextLoaded && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                CTX
              </Badge>
            )}
            <span className="text-muted-foreground font-mono text-xs truncate max-w-36">
              {uiState.modelId}
            </span>
          </div>
        )}
      </div>

      {langError && (
        <div className="px-4 py-1.5 text-destructive text-xs border-b border-destructive/20 bg-destructive/5">
          {langError}
        </div>
      )}
    </div>
  );
}
