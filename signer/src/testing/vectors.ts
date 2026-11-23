// Reader for the signup protocol's vectors. Test-only.
import { readFileSync } from "node:fs";

export interface SignupKey {
  name: string;
  private_key_hex: string;
  public_key: string;
  address: string;
}

export interface SignupVector {
  name: string;
  description: string;
  prefix: string;
  domain: string;
  challenge: Record<string, string> | null;
  now: string;
  signer: string;
  public_key: string;
  data: string;
  sign_bytes: string;
  signature: string;
  signature_valid: boolean;
  expect: string;
}

export function signupVectors(): { keys: SignupKey[]; vectors: SignupVector[] } {
  return JSON.parse(readFileSync(new URL("../../testdata/signup/vectors.json", import.meta.url), "utf8")) as { keys: SignupKey[]; vectors: SignupVector[] };
}
