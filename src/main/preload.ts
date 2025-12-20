import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('tslApi', {
  // UDP Server
  udpServerStart: (port: number) => ipcRenderer.invoke('udp-server-start', port),
  udpServerStop: () => ipcRenderer.invoke('udp-server-stop'),

  // UDP Client
  udpClientSend: (host: string, port: number, data: number[]) =>
    ipcRenderer.invoke('udp-client-send', { host, port, data }),

  // TCP Server
  tcpServerStart: (port: number) => ipcRenderer.invoke('tcp-server-start', port),
  tcpServerStop: () => ipcRenderer.invoke('tcp-server-stop'),

  // TCP Client
  tcpClientConnect: (host: string, port: number) =>
    ipcRenderer.invoke('tcp-client-connect', { host, port }),
  tcpClientDisconnect: () => ipcRenderer.invoke('tcp-client-disconnect'),
  tcpClientSend: (data: number[]) => ipcRenderer.invoke('tcp-client-send', data),

  // Message builders
  buildV31: (message: unknown) => ipcRenderer.invoke('build-v31', message),
  buildV40: (message: unknown) => ipcRenderer.invoke('build-v40', message),
  buildV50: (message: unknown) => ipcRenderer.invoke('build-v50', message),
  buildV50Tcp: (message: unknown) => ipcRenderer.invoke('build-v50-tcp', message),

  // Parser
  parseHex: (hexString: string) => ipcRenderer.invoke('parse-hex', hexString),

  // Event listeners
  onPacketReceived: (callback: (packet: unknown) => void) => {
    ipcRenderer.on('packet-received', (_, packet) => callback(packet));
  },
  onPacketSent: (callback: (packet: unknown) => void) => {
    ipcRenderer.on('packet-sent', (_, packet) => callback(packet));
  },
  onStatusUpdate: (callback: (status: unknown) => void) => {
    ipcRenderer.on('status-update', (_, status) => callback(status));
  },
  onError: (callback: (error: unknown) => void) => {
    ipcRenderer.on('error', (_, error) => callback(error));
  },
  onTcpClientConnected: (callback: (connected: boolean) => void) => {
    ipcRenderer.on('tcp-client-connected', (_, connected) => callback(connected));
  }
});
