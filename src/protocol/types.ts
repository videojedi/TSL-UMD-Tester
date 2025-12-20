// TSL UMD Protocol Types

export enum TallyState {
  OFF = 0,
  RED = 1,
  GREEN = 2,
  AMBER = 3
}

export enum Brightness {
  OFF = 0,
  LOW = 1,      // 1/7 brightness
  MEDIUM = 2,   // 1/2 brightness
  FULL = 3
}

export enum ProtocolVersion {
  V3_1 = '3.1',
  V4_0 = '4.0',
  V5_0 = '5.0'
}

// Base message structure for V3.1/V4.0
export interface TslBaseMessage {
  address: number;        // 0-126
  tally1: boolean;
  tally2: boolean;
  tally3: boolean;
  tally4: boolean;
  brightness: Brightness;
  displayText: string;    // 16 characters
}

// V3.1 Message Structure
export interface TslV31Message extends TslBaseMessage {
  version: ProtocolVersion.V3_1;
}

// V4.0 Extended Message
export interface TslV40Message extends TslBaseMessage {
  version: ProtocolVersion.V4_0;
  leftDisplay: {
    leftTally: TallyState;
    textTally: TallyState;
    rightTally: TallyState;
  };
  rightDisplay: {
    leftTally: TallyState;
    textTally: TallyState;
    rightTally: TallyState;
  };
}

// V5.0 Display Message
export interface TslV50DisplayMessage {
  index: number;          // 0-65534
  rightTally: TallyState;
  textTally: TallyState;
  leftTally: TallyState;
  brightness: Brightness;
  text: string;
}

export interface TslV50Message {
  version: ProtocolVersion.V5_0;
  packetByteCount: number;
  minorVersion: number;
  flags: {
    unicode: boolean;
    screenControl: boolean;
  };
  screen: number;
  displays: TslV50DisplayMessage[];
}

export type TslMessage = TslV31Message | TslV40Message | TslV50Message;

// Connection types
export interface ConnectionConfig {
  type: 'udp' | 'tcp';
  mode: 'server' | 'client';
  host: string;
  port: number;
}

// Parsed packet info for logging
export interface ParsedPacket {
  timestamp: Date;
  rawData: Buffer;
  hexDump: string;
  parsed: TslMessage | null;
  error?: string;
  source: string;
}
