import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedLogLine, hex, judge, PROBE, reversed, utf8 } from "./probe";

test("the probe reversed is what native code must return", () => {
  assert.equal(new TextDecoder().decode(reversed(utf8(PROBE))), "kcehc-evitan-kra");
  assert.equal(judge(utf8("kcehc-evitan-kra")), "ok");
});

test("anything else is a mismatch: the probe unreversed, a byte short, and nothing", () => {
  assert.equal(judge(utf8(PROBE)), "mismatch");
  assert.equal(judge(utf8("kcehc-evitan-kr")), "mismatch");
  assert.equal(judge(new Uint8Array()), "mismatch");
});

test("reversing leaves the bytes given untouched", () => {
  const bytes = utf8("abc");
  assert.equal(hex(reversed(bytes)), "636261");
  assert.equal(hex(bytes), "616263");
});

test("the log line is the one both platforms write", () => {
  assert.equal(expectedLogLine(), "ark-native-check reversed=6b636568632d65766974616e2d6b7261");
});
