// The device answers with an ECDSA signature in DER. The chain and the signup
// protocol take 64 bytes, r then s, with s in the lower half of the curve
// order, so the adapter converts what the device returns and normalises it.
// The parser is strict: one sequence of two minimal positive integers, each
// inside the curve order, and nothing after it.

/** The order of secp256k1. */
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export class DerError extends Error {
  override readonly name: string = "DerError";
}

function toBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function to32Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let rest = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/** Reads one DER integer at `at`, returning its value and where the next element starts. */
function readInteger(der: Uint8Array, at: number): { value: bigint; next: number } {
  if (der[at] !== 0x02) throw new DerError("expected an integer");
  const length = der[at + 1];
  if (length === undefined || length === 0 || length > 33) throw new DerError("an integer of a length no signature has");
  const bytes = der.subarray(at + 2, at + 2 + length);
  if (bytes.length !== length) throw new DerError("an integer cut short");
  const [first, second] = bytes;
  if (first === undefined || first >= 0x80) throw new DerError("a negative integer");
  // A leading zero is there only to keep a high first bit from reading as a sign.
  if (first === 0 && (second === undefined || second < 0x80)) throw new DerError("an integer not in its shortest form");
  const value = toBigInt(bytes);
  if (value === 0n || value >= N) throw new DerError("an integer outside the curve order");
  return { value, next: at + 2 + length };
}

/** A DER signature as 64 bytes, r then s, with s in the lower half of the curve order. */
export function compactFromDer(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new DerError("expected a sequence");
  if (der[1] !== der.length - 2) throw new DerError("the sequence's length is not the signature's");
  const r = readInteger(der, 2);
  const s = readInteger(der, r.next);
  if (s.next !== der.length) throw new DerError("bytes after the signature");
  const lowS = s.value > N / 2n ? N - s.value : s.value;
  const out = new Uint8Array(64);
  out.set(to32Bytes(r.value), 0);
  out.set(to32Bytes(lowS), 32);
  return out;
}
