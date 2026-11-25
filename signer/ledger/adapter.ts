// The Ledger as a key adapter. It talks to the Ark device app through
// Zondax's `@zondax/ledger-cosmos-js`, which this file alone touches, over a
// session of Ledger's Device Management Kit that the client injects: the kit
// is what connects, on the phone and in a browser alike, and the adapter asks
// one thing of it, to send a command and return the answer.
// The device signs amino JSON alone, since it shows what it signs, and it is
// the device's display the member reads there: the adapter sends the sign
// bytes as the core hands them over and rewrites nothing.
//
// An account is paired once, when the member confirms its address on the
// device, and is remembered by the client. After that the adapter reports the
// account without the device, so a Ledger left in a drawer does not stop the
// signer listing its accounts, and reaches for the device only to sign, and
// before a review to say whether it could.

import { bytesEqual, DEFAULT_PREFIX, isCompressedPublicKey, publicKeyToAddress } from "@ararat-network/sdk";
import zondax from "@zondax/ledger-cosmos-js";
import { type DeviceManagementKitLike, DMKTransport } from "@zondax/ledger-js";
import { Buffer } from "buffer";
import type { AdapterAccount, KeyAdapter } from "../src/adapter.ts";
import { type RefusalKind, SignerRefusal } from "../src/refusal.ts";
import { compactFromDer } from "./der.ts";

// The package is CommonJS: a bundler hands over its default export, the class, and Node its whole exports.
type CosmosApp = InstanceType<typeof zondax.default>;
const loaded: unknown = zondax;
const App = (typeof loaded === "function" ? loaded : (loaded as { default: unknown }).default) as typeof zondax.default;

/** What the adapter asks of Ledger's Device Management Kit: `sendApdu`, a command to a session and its answer. */
export type LedgerDeviceKit = DeviceManagementKitLike;

/** A connected device: the kit, and the session it opened to the device. */
export interface LedgerSession {
  readonly dmk: LedgerDeviceKit;
  readonly sessionId: string;
}

/** The one path the device app derives at for an account, and the one `arkd` uses. */
export const LEDGER_PATH = "m/44'/330'/0'/0/0";
/** The device app's name, as the device itself reports the app that is open. */
export const LEDGER_APP_NAME = "Ark";
/** The first device app that signs an unordered transaction: an older one is refused, so every Ledger account has one path. */
export const LEDGER_MINIMUM_VERSION: readonly [number, number, number] = [2, 3, 0];
/** The most the device holds of one sign document, in bytes. */
export const LEDGER_BUFFER_SIZE = 16384;

/** The sign mode byte for amino JSON. */
const AMINO_JSON = 0x0;

const RETURN_CODES: ReadonlyMap<number, RefusalKind> = new Map<number, RefusalKind>([
  [0x6986, "rejected_on_device"],
  [0x5515, "device_locked"],
  [0x6e00, "wrong_app"],
  [0x6e01, "wrong_app"],
  // What the package reports when the kit could not send and the device gave no answer.
  [0xffff, "device_unavailable"],
]);

/** A refusal for whatever stopped an exchange with the device: by its return code where it has one, and otherwise a fault. */
function refusalOf(err: unknown, doing: string): SignerRefusal {
  if (err instanceof SignerRefusal) return err;
  const code = typeof err === "object" && err !== null && "returnCode" in err ? err.returnCode : undefined;
  if (typeof code !== "number") return new SignerRefusal("invalid", `the Ledger adapter failed ${doing}`, { cause: err });
  const kind = RETURN_CODES.get(code) ?? "invalid";
  return new SignerRefusal(kind, `the Ledger answered 0x${code.toString(16).padStart(4, "0")} ${doing}`, { cause: err });
}

function olderThanMinimum(version: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    const [have, need] = [version[i] ?? 0, LEDGER_MINIMUM_VERSION[i] ?? 0];
    if (have !== need) return have < need;
  }
  return false;
}

/** The device app, once the device says the Ark app is open, unlocked, and new enough. */
async function openApp(session: LedgerSession): Promise<CosmosApp> {
  const app = new App(new DMKTransport(session.dmk, session.sessionId));
  // Asked of the device itself, not of the app: the Cosmos app this one was forked from answers the same commands.
  const { appName } = await app.appInfo();
  if (appName !== LEDGER_APP_NAME) throw new SignerRefusal("wrong_app", `the Ledger has ${appName ?? "no app"} open, not ${LEDGER_APP_NAME}`);
  const { major, minor, patch, deviceLocked } = await app.getVersion();
  if (deviceLocked) throw new SignerRefusal("device_locked", "the Ledger is locked");
  if (major === undefined || minor === undefined || patch === undefined) throw new SignerRefusal("invalid", "the Ledger reported no app version");
  if (olderThanMinimum([major, minor, patch])) {
    throw new SignerRefusal(
      "app_outdated",
      `the Ledger's ${LEDGER_APP_NAME} app is ${major}.${minor}.${patch}, older than ${LEDGER_MINIMUM_VERSION.join(".")}`,
    );
  }
  return app;
}

/** An account as the adapter holds it, refused unless its key is its address's. */
function checkedAccount(address: string, publicKey: Uint8Array): AdapterAccount {
  const key = Uint8Array.from(publicKey);
  let derived: string | undefined;
  try {
    if (isCompressedPublicKey(key)) derived = publicKeyToAddress(key, DEFAULT_PREFIX);
  } catch {
    derived = undefined;
  }
  if (derived === undefined || derived !== address) throw new SignerRefusal("invalid", `the key given is not ${address}'s`);
  return { address, publicKey: key };
}

/** The device's account; with `show`, the device displays the address and answers once the member has confirmed it there. */
async function deviceAccount(app: CosmosApp, show: boolean): Promise<AdapterAccount> {
  const answer = show ? await app.showAddressAndPubKey(LEDGER_PATH, DEFAULT_PREFIX) : await app.getAddressAndPubKey(LEDGER_PATH, DEFAULT_PREFIX);
  return checkedAccount(answer.bech32_address, answer.compressed_pk);
}

/**
 * Pairs a Ledger at first use: the device shows its address, the member confirms it there, and the account comes
 * back for the client to remember. The address a member checks is the one on the device, not one the app shows.
 */
export async function pairLedger(session: LedgerSession): Promise<AdapterAccount> {
  try {
    return await deviceAccount(await openApp(session), true);
  } catch (err) {
    throw refusalOf(err, "pairing");
  }
}

export interface LedgerAdapterOptions {
  /** The account this Ledger was paired as, from `pairLedger`. */
  readonly account: AdapterAccount;
  /** The session to the device, connecting if it must. Called for each signature; the client owns the connection. */
  readonly connect: () => Promise<LedgerSession>;
}

/** The adapter for one paired Ledger account. It signs amino alone. */
export function ledgerAdapter(options: LedgerAdapterOptions): KeyAdapter {
  const account = checkedAccount(options.account.address, options.account.publicKey);
  // The device answers one request at a time, and reviews one document at a time, so each waits for the one before.
  let busy: Promise<unknown> = Promise.resolve();
  function queued<T>(run: () => Promise<T>): Promise<T> {
    const done = busy.then(run);
    busy = done.catch(() => undefined);
    return done;
  }

  /** Asks something of the device app, once the device connected says it is the paired Ledger with the Ark app open, unlocked, and new enough. */
  async function onDevice<T>(doing: string, ask: (app: CosmosApp) => Promise<T>): Promise<T> {
    let session: LedgerSession;
    try {
      session = await options.connect();
    } catch (err) {
      if (err instanceof SignerRefusal) throw err;
      throw new SignerRefusal("device_unavailable", "the Ledger could not be reached", { cause: err });
    }
    try {
      const app = await openApp(session);
      // Read without showing it: the member confirmed this address when the Ledger was paired.
      const device = await deviceAccount(app, false);
      if (device.address !== account.address || !bytesEqual(device.publicKey, account.publicKey)) {
        throw new SignerRefusal("device_unavailable", `the Ledger connected holds ${device.address}; the one that holds ${account.address} is not connected`);
      }
      return await ask(app);
    } catch (err) {
      throw refusalOf(err, doing);
    }
  }

  async function signOnDevice(signBytes: Uint8Array): Promise<Uint8Array> {
    return onDevice("signing", async (app) => {
      const { signature } = await app.sign(LEDGER_PATH, Buffer.from(signBytes), DEFAULT_PREFIX, AMINO_JSON);
      return compactFromDer(signature);
    });
  }

  return {
    modes: ["amino"],
    async accounts(): Promise<readonly AdapterAccount[]> {
      return [{ address: account.address, publicKey: Uint8Array.from(account.publicKey) }];
    },
    sign(address: string, signBytes: Uint8Array): Promise<Uint8Array> {
      if (address !== account.address) return Promise.reject(new SignerRefusal("invalid", `the Ledger adapter holds ${account.address}, not ${address}`));
      // Refused here, before the device is asked: it would answer that the document is past its buffer.
      if (signBytes.length > LEDGER_BUFFER_SIZE) {
        return Promise.reject(new SignerRefusal("invalid", `the document is ${signBytes.length} bytes, and the Ledger holds ${LEDGER_BUFFER_SIZE}`));
      }
      const bytes = Uint8Array.from(signBytes);
      return queued(() => signOnDevice(bytes));
    },
    // The same questions a signature begins with, and no document: the device shows nothing, and `sign` asks them again.
    ready(address: string): Promise<void> {
      if (address !== account.address) return Promise.reject(new SignerRefusal("invalid", `the Ledger adapter holds ${account.address}, not ${address}`));
      return queued(() => onDevice("saying whether it can sign", async () => undefined));
    },
  };
}
