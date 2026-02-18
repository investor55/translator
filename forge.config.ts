import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import * as path from "path";
import * as fs from "fs";

const config: ForgeConfig = {
  packagerConfig: {
    asar: { unpackDir: "node_modules/audiotee" },
    icon: "./assets/icon",
    appBundleId: "com.ambient.app",
    afterCopy: [
      (buildPath, _electronVersion, _platform, _arch, callback) => {
        const src = path.resolve(__dirname, "node_modules", "audiotee");
        const dst = path.resolve(buildPath, "node_modules", "audiotee");
        fs.cpSync(src, dst, { recursive: true });
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
