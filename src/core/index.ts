// Barrel export for core modules
export { Session } from "./session";
export { log } from "./logger";
export { parseArgs, validateEnv, printHelp } from "./config";
export { pcmToWavBuffer, isAudioSilent } from "./audio-utils";
export { normalizeText, cleanTranslationOutput, toReadableError } from "./text-utils";
export {
  LANG_NAMES,
  getLanguageLabel,
  getLanguageName,
  isValidLangCode,
  hasTranslatableContent,
  detectSourceLanguage,
  extractSentences,
  buildAudioPromptForStructured,
} from "./language";
export {
  checkMacOSVersion,
  createAudioRecorder,
  listAvfoundationDevices,
  selectAudioDevice,
  formatDevices,
  spawnFfmpeg,
  type AudioRecorder,
} from "./audio";
export type {
  LanguageCode,
  Language,
  Direction,
  Device,
  TranscriptBlock,
  Summary,
  UIState,
  IntroSelection,
  SessionConfig,
  CliConfig,
  SessionEvents,
  TranscriptionProvider,
  AnalysisProvider,
} from "./types";
export {
  SUPPORTED_LANGUAGES,
  DEFAULT_VERTEX_MODEL_ID,
  DEFAULT_VERTEX_LOCATION,
  DEFAULT_TRANSCRIPTION_MODEL_ID,
  DEFAULT_ANALYSIS_MODEL_ID,
  DEFAULT_INTERVAL_MS,
} from "./types";
