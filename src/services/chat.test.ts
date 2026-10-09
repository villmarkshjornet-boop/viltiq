import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Samme begrunnelse som kvoter.test.ts: chat.ts importerer firebase/firestore
// og "@/..."-alias som node --test ikke løser uten hjelp.
register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { tellUlesteMeldinger } = await import("./chat");

const meldinger = [
  { id: "1", senderUid: "meg", senderNavn: "Meg", tekst: "hei", sendtAtMs: 1000 },
  { id: "2", senderUid: "andre", senderNavn: "Andre", tekst: "hallo", sendtAtMs: 2000 },
  { id: "3", senderUid: "andre", senderNavn: "Andre", tekst: "noe mer", sendtAtMs: 3000 },
];

test("tellUlesteMeldinger: teller kun meldinger fra andre, sendt etter sist lest", () => {
  assert.equal(tellUlesteMeldinger(meldinger, 1500, "meg"), 2);
});

test("tellUlesteMeldinger: egne meldinger telles aldri, uansett tidspunkt", () => {
  assert.equal(tellUlesteMeldinger(meldinger, 0, "meg"), 2);
});

test("tellUlesteMeldinger: alt lest når sistLestMs er etter siste melding", () => {
  assert.equal(tellUlesteMeldinger(meldinger, 5000, "meg"), 0);
});

test("tellUlesteMeldinger: melding uten sendtAtMs ennå (null) telles aldri som ulest — unngår falsk badge før tidsstempelet er skrevet", () => {
  const utenTidsstempel = [{ id: "x", senderUid: "andre", senderNavn: "Andre", tekst: "ny", sendtAtMs: null }];
  assert.equal(tellUlesteMeldinger(utenTidsstempel, 1, "meg"), 0);
  assert.equal(tellUlesteMeldinger(utenTidsstempel, 0, "meg"), 0);
});
