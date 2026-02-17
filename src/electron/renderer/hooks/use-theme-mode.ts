import { useEffect } from "react";
import type { ThemeMode } from "../../../core/types";
import { applyThemeClass } from "../lib/theme";

export function useThemeMode(themeMode: ThemeMode) {
  useEffect(() => {
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;

    const applyTheme = () => {
      const shouldUseDark =
        themeMode === "dark" || (themeMode === "system" && !!media?.matches);
      applyThemeClass(shouldUseDark);
    };

    applyTheme();
    if (themeMode !== "system" || !media) return;

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", applyTheme);
      return () => media.removeEventListener("change", applyTheme);
    }

    media.addListener(applyTheme);
    return () => media.removeListener(applyTheme);
  }, [themeMode]);
}
