import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

// Samme begrunnelse som cameras.test.ts: kvoter.ts importerer firebase/
// firestore og "@/..."-alias som node --test ikke løser uten hjelp.
register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { migrerKvoter } = await import("./kvoter");

// ---------------------------------------------------------------------------
// migrerKvoter (STEG 5 §4) — gammelt flatt format ({ art: number }) skal
// konverteres til én kategori "Alle", uten å miste det gamle maks-tallet.
// Nytt format skal gå gjennom uendret. Dette er selve garantien for at
// jaktlag som satte kvoter FØR §4 ikke mister dataen sin.
// ---------------------------------------------------------------------------

test("migrerKvoter: gammelt flatt format blir én kategori kalt Alle", () => {
  const resultat = migrerKvoter({ Hjort: 5, Rådyr: 3 });
  assert.deepEqual(resultat, {
    Hjort: { kategorier: [{ id: "alle", navn: "Alle", maks: 5 }] },
    Rådyr: { kategorier: [{ id: "alle", navn: "Alle", maks: 3 }] },
  });
});

test("migrerKvoter: negative gamle tall klippes til 0", () => {
  const resultat = migrerKvoter({ Elg: -2 });
  assert.equal(resultat.Elg.kategorier[0].maks, 0);
});

test("migrerKvoter: nytt format (kategorier-array) går gjennom uendret", () => {
  const nytt = {
    Hjort: { kategorier: [{ id: "a1", navn: "Bukk", maks: 2 }, { id: "a2", navn: "Kolle", maks: 1 }] },
  };
  const resultat = migrerKvoter(nytt);
  assert.deepEqual(resultat, nytt);
});

test("migrerKvoter: negative maks-tall i nytt format klippes også til 0", () => {
  const resultat = migrerKvoter({ Elg: { kategorier: [{ id: "x", navn: "Okse", maks: -5 }] } });
  assert.equal(resultat.Elg.kategorier[0].maks, 0);
});

test("migrerKvoter: tom/manglende input gir tomt objekt, ikke en feil", () => {
  assert.deepEqual(migrerKvoter(null), {});
  assert.deepEqual(migrerKvoter(undefined), {});
  assert.deepEqual(migrerKvoter({}), {});
});

test("migrerKvoter: ukjente/ugyldige verdityper for en art hoppes stille over", () => {
  const resultat = migrerKvoter({ Hjort: "ugyldig", Rådyr: 4 });
  assert.deepEqual(resultat, { Rådyr: { kategorier: [{ id: "alle", navn: "Alle", maks: 4 }] } });
});

// ---------------------------------------------------------------------------
// saveKvoter — skal alltid skrive HELE tilstanden (ikke en delvis merge),
// fordi hver mutator (leggTilKategori/oppdaterKategori/fjernKategori) henter
// gjeldende tilstand med getKvoter() først og skriver den fulle, oppdaterte
// versjonen tilbake. Verifiserer dette mot selve kildekoden, siden vi ikke
// har en ekte Firestore å teste opp mot her.
// ---------------------------------------------------------------------------

test("saveKvoter: skriver med setDoc uten merge:true (fullstendig overskriving)", () => {
  const kilde = readFileSync(path.join(import.meta.dirname, "kvoter.ts"), "utf-8");
  const match = kilde.match(/export async function saveKvoter\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(match, "fant ikke saveKvoter i kildekoden");
  const body = match[1];
  assert.match(body, /setDoc\(kvoteRef\(id\),\s*kvoter\)/);
  assert.ok(!body.includes("merge: true"), "saveKvoter skal ikke bruke merge:true — mutatorene sender alltid full tilstand");
});

test("fjernKategori: fjerner kategorien fra arrayet, rører ingen andre arter", () => {
  const kilde = readFileSync(path.join(import.meta.dirname, "kvoter.ts"), "utf-8");
  const match = kilde.match(/export async function fjernKategori\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(match, "fant ikke fjernKategori i kildekoden");
  const body = match[1];
  assert.match(body, /\.filter\(\(k\) => k\.id !== kategoriId\)/);
});
