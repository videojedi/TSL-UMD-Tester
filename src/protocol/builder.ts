import {
  TslV31Message,
  TslV40Message,
  TslV50Message,
  TslV50DisplayMessage,
  ProtocolVersion,
  Brightness,
  TallyState
} from './types';

export class TslBuilder {

  // Build V3.1 message
  static buildV31(message: TslV31Message): Buffer {
    const buffer = Buffer.alloc(18);

    // Header: address + 0x80
    buffer[0] = message.address + 0x80;

    // Control byte
    let control = 0;
    if (message.tally1) control |= 0x01;
    if (message.tally2) control |= 0x02;
    if (message.tally3) control |= 0x04;
    if (message.tally4) control |= 0x08;
    control |= (message.brightness & 0x03) << 4;
    buffer[1] = control;

    // Display text (16 chars, padded with spaces)
    const text = message.displayText.padEnd(16, ' ').slice(0, 16);
    buffer.write(text, 2, 16, 'ascii');

    return buffer;
  }

  // Build V4.0 message
  static buildV40(message: TslV40Message): Buffer {
    // Start with V3.1 format
    const v31Buffer = this.buildV31({
      ...message,
      version: ProtocolVersion.V3_1
    });

    const buffer = Buffer.alloc(22);
    v31Buffer.copy(buffer, 0);

    // Calculate checksum (2's complement of sum mod 128)
    let sum = 0;
    for (let i = 0; i < 18; i++) {
      sum += buffer[i];
    }
    buffer[18] = ((~sum + 1) & 0x7F);

    // VBC: Version 0, 2 bytes of XDATA
    buffer[19] = 0x02; // minor version 0, 2 bytes

    // XDATA byte 1 (left display)
    const buildTallyByte = (display: { leftTally: TallyState; textTally: TallyState; rightTally: TallyState }) => {
      return ((display.leftTally & 0x03) << 4) |
             ((display.textTally & 0x03) << 2) |
             (display.rightTally & 0x03);
    };

    buffer[20] = buildTallyByte(message.leftDisplay);
    buffer[21] = buildTallyByte(message.rightDisplay);

    return buffer;
  }

  // Build V5.0 message
  static buildV50(message: TslV50Message): Buffer {
    // Calculate total size
    let dataSize = 4; // VER + FLAGS + SCREEN

    for (const display of message.displays) {
      const textBytes = message.flags.unicode
        ? Buffer.from(display.text, 'utf16le')
        : Buffer.from(display.text, 'ascii');
      dataSize += 6 + textBytes.length; // INDEX + CONTROL + LENGTH + TEXT
    }

    const buffer = Buffer.alloc(2 + dataSize);

    // PBC (packet byte count, excluding PBC itself)
    buffer.writeUInt16LE(dataSize, 0);

    // VER
    buffer[2] = message.minorVersion;

    // FLAGS
    let flags = 0;
    if (message.flags.unicode) flags |= 0x01;
    if (message.flags.screenControl) flags |= 0x02;
    buffer[3] = flags;

    // SCREEN
    buffer.writeUInt16LE(message.screen, 4);

    // Display messages
    let offset = 6;
    for (const display of message.displays) {
      // INDEX
      buffer.writeUInt16LE(display.index, offset);
      offset += 2;

      // CONTROL
      let control = 0;
      control |= display.rightTally & 0x03;
      control |= (display.textTally & 0x03) << 2;
      control |= (display.leftTally & 0x03) << 4;
      control |= (display.brightness & 0x03) << 6;
      buffer.writeUInt16LE(control, offset);
      offset += 2;

      // LENGTH and TEXT
      const textBytes = message.flags.unicode
        ? Buffer.from(display.text, 'utf16le')
        : Buffer.from(display.text, 'ascii');
      buffer.writeUInt16LE(textBytes.length, offset);
      offset += 2;
      textBytes.copy(buffer, offset);
      offset += textBytes.length;
    }

    return buffer;
  }

  // Build TCP wrapper for V5.0 (DLE/STX framing)
  static wrapForTcp(buffer: Buffer): Buffer {
    const DLE = 0xFE;
    const STX = 0x02;

    // Count DLE occurrences for byte stuffing
    let dleCount = 0;
    for (const byte of buffer) {
      if (byte === DLE) dleCount++;
    }

    const wrapped = Buffer.alloc(2 + buffer.length + dleCount);
    wrapped[0] = DLE;
    wrapped[1] = STX;

    let offset = 2;
    for (const byte of buffer) {
      wrapped[offset++] = byte;
      if (byte === DLE) {
        wrapped[offset++] = DLE; // Byte stuffing
      }
    }

    return wrapped;
  }

  // Remove TCP wrapper (DLE/STX framing)
  static unwrapFromTcp(buffer: Buffer): Buffer | null {
    const DLE = 0xFE;
    const STX = 0x02;

    // Find DLE/STX sequence
    let start = -1;
    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i] === DLE && buffer[i + 1] === STX) {
        start = i + 2;
        break;
      }
    }

    if (start === -1) return null;

    // Remove byte stuffing
    const result: number[] = [];
    for (let i = start; i < buffer.length; i++) {
      if (buffer[i] === DLE && i + 1 < buffer.length && buffer[i + 1] === DLE) {
        result.push(DLE);
        i++; // Skip the stuffed byte
      } else {
        result.push(buffer[i]);
      }
    }

    return Buffer.from(result);
  }

  // Helper to create a simple V3.1 message
  static createSimpleV31(
    address: number,
    text: string,
    tally1 = false,
    tally2 = false,
    brightness: Brightness = Brightness.FULL
  ): Buffer {
    return this.buildV31({
      version: ProtocolVersion.V3_1,
      address,
      tally1,
      tally2,
      tally3: false,
      tally4: false,
      brightness,
      displayText: text
    });
  }

  // Helper to create a simple V5.0 message
  static createSimpleV50(
    index: number,
    text: string,
    leftTally: TallyState = TallyState.OFF,
    rightTally: TallyState = TallyState.OFF,
    brightness: Brightness = Brightness.FULL,
    screen = 0
  ): Buffer {
    return this.buildV50({
      version: ProtocolVersion.V5_0,
      packetByteCount: 0, // Will be calculated
      minorVersion: 0,
      flags: { unicode: false, screenControl: false },
      screen,
      displays: [{
        index,
        leftTally,
        textTally: TallyState.OFF,
        rightTally,
        brightness,
        text
      }]
    });
  }
}
