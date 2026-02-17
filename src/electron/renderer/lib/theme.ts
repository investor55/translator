import type { ThemeMode } from "../../../core/types";

const APP_CONFIG_STORAGE_KEY = "rosetta-app-config";
const LIGHT_BACKGROUND = "oklch(0.985 0.002 90)";
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

export function applyThemeClass(shouldUseDark: boolean) {
  document.documentElement.classList.toggle("dark", shouldUseDark);
  document.documentElement.style.colorScheme = shouldUseDark ? "dark" : "light";
  document.documentElement.style.backgroundColor = shouldUseDark
    ? DARK_BACKGROUND
    : LIGHT_BACKGROUND;
  document.body?.classList.toggle("dark", shouldUseDark);
}
