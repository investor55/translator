import { ipcMain } from "electron";
import type { IntegrationManager } from "../integrations/types";

export function registerIntegrationHandlers(integrations: IntegrationManager) {
  ipcMain.handle("get-mcp-integrations-status", async () => {
    return integrations.getStatus();
  });

  ipcMain.handle("connect-notion-mcp", async () => {
    return integrations.connectNotion();
  });

  ipcMain.handle("disconnect-notion-mcp", async () => {
    return integrations.disconnectNotion();
  });

  ipcMain.handle("set-linear-mcp-token", async (_event, token: string) => {
    return integrations.setLinearToken(token);
  });

  ipcMain.handle("clear-linear-mcp-token", async () => {
    return integrations.clearLinearToken();
  });
}
