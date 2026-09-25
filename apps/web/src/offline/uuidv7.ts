let lastTimestamp = -1;
let sequence = 0;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

/**
 * Creates a UUIDv7 with a monotonic 12-bit sequence for calls made in the same
 * millisecond. The timestamp is clamped if the device clock moves backwards.
 */
export function createUuidV7(now = Date.now()): string {
  const timestamp = Math.max(Math.trunc(now), lastTimestamp);
  if (timestamp === lastTimestamp) {
    sequence = (sequence + 1) & 0x0fff;
  } else {
    const seed = randomBytes(2);
    sequence = (((seed[0] ?? 0) << 8) | (seed[1] ?? 0)) & 0x0fff;
    lastTimestamp = timestamp;
  }

  const random = randomBytes(8);
  const bytes = new Uint8Array(16);
  let remaining = timestamp;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  bytes[6] = 0x70 | (sequence >> 8);
  bytes[7] = sequence & 0xff;
  bytes[8] = 0x80 | ((random[0] ?? 0) & 0x3f);
  bytes.set(random.subarray(1), 9);

  const hex = Array.from(bytes, toHex).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}
