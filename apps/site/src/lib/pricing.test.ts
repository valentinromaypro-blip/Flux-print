import { test } from "node:test";
import assert from "node:assert/strict";
import { priceFor } from "./pricing.ts";

const deck = { unit: 24.9, tiers: [[1, 1], [5, 0.85], [10, 0.75]] as [number, number][], media: { "carte-graphique-300g": -1.5 } };
const oracle = { unit: 12, per_card: 0.28, tiers: [[1, 1], [10, 0.78]] as [number, number][] };

test("prix unitaire et total", () => {
  assert.deepEqual(priceFor(deck, { media: "cmdm-350g", copies: 1 }), { unitCents: 2490, totalCents: 2490, tierDiscount: 0 });
});

test("dégressif par quantité", () => {
  const p = priceFor(deck, { media: "cmdm-350g", copies: 5 });
  assert.equal(p.unitCents, 2117);
  assert.equal(p.totalCents, 10585);
  assert.equal(p.tierDiscount, 15);
});

test("supplément ou remise de support", () => {
  assert.equal(priceFor(deck, { media: "carte-graphique-300g", copies: 1 }).unitCents, 2340);
});

test("prix à la carte pour l'oracle", () => {
  assert.equal(priceFor(oracle, { media: "x", cards: 44, copies: 1 }).unitCents, 2432);
  assert.equal(priceFor(oracle, { media: "x", cards: 44, copies: 10 }).unitCents, 1897);
});

test("quantité invalide refusée", () => {
  assert.throws(() => priceFor(deck, { media: "", copies: 0 }));
});
