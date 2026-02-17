import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: "./assets/icon",
    appBundleId: "com.rosetta.translator",
    extraResource: ["./node_modules/audiotee"],
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
