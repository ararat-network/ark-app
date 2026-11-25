// The string for what the keystore's check found. Apart from the screen so
// that it is tested with no device.
import type { KeystoreCheck } from "@ararat-network/signer/keystore";
import type { StringKey } from "./strings";

const STATUS: Record<KeystoreCheck, StringKey> = {
  ok: "scaffold.keystore.ok",
  failed: "scaffold.keystore.failed",
  unavailable: "scaffold.keystore.unavailable",
};

export function keystoreStatus(check: KeystoreCheck): StringKey {
  return STATUS[check];
}
