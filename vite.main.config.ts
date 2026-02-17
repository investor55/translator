import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Provide build.lib explicitly so forge's plugin skips its own single-entry setup
    // and we can co-build whisper helper entrypoints alongside main.js in .vite/build/.
    lib: {
      entry: {
        main: "src/electron/main.ts",
        "whisper-worker": "src/core/whisper-worker.ts",
        "whisper-child": "src/core/whisper-child.ts",
      },
      formats: ["cjs"],
      fileName: () => "[name].js",
    },
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
    },
  },
  resolve: {
    conditions: ["node"],
    mainFields: ["module", "jsnext:main", "jsnext"],
  },
});
