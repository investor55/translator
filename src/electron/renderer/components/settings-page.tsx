import type {
  AnalysisProvider,
  AppConfig,
  FontSize,
  McpIntegrationStatus,
  Direction,
  Language,
  LanguageCode,
  LightVariant,
  ThemeMode,
  TranscriptionProvider,
} from "../../../core/types";
import {
  DEFAULT_TRANSCRIPTION_MODEL_ID,
  DEFAULT_WHISPER_MODEL_ID,
  DEFAULT_VERTEX_MODEL_ID,
} from "../../../core/types";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Laptop2Icon, MoonIcon, RotateCcwIcon, SunIcon } from "lucide-react";

type SettingsPageProps = {
  config: AppConfig;
  languages: Language[];
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  onSourceLangChange: (lang: LanguageCode) => void;
  onTargetLangChange: (lang: LanguageCode) => void;
  isRecording: boolean;
  onConfigChange: (next: AppConfig) => void;
  onReset: () => void;
  mcpIntegrations: McpIntegrationStatus[];
  mcpBusy?: boolean;
  onConnectNotionMcp: () => void | Promise<void>;
  onDisconnectNotionMcp: () => void | Promise<void>;
  onSetLinearToken: (token: string) => Promise<{ ok: boolean; error?: string }>;
  onClearLinearToken: () => Promise<{ ok: boolean; error?: string }>;
};

const THEME_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  icon: ReactNode;
}> = [
  {
    value: "system",
    label: "System",
    icon: <Laptop2Icon className="size-3.5" />,
  },
  { value: "light", label: "Light", icon: <SunIcon className="size-3.5" /> },
  { value: "dark", label: "Dark", icon: <MoonIcon className="size-3.5" /> },
];

const LIGHT_VARIANT_OPTIONS: Array<{
  value: LightVariant;
  label: string;
  swatch: string;
}> = [
  { value: "warm", label: "Warm", swatch: "oklch(0.985 0.002 90)" },
  { value: "linen", label: "Linen", swatch: "#EEEEEE" },
];

const FONT_SIZE_OPTIONS: Array<{ value: FontSize; label: string }> = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Default" },
  { value: "lg", label: "Large" },
];

const DIRECTION_OPTIONS: Array<{ value: Direction; label: string }> = [
  { value: "auto", label: "Auto Detect" },
  { value: "source-target", label: "Source to Target" },
];

const TRANSCRIPTION_PROVIDERS: Array<{
  value: TranscriptionProvider;
  label: string;
}> = [
  { value: "elevenlabs", label: "ElevenLabs (Realtime)" },
  { value: "whisper", label: "Whisper (Local / Offline)" },
  { value: "google", label: "Google" },
  { value: "vertex", label: "Vertex AI" },
];

function getDefaultModelId(provider: TranscriptionProvider): string {
  switch (provider) {
    case "whisper":
      return DEFAULT_WHISPER_MODEL_ID;
    case "elevenlabs":
      return DEFAULT_TRANSCRIPTION_MODEL_ID;
    case "google":
      return "gemini-2.0-flash";
    case "vertex":
      return DEFAULT_VERTEX_MODEL_ID;
  }
}

function getModelIdPlaceholder(provider: TranscriptionProvider): string {
  return getDefaultModelId(provider);
}

const ANALYSIS_PROVIDERS: Array<{ value: AnalysisProvider; label: string }> = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "google", label: "Google" },
  { value: "vertex", label: "Vertex AI" },
];

type AnalysisModelPreset = {
  label: string;
  modelId: string;
  providerOnly: string;
};
const ANALYSIS_MODEL_PRESETS: AnalysisModelPreset[] = [
  {
    label: "Kimi K2 0905",
    modelId: "moonshotai/kimi-k2-0905:exacto",
    providerOnly: "groq",
  },
  {
    label: "Kimi K2.5",
    modelId: "moonshotai/kimi-k2.5",
    providerOnly: "basten",
  },
];

type TodoModelPreset = { label: string; modelId: string; providers: string[] };
const TODO_MODEL_PRESETS: TodoModelPreset[] = [
  {
    label: "GPT-OSS 120B",
    modelId: "openai/gpt-oss-120b",
    providers: ["sambanova", "groq", "cerebras"],
  },
];

function SettingRow({
  label,
  description,
  control,
}: {
  label: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
          {description}
        </p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function renderLanguageLabel(languages: Language[], code: LanguageCode) {
  const lang = languages.find((item) => item.code === code);
  return lang
    ? `${lang.native} (${lang.code.toUpperCase()})`
    : code.toUpperCase();
}

export function SettingsPage({
  config,
  languages,
  sourceLang,
  targetLang,
  onSourceLangChange,
  onTargetLangChange,
  isRecording,
  onConfigChange,
  onReset,
  mcpIntegrations,
  mcpBusy = false,
  onConnectNotionMcp,
  onDisconnectNotionMcp,
  onSetLinearToken,
  onClearLinearToken,
}: SettingsPageProps) {
  const [linearTokenInput, setLinearTokenInput] = useState("");
  const [linearTokenError, setLinearTokenError] = useState("");

  const notionStatus = useMemo(
    () => mcpIntegrations.find((item) => item.provider === "notion"),
    [mcpIntegrations]
  );
  const linearStatus = useMemo(
    () => mcpIntegrations.find((item) => item.provider === "linear"),
    [mcpIntegrations]
  );

  const languagesLoading = languages.length === 0;
  const set = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    onConfigChange({ ...config, [key]: value });
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Control appearance and runtime behavior. Session changes apply
              when you start or resume a session.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcwIcon className="size-3.5" data-icon="inline-start" />
            Reset Defaults
          </Button>
        </div>

        {isRecording && (
          <div className="mb-6 border border-amber-300/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 text-xs rounded-none">
            Currently recording. Configuration updates will apply to the next
            session.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Row 1: Appearance + Session ── */}
          <section className="border border-border bg-card px-4 py-3 rounded-none">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Appearance
            </h2>
            <Separator className="my-3" />
            <SettingRow
              label="Theme"
              description="Choose light, dark, or follow your system theme."
              control={
                <div className="inline-flex items-center border border-border rounded-none overflow-hidden">
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`h-8 px-2.5 text-xs inline-flex items-center gap-1.5 transition-colors ${
                        config.themeMode === option.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => set("themeMode", option.value)}
                    >
                      {option.icon}
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            />
            {config.themeMode !== "dark" && (
              <SettingRow
                label="Light Style"
                description="Color palette used in light mode."
                control={
                  <div className="inline-flex items-center border border-border rounded-none overflow-hidden">
                    {LIGHT_VARIANT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`h-8 px-2.5 text-xs inline-flex items-center gap-1.5 transition-colors ${
                          config.lightVariant === option.value
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => set("lightVariant", option.value)}
                      >
                        <span
                          className="size-3 rounded-sm border border-border/50 shrink-0"
                          style={{ backgroundColor: option.swatch }}
                        />
                        {option.label}
                      </button>
                    ))}
                  </div>
                }
              />
            )}
            <SettingRow
              label="Font Size"
              description="Scale the entire interface up or down."
              control={
                <div className="inline-flex items-center border border-border rounded-none overflow-hidden">
                  {FONT_SIZE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`h-8 px-2.5 text-xs inline-flex items-center gap-1.5 transition-colors ${
                        config.fontSize === option.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => set("fontSize", option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            />
          </section>

          <section className="border border-border bg-card px-4 py-3 rounded-none">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Session
            </h2>
            <Separator className="my-3" />
            <div className="space-y-1">
              <SettingRow
                label="Translation"
                description="Start new sessions with translation enabled by default."
                control={
                  <Switch
                    checked={config.translationEnabled}
                    onCheckedChange={(v) => set("translationEnabled", v)}
                  />
                }
              />
              <SettingRow
                label="Use Context"
                description="Inject context from the context file into every prompt."
                control={
                  <Switch
                    checked={config.useContext}
                    onCheckedChange={(v) => set("useContext", v)}
                  />
                }
              />
              <SettingRow
                label="Compact Responses"
                description="Ask the model for shorter outputs when possible."
                control={
                  <Switch
                    checked={config.compact}
                    onCheckedChange={(v) => set("compact", v)}
                  />
                }
              />
              <SettingRow
                label="Agent Auto-Approve"
                description="Agents skip approval for safe creates. Updates, deletes, and archives still require confirmation."
                control={
                  <Switch
                    checked={config.agentAutoApprove}
                    onCheckedChange={(v) => set("agentAutoApprove", v)}
                  />
                }
              />
            </div>
          </section>

          {/* ── Row 2: Audio & Transcription (full width) ── */}
          <section className="border border-border bg-card px-4 py-3 rounded-none lg:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Audio & Transcription
            </h2>
            <Separator className="my-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  Provider
                </label>
                <Select
                  value={config.transcriptionProvider}
                  onValueChange={(v) => {
                    const provider = v as TranscriptionProvider;
                    onConfigChange({
                      ...config,
                      transcriptionProvider: provider,
                      transcriptionModelId: getDefaultModelId(provider),
                      translationEnabled:
                        provider === "vertex"
                          ? config.translationEnabled
                          : false,
                    });
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSCRIPTION_PROVIDERS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  Model
                </label>
                <Input
                  value={config.transcriptionModelId}
                  onChange={(e) => set("transcriptionModelId", e.target.value)}
                  placeholder={getModelIdPlaceholder(
                    config.transcriptionProvider
                  )}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  {config.transcriptionProvider === "vertex"
                    ? "Source Language"
                    : "Language"}
                </label>
                <Select
                  value={sourceLang}
                  onValueChange={(value) => {
                    const next = value as LanguageCode;
                    onSourceLangChange(next);
                    if (next === targetLang) {
                      onTargetLangChange(next === "en" ? "ko" : "en");
                    }
                  }}
                  disabled={languagesLoading}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue>
                      {renderLanguageLabel(languages, sourceLang)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {languages.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.name} ({lang.native})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {config.transcriptionProvider === "vertex" ? (
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">
                    Target Language
                  </label>
                  <Select
                    value={targetLang}
                    onValueChange={(value) => {
                      const next = value as LanguageCode;
                      onTargetLangChange(next);
                      if (next === sourceLang) {
                        onSourceLangChange(next === "en" ? "ko" : "en");
                      }
                    }}
                    disabled={languagesLoading}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue>
                        {renderLanguageLabel(languages, targetLang)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {languages.map((lang) => (
                        <SelectItem key={lang.code} value={lang.code}>
                          {lang.name} ({lang.native})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">
                    Chunk Interval (ms)
                  </label>
                  <Input
                    type="number"
                    min={500}
                    max={60000}
                    step={100}
                    value={config.intervalMs}
                    onChange={(e) =>
                      set(
                        "intervalMs",
                        Number.parseInt(e.target.value || "0", 10)
                      )
                    }
                    className="w-full"
                  />
                </div>
              )}
            </div>
            {config.transcriptionProvider === "vertex" && (
              <div className="mt-3">
                <SettingRow
                  label="Direction"
                  description="Auto-detect speaker language or always translate source → target."
                  control={
                    <Select
                      value={config.direction}
                      onValueChange={(v) => set("direction", v as Direction)}
                    >
                      <SelectTrigger size="sm" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DIRECTION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingRow
                  label="Chunk Interval (ms)"
                  description="How often audio chunks are sent for processing."
                  control={
                    <Input
                      type="number"
                      min={500}
                      max={60000}
                      step={100}
                      value={config.intervalMs}
                      onChange={(e) =>
                        set(
                          "intervalMs",
                          Number.parseInt(e.target.value || "0", 10)
                        )
                      }
                      className="w-32"
                    />
                  }
                />
              </div>
            )}
            {config.transcriptionProvider === "whisper" && (
              <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
                Whisper runs locally with no API key. Start with{" "}
                <code className="font-mono">Xenova/whisper-small</code> for
                better quality; it uses more memory than base/tiny.
              </p>
            )}
          </section>

          {/* ── Row 3: AI Models (full width) ── */}
          <section className="border border-border bg-card px-4 py-3 rounded-none lg:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              AI Models
            </h2>
            <Separator className="my-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">
                  Analysis Provider
                </label>
                <Select
                  value={config.analysisProvider}
                  onValueChange={(v) =>
                    set("analysisProvider", v as AnalysisProvider)
                  }
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANALYSIS_PROVIDERS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {config.analysisProvider === "openrouter" ? (
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">
                    Analysis Model
                  </label>
                  <Select
                    value={config.analysisModelId}
                    onValueChange={(modelId) => {
                      const preset = ANALYSIS_MODEL_PRESETS.find(
                        (p) => p.modelId === modelId
                      );
                      onConfigChange({
                        ...config,
                        analysisModelId: modelId,
                        analysisProviderOnly: preset?.providerOnly,
                      });
                    }}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ANALYSIS_MODEL_PRESETS.map((preset) => (
                        <SelectItem key={preset.modelId} value={preset.modelId}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">
                    Analysis Model ID
                  </label>
                  <Input
                    value={config.analysisModelId}
                    onChange={(e) => set("analysisModelId", e.target.value)}
                    placeholder="gemini-2.0-flash"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">Todo Model</label>
                <Select
                  value={config.todoModelId}
                  onValueChange={(modelId) => {
                    const preset = TODO_MODEL_PRESETS.find((p) => p.modelId === modelId);
                    onConfigChange({
                      ...config,
                      todoModelId: modelId,
                      todoProviders: preset?.providers ?? [],
                    });
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TODO_MODEL_PRESETS.map((preset) => (
                      <SelectItem key={preset.modelId} value={preset.modelId}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {config.analysisProvider === "openrouter" && (
              <div className="mt-3">
                <SettingRow
                  label="Analysis Reasoning"
                  description="Enable extended reasoning tokens for the analysis model (max 4096)."
                  control={
                    <Switch
                      checked={config.analysisReasoning}
                      onCheckedChange={(v) => set("analysisReasoning", v)}
                    />
                  }
                />
              </div>
            )}
          </section>

          {/* ── Row 4: Advanced (full width) ── */}
          <section className="border border-border bg-card px-4 py-3 rounded-none lg:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Advanced
            </h2>
            <Separator className="my-3" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8">
              <div className="space-y-1">
                <SettingRow
                  label="Debug Mode"
                  description="Enable extra logging and diagnostics."
                  control={
                    <Switch
                      checked={config.debug}
                      onCheckedChange={(v) => set("debug", v)}
                    />
                  }
                />
                <SettingRow
                  label="Legacy Audio"
                  description="Use the legacy ffmpeg loopback capture flow instead of ScreenCaptureKit."
                  control={
                    <Switch
                      checked={config.legacyAudio}
                      onCheckedChange={(v) => set("legacyAudio", v)}
                    />
                  }
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2 lg:mt-0">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">
                    Context File
                  </label>
                  <Input
                    value={config.contextFile}
                    onChange={(e) => set("contextFile", e.target.value)}
                    placeholder="context.md"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">
                    Vertex Project
                  </label>
                  <Input
                    value={config.vertexProject ?? ""}
                    onChange={(e) => set("vertexProject", e.target.value)}
                    placeholder="project-id"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">
                    Vertex Location
                  </label>
                  <Input
                    value={config.vertexLocation}
                    onChange={(e) => set("vertexLocation", e.target.value)}
                    placeholder="global"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ── Row 5: Integrations (full width) ── */}
          <section className="border border-border bg-card px-4 py-3 rounded-none lg:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Integrations
            </h2>
            <Separator className="my-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="border border-border/70 bg-background px-3 py-3 rounded-none">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">
                    Notion MCP
                  </p>
                  <span className="text-[11px] text-muted-foreground">
                    {notionStatus?.state ?? "disconnected"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                  Hosted MCP via local OAuth callback.
                </p>
                {notionStatus?.error && (
                  <p className="mt-1 text-[11px] text-destructive">
                    {notionStatus.error}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  {notionStatus?.state === "connected" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void onDisconnectNotionMcp()}
                      disabled={mcpBusy || notionStatus.enabled === false}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => void onConnectNotionMcp()}
                      disabled={mcpBusy || notionStatus?.enabled === false}
                    >
                      Connect Notion
                    </Button>
                  )}
                </div>
              </div>

              <div className="border border-border/70 bg-background px-3 py-3 rounded-none">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">
                    Linear MCP
                  </p>
                  <span className="text-[11px] text-muted-foreground">
                    {linearStatus?.state ?? "disconnected"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                  Token-based access for Linear MCP.
                </p>
                {linearStatus?.error && (
                  <p className="mt-1 text-[11px] text-destructive">
                    {linearStatus.error}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="password"
                    value={linearTokenInput}
                    onChange={(e) => {
                      setLinearTokenInput(e.target.value);
                      setLinearTokenError("");
                    }}
                    placeholder="lin_api_..."
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      const result = await onSetLinearToken(linearTokenInput);
                      if (!result.ok) {
                        setLinearTokenError(
                          result.error ?? "Could not save Linear token."
                        );
                        return;
                      }
                      setLinearTokenInput("");
                    }}
                    disabled={mcpBusy || linearStatus?.enabled === false}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const result = await onClearLinearToken();
                      if (!result.ok) {
                        setLinearTokenError(
                          result.error ?? "Could not disconnect Linear."
                        );
                      }
                    }}
                    disabled={mcpBusy || linearStatus?.enabled === false}
                  >
                    Disconnect
                  </Button>
                </div>
                {linearTokenError && (
                  <p className="mt-1 text-[11px] text-destructive">
                    {linearTokenError}
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
