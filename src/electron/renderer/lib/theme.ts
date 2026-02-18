import type { FontFamily, FontSize, LightVariant, ThemeMode } from "../../../core/types";

const FONT_SIZE_PX: Record<FontSize, string> = {
  sm: "14px",
  md: "16px",
  lg: "18px",
};

const APP_CONFIG_STORAGE_KEY = "ambient-app-config";
const LIGHT_BACKGROUND = "oklch(0.985 0.002 90)";
const LINEN_BACKGROUND = "#EEEEEE";
const DARK_BACKGROUND = "oklch(0.145 0 0)";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function readStoredThemeMode(): ThemeMode | undefined {
  try {
    const raw = window.localStorage.getItem(APP_CONFIG_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { themeMode?: unknown };
    return isThemeMode(parsed.themeMode) ? parsed.themeMode : undefined;
  } catch {
    return undefined;
  }
}

export function resolveShouldUseDark(themeMode: ThemeMode | undefined): boolean {
  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return themeMode === "dark" || (themeMode !== "light" && prefersDark);
}

export function applyThemeClass(shouldUseDark: boolean, lightVariant: LightVariant = "warm", fontSize: FontSize = "md", fontFamily: FontFamily = "sans") {
  const isLinen = !shouldUseDark && lightVariant === "linen";
  document.documentElement.classList.toggle("dark", shouldUseDark);
  document.documentElement.classList.toggle("light-linen", isLinen);
  document.documentElement.style.colorScheme = shouldUseDark ? "dark" : "light";
  document.documentElement.style.backgroundColor = shouldUseDark
    ? DARK_BACKGROUND
    : isLinen
      ? LINEN_BACKGROUND
      : LIGHT_BACKGROUND;
  document.documentElement.style.fontSize = FONT_SIZE_PX[fontSize];
  document.documentElement.classList.toggle("font-ui-mono", fontFamily === "mono");
  document.body?.classList.toggle("dark", shouldUseDark);
  document.body?.classList.toggle("light-linen", isLinen);
}
