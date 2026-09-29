import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { backFields, type BackModel } from "./backs.ts";

// Même fixture que services/print-engine/tests/test_design.py : le studio remplit les dos comme le moteur.
const fixture = JSON.parse(readFileSync(new URL("../../../../services/print-engine/tests/fixtures/back_fields.json", import.meta.url), "utf8"));
const models: BackModel[] = JSON.parse(readFileSync(new URL("../../public/cartes/dos/models.json", import.meta.url), "utf8")).models;

test("les champs des dos sont identiques au moteur", () => {
  for (const c of fixture) {
    const m = models.find((x) => x.id === c.model)!;
    assert.deepEqual(backFields(m, c.input), c.fields);
  }
});
