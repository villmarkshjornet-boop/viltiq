import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { oppdaterFelling, slettFelling } = await import("./felling");

// ---------------------------------------------------------------------------
// oppdaterFelling (STEG 5 §4) — retting av en felling (bl.a. kategoriId) må
// gå via updateDoc på nøyaktig det dokumentet, og må ALDRI selv sette
// uid/jaktlagId/opprettet (eierskap/opprinnelse låses av firestore.rules,
// men funksjonen skal uansett ikke prøve å sende de feltene — den tar kun
// imot FellingInput, som ikke har dem i typen).
// ---------------------------------------------------------------------------

test("oppdaterFelling: bruker updateDoc på fellings/{id}, ikke setDoc/deleteDoc", () => {
  const kilde = readFileSync(path.join(import.meta.dirname, "felling.ts"), "utf-8");
  const match = kilde.match(/export async function oppdaterFelling\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(match, "fant ikke oppdaterFelling i kildekoden");
  const body = match[1];
  assert.match(body, /updateDoc\(\s*doc\(db,\s*"fellings",\s*id\)/);
  assert.ok(!body.includes("setDoc"), "oppdaterFelling skal ikke bruke setDoc");
  assert.ok(!body.includes("deleteDoc"), "oppdaterFelling skal ikke slette noe");
  assert.equal(typeof oppdaterFelling, "function");
});

test("slettFelling: sletter nøyaktig ett dokument i fellings-samlingen", () => {
  const kilde = readFileSync(path.join(import.meta.dirname, "felling.ts"), "utf-8");
  const match = kilde.match(/export async function slettFelling\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(match, "fant ikke slettFelling i kildekoden");
  const body = match[1];
  assert.match(body, /deleteDoc\(\s*doc\(db,\s*"fellings",\s*id\)/);
  assert.equal(typeof slettFelling, "function");
});

test("Felling.kategoriId finnes i typen (§4: kobling felling → kvote-kategori)", () => {
  const kilde = readFileSync(path.join(import.meta.dirname, "felling.ts"), "utf-8");
  assert.match(kilde, /kategoriId:\s*string \| null/);
});
