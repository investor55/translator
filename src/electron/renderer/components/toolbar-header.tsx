import { ArrowLeftIcon, FileTextIcon, LanguagesIcon, MicIcon, MicOffIcon, MonitorSpeakerIcon, PlusIcon, Settings2Icon } from "lucide-react";
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
  sessionActive: boolean;
  onStart: () => void;
  onNewSession: () => void;
  onTogglePause: () => void;
  uiState: UIState | null;
  langError: string;
  onToggleTranslation?: () => void;
  onToggleMic?: () => void;
  onGenerateSummary?: () => void;
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
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
  sessionActive,
  onStart,
  onNewSession,
  onTogglePause,
  uiState,
  langError,
  onToggleTranslation,
  onToggleMic,
  onGenerateSummary,
  settingsOpen,
  onToggleSettings,
}: ToolbarHeaderProps) {
  const isRecordingOrConnecting =
    uiState?.status === "recording" || uiState?.status === "connecting";
  const loading = languages.length === 0;
  const canTranslate = uiState?.canTranslate ?? false;
  const translationEnabled = (uiState?.translationEnabled ?? false) && canTranslate;
  const micEnabled = uiState?.micEnabled ?? false;

  if (settingsOpen) {
    return (
      <div className="shrink-0">
        <div className="titlebar-drag border-b border-border pl-20 pr-4 flex items-center h-11">
          <Button variant="ghost" size="sm" onClick={onToggleSettings} className="titlebar-no-drag gap-1.5">
            <ArrowLeftIcon className="size-3.5" />
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0">
      <div className="titlebar-drag border-b border-border pl-20 pr-4 flex items-center gap-3 h-11 text-sm">
        {/* Logo */}
        <span className="font-serif text-base font-medium text-foreground titlebar-no-drag">
          Ambient
        </span>

        <Separator orientation="vertical" className="h-4" />

        {/* Language selector */}
        <div className="flex items-center gap-1.5 titlebar-no-drag">
          <span className="text-xs text-muted-foreground">
            {translationEnabled ? "Source" : "Language"}
          </span>
          <Select
            value={sourceLang}
            onValueChange={(v) => {
              onSourceLangChange(v as LanguageCode);
              if (v === targetLang) {
                const alt = v === "en" ? "ko" : "en";
                onTargetLangChange(alt as LanguageCode);
              }
            }}
            disabled={loading || isRecordingOrConnecting}
          >
            <SelectTrigger size="sm" className="w-32">
              <SelectValue>
                {loading ? "..." : renderLabel(languages, sourceLang)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {languages.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  <span className="font-mono text-2xs opacity-60 mr-1.5">
                    {lang.code.toUpperCase()}
                  </span>
                  {lang.name}
                  <span className="text-muted-foreground ml-1.5">({lang.native})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {translationEnabled && (
            <>
              <span className="text-xs text-muted-foreground">→ Target</span>
              <Select
                value={targetLang}
                onValueChange={(v) => {
                  onTargetLangChange(v as LanguageCode);
                  if (v === sourceLang) {
                    const alt = v === "en" ? "ko" : "en";
                    onSourceLangChange(alt as LanguageCode);
                  }
                }}
                disabled={loading || isRecordingOrConnecting}
              >
                <SelectTrigger size="sm" className="w-32">
                  <SelectValue>
                    {loading ? "..." : renderLabel(languages, targetLang)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {languages.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      <span className="font-mono text-2xs opacity-60 mr-1.5">
                        {lang.code.toUpperCase()}
                      </span>
                      {lang.name}
                      <span className="text-muted-foreground ml-1.5">({lang.native})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        <Separator orientation="vertical" className="h-4" />

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 titlebar-no-drag">
          {!sessionActive ? (
            <Button size="sm" onClick={onStart} disabled={loading}>
              <PlusIcon className="size-3.5" data-icon="inline-start" />
              New Session
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onNewSession}>
                <PlusIcon className="size-3.5" data-icon="inline-start" />
                New
              </Button>
              <Button variant="outline" size="sm" onClick={onGenerateSummary}>
                <FileTextIcon className="size-3.5" data-icon="inline-start" />
                Summary
              </Button>
            </>
          )}
        </div>

        {/* Mode toggles */}
        {sessionActive && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex items-center gap-1.5 titlebar-no-drag">
              {canTranslate && (
                <Button
                  variant={translationEnabled ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={onToggleTranslation}
                  aria-label={translationEnabled ? "Disable translation" : "Enable translation"}
                >
                  <LanguagesIcon className="size-3.5" />
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={onTogglePause}
                className={isRecordingOrConnecting ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-600 gap-1.5" : "gap-1.5"}
                aria-label={isRecordingOrConnecting ? "Pause computer audio" : "Resume computer audio"}
              >
                {isRecordingOrConnecting && (
                  <span className="relative flex size-2">
                    <span className="absolute inset-0 rounded-full bg-white/40 mic-pulse-ring" />
                    <span className="relative inline-flex size-2 rounded-full bg-white" />
                  </span>
                )}
                <MonitorSpeakerIcon className="size-3.5" />
                <span className="text-xs">Computer Audio</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleMic}
                className={micEnabled ? "bg-red-600 hover:bg-red-700 text-white border-red-600 gap-1.5" : "gap-1.5"}
                aria-label={micEnabled ? "Turn off microphone" : "Turn on microphone"}
              >
                {micEnabled ? (
                  <>
                    <span className="relative flex size-2">
                      <span className="absolute inset-0 rounded-full bg-white/40 mic-pulse-ring" />
                      <span className="relative inline-flex size-2 rounded-full bg-white" />
                    </span>
                    <MicIcon className="size-3.5" />
                  </>
                ) : (
                  <MicOffIcon className="size-3.5" />
                )}
                <span className="text-xs">My Voice</span>
              </Button>
            </div>
          </>
        )}

        {/* Status info (right-aligned) */}
        <div className="ml-auto flex items-center gap-2 titlebar-no-drag">
          {uiState && (
            <>
              <StatusBadge status={uiState.status} />
              {uiState.cost != null && uiState.cost > 0 && (
                <>
                  <Separator orientation="vertical" className="h-4" />
                  <span className="font-mono text-muted-foreground text-xs">
                    ${uiState.cost.toFixed(4)}
                  </span>
                </>
              )}
            </>
          )}
          <Separator orientation="vertical" className="h-4" />
          <Button
            variant={settingsOpen ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={onToggleSettings}
            aria-label={settingsOpen ? "Close settings" : "Open settings"}
          >
            <Settings2Icon className="size-3.5" />
          </Button>
        </div>
      </div>

      {langError && (
        <div className="px-4 py-1.5 text-destructive text-xs border-b border-destructive/20 bg-destructive/5">
          {langError}
        </div>
      )}
    </div>
  );
}
