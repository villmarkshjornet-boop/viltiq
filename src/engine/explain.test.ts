// Tester for explain.ts sin computeRecommendedTimeWindow() — V1.3 "Beste
// tidspunkt". Verifiserer at vinduet er REELT utledet fra sunrise/sunsetMs +
// artens crepuscularActivity.strength (samme formel som
// computeCrepuscularActivityMultiplier i ecology/suitability.ts), ALDRI et
// hardkodet/oppdiktet klokkeslett — se filkommentaren over funksjonen.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { computeRecommendedTimeWindow } = await import("./explain");
const { HJORT_ECOLOGY_PROFILE } = await import("./ecology/hjort");
const { RADYR_ECOLOGY_PROFILE } = await import("./ecology/radyr");
const { getEcologyProfile } = await import("./ecology/profiles");

const SUNRISE = Date.UTC(2026, 5, 1, 4, 0, 0); // 2026-06-01T04:00:00Z
const SUNSET = Date.UTC(2026, 5, 1, 21, 0, 0); // 2026-06-01T21:00:00Z — godt separert fra soloppgang

test("computeRecommendedTimeWindow — hjort (reell crepuscularActivity.strength) gir vinduer rundt BÅDE soloppgang og solnedgang", () => {
  const windows = computeRecommendedTimeWindow(SUNRISE, SUNSET, HJORT_ECOLOGY_PROFILE.crepuscularActivity);
  assert.equal(windows.length, 2, "forventet ett vindu for soloppgang og ett for solnedgang");

  const dawn = windows.find((w: any) => w.type === "dawn");
  const dusk = windows.find((w: any) => w.type === "dusk");
  assert.ok(dawn, "forventet et dawn-vindu");
  assert.ok(dusk, "forventet et dusk-vindu");

  // Selve hendelsestidspunktet (der aktivitetsbonusen er størst) skal alltid ligge INNENFOR vinduet.
  assert.ok(dawn!.startMs <= SUNRISE && SUNRISE <= dawn!.endMs, "soloppgang skal ligge inni dawn-vinduet");
  assert.ok(dusk!.startMs <= SUNSET && SUNSET <= dusk!.endMs, "solnedgang skal ligge inni dusk-vinduet");

  // Vinduet skal ha faktisk bredde (ikke et null-bredt "punkt").
  assert.ok(dawn!.endMs - dawn!.startMs > 0, "dawn-vinduet skal ha positiv bredde");
  assert.ok(dusk!.endMs - dusk!.startMs > 0, "dusk-vinduet skal ha positiv bredde");
});

test("computeRecommendedTimeWindow — art uten dokumentert skumringseffekt ('annet'/Rev, strength=0) gir ALDRI et oppdiktet vindu", () => {
  const annetProfile = getEcologyProfile("annet");
  assert.equal(annetProfile.crepuscularActivity.strength, 0);
  const windows = computeRecommendedTimeWindow(SUNRISE, SUNSET, annetProfile.crepuscularActivity);
  assert.deepEqual(windows, [], "strength 0 skal aldri produsere et vindu");
});

test("computeRecommendedTimeWindow — svært lav (men > 0) styrke som aldri når den meningsfulle terskelen gir også tomt resultat", () => {
  // Ved terskel 1.05 og formelen 1 + strength*fraction*0.3 kreves strength >
  // ~0.1667 for at selve toppunktet (fraction=1) i det hele tatt skal nå 1.05.
  // 0.05 er bevisst under den grensen — skal IKKE gi et vindu, men heller ikke krasje.
  const veldigSvak = { evidence: "LOW" as const, strength: 0.05 };
  const windows = computeRecommendedTimeWindow(SUNRISE, SUNSET, veldigSvak);
  assert.deepEqual(windows, [], "for svak styrke til at toppunktet når terskelen skal gi tomt array, ikke et fabrikkert vindu");
});

test("computeRecommendedTimeWindow — mangler sunrise/sunsetMs (ingen værdata) gir tomt array selv for en sterk art", () => {
  const windows = computeRecommendedTimeWindow(null, null, HJORT_ECOLOGY_PROFILE.crepuscularActivity);
  assert.deepEqual(windows, []);
});

test("computeRecommendedTimeWindow — kun soloppgang kjent (solnedgang null) gir kun et dawn-vindu", () => {
  const windows = computeRecommendedTimeWindow(SUNRISE, null, HJORT_ECOLOGY_PROFILE.crepuscularActivity);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].type, "dawn");
});

test("computeRecommendedTimeWindow — kun solnedgang kjent (soloppgang null) gir kun et dusk-vindu", () => {
  const windows = computeRecommendedTimeWindow(null, SUNSET, HJORT_ECOLOGY_PROFILE.crepuscularActivity);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].type, "dusk");
});

test("computeRecommendedTimeWindow — ulike arters crepuscularActivity.strength gir ulik vindusbredde (sterkere art = bredere vindu)", () => {
  const sterk = { evidence: "MEDIUM" as const, strength: 0.4 }; // hjort/rådyr-nivå
  const svak = { evidence: "MEDIUM" as const, strength: 0.2 }; // rett over terskel-grensen

  const sterkeVinduer = computeRecommendedTimeWindow(SUNRISE, null, sterk);
  const svakeVinduer = computeRecommendedTimeWindow(SUNRISE, null, svak);

  assert.equal(sterkeVinduer.length, 1);
  assert.equal(svakeVinduer.length, 1);

  const sterkBredde = sterkeVinduer[0].endMs - sterkeVinduer[0].startMs;
  const svakBredde = svakeVinduer[0].endMs - svakeVinduer[0].startMs;
  assert.ok(sterkBredde > svakBredde, `forventet at strength=0.4 gir bredere vindu enn strength=0.2 (fikk ${sterkBredde}ms vs ${svakBredde}ms)`);
});

test("computeRecommendedTimeWindow — endrer seg sensibelt med ulike sunrise/sunsetMs (ikke et fast klokkeslett)", () => {
  const senereSoloppgang = SUNRISE + 2 * 3600000; // 2 timer senere soloppgang (f.eks. lenger nord/senere årstid)
  const vindu1 = computeRecommendedTimeWindow(SUNRISE, null, HJORT_ECOLOGY_PROFILE.crepuscularActivity);
  const vindu2 = computeRecommendedTimeWindow(senereSoloppgang, null, HJORT_ECOLOGY_PROFILE.crepuscularActivity);

  assert.equal(vindu1.length, 1);
  assert.equal(vindu2.length, 1);
  // Vinduet skal flytte seg med soloppgangen — samme (eller nær samme) bredde, men forskjøvet klokkeslett.
  assert.notEqual(vindu1[0].startMs, vindu2[0].startMs);
  assert.ok(
    Math.abs(vindu2[0].startMs - vindu1[0].startMs - 2 * 3600000) < 5 * 60000,
    "vinduet skal forskyves med omtrent samme delta som soloppgangen selv flyttet seg"
  );
});

test("computeRecommendedTimeWindow — rådyr (annen crepuscularActivity enn hjort) gir også et gyldig, ikke-identisk-hardkodet vindu", () => {
  const windows = computeRecommendedTimeWindow(SUNRISE, SUNSET, RADYR_ECOLOGY_PROFILE.crepuscularActivity);
  assert.equal(windows.length, 2);
  for (const w of windows) {
    assert.ok(w.endMs > w.startMs);
  }
});
