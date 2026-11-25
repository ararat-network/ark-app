// The Ark device app on the emulator, for the tests beside this file. It
// loads the binary of a ledger-ark release that scripts/fetch-ledger-binaries.sh
// downloaded and checked, and gives the adapter the one thing it asks of
// Ledger's Device Management Kit: a command sent, and the answer returned.
import { fileURLToPath } from "node:url";
import { toHex } from "@ararat-network/sdk";
import zemu, { type TModel } from "@zondax/zemu";
import type { LedgerSession } from "../adapter.ts";

// The package is CommonJS: Node hands over its whole exports.
const { default: Zemu, DEFAULT_START_OPTIONS, ButtonKind, isTouchDevice } = zemu;

/** The seed ledger-ark's own emulator tests use, so the account here is the one its snapshots show. */
const SEED = "equip will roof matter pink blind book anxiety banner elbow sun young";
const RELEASE = "v2.3.1";

/** One command and its answer, as hex: what the unit tests replay. */
export interface Exchange {
  apdu: string;
  data: string;
  status: string;
}

export interface Device {
  readonly model: TModel;
  readonly session: LedgerSession;
  /** Every exchange since the last call, for recording. */
  takeExchanges(): Exchange[];
  /** Starts a request, reads the review it brings up through to its end, approves it, and returns the request's answer. */
  approve<T>(start: () => Promise<T>): Promise<T>;
  /** As `approve`, for the review of an address, which a touch model confirms with a tap where it holds to sign. */
  confirmAddress<T>(start: () => Promise<T>): Promise<T>;
  /** Starts a request, reads the review it brings up through to its end, rejects it, and returns what the request failed with. */
  reject(start: () => Promise<unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export async function pullImage(): Promise<void> {
  await Zemu.checkAndPullImage();
  await Zemu.stopAllEmuContainers();
}

export async function startDevice(model: TModel): Promise<Device> {
  const elf = fileURLToPath(new URL(`binaries/ark_zemu_${model}_${RELEASE}.elf`, import.meta.url));
  const sim = new Zemu(elf);
  await sim.start({ ...DEFAULT_START_OPTIONS, model, custom: `-s "${SEED}"`, X11: false });
  let exchanges: Exchange[] = [];

  /**
   * Starts the request with the emulator's record of what it has shown cleared: the harness finds the end of a review
   * by the text on it, and would otherwise find the end of the review before.
   */
  async function begin<T>(start: () => Promise<T>): Promise<{ request: Promise<T> }> {
    await sim.deleteEvents();
    const request = start();
    request.catch(() => undefined);
    // Wrapped, since a promise returned bare from here would be waited for here.
    return { request };
  }

  /** Waits until the device shows a review, failing at once if what was asked was answered with no review. */
  async function untilReview(request: Promise<unknown>): Promise<void> {
    const early = request.then(
      () => Promise.reject(new Error("the device answered with no review")),
      (err) => Promise.reject(err),
    );
    await Promise.race([sim.waitUntilScreenIsNot(sim.getMainMenuSnapshot()), early]);
    early.catch(() => undefined);
  }

  async function approve<T>(start: () => Promise<T>): Promise<T> {
    const { request } = await begin(start);
    await untilReview(request);
    await sim.navigateUntilText(".", "review", sim.startOptions.approveKeyword, true, false);
    const answer = await request;
    await sim.waitUntilScreenIs(sim.getMainMenuSnapshot());
    return answer;
  }

  return {
    model,
    session: {
      sessionId: "emulator",
      dmk: {
        async sendApdu({ apdu }) {
          const answer = await sim.getTransport().exchange(Buffer.from(apdu));
          const data = answer.subarray(0, answer.length - 2);
          const statusCode = answer.subarray(answer.length - 2);
          exchanges.push({ apdu: toHex(apdu), data: toHex(data), status: toHex(statusCode) });
          return { data, statusCode };
        },
      },
    },
    takeExchanges() {
      const taken = exchanges;
      exchanges = [];
      return taken;
    },
    approve,
    async confirmAddress<T>(start: () => Promise<T>): Promise<T> {
      if (!isTouchDevice(model)) return approve(start);
      const { approveKeyword, approveAction } = sim.startOptions;
      sim.startOptions.approveKeyword = "Confirm";
      sim.startOptions.approveAction = ButtonKind.DynamicTapButton;
      try {
        return await approve(start);
      } finally {
        sim.startOptions.approveKeyword = approveKeyword;
        sim.startOptions.approveAction = approveAction;
      }
    },
    async reject(start: () => Promise<unknown>): Promise<unknown> {
      const { request } = await begin(start);
      const failure = request.then(
        () => Promise.reject(new Error("the device signed what was rejected")),
        (err: unknown) => err,
      );
      await untilReview(request);
      await sim.navigateUntilText(".", "review", sim.startOptions.rejectKeyword, true, false);
      const err = await failure;
      await sim.waitUntilScreenIs(sim.getMainMenuSnapshot());
      return err;
    },
    close: () => sim.close(),
  };
}
