// Re-export from core for backward compatibility
export type { LanguageCode, Language, IntroSelection } from "./core/types";
export { SUPPORTED_LANGUAGES } from "./core/types";
export { getLanguageName, getLanguageLabel } from "./core/language";
export { showIntroScreen } from "./terminal/intro-screen";
