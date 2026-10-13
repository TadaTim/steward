import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, hashObject } from "../src/index.js";

test("canonicalJson is key-order independent", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 1 }));
});

test("hashObject distinguishes different args (approval binding)", () => {
  assert.notEqual(hashObject({ to: "a@x.com", amount: 10 }), hashObject({ to: "a@x.com", amount: 11 }));
  assert.equal(hashObject({ to: "a@x.com" }), hashObject({ to: "a@x.com" }));
});
