import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import type { Kvoter } from "../services/kvoter";

// Se src/lib/cameraActivity.test.ts / src/testSupport/nodeEsmTestLoader.mjs
// for hvorfor denne kroken trengs: ren `node --test` løser ikke den
// extensionsløse relative spesifikatoren under på egen hånd.
register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { beregnKvoteRader, fellingerUtenGyldigKategori } = await import("./kvoteBeregning");

const ARTER = ["Hjort", "Elg"] as const;

const KVOTER: Kvoter = {
  Hjort: {
    kategorier: [
      { id: "bukk", navn: "Bukk", maks: 2 },
      { id: "kolle", navn: "Kolle", maks: 2 },
      { id: "kalv", navn: "Kalv", maks: 3 },
    ],
  },
  Elg: {
    kategorier: [{ id: "okse", navn: "Okse", maks: 1 }],
  },
};

// ---------------------------------------------------------------------------
// beregnKvoteRader — STEG 5 §4/§9: "felt" beregnes ALLTID live fra fellings,
// aldri fra en lagret teller. Disse testene simulerer nøyaktig
// akseptansekriteriene: registrering, redigering (kategoribytte) og
// sletting av en felling skal automatisk gi riktig felt-tall for RIKTIG
// kategori — uten noen synk-funksjon å kalle.
// ---------------------------------------------------------------------------

test("beregnKvoteRader: én rad per kategori, felt=0 når ingen fellinger finnes", () => {
  const rader = beregnKvoteRader(KVOTER, [], ARTER);
  assert.equal(rader.length, 4); // 3 for Hjort + 1 for Elg
  assert.ok(rader.every((r) => r.felt === 0));
});

test("beregnKvoteRader: en registrert felling teller mot RIKTIG kategori, ikke de andre", () => {
  const fellings = [{ dyr: "Hjort", kategoriId: "bukk" }];
  const rader = beregnKvoteRader(KVOTER, fellings, ARTER);
  assert.equal(rader.find((r) => r.kategoriId === "bukk")!.felt, 1);
  assert.equal(rader.find((r) => r.kategoriId === "kolle")!.felt, 0);
  assert.equal(rader.find((r) => r.kategoriId === "kalv")!.felt, 0);
  assert.equal(rader.find((r) => r.kategoriId === "okse")!.felt, 0);
});

test("beregnKvoteRader: å 'redigere' en felling (endre kategoriId i input) flytter felt-tallet — gammel kategori går ned, ny går opp", () => {
  const førRedigering = [{ dyr: "Hjort", kategoriId: "bukk" }];
  const etterRedigering = [{ dyr: "Hjort", kategoriId: "kolle" }]; // samme felling, kategoriId endret

  const raderFør = beregnKvoteRader(KVOTER, førRedigering, ARTER);
  assert.equal(raderFør.find((r) => r.kategoriId === "bukk")!.felt, 1);
  assert.equal(raderFør.find((r) => r.kategoriId === "kolle")!.felt, 0);

  const raderEtter = beregnKvoteRader(KVOTER, etterRedigering, ARTER);
  assert.equal(raderEtter.find((r) => r.kategoriId === "bukk")!.felt, 0);
  assert.equal(raderEtter.find((r) => r.kategoriId === "kolle")!.felt, 1);
});

test("beregnKvoteRader: å 'slette' en felling (fjerne den fra listen) reduserer felt-tallet for kategorien den talte mot", () => {
  const førSletting = [
    { dyr: "Hjort", kategoriId: "bukk" },
    { dyr: "Hjort", kategoriId: "bukk" },
  ];
  const etterSletting = [{ dyr: "Hjort", kategoriId: "bukk" }]; // én fjernet

  assert.equal(beregnKvoteRader(KVOTER, førSletting, ARTER).find((r) => r.kategoriId === "bukk")!.felt, 2);
  assert.equal(beregnKvoteRader(KVOTER, etterSletting, ARTER).find((r) => r.kategoriId === "bukk")!.felt, 1);
});

test("beregnKvoteRader: fellinger for arter utenfor 'arter'-lista påvirker ingenting", () => {
  const fellings = [{ dyr: "Rev", kategoriId: null }];
  const rader = beregnKvoteRader(KVOTER, fellings, ARTER);
  assert.ok(rader.every((r) => r.felt === 0));
});

test("beregnKvoteRader: art uten kategorier gir ingen rader for den arten", () => {
  const rader = beregnKvoteRader({ Rådyr: { kategorier: [] } }, [], ["Rådyr"]);
  assert.equal(rader.length, 0);
});

// ---------------------------------------------------------------------------
// fellingerUtenGyldigKategori — fellinger uten kategori (eller med en
// kategori som siden er fjernet) skal aldri stille forsvinne fra oversikten.
// ---------------------------------------------------------------------------

test("fellingerUtenGyldigKategori: felling uten kategoriId flagges når arten HAR kategorier", () => {
  const fellings = [{ dyr: "Hjort", kategoriId: null }];
  const resultat = fellingerUtenGyldigKategori(KVOTER, fellings, ARTER);
  assert.equal(resultat.length, 1);
});

test("fellingerUtenGyldigKategori: felling med gyldig kategoriId flagges IKKE", () => {
  const fellings = [{ dyr: "Hjort", kategoriId: "bukk" }];
  assert.equal(fellingerUtenGyldigKategori(KVOTER, fellings, ARTER).length, 0);
});

test("fellingerUtenGyldigKategori: felling som peker på en FJERNET kategori flagges", () => {
  const fellings = [{ dyr: "Hjort", kategoriId: "en-slettet-id" }];
  assert.equal(fellingerUtenGyldigKategori(KVOTER, fellings, ARTER).length, 1);
});

test("fellingerUtenGyldigKategori: arter uten kategorier definert ennå flagges ikke (ikke relevant ennå)", () => {
  const fellings = [{ dyr: "Rådyr", kategoriId: null }];
  assert.equal(fellingerUtenGyldigKategori({}, fellings, ["Rådyr"]).length, 0);
});
