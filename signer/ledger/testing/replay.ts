// A device that answers from a list of exchanges recorded on the emulator, in
// order, and fails on a command it was not recorded answering. Test-only.
import { fromHex, toHex } from "@ararat-network/sdk";
import type { LedgerSession } from "../adapter.ts";

export interface Exchange {
  /** The command sent: class, instruction, two parameters, a length, and the data. */
  apdu: string;
  /** The answer's data. */
  data: string;
  /** The answer's two status bytes. */
  status: string;
}

export interface Replay {
  readonly session: LedgerSession;
  /** How many of the exchanges have been used. */
  used(): number;
  /** Every command sent, as hex, the unexpected ones included. */
  readonly sent: string[];
}

/** A session that replays the exchanges; `fail` makes the kit itself fail from that exchange on, as a dropped connection does. */
export function replay(exchanges: readonly Exchange[], fail?: { at: number; error: Error }): Replay {
  let next = 0;
  const sent: string[] = [];
  return {
    sent,
    used: () => next,
    session: {
      sessionId: "replay",
      dmk: {
        async sendApdu({ apdu }) {
          const command = toHex(apdu);
          sent.push(command);
          if (fail && next >= fail.at) throw fail.error;
          const exchange = exchanges[next];
          if (!exchange) throw new Error(`no exchange is recorded after ${next}: ${command}`);
          if (exchange.apdu !== command) throw new Error(`exchange ${next} was recorded as ${exchange.apdu}, and ${command} was sent`);
          next++;
          return { data: fromHex(exchange.data), statusCode: fromHex(exchange.status) };
        },
      },
    },
  };
}
