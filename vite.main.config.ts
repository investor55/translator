import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      external: ["audiotee", "macos-audio-devices", "electron", "electron/renderer", "better-sqlite3", "drizzle-orm", "exa-js"],
      output: {
        format: "cjs",
      },
    },
  },
  resolve: {
    conditions: ["node"],
    mainFields: ["module", "jsnext:main", "jsnext"],
  },
});
