import assert from "node:assert/strict";
import { test } from "node:test";
import { fromHex, isLowS, toHex } from "@ararat-network/sdk";
import { compactFromDer, DerError } from "./der.ts";

const R = "7f".repeat(32);
const LOW_S = "01".padStart(64, "0");
/** The curve order less one: the highest s there is, whose lower twin is one. */
const HIGH_S = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140";

const integer = (hex: string): string => `02${(hex.length / 2).toString(16).padStart(2, "0")}${hex}`;
const sequence = (body: string): string => `30${(body.length / 2).toString(16).padStart(2, "0")}${body}`;
const der = (r: string, s: string): Uint8Array => fromHex(sequence(integer(r) + integer(s)));

test("a DER signature becomes 64 bytes, r then s, each padded to 32", () => {
  assert.equal(toHex(compactFromDer(der(R, "01"))), R + LOW_S);
  assert.equal(toHex(compactFromDer(der("05", "06"))), "05".padStart(64, "0") + "06".padStart(64, "0"));
});

test("an integer with a high first bit carries a leading zero, which is dropped", () => {
  const r = "80".padEnd(64, "0");
  assert.equal(toHex(compactFromDer(der(`00${r}`, "01"))), r + LOW_S);
});

test("an s in the upper half of the curve order is replaced by its lower twin", () => {
  const compact = compactFromDer(der(R, `00${HIGH_S}`));
  assert.equal(toHex(compact), R + LOW_S);
  assert.ok(isLowS(compact));
});

test("anything that is not one strict DER signature is refused", () => {
  const good = toHex(der(R, "01"));
  const malformed: [string, string][] = [
    ["nothing", ""],
    ["no sequence", `31${good.slice(2)}`],
    ["a sequence longer than its length says", `${good}00`],
    ["a sequence shorter than its length says", good.slice(0, -2)],
    ["one integer", sequence(integer(R))],
    ["three integers", sequence(integer(R) + integer("01") + integer("01"))],
    ["an element that is no integer", sequence(`${integer(R)}040101`)],
    ["an empty integer", sequence(`${integer(R)}0200`)],
    ["a negative integer", sequence(integer("80") + integer("01"))],
    ["an integer with a needless leading zero", sequence(integer("0001") + integer("01"))],
    ["zero", sequence(integer("00") + integer("01"))],
    ["an integer at the curve order", sequence(integer(R) + integer("00fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"))],
    ["an integer of 34 bytes", sequence(integer(`0000${R}`) + integer("01"))],
    ["an integer cut short", "30060202010201"],
  ];
  for (const [name, hex] of malformed) assert.throws(() => compactFromDer(fromHex(hex)), DerError, name);
});
