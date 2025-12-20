import {
  TslMessage,
  TslV31Message,
  TslV40Message,
  TslV50Message,
  TslV50DisplayMessage,
  ProtocolVersion,
  Brightness,
  TallyState
} from './types';

export class TslParser {

  // Detect protocol version from buffer
  static detectVersion(buffer: Buffer): ProtocolVersion | null {
    if (buffer.length < 2) return null;

    // V5.0: Check if first two bytes could be a valid packet byte count
    // V5.0 packets have PBC as first 16 bits (little-endian)
    if (buffer.length >= 6) {
      const pbc = buffer.readUInt16LE(0);
      // If PBC matches remaining buffer length, likely V5.0
      if (pbc === buffer.length - 2) {
        return ProtocolVersion.V5_0;
      }
    }

    // V3.1/V4.0: Header byte should be 0x80 + address (0x80-0xFE)
    const header = buffer[0];
    if (header >= 0x80 && header <= 0xFE) {
      // Check if V4.0 (has checksum after 18 bytes)
      if (buffer.length > 18) {
        // Calculate V3.1 checksum to verify V4.0
        let sum = 0;
        for (let i = 0; i < 18; i++) {
          sum += buffer[i];
        }
        const expectedChecksum = ((~sum + 1) & 0x7F);
        if (buffer[18] === expectedChecksum) {
          return ProtocolVersion.V4_0;
        }
      }
      return ProtocolVersion.V3_1;
    }

    return null;
  }

  // Parse V3.1 message
  static parseV31(buffer: Buffer): TslV31Message | null {
    if (buffer.length < 18) return null;

    const header = buffer[0];
    if (header < 0x80 || header > 0xFE) return null;

    const address = header - 0x80;
    const control = buffer[1];

    // Extract tally bits
    const tally1 = (control & 0x01) !== 0;
    const tally2 = (control & 0x02) !== 0;
    const tally3 = (control & 0x04) !== 0;
    const tally4 = (control & 0x08) !== 0;

    // Extract brightness (bits 4-5)
    const brightness = ((control >> 4) & 0x03) as Brightness;

    // Extract display text (16 bytes, ASCII 0x20-0x7E)
    const displayText = buffer.slice(2, 18).toString('ascii').replace(/[\x00-\x1F\x7F]/g, ' ');

    return {
      version: ProtocolVersion.V3_1,
      address,
      tally1,
      tally2,
      tally3,
      tally4,
      brightness,
      displayText
    };
  }

  // Parse V4.0 message
  static parseV40(buffer: Buffer): TslV40Message | null {
    if (buffer.length < 22) return null;

    // First parse as V3.1
    const v31 = this.parseV31(buffer);
    if (!v31) return null;

    // Verify checksum
    let sum = 0;
    for (let i = 0; i < 18; i++) {
      sum += buffer[i];
    }
    const expectedChecksum = ((~sum + 1) & 0x7F);
    if (buffer[18] !== expectedChecksum) return null;

    // Parse VBC (Version/Byte Count)
    const vbc = buffer[19];
    const minorVersion = (vbc >> 4) & 0x07;
    const xdataCount = vbc & 0x0F;

    if (buffer.length < 20 + xdataCount) return null;

    // Parse XDATA for V4.0 (2 bytes)
    const xbyte1 = buffer[20]; // Display L tally
    const xbyte2 = buffer[21]; // Display R tally

    const parseTallyByte = (byte: number) => ({
      leftTally: ((byte >> 4) & 0x03) as TallyState,
      textTally: ((byte >> 2) & 0x03) as TallyState,
      rightTally: (byte & 0x03) as TallyState
    });

    // Explicitly copy all fields to ensure displayText is included
    return {
      version: ProtocolVersion.V4_0,
      address: v31.address,
      tally1: v31.tally1,
      tally2: v31.tally2,
      tally3: v31.tally3,
      tally4: v31.tally4,
      brightness: v31.brightness,
      displayText: v31.displayText,
      leftDisplay: parseTallyByte(xbyte1),
      rightDisplay: parseTallyByte(xbyte2)
    };
  }

  // Parse V5.0 message
  static parseV50(buffer: Buffer): TslV50Message | null {
    if (buffer.length < 6) return null;

    const pbc = buffer.readUInt16LE(0);
    if (pbc !== buffer.length - 2) return null;

    const ver = buffer[2];
    const flags = buffer[3];
    const screen = buffer.readUInt16LE(4);

    const unicode = (flags & 0x01) !== 0;
    const screenControl = (flags & 0x02) !== 0;

    if (screenControl) {
      // Screen control not defined in V5.0
      return {
        version: ProtocolVersion.V5_0,
        packetByteCount: pbc,
        minorVersion: ver,
        flags: { unicode, screenControl },
        screen,
        displays: []
      };
    }

    // Parse display messages
    const displays: TslV50DisplayMessage[] = [];
    let offset = 6;

    while (offset < buffer.length) {
      if (buffer.length - offset < 6) break;

      const index = buffer.readUInt16LE(offset);
      const control = buffer.readUInt16LE(offset + 2);

      const rightTally = (control & 0x03) as TallyState;
      const textTally = ((control >> 2) & 0x03) as TallyState;
      const leftTally = ((control >> 4) & 0x03) as TallyState;
      const brightness = ((control >> 6) & 0x03) as Brightness;
      const isControlData = (control & 0x8000) !== 0;

      if (isControlData) {
        // Control data not defined in V5.0
        break;
      }

      const textLength = buffer.readUInt16LE(offset + 4);
      offset += 6;

      if (buffer.length - offset < textLength) break;

      let text: string;
      if (unicode) {
        text = buffer.slice(offset, offset + textLength).toString('utf16le');
      } else {
        text = buffer.slice(offset, offset + textLength).toString('ascii');
      }
      offset += textLength;

      displays.push({
        index,
        rightTally,
        textTally,
        leftTally,
        brightness,
        text
      });
    }

    return {
      version: ProtocolVersion.V5_0,
      packetByteCount: pbc,
      minorVersion: ver,
      flags: { unicode, screenControl },
      screen,
      displays
    };
  }

  // Auto-detect and parse
  static parse(buffer: Buffer): TslMessage | null {
    const version = this.detectVersion(buffer);

    switch (version) {
      case ProtocolVersion.V3_1:
        return this.parseV31(buffer);
      case ProtocolVersion.V4_0:
        return this.parseV40(buffer);
      case ProtocolVersion.V5_0:
        return this.parseV50(buffer);
      default:
        return null;
    }
  }

  // Generate hex dump for display
  static hexDump(buffer: Buffer): string {
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i += 16) {
      const slice = buffer.slice(i, Math.min(i + 16, buffer.length));
      const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(slice).map(b => (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.').join('');
      lines.push(`${i.toString(16).padStart(4, '0')}  ${hex.padEnd(48)}  ${ascii}`);
    }
    return lines.join('\n');
  }
}
