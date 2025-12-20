import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { UdpServer, UdpClient, TcpServer, TcpClient } from './network';
import { TslBuilder } from '../protocol/builder';
import { TslParser } from '../protocol/parser';
import {
  TslV31Message,
  TslV40Message,
  TslV50Message,
  ParsedPacket
} from '../protocol/types';

let mainWindow: BrowserWindow | null = null;

// Network instances
let udpServer: UdpServer | null = null;
let udpClient: UdpClient | null = null;
let tcpServer: TcpServer | null = null;
let tcpClient: TcpClient | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendToRenderer(channel: string, data: unknown) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, data);
  }
}

function setupIpcHandlers() {
  // UDP Server handlers
  ipcMain.handle('udp-server-start', async (_, port: number) => {
    try {
      if (udpServer) udpServer.stop();
      udpServer = new UdpServer(port);

      udpServer.on('packet', (packet: ParsedPacket) => {
        sendToRenderer('packet-received', packet);
      });

      udpServer.on('status', (status: string) => {
        sendToRenderer('status-update', { type: 'udp-server', status });
      });

      udpServer.on('error', (error: Error) => {
        sendToRenderer('error', { type: 'udp-server', message: error.message });
      });

      udpServer.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('udp-server-stop', async () => {
    if (udpServer) {
      udpServer.stop();
      udpServer = null;
    }
    return { success: true };
  });

  // UDP Client handlers
  ipcMain.handle('udp-client-send', async (_, { host, port, data }: { host: string; port: number; data: number[] }) => {
    try {
      if (!udpClient) {
        udpClient = new UdpClient(host, port);

        udpClient.on('packet', (packet: ParsedPacket) => {
          sendToRenderer('packet-sent', packet);
        });

        udpClient.on('status', (status: string) => {
          sendToRenderer('status-update', { type: 'udp-client', status });
        });

        udpClient.on('error', (error: Error) => {
          sendToRenderer('error', { type: 'udp-client', message: error.message });
        });
      } else {
        udpClient.setTarget(host, port);
      }

      udpClient.send(Buffer.from(data));
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // TCP Server handlers
  ipcMain.handle('tcp-server-start', async (_, port: number) => {
    try {
      if (tcpServer) tcpServer.stop();
      tcpServer = new TcpServer(port);

      tcpServer.on('packet', (packet: ParsedPacket) => {
        sendToRenderer('packet-received', packet);
      });

      tcpServer.on('status', (status: string) => {
        sendToRenderer('status-update', { type: 'tcp-server', status });
      });

      tcpServer.on('error', (error: Error) => {
        sendToRenderer('error', { type: 'tcp-server', message: error.message });
      });

      tcpServer.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('tcp-server-stop', async () => {
    if (tcpServer) {
      tcpServer.stop();
      tcpServer = null;
    }
    return { success: true };
  });

  // TCP Client handlers
  ipcMain.handle('tcp-client-connect', async (_, { host, port }: { host: string; port: number }) => {
    try {
      if (tcpClient) tcpClient.disconnect();
      tcpClient = new TcpClient(host, port);

      tcpClient.on('packet', (packet: ParsedPacket) => {
        sendToRenderer('packet-received', packet);
      });

      tcpClient.on('status', (status: string) => {
        sendToRenderer('status-update', { type: 'tcp-client', status });
      });

      tcpClient.on('error', (error: Error) => {
        sendToRenderer('error', { type: 'tcp-client', message: error.message });
      });

      tcpClient.on('connected', () => {
        sendToRenderer('tcp-client-connected', true);
      });

      tcpClient.on('disconnected', () => {
        sendToRenderer('tcp-client-connected', false);
      });

      await tcpClient.connect();
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('tcp-client-disconnect', async () => {
    if (tcpClient) {
      tcpClient.disconnect();
      tcpClient = null;
    }
    return { success: true };
  });

  ipcMain.handle('tcp-client-send', async (_, data: number[]) => {
    try {
      if (!tcpClient || !tcpClient.isConnected()) {
        return { success: false, error: 'Not connected' };
      }
      tcpClient.send(Buffer.from(data));
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Message building handlers
  ipcMain.handle('build-v31', async (_, message: TslV31Message) => {
    const buffer = TslBuilder.buildV31(message);
    return Array.from(buffer);
  });

  ipcMain.handle('build-v40', async (_, message: TslV40Message) => {
    const buffer = TslBuilder.buildV40(message);
    return Array.from(buffer);
  });

  ipcMain.handle('build-v50', async (_, message: TslV50Message) => {
    const buffer = TslBuilder.buildV50(message);
    return Array.from(buffer);
  });

  ipcMain.handle('build-v50-tcp', async (_, message: TslV50Message) => {
    const buffer = TslBuilder.buildV50(message);
    const wrapped = TslBuilder.wrapForTcp(buffer);
    return Array.from(wrapped);
  });

  ipcMain.handle('parse-hex', async (_, hexString: string) => {
    try {
      const cleanHex = hexString.replace(/[\s,]/g, '');
      const buffer = Buffer.from(cleanHex, 'hex');
      const parsed = TslParser.parse(buffer);
      const hexDump = TslParser.hexDump(buffer);
      return { success: true, parsed, hexDump };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  // Clean up network resources
  if (udpServer) udpServer.stop();
  if (udpClient) udpClient.close();
  if (tcpServer) tcpServer.stop();
  if (tcpClient) tcpClient.disconnect();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
