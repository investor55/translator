import type {
  AppConfig,
  CustomMcpStatus,
  DarkVariant,
  FontFamily,
  FontSize,
  McpIntegrationStatus,
  McpProviderToolSummary,
  McpToolInfo,
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
import { MODEL_PRESETS } from "../../../core/models";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Laptop2Icon,
  MoonIcon,
  RotateCcwIcon,
  ServerIcon,
  SunIcon,
} from "lucide-react";
import {
  NotionIcon,
  LinearIcon,
  resolveProviderIcon,
} from "./integration-icons";

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
  customMcpServers: CustomMcpStatus[];
  onAddCustomServer: (cfg: {
    name: string;
    url: string;
    transport: "streamable" | "sse";
    bearerToken?: string;
  }) => Promise<{ ok: boolean; error?: string; id?: string }>;
  onRemoveCustomServer: (
    id: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onConnectCustomServer: (
    id: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onDisconnectCustomServer: (
    id: string
  ) => Promise<{ ok: boolean; error?: string }>;
  mcpToolsByProvider: Record<string, McpProviderToolSummary>;
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
  { value: "aqua", label: "Aqua", swatch: "oklch(0.77 0.098 242)" },
  { value: "warm", label: "Warm", swatch: "oklch(0.985 0.002 90)" },
  { value: "linen", label: "Linen", swatch: "#EEEEEE" },
  { value: "ivory", label: "Ivory", swatch: "oklch(0.968 0.004 90)" },
  { value: "petal", label: "Petal", swatch: "oklch(0.962 0.006 250)" },
];

const DARK_VARIANT_OPTIONS: Array<{
  value: DarkVariant;
  label: string;
  swatch: string;
}> = [
  { value: "charcoal", label: "Charcoal", swatch: "oklch(0.145 0 0)" },
  { value: "steel", label: "Steel", swatch: "oklch(0.2 0.004 260)" },
  { value: "abyss", label: "Abyss", swatch: "oklch(0.185 0.02 264)" },
  { value: "pitch-black", label: "Pitch Black", swatch: "oklch(0 0 0)" },
];

const SEGMENTED_GROUP_CLASS =
  "inline-flex flex-wrap items-center justify-end gap-1 rounded-sm border border-border/70 bg-muted/35 p-1 max-w-[28rem]";

function segmentedButtonClass(selected: boolean): string {
  return `aqua-segment ${selected ? "aqua-segment-active" : ""} h-7 px-2.5 text-xs inline-flex items-center gap-1.5 rounded-[6px] border transition-colors ${
    selected
      ? "border-border/85 bg-background text-foreground shadow-sm"
      : "border-transparent bg-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground"
  }`;
}

const FONT_SIZE_OPTIONS: Array<{ value: FontSize; label: string }> = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Default" },
  { value: "lg", label: "Large" },
];

const FONT_FAMILY_OPTIONS: Array<{ value: FontFamily; label: string }> = [
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Mono" },
];

const DIRECTION_OPTIONS: Array<{ value: Direction; label: string }> = [
  { value: "auto", label: "Auto Detect" },
  { value: "source-target", label: "Source to Target" },
];

type TranscriptionPreset = {
  key: string;
  provider: TranscriptionProvider;
  modelId: string;
  label: string;
  description: string;
};

const TRANSCRIPTION_PRESETS: TranscriptionPreset[] = [
  { key: "vertex:gemini-3-flash-preview", provider: "vertex", modelId: "gemini-3-flash-preview", label: "Gemini 3 Flash — Vertex AI", description: "Best accuracy, supports translation" },
  { key: "openrouter:google/gemini-3-flash-preview", provider: "openrouter", modelId: "google/gemini-3-flash-preview", label: "Gemini 3 Flash — OpenRouter", description: "Best accuracy, supports translation" },
  { key: "elevenlabs:scribe_v2_realtime", provider: "elevenlabs", modelId: "scribe_v2_realtime", label: "ElevenLabs Scribe v2 Realtime", description: "Fastest transcription" },
  { key: "elevenlabs:scribe_v2", provider: "elevenlabs", modelId: "scribe_v2", label: "ElevenLabs Scribe v2", description: "Fast transcription" },
  { key: "whisper:Xenova/whisper-small", provider: "whisper", modelId: "Xenova/whisper-small", label: "Whisper Small (Local)", description: "Slow, lower accuracy, offline" },
  { key: "whisper:Xenova/whisper-tiny", provider: "whisper", modelId: "Xenova/whisper-tiny", label: "Whisper Tiny (Local)", description: "Slow, lowest accuracy, offline" },
];

function getPresetKey(provider: TranscriptionProvider, modelId: string): string {
  return `${provider}:${modelId}`;
}

const ANALYSIS_PROVIDERS: Array<{ value: AppConfig["analysisProvider"]; label: string }> = [
  { value: "openrouter", label: "OpenRouter" },
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
        <p className="text-2xs text-muted-foreground mt-0.5 leading-relaxed">
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

function ToolList({ tools }: { tools: McpToolInfo[] }) {
  if (tools.length === 0) return null;
  return (
    <details className="mt-2 group">
      <summary className="text-2xs text-muted-foreground cursor-pointer select-none list-none flex items-center gap-1 hover:text-foreground transition-colors">
        <span className="inline-block transition-transform group-open:rotate-90">
          ▶
        </span>
        {tools.length} tool{tools.length !== 1 ? "s" : ""}
      </summary>
      <ul className="mt-1.5 space-y-0.5 max-h-48 overflow-y-auto">
        {tools.map((tool) => (
          <li key={tool.name} className="flex items-start gap-1.5 text-2xs">
            <span
              className={`mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full ${
                tool.isMutating ? "bg-amber-400" : "bg-green-500"
              }`}
              title={tool.isMutating ? "write" : "read-only"}
            />
            <span
              className="font-mono text-foreground/80 truncate"
              title={tool.description}
            >
              {tool.name}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
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
  customMcpServers,
  onAddCustomServer,
  onRemoveCustomServer,
  onConnectCustomServer,
  onDisconnectCustomServer,
  mcpToolsByProvider,
}: SettingsPageProps) {
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof globalThis.matchMedia === "function"
      ? globalThis.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );
  const [linearTokenInput, setLinearTokenInput] = useState("");
  const [linearTokenError, setLinearTokenError] = useState("");
  const [customServerName, setCustomServerName] = useState("");
  const [customServerUrl, setCustomServerUrl] = useState("");
  const [customServerTransport, setCustomServerTransport] = useState<
    "streamable" | "sse"
  >("streamable");
  const [customServerToken, setCustomServerToken] = useState("");
  const [customServerError, setCustomServerError] = useState("");
  const addFormRef = useRef<HTMLFormElement>(null);

  const notionStatus = useMemo(
    () => mcpIntegrations.find((item) => item.provider === "notion"),
    [mcpIntegrations]
  );
  const linearStatus = useMemo(
    () => mcpIntegrations.find((item) => item.provider === "linear"),
    [mcpIntegrations]
  );
  const showDarkStyle =
    config.themeMode === "dark" ||
    (config.themeMode === "system" && systemPrefersDark);
  const showLightStyle = !showDarkStyle;

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const media = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    setSystemPrefersDark(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const languagesLoading = languages.length === 0;
  const set = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => {
    onConfigChange({ ...config, [key]: value });
  };

  return (
    <div className="aqua-settings flex-1 min-h-0 overflow-y-auto bg-background">
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
          <div className="mb-6 border border-amber-300/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 text-xs rounded-sm">
            Currently recording. Configuration updates will apply to the next
            session.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Row 1: Appearance + Session ── */}
          <section className="border border-border bg-card px-4 py-3 rounded-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Appearance
            </h2>
            <Separator className="my-3" />
            <SettingRow
              label="Theme"
              description="Choose light, dark, or follow your system theme."
              control={
                <div className={SEGMENTED_GROUP_CLASS}>
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={segmentedButtonClass(
                        config.themeMode === option.value
                      )}
                      onClick={() => set("themeMode", option.value)}
                    >
                      {option.icon}
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            />
            {showLightStyle && (
              <SettingRow
                label="Light Style"
                description="Color palette used in light mode."
                control={
                  <div className={SEGMENTED_GROUP_CLASS}>
                    {LIGHT_VARIANT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={segmentedButtonClass(
                          config.lightVariant === option.value
                        )}
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
            {showDarkStyle && (
              <SettingRow
                label="Dark Style"
                description="Color palette used in dark mode."
                control={
                  <div className={SEGMENTED_GROUP_CLASS}>
                    {DARK_VARIANT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={segmentedButtonClass(
                          config.darkVariant === option.value
                        )}
                        onClick={() => set("darkVariant", option.value)}
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
                <div className="inline-flex items-center border border-border rounded-sm overflow-hidden">
                  {FONT_SIZE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`aqua-segment ${config.fontSize === option.value ? "aqua-segment-active" : ""} h-8 px-2.5 text-xs inline-flex items-center gap-1.5 transition-colors ${
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
            <SettingRow
              label="UI Font"
              description="Sans for a clean look; serif for an editorial feel; mono for a terminal aesthetic."
              control={
                <div className="inline-flex items-center border border-border rounded-sm overflow-hidden">
                  {FONT_FAMILY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`aqua-segment ${config.fontFamily === option.value ? "aqua-segment-active" : ""} h-8 px-2.5 text-xs inline-flex items-center gap-1.5 transition-colors ${
                        config.fontFamily === option.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => set("fontFamily", option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            />
          </section>

          <section className="border border-border bg-card px-4 py-3 rounded-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Session
            </h2>
            <Separator className="my-3" />
            <div className="space-y-1">
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
              <SettingRow
                label="Auto-Delegate"
                description="Automatically launch agents for agent-classified tasks when a session summary is generated."
                control={
                  <Switch
                    checked={config.autoDelegate}
                    onCheckedChange={(v) => set("autoDelegate", v)}
                  />
                }
              />
            </div>
          </section>

          {/* ── Row 2: Transcription (full width) ── */}
          <section className="border border-border bg-card px-4 py-3 rounded-sm lg:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Transcription
            </h2>
            <Separator className="my-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-2xs text-muted-foreground">
                  Engine
                </label>
                <Select
                  value={getPresetKey(config.transcriptionProvider, config.transcriptionModelId)}
                  onValueChange={(key) => {
                    const preset = TRANSCRIPTION_PRESETS.find((p) => p.key === key);
                    if (!preset) return;
                    onConfigChange({
                      ...config,
                      transcriptionProvider: preset.provider,
                      transcriptionModelId: preset.modelId,
                      translationEnabled:
                        preset.provider === "vertex" || preset.provider === "openrouter"
                          ? config.translationEnabled
                          : false,
                    });
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSCRIPTION_PRESETS.map((preset) => (
                      <SelectItem key={preset.key} value={preset.key}>
                        <span>{preset.label}</span>
                        <span className="ml-1.5 text-2xs text-muted-foreground">
                          — {preset.description}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-2xs text-muted-foreground">
                  Language
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
              <div className="space-y-1">
                <label className="text-2xs text-muted-foreground">
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
            </div>
            {config.transcriptionProvider === "whisper" && (
              <p className="mt-3 text-2xs text-muted-foreground leading-relaxed">
                Whisper runs locally with no API key. Start with{" "}
                <code className="font-mono">Xenova/whisper-small</code> for
                better quality; it uses more memory than base/tiny.
              </p>
            )}
          </section>

          {/* ── Row 3: Translation (full width, only for translatable providers) ── */}
          {(config.transcriptionProvider === "vertex" ||
            config.transcriptionProvider === "openrouter") && (
            <section className="border border-border bg-card px-4 py-3 rounded-sm lg:col-span-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Translation
              </h2>
              <Separator className="my-3" />
              <SettingRow
                label="Translation"
                description="Enable real-time translation alongside transcription."
                control={
                  <Switch
                    checked={config.translationEnabled}
                    onCheckedChange={(v) => set("translationEnabled", v)}
                  />
                }
              />
              {config.translationEnabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div className="space-y-1">
                    <label className="text-2xs text-muted-foreground">
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
                  <div className="space-y-1">
                    <label className="text-2xs text-muted-foreground">
                      Direction
                    </label>
                    <Select
                      value={config.direction}
                      onValueChange={(v) => set("direction", v as Direction)}
                    >
                      <SelectTrigger size="sm" className="w-full">
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
                    <p className="text-2xs text-muted-foreground">
                      Auto-detect speaker language or always translate source to target.
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── Row 4: Agent Models (full width) ── */}
          <section className="border border-border bg-card px-4 py-3 rounded-sm lg:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Model Roles
            </h2>
            <Separator className="my-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-2xs text-muted-foreground">
                  Provider
                </label>
                <Select
                  value={config.analysisProvider}
                  onValueChange={(v) => set("analysisProvider", v as AppConfig["analysisProvider"])}
                  disabled
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
                <p className="text-2xs text-muted-foreground">OpenRouter (currently fixed)</p>
              </div>
              {config.analysisProvider === "openrouter" ? (
                <div className="space-y-1">
                  <label className="text-2xs text-muted-foreground">
                    Analysis Model
                  </label>
                  <Select
                    value={config.analysisModelId}
                    onValueChange={(modelId) => {
                      const preset = MODEL_PRESETS.find(
                        (p) => p.modelId === modelId
                      );
                      onConfigChange({
                        ...config,
                        analysisModelId: modelId,
                        analysisReasoning:
                          preset?.reasoning ?? config.analysisReasoning,
                        analysisProviderOnly: preset?.providerOnly,
                      });
                    }}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODEL_PRESETS.map((preset) => (
                        <SelectItem key={preset.modelId} value={preset.modelId}>
                          <span className="inline-flex items-center gap-1.5">
                            {preset.label}
                            {!!preset.reasoning && <kbd className="px-1 py-px rounded-sm bg-secondary font-mono text-2xs text-secondary-foreground">thinking</kbd>}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-2xs text-muted-foreground">
                    Live key points, insights, and agent reasoning
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-2xs text-muted-foreground">
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
                <label className="text-2xs text-muted-foreground">
                  Task Model
                </label>
                <Select
                  value={config.taskModelId}
                  onValueChange={(modelId) => {
                    const preset = MODEL_PRESETS.find(
                      (p) => p.modelId === modelId
                    );
                    onConfigChange({
                      ...config,
                      taskModelId: modelId,
                      taskProviders: preset?.providers ?? [],
                    });
                  }}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_PRESETS.map((preset) => (
                      <SelectItem key={preset.modelId} value={preset.modelId}>
                        <span className="inline-flex items-center gap-1.5">
                          {preset.label}
                          {!!preset.reasoning && <kbd className="px-1 py-px rounded-sm bg-secondary font-mono text-2xs text-secondary-foreground">thinking</kbd>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-2xs text-muted-foreground">
                  Task extraction and task-size classification
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-2xs text-muted-foreground">
                  Utility Model
                </label>
                <Select
                  value={config.utilityModelId}
                  onValueChange={(modelId) => set("utilityModelId", modelId)}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_PRESETS.map((preset) => (
                      <SelectItem key={preset.modelId} value={preset.modelId}>
                        <span className="inline-flex items-center gap-1.5">
                          {preset.label}
                          {!!preset.reasoning && <kbd className="px-1 py-px rounded-sm bg-secondary font-mono text-2xs text-secondary-foreground">thinking</kbd>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-2xs text-muted-foreground">
                  Titles and transcript post-processing
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-2xs text-muted-foreground">
                  Synthesis Model
                </label>
                <Select
                  value={config.synthesisModelId}
                  onValueChange={(modelId) => set("synthesisModelId", modelId)}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_PRESETS.map((preset) => (
                      <SelectItem key={preset.modelId} value={preset.modelId}>
                        <span className="inline-flex items-center gap-1.5">
                          {preset.label}
                          {!!preset.reasoning && <kbd className="px-1 py-px rounded-sm bg-secondary font-mono text-2xs text-secondary-foreground">thinking</kbd>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-2xs text-muted-foreground">
                  Session summary, agents summary, and agent learnings
                </p>
              </div>
            </div>
          </section>

          {/* ── Row 5: Advanced (full width) ── */}
          <section className="border border-border bg-card px-4 py-3 rounded-sm lg:col-span-2">
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
                  <label className="text-2xs text-muted-foreground">
                    Context File
                  </label>
                  <Input
                    value={config.contextFile}
                    onChange={(e) => set("contextFile", e.target.value)}
                    placeholder="context.md"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-2xs text-muted-foreground">
                    Vertex Project
                  </label>
                  <Input
                    value={config.vertexProject ?? ""}
                    onChange={(e) => set("vertexProject", e.target.value)}
                    placeholder="project-id"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-2xs text-muted-foreground">
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

          {/* ── Row 6: Integrations (full width) ── */}
          <section className="border border-border bg-card px-4 py-3 rounded-sm lg:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Integrations
            </h2>
            <Separator className="my-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="border border-border/70 bg-background px-3 py-3 rounded-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <NotionIcon className="w-4 h-4 shrink-0" />
                    <p className="text-xs font-semibold text-foreground">
                      Notion MCP
                    </p>
                  </div>
                  <span className="text-2xs text-muted-foreground">
                    {notionStatus?.state ?? "disconnected"}
                  </span>
                </div>
                <p className="mt-1 text-2xs text-muted-foreground leading-relaxed">
                  Hosted MCP via local OAuth callback.
                </p>
                {notionStatus?.error && (
                  <p className="mt-1 text-2xs text-destructive">
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
                <ToolList tools={mcpToolsByProvider["notion"]?.tools ?? []} />
              </div>

              <div className="border border-border/70 bg-background px-3 py-3 rounded-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <LinearIcon className="w-4 h-4 shrink-0" />
                    <p className="text-xs font-semibold text-foreground">
                      Linear MCP
                    </p>
                  </div>
                  <span className="text-2xs text-muted-foreground">
                    {linearStatus?.state ?? "disconnected"}
                  </span>
                </div>
                <p className="mt-1 text-2xs text-muted-foreground leading-relaxed">
                  Token-based access for Linear MCP.
                </p>
                {linearStatus?.error && (
                  <p className="mt-1 text-2xs text-destructive">
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
                  <p className="mt-1 text-2xs text-destructive">
                    {linearTokenError}
                  </p>
                )}
                <ToolList tools={mcpToolsByProvider["linear"]?.tools ?? []} />
              </div>
            </div>

            {/* ── Custom MCP Servers ── */}
            <div className="mt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Custom MCP Servers
              </p>
              <form
                ref={addFormRef}
                className="flex flex-wrap gap-2 mb-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setCustomServerError("");
                  const result = await onAddCustomServer({
                    name: customServerName,
                    url: customServerUrl,
                    transport: customServerTransport,
                    bearerToken: customServerToken || undefined,
                  });
                  if (!result.ok) {
                    setCustomServerError(
                      result.error ?? "Failed to add server."
                    );
                    return;
                  }
                  setCustomServerName("");
                  setCustomServerUrl("");
                  setCustomServerToken("");
                  setCustomServerTransport("streamable");
                }}
              >
                <Input
                  value={customServerName}
                  onChange={(e) => setCustomServerName(e.target.value)}
                  placeholder="Name"
                  className="w-28 shrink-0"
                  required
                  disabled={mcpBusy}
                />
                <Input
                  value={customServerUrl}
                  onChange={(e) => setCustomServerUrl(e.target.value)}
                  placeholder="https://mcp.example.com/mcp"
                  className="flex-1 min-w-40"
                  required
                  disabled={mcpBusy}
                />
                <Select
                  value={customServerTransport}
                  onValueChange={(v) =>
                    setCustomServerTransport(v as "streamable" | "sse")
                  }
                  disabled={mcpBusy}
                >
                  <SelectTrigger className="w-36 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="streamable">Streamable HTTP</SelectItem>
                    <SelectItem value="sse">SSE</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="password"
                  value={customServerToken}
                  onChange={(e) => setCustomServerToken(e.target.value)}
                  placeholder="Bearer token (optional)"
                  className="w-44 shrink-0"
                  disabled={mcpBusy}
                />
                <Button type="submit" size="sm" disabled={mcpBusy}>
                  Add
                </Button>
              </form>
              {customServerError && (
                <p className="mb-2 text-2xs text-destructive">
                  {customServerError}
                </p>
              )}
              {customMcpServers.length > 0 && (
                <div className="space-y-1.5">
                  {customMcpServers.map((server) => {
                    const serverTools =
                      mcpToolsByProvider[`custom:${server.id}`]?.tools ?? [];
                    const ProviderIcon = resolveProviderIcon(server.url);
                    return (
                      <div
                        key={server.id}
                        className="border border-border/70 bg-background px-3 py-2 rounded-sm"
                      >
                        <div className="flex items-center gap-2">
                          {ProviderIcon ? (
                            <ProviderIcon className="w-4 h-4 shrink-0" />
                          ) : (
                            <ServerIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">
                              {server.name}
                            </p>
                            <p className="text-2xs text-muted-foreground truncate">
                              {server.url}
                            </p>
                            {server.error && (
                              <p className="text-2xs text-destructive truncate">
                                {server.error}
                              </p>
                            )}
                          </div>
                          <span
                            className={`shrink-0 text-2xs px-1.5 py-0.5 rounded-full ${
                              server.state === "connected"
                                ? "bg-green-500/15 text-green-600 dark:text-green-400"
                                : server.state === "error"
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {server.state}
                          </span>
                          {server.state === "connected" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void onDisconnectCustomServer(server.id)
                              }
                              disabled={mcpBusy}
                            >
                              Disconnect
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void onConnectCustomServer(server.id)
                              }
                              disabled={mcpBusy}
                            >
                              Connect
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void onRemoveCustomServer(server.id)}
                            disabled={mcpBusy}
                            className="text-muted-foreground hover:text-destructive shrink-0"
                          >
                            ✕
                          </Button>
                        </div>
                        <ToolList tools={serverTools} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
