import * as dgram from 'dgram';
import * as net from 'net';
import { EventEmitter } from 'events';
import { TslParser } from '../protocol/parser';
import { TslBuilder } from '../protocol/builder';
import { ParsedPacket, TslMessage } from '../protocol/types';

export interface NetworkEvents {
  'packet': (packet: ParsedPacket) => void;
  'error': (error: Error) => void;
  'status': (status: string) => void;
  'connected': () => void;
  'disconnected': () => void;
}

export class UdpServer extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private port: number;
  private running = false;

  constructor(port: number = 5000) {
    super();
    this.port = port;
  }

  start(): void {
    if (this.running) return;

    this.socket = dgram.createSocket('udp4');

    this.socket.on('message', (msg, rinfo) => {
      const packet = this.parsePacket(msg, `${rinfo.address}:${rinfo.port}`);
      this.emit('packet', packet);
    });

    this.socket.on('error', (err) => {
      this.emit('error', err);
    });

    this.socket.on('listening', () => {
      const addr = this.socket!.address();
      this.emit('status', `UDP Server listening on ${addr.address}:${addr.port}`);
      this.running = true;
    });

    this.socket.bind(this.port);
  }

  stop(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.running = false;
      this.emit('status', 'UDP Server stopped');
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private parsePacket(buffer: Buffer, source: string): ParsedPacket {
    const parsed = TslParser.parse(buffer);
    return {
      timestamp: new Date(),
      rawData: buffer,
      hexDump: TslParser.hexDump(buffer),
      parsed,
      error: parsed ? undefined : 'Failed to parse packet',
      source
    };
  }
}

export class UdpClient extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private targetHost: string;
  private targetPort: number;

  constructor(host: string = '127.0.0.1', port: number = 5000) {
    super();
    this.targetHost = host;
    this.targetPort = port;
  }

  connect(): void {
    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', (err) => {
      this.emit('error', err);
    });
    this.emit('status', `UDP Client ready to send to ${this.targetHost}:${this.targetPort}`);
  }

  send(buffer: Buffer): void {
    if (!this.socket) {
      this.connect();
    }
    this.socket!.send(buffer, this.targetPort, this.targetHost, (err) => {
      if (err) {
        this.emit('error', err);
      } else {
        const packet: ParsedPacket = {
          timestamp: new Date(),
          rawData: buffer,
          hexDump: TslParser.hexDump(buffer),
          parsed: TslParser.parse(buffer),
          source: 'Sent'
        };
        this.emit('packet', packet);
      }
    });
  }

  setTarget(host: string, port: number): void {
    this.targetHost = host;
    this.targetPort = port;
    this.emit('status', `Target set to ${host}:${port}`);
  }

  close(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.emit('status', 'UDP Client closed');
    }
  }
}

export class TcpServer extends EventEmitter {
  private server: net.Server | null = null;
  private clients: Set<net.Socket> = new Set();
  private port: number;
  private running = false;
  private receiveBuffer: Buffer = Buffer.alloc(0);

  constructor(port: number = 5000) {
    super();
    this.port = port;
  }

  start(): void {
    if (this.running) return;

    this.server = net.createServer((socket) => {
      this.clients.add(socket);
      const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
      this.emit('status', `TCP Client connected: ${clientAddr}`);
      this.emit('connected');

      socket.on('data', (data) => {
        this.handleData(data, clientAddr);
      });

      socket.on('close', () => {
        this.clients.delete(socket);
        this.emit('status', `TCP Client disconnected: ${clientAddr}`);
        this.emit('disconnected');
      });

      socket.on('error', (err) => {
        this.emit('error', err);
      });
    });

    this.server.on('error', (err) => {
      this.emit('error', err);
    });

    this.server.listen(this.port, () => {
      this.emit('status', `TCP Server listening on port ${this.port}`);
      this.running = true;
    });
  }

  private handleData(data: Buffer, source: string): void {
    // Append to receive buffer
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);

    // Try to extract complete packets
    while (this.receiveBuffer.length > 0) {
      // Try to unwrap TCP framed packet (V5.0)
      const unwrapped = TslBuilder.unwrapFromTcp(this.receiveBuffer);
      if (unwrapped) {
        const packet = this.parsePacket(unwrapped, source);
        this.emit('packet', packet);
        // Find end of this packet and remove from buffer
        // For simplicity, clear the buffer after processing
        this.receiveBuffer = Buffer.alloc(0);
        break;
      }

      // Try V3.1/V4.0 (fixed size packets)
      if (this.receiveBuffer.length >= 18) {
        const version = TslParser.detectVersion(this.receiveBuffer);
        if (version === '3.1' && this.receiveBuffer.length >= 18) {
          const packetData = this.receiveBuffer.slice(0, 18);
          this.receiveBuffer = this.receiveBuffer.slice(18);
          const packet = this.parsePacket(packetData, source);
          this.emit('packet', packet);
          continue;
        }
        if (version === '4.0' && this.receiveBuffer.length >= 22) {
          const packetData = this.receiveBuffer.slice(0, 22);
          this.receiveBuffer = this.receiveBuffer.slice(22);
          const packet = this.parsePacket(packetData, source);
          this.emit('packet', packet);
          continue;
        }
      }

      // If we can't parse anything, emit raw data as packet
      if (this.receiveBuffer.length > 0) {
        const packet = this.parsePacket(this.receiveBuffer, source);
        this.emit('packet', packet);
        this.receiveBuffer = Buffer.alloc(0);
      }
      break;
    }
  }

  stop(): void {
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
      this.running = false;
      this.emit('status', 'TCP Server stopped');
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  private parsePacket(buffer: Buffer, source: string): ParsedPacket {
    const parsed = TslParser.parse(buffer);
    return {
      timestamp: new Date(),
      rawData: buffer,
      hexDump: TslParser.hexDump(buffer),
      parsed,
      error: parsed ? undefined : 'Failed to parse packet',
      source
    };
  }
}

export class TcpClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private host: string;
  private port: number;
  private connected = false;
  private receiveBuffer: Buffer = Buffer.alloc(0);

  constructor(host: string = '127.0.0.1', port: number = 5000) {
    super();
    this.host = host;
    this.port = port;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();

      this.socket.on('connect', () => {
        this.connected = true;
        this.emit('status', `Connected to ${this.host}:${this.port}`);
        this.emit('connected');
        resolve();
      });

      this.socket.on('data', (data) => {
        this.handleData(data);
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.emit('status', 'Disconnected');
        this.emit('disconnected');
      });

      this.socket.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.socket.connect(this.port, this.host);
    });
  }

  private handleData(data: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);

    while (this.receiveBuffer.length > 0) {
      const unwrapped = TslBuilder.unwrapFromTcp(this.receiveBuffer);
      if (unwrapped) {
        const packet: ParsedPacket = {
          timestamp: new Date(),
          rawData: unwrapped,
          hexDump: TslParser.hexDump(unwrapped),
          parsed: TslParser.parse(unwrapped),
          source: 'Received'
        };
        this.emit('packet', packet);
        this.receiveBuffer = Buffer.alloc(0);
        break;
      }

      if (this.receiveBuffer.length >= 18) {
        const version = TslParser.detectVersion(this.receiveBuffer);
        let packetLen = 18;
        if (version === '4.0') packetLen = 22;

        if (this.receiveBuffer.length >= packetLen) {
          const packetData = this.receiveBuffer.slice(0, packetLen);
          this.receiveBuffer = this.receiveBuffer.slice(packetLen);
          const packet: ParsedPacket = {
            timestamp: new Date(),
            rawData: packetData,
            hexDump: TslParser.hexDump(packetData),
            parsed: TslParser.parse(packetData),
            source: 'Received'
          };
          this.emit('packet', packet);
          continue;
        }
      }
      break;
    }
  }

  send(buffer: Buffer): void {
    if (!this.socket || !this.connected) {
      this.emit('error', new Error('Not connected'));
      return;
    }

    this.socket.write(buffer, (err) => {
      if (err) {
        this.emit('error', err);
      } else {
        const packet: ParsedPacket = {
          timestamp: new Date(),
          rawData: buffer,
          hexDump: TslParser.hexDump(buffer),
          parsed: TslParser.parse(buffer),
          source: 'Sent'
        };
        this.emit('packet', packet);
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  setTarget(host: string, port: number): void {
    this.host = host;
    this.port = port;
  }
}
