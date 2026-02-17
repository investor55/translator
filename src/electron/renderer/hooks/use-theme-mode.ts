import { useEffect } from "react";
import type { ThemeMode } from "../../../core/types";

export function useThemeMode(themeMode: ThemeMode) {
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      document.documentElement.classList.remove("dark");
      document.body.classList.remove("dark");
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const shouldUseDark =
        themeMode === "dark" || (themeMode === "system" && media.matches);
      document.documentElement.classList.toggle("dark", shouldUseDark);
      document.body.classList.toggle("dark", shouldUseDark);
    };

    applyTheme();
    if (themeMode !== "system") return;

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", applyTheme);
      return () => media.removeEventListener("change", applyTheme);
    }

    media.addListener(applyTheme);
    return () => media.removeListener(applyTheme);
  }, [themeMode]);
}
