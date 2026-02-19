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

  ipcMain.handle("add-custom-mcp-server", async (_event, cfg: { name: string; url: string; transport: "streamable" | "sse"; bearerToken?: string }) => {
    return integrations.addCustomMcpServer(cfg);
  });

  ipcMain.handle("remove-custom-mcp-server", async (_event, id: string) => {
    return integrations.removeCustomMcpServer(id);
  });

  ipcMain.handle("connect-custom-mcp-server", async (_event, id: string) => {
    return integrations.connectCustomMcpServer(id);
  });

  ipcMain.handle("disconnect-custom-mcp-server", async (_event, id: string) => {
    return integrations.disconnectCustomMcpServer(id);
  });

  ipcMain.handle("get-custom-mcp-servers-status", async () => {
    return integrations.getCustomMcpServersStatus();
  });

  ipcMain.handle("get-mcp-tools-info", async () => {
    return integrations.getMcpToolsInfo();
  });
}
