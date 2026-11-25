import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentError, type SignupDocument } from "../signup/document.ts";
import { signupVectors } from "../testing/vectors.ts";
import { reviewDocument } from "./document.ts";

const { vectors } = signupVectors();
const challenge = vectors.find((v) => v.name === "challenge_ok")!.challenge as unknown as SignupDocument;
const vouch = vectors.find((v) => v.name === "vouch_ok")!.challenge as unknown as SignupDocument;

test("a challenge is reviewed as its origin, its kind, its chain, and its expiry", () => {
  assert.deepEqual(reviewDocument(challenge), [
    { label: "document.origin", value: { kind: "origin", origin: challenge.origin } },
    { label: "document.kind", value: { kind: "choice", choice: "document.kind.signup" } },
    { label: "document.chain_id", value: { kind: "text", text: challenge.chain_id } },
    { label: "document.expires", value: { kind: "time", unixSeconds: challenge.expires } },
  ]);
});

test("a vouch names the admission it answers as well", () => {
  const fields = reviewDocument(vouch);
  assert.deepEqual(
    fields.map((f) => f.label),
    ["document.origin", "document.kind", "document.chain_id", "document.expires", "document.admission"],
  );
  assert.deepEqual(fields[1]!.value, { kind: "choice", choice: "document.kind.vouch" });
  assert.deepEqual(fields[4]!.value, { kind: "text", text: vouch.admission });
});

test("a document outside the grammar has no review", () => {
  assert.throws(() => reviewDocument({ ...challenge, domain: "ark-signup/v2" }), DocumentError);
  assert.throws(() => reviewDocument({ ...challenge, origin: "https://members.ararat.network/login" }), DocumentError);
});
