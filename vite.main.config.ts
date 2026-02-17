import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        "audiotee",
        "macos-audio-devices",
        "electron",
        "electron/renderer",
        "better-sqlite3",
        "drizzle-orm",
        "exa-js",
        "@elevenlabs/elevenlabs-js",
        "ws",
        "bufferutil",
        "utf-8-validate",
        "@huggingface/transformers",
        "onnxruntime-node",
      ],
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
