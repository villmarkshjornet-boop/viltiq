import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

// cameras.ts pulls in firebase/firestore, the "@/..." bundler path alias, and
// a same-directory extensionless import ("./jaktlag") — none of which plain
// `node --test` can resolve/execute out of the box (see
// src/testSupport/nodeEsmTestLoader.mjs for the exact, narrow reasons and
// why this does NOT change the behavior of the code under test). We register
// that loader before dynamically importing the real module, so the function
// we assert on below is the actual implementation shipped in cameras.ts, not
// a reimplementation.
register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { normaliserGrader, deactivateCamera } = await import("./cameras");

// ---------------------------------------------------------------------------
// normaliserGrader — normaliser til [0, 360)
// ---------------------------------------------------------------------------

test("normaliserGrader: verdier innenfor [0, 360) er uendret", () => {
  assert.equal(normaliserGrader(0), 0);
  assert.equal(normaliserGrader(90), 90);
  assert.equal(normaliserGrader(359), 359);
});

test("normaliserGrader: 360 normaliseres til 0", () => {
  assert.equal(normaliserGrader(360), 0);
});

test("normaliserGrader: negative verdier vikles rundt til øvre del av intervallet", () => {
  assert.equal(normaliserGrader(-10), 350);
});

test("normaliserGrader: verdier over 360 vikles rundt (modulo)", () => {
  assert.equal(normaliserGrader(725), 5); // 725 - 2*360 = 5
});

test("normaliserGrader: resultatet er alltid i [0, 360) for et bredt utvalg input", () => {
  const inputs = [0, 1, 90, 180, 270, 359, 360, 361, -1, -359, -360, -361, 720, -720, 1000, -1000];
  for (const grader of inputs) {
    const resultat = normaliserGrader(grader);
    assert.ok(
      resultat >= 0 && resultat < 360,
      `normaliserGrader(${grader}) = ${resultat} er utenfor [0, 360)`
    );
  }
});

// ---------------------------------------------------------------------------
// deactivateCamera — "fjern kamera" er en myk sletting: kun kamera-dokumentet
// oppdateres, observasjoner røres aldri. Vi kan ikke verifisere dette mot en
// ekte Firestore her (se rapport/kommentar om utestede deler), men vi KAN
// verifisere det som følger logisk av kildekoden selv: at funksjonen kun
// kaller updateDoc på "cameras"-dokumentet, og aldri berører "observations"-
// samlingen. Dette leser den faktiske kildekoden (ikke en reimplementasjon).
// ---------------------------------------------------------------------------

test("deactivateCamera: kildekoden oppdaterer kun kamera-dokumentet, aldri observasjoner", () => {
  const kilde = readFileSync(
    path.join(import.meta.dirname, "cameras.ts"),
    "utf-8"
  );

  const match = kilde.match(
    /export async function deactivateCamera\([^)]*\)[^{]*\{([\s\S]*?)\n\}/
  );
  assert.ok(match, "fant ikke deactivateCamera-funksjonen i kildekoden");
  const body = match[1];

  // Skal oppdatere nøyaktig ett dokument, i "cameras"-samlingen.
  assert.match(body, /updateDoc\(\s*doc\(db,\s*"cameras",\s*id\)/);
  // Skal aldri referere "observations"-samlingen i det hele tatt.
  assert.ok(
    !body.includes("observations"),
    "deactivateCamera skal ikke røre observations-samlingen"
  );
  // Skal ikke slette noe dokument (myk sletting, ikke hard sletting).
  assert.ok(
    !body.includes("deleteDoc"),
    "deactivateCamera skal være en myk sletting (updateDoc), ikke deleteDoc"
  );

  assert.equal(typeof deactivateCamera, "function");
});
