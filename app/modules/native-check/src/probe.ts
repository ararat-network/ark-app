// What the check sends to native code and what must come back. Kept apart
// from the native module so that it runs in a test with no device, and so
// that CI can print the line it then looks for in a device's log.

/** The bytes sent: ASCII, so the reversed bytes read as text too. */
export const PROBE = "ark-native-check";

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function reversed(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes).reverse();
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The line native code writes to the device's log when it is called with the probe and answers rightly. */
export function expectedLogLine(): string {
  return `ark-native-check reversed=${hex(reversed(utf8(PROBE)))}`;
}

export type CheckResult = "ok" | "mismatch";

/** Whether what native code returned is the probe reversed. */
export function judge(returned: Uint8Array): CheckResult {
  return hex(returned) === hex(reversed(utf8(PROBE))) ? "ok" : "mismatch";
}
