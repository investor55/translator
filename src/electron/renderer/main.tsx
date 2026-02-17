import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles/global.css";

try {
  const raw = window.localStorage.getItem("rosetta-app-config");
  const parsed = raw ? JSON.parse(raw) as { themeMode?: "system" | "light" | "dark" } : null;
  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const shouldUseDark =
    parsed?.themeMode === "dark" ||
    (parsed?.themeMode !== "light" && prefersDark);
  document.documentElement.classList.toggle("dark", shouldUseDark);
  document.body.classList.toggle("dark", shouldUseDark);
} catch {
  // Ignore malformed local storage and fall back to system preference.
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
