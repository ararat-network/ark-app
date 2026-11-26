// The strings for what the keystore says: its check, the key it holds, the
// prompt it shows, and why a call was refused. Apart from the screen so that
// they are tested with no device.
import type { DeviceKey, KeystoreCheck, KeystoreErrorKind, KeystorePrompt, KeystorePromptPurpose, SeedPhraseHidden } from "@ararat-network/signer/keystore";
import { type StringKey, strings } from "./strings";

const STATUS: Record<KeystoreCheck, StringKey> = {
  ok: "scaffold.keystore.ok",
  failed: "scaffold.keystore.failed",
  unavailable: "scaffold.keystore.unavailable",
};

export function keystoreStatus(check: KeystoreCheck): StringKey {
  return STATUS[check];
}

/** What is said of a key: how it opens and what holds it, or that the phone no longer opens it. */
export function keyStatus(key: Pick<DeviceKey, "protection" | "hardware" | "invalidated"> | null): StringKey[] {
  if (!key) return ["scaffold.key.none"];
  const held: StringKey[] = [`scaffold.key.protection.${key.protection}`, `scaffold.key.hardware.${key.hardware}`];
  return key.invalidated ? ["scaffold.key.invalidated", ...held] : held;
}

/** The system prompt's text, read when the prompt is shown. */
export function keystorePrompt(purpose: KeystorePromptPurpose): KeystorePrompt {
  return {
    title: strings[`keystore.prompt.${purpose}.title`],
    reason: strings[`keystore.prompt.${purpose}.reason`],
    cancel: strings["keystore.prompt.cancel"],
  };
}

/** The string for why the native view cleared the words itself. */
export function seedPhraseHiddenString(reason: SeedPhraseHidden): StringKey {
  return `scaffold.result.seed_phrase_hidden.${reason}`;
}

/** The string for what stopped a keystore call: by its kind where it has one of the keystore's, and the general one otherwise. */
export function keystoreErrorString(thrown: unknown): StringKey {
  const kind = typeof thrown === "object" && thrown !== null && "kind" in thrown ? thrown.kind : undefined;
  const key = `keystore.error.${String(kind)}`;
  return key in strings ? (key as `keystore.error.${KeystoreErrorKind}`) : "keystore.error.failed";
}
