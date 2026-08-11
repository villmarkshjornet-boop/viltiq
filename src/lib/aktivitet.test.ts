import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// See src/lib/cameraActivity.test.ts / src/testSupport/nodeEsmTestLoader.mjs
// for why this hook is needed: plain `node --test` cannot resolve the
// extensionless relative specifier below on its own.
register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { hentTimerSiden, hentTidsvekt, hentNivå, nivåFarge, dyrEmoji, hentRelativTid } =
  await import("./aktivitet");

// ---------------------------------------------------------------------------
// hentTimerSiden
// ---------------------------------------------------------------------------

test("hentTimerSiden: 3 timer tilbake gir ~3", () => {
  const tid = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const t = hentTimerSiden(tid);
  assert.ok(Math.abs(t - 3) < 0.01, `forventet ~3 timer, fikk ${t}`);
});

test("hentTimerSiden: tomt tidspunkt regnes som uendelig gammelt", () => {
  assert.equal(hentTimerSiden(""), Number.POSITIVE_INFINITY);
});

test("hentTimerSiden: ugyldig tidsstreng regnes som uendelig gammelt", () => {
  assert.equal(hentTimerSiden("ikke-en-dato"), Number.POSITIVE_INFINITY);
});

test("hentTimerSiden: Unix epoch (1970-01-01) er et gyldig tidspunkt, ikke 'uendelig gammelt'", () => {
  // Regresjonstest for en tidligere bug: koden sjekket `!ms` i stedet for
  // `Number.isNaN(ms)`, så getTime()===0 (nøyaktig epoch) ble feilaktig
  // behandlet som ugyldig. Epoch er svært langt tilbake i tid, men skal
  // fortsatt gi et stort, ENDELIG timetall — ikke Infinity.
  const t = hentTimerSiden(new Date(0).toISOString());
  assert.ok(Number.isFinite(t), `forventet et endelig timetall, fikk ${t}`);
  assert.ok(t > 400000, `forventet et svært stort timetall (epoch er lenge siden), fikk ${t}`);
});

// ---------------------------------------------------------------------------
// hentTidsvekt
// ---------------------------------------------------------------------------

test("hentTidsvekt: innenfor 6 timer gir vekt 5", () => {
  const tid = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
  assert.equal(hentTidsvekt(tid), 5);
});

test("hentTidsvekt: innenfor 24 timer (men over 6) gir vekt 4", () => {
  const tid = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  assert.equal(hentTidsvekt(tid), 4);
});

test("hentTidsvekt: innenfor 72 timer (men over 24) gir vekt 3", () => {
  const tid = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  assert.equal(hentTidsvekt(tid), 3);
});

test("hentTidsvekt: innenfor 168 timer (men over 72) gir vekt 2", () => {
  const tid = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString();
  assert.equal(hentTidsvekt(tid), 2);
});

test("hentTidsvekt: over 168 timer gir vekt 1", () => {
  const tid = new Date(Date.now() - 300 * 60 * 60 * 1000).toISOString();
  assert.equal(hentTidsvekt(tid), 1);
});

// ---------------------------------------------------------------------------
// hentNivå
// ---------------------------------------------------------------------------

test("hentNivå: grenseverdier for Høy/Medium/Lav", () => {
  assert.equal(hentNivå(14), "Høy");
  assert.equal(hentNivå(13.9), "Medium");
  assert.equal(hentNivå(6), "Medium");
  assert.equal(hentNivå(5.9), "Lav");
  assert.equal(hentNivå(0), "Lav");
});

// ---------------------------------------------------------------------------
// nivåFarge
// ---------------------------------------------------------------------------

test("nivåFarge: gir riktig farge per nivå, og faller tilbake til grønn for ukjente verdier", () => {
  assert.equal(nivåFarge("Høy"), "#F97316");
  assert.equal(nivåFarge("Medium"), "#EAB308");
  assert.equal(nivåFarge("Lav"), "#22C55E");
  assert.equal(nivåFarge("noe-ukjent"), "#22C55E");
});

// ---------------------------------------------------------------------------
// dyrEmoji
// ---------------------------------------------------------------------------

test("dyrEmoji: Rev gir rev-emoji, alt annet gir hjort-emoji", () => {
  assert.equal(dyrEmoji("Rev"), "🦊");
  assert.equal(dyrEmoji("Rådyr"), "🦌");
  assert.equal(dyrEmoji("Elg"), "🦌");
  assert.equal(dyrEmoji(""), "🦌");
});

// ---------------------------------------------------------------------------
// hentRelativTid
// ---------------------------------------------------------------------------

test("hentRelativTid: under 60 minutter vises i minutter", () => {
  const tid = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert.equal(hentRelativTid(tid), "for 10m siden");
});

test("hentRelativTid: under 24 timer vises i timer", () => {
  const tid = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  assert.equal(hentRelativTid(tid), "for 5t siden");
});

test("hentRelativTid: 24 timer eller mer vises i dager", () => {
  const tid = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(hentRelativTid(tid), "for 3d siden");
});
