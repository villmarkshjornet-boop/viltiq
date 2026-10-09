import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { deriveViewportRadiusMeters, shouldReuseAnalysisAnchor, MIN_ANALYSIS_RADIUS_METERS, MAX_ANALYSIS_RADIUS_METERS } = await import(
  "./analysisAnchor"
);
const { movePoint } = await import("./geo");

// V1.3 §C/§D/§Y (Stable Viewport A-E): analysen skal stå geografisk stille
// ved SMÅ kartbevegelser, men følge brukeren til et reelt NYTT område.

// ===========================================================================
// deriveViewportRadiusMeters — §D
// ===========================================================================

test("deriveViewportRadiusMeters: klipper til minimumsradius for et ekstremt nært zoom", () => {
  const r = deriveViewportRadiusMeters({ latitude: 60, longitude: 10, latitudeDelta: 0.0005, longitudeDelta: 0.0005 });
  assert.equal(r, MIN_ANALYSIS_RADIUS_METERS);
});

test("deriveViewportRadiusMeters: klipper til maksradius for et ekstremt vidt zoom", () => {
  const r = deriveViewportRadiusMeters({ latitude: 60, longitude: 10, latitudeDelta: 5, longitudeDelta: 5 });
  assert.equal(r, MAX_ANALYSIS_RADIUS_METERS);
});

test("deriveViewportRadiusMeters: et moderat zoom gir en radius mellom min og maks, med margin over selve halvdiagonalen", () => {
  // ~0.05° breddegrad ≈ 5,55 km høyde -> halvhøyde ≈ 2,78 km
  const r = deriveViewportRadiusMeters({ latitude: 60, longitude: 10, latitudeDelta: 0.05, longitudeDelta: 0.05 });
  assert.ok(r > MIN_ANALYSIS_RADIUS_METERS && r < MAX_ANALYSIS_RADIUS_METERS, `forventet et mellomliggende tall, fikk ${r}`);
  assert.ok(r > 2780, "forventet at margin-faktoren løfter radiusen over den rå halvdiagonalen");
});

// ===========================================================================
// shouldReuseAnalysisAnchor — §C, §Y-A til §Y-E
// ===========================================================================

test("§Y-A: ingen eksisterende anker -> alltid ny analyse", () => {
  const center = { latitude: 60, longitude: 10 };
  assert.equal(shouldReuseAnalysisAnchor(null, center, 3000), false);
});

test("§Y-A: pan 100–300 m med et 5 km-anker -> SAMME analyse (godt innenfor dead-zonen)", () => {
  const anchor = { center: { latitude: 60, longitude: 10 }, radiusMeters: 5000 };
  const litt200m = movePoint(anchor.center.latitude, anchor.center.longitude, 45, 200);
  assert.equal(shouldReuseAnalysisAnchor(anchor, litt200m, 5000), true, "200 m drift på et 5 km-anker skal IKKE trigge ny analyse");
});

test("§Y-B: pan nær kanten av dekningen, men fortsatt innenfor -> behold eksisterende analyse", () => {
  const anchor = { center: { latitude: 60, longitude: 10 }, radiusMeters: 5000 };
  // 1800 m < 5000*0.4=2000 m default-terskel -> fortsatt dekket
  const nesten = movePoint(anchor.center.latitude, anchor.center.longitude, 90, 1800);
  assert.equal(shouldReuseAnalysisAnchor(anchor, nesten, 5000), true);
});

test("§Y-C: pan langt til et reelt nytt område -> ny analyse", () => {
  const anchor = { center: { latitude: 60, longitude: 10 }, radiusMeters: 5000 };
  const langtUnna = movePoint(anchor.center.latitude, anchor.center.longitude, 90, 20000);
  assert.equal(shouldReuseAnalysisAnchor(anchor, langtUnna, 5000), false);
});

test("§Y-D: zoom inn PÅ hotspoten (senter uendret, mindre radius) -> behold eksisterende analyse (presentasjonsendring, ikke ny analyse)", () => {
  const anchor = { center: { latitude: 60, longitude: 10 }, radiusMeters: 5000 };
  assert.equal(shouldReuseAnalysisAnchor(anchor, anchor.center, 800), true, "en MINDRE viewport-radius enn det som allerede er dekket skal aldri kreve ny analyse");
});

test("§Y-E: zoom UT utover eksisterende dekning -> kontrollert ny analyse, selv om senteret ikke har flyttet seg", () => {
  const anchor = { center: { latitude: 60, longitude: 10 }, radiusMeters: 2000 };
  // Ny viewport-radius (3000) > anchor.radiusMeters (2000) * 1.3 (default vekstfaktor) = 2600
  assert.equal(shouldReuseAnalysisAnchor(anchor, anchor.center, 3000), false);
});

test("shouldReuseAnalysisAnchor: senteret rett innenfor dead-zone-grensen regnes som fortsatt dekket", () => {
  const anchor = { center: { latitude: 60, longitude: 10 }, radiusMeters: 1000 };
  // Godt innenfor 0.4 * 1000 = 400 m-terskelen, men bevisst nær den — geodetisk
  // avstandsberegning (movePoint -> distanceMeters) er ikke bit-eksakt nok til
  // å teste PRESIST på selve grensen uten flaks-avhengig floating point-utfall.
  const nesten = movePoint(anchor.center.latitude, anchor.center.longitude, 0, 390);
  assert.equal(shouldReuseAnalysisAnchor(anchor, nesten, 1000), true);
});

test("shouldReuseAnalysisAnchor: egendefinerte terskler (options) overstyrer default", () => {
  const anchor = { center: { latitude: 60, longitude: 10 }, radiusMeters: 5000 };
  const litt500m = movePoint(anchor.center.latitude, anchor.center.longitude, 0, 500);
  assert.equal(
    shouldReuseAnalysisAnchor(anchor, litt500m, 5000, { centerFraction: 0.05 }),
    false,
    "en strengere centerFraction skal kunne gjøre samme drift til 'utenfor dekning'"
  );
});
