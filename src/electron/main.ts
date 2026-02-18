import { app, BrowserWindow } from "electron";
import path from "node:path";
import "dotenv/config";
import { registerIpcHandlers, shutdownSessionOnAppQuit } from "./ipc-handlers";
import { createDatabase, type AppDatabase } from "../core/db/db";
import { log } from "../core/logger";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let db: AppDatabase | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#FAFAF8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  if (process.env.NODE_ENV === "development" || MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath("userData"), "ambient.db");
  db = createDatabase(dbPath);
  const staleAgentCount = db.failStaleRunningAgents("Interrupted because the app quit before completion.");
  if (staleAgentCount > 0) {
    log("WARN", `Recovered ${staleAgentCount} stale running agent(s) as failed on startup`);
  }

  registerIpcHandlers(() => mainWindow, db);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  shutdownSessionOnAppQuit();
  db?.close();
  db = null;
});

app.on("window-all-closed", () => {
  app.quit();
});
