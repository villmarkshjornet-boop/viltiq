import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

// predictions.ts pulls in firebase/firestore and the "@/..." bundler alias —
// same reason as cameras.test.ts/felling.test.ts need this loader. See
// src/testSupport/nodeEsmTestLoader.mjs for details; it does not change the
// behavior of the code under test.
register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { savePredictionSnapshot, getRecentSnapshots, evaluateSnapshotAgainstObservation } =
  await import("./predictions");

const SOURCE = readFileSync(path.join(import.meta.dirname, "predictions.ts"), "utf-8");

// ---------------------------------------------------------------------------
// savePredictionSnapshot — må ALDRI stole på snapshot.jaktlagId slik kalleren
// måtte ha satt den; jaktlagId skal alltid løses på nytt via
// getAktivtJaktlagId(), akkurat som observations.ts/felling.ts. Må skrive til
// "predictions"-samlingen og stemple en server-tidsstempel.
// ---------------------------------------------------------------------------

test("savePredictionSnapshot: løser jaktlagId via getAktivtJaktlagId(), skriver til 'predictions', stempler serverTimestamp", () => {
  const match = SOURCE.match(
    /export async function savePredictionSnapshot\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
  );
  assert.ok(match, "fant ikke savePredictionSnapshot i kildekoden");
  const body = match[1];

  assert.match(body, /getAktivtJaktlagId\(\)/);
  assert.match(body, /addDoc\(\s*collection\(db,\s*PREDICTIONS_COLLECTION\)/);
  assert.match(body, /createdAt:\s*serverTimestamp\(\)/);
  // Skriver ...snapshot og overskriver deretter jaktlagId med den
  // server-side-resolverte verdien — ikke den som eventuelt kom fra snapshot.
  assert.match(body, /\.\.\.snapshot,\s*jaktlagId,/);
  assert.equal(typeof savePredictionSnapshot, "function");
});

test("PREDICTIONS_COLLECTION er 'predictions' (topp-nivå-samling, ikke en subcollection)", () => {
  assert.match(SOURCE, /const PREDICTIONS_COLLECTION = "predictions";/);
});

// ---------------------------------------------------------------------------
// getRecentSnapshots — skal spørre skopet til jaktlagId (eget aktive lag
// eller offentlig), sortert på calculatedAt desc.
// ---------------------------------------------------------------------------

test("getRecentSnapshots: spør scoped på jaktlagId og species, sortert på calculatedAt desc", () => {
  const match = SOURCE.match(
    /export async function getRecentSnapshots\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
  );
  assert.ok(match, "fant ikke getRecentSnapshots i kildekoden");
  const body = match[1];

  assert.match(body, /getAktivtJaktlagId\(\)/);
  assert.match(body, /where\(\s*"jaktlagId",\s*"==",\s*jaktlagId\s*\)/);
  assert.match(body, /where\(\s*"species",\s*"==",\s*species\s*\)/);
  assert.match(body, /orderBy\(\s*"calculatedAt",\s*"desc"\s*\)/);
  assert.equal(typeof getRecentSnapshots, "function");
});

// ---------------------------------------------------------------------------
// evaluateSnapshotAgainstObservation — ren funksjon, ingen Firestore-kall i
// kroppen (se den mer utfyllende testen for selve oppførselen i
// src/engine/snapshot.test.ts). Her bekrefter vi bare at den faktisk
// eksporteres fra denne filen og ikke gjør noen Firestore-IO.
// ---------------------------------------------------------------------------

test("evaluateSnapshotAgainstObservation: ren funksjon, ingen Firestore-kall i kroppen", () => {
  const match = SOURCE.match(
    /export function evaluateSnapshotAgainstObservation\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
  );
  assert.ok(match, "fant ikke evaluateSnapshotAgainstObservation i kildekoden");
  const body = match[1];

  for (const forbidden of ["addDoc", "getDoc", "getDocs", "onSnapshot", "updateDoc", "deleteDoc"]) {
    assert.ok(!body.includes(forbidden), `evaluateSnapshotAgainstObservation skal ikke kalle ${forbidden}`);
  }
  assert.equal(typeof evaluateSnapshotAgainstObservation, "function");
});
