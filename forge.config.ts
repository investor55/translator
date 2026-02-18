import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import * as path from "path";
import * as fs from "fs";

const config: ForgeConfig = {
  packagerConfig: {
    // Modules marked external in vite.main.config.ts are not bundled by Vite,
    // so they must be copied into node_modules before the asar is created.
    // Modules with native binaries must also be unpacked so they can be executed.
    asar: {
      unpackDir:
        "node_modules/{audiotee,macos-audio-devices,better-sqlite3,bufferutil,utf-8-validate,onnxruntime-node}",
    },
    icon: "./assets/icon",
    appBundleId: "com.ambient.app",
    afterCopy: [
      (buildPath, _electronVersion, _platform, _arch, callback) => {
        // Pure module name → copy from root node_modules/name
        // Scoped module name (@scope/pkg) → copy from root node_modules/@scope/pkg
        const externalModules = [
          "audiotee",
          "macos-audio-devices",
          "better-sqlite3",
          "drizzle-orm",
          "exa-js",
          "@elevenlabs/elevenlabs-js",
          "ws",
          "bufferutil",
          "utf-8-validate",
          "@huggingface/transformers",
          "onnxruntime-node",
        ];

        for (const mod of externalModules) {
          const src = path.resolve(__dirname, "node_modules", mod);
          const dst = path.resolve(buildPath, "node_modules", mod);
          if (fs.existsSync(src)) {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.cpSync(src, dst, { recursive: true });
          }
        }
        callback();
      },
    ],
    osxSign: {
      optionsForFile: () => ({
        entitlements: "./assets/entitlements.plist",
      }),
    },
    darwinDarkModeSupport: true,
    extendInfo: {
      NSScreenCaptureUsageDescription:
        "Ambient needs screen capture access to record system audio.",
      NSMicrophoneUsageDescription:
        "Ambient needs microphone access to capture your voice.",
    },
  },
  makers: [
    new MakerDMG({
      format: "ULFO",
    }),
    new MakerZIP({}, ["darwin"]),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: "src/electron/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/electron/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
