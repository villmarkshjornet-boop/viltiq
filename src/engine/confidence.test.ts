import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { computeZoneConfidence, confidenceLevelFromScore, computeFallbackConfidence } = await import("./confidence");
const { DEFAULT_ENGINE_CONFIG } = await import("./config");

// § kritisk korrigering: computeZoneConfidence sin directionalConsistency-
// komponent fikk tidligere `o.movementDirectionDeg ?? o.cameraDirectionDeg`
// — dvs. falt tilbake til kameraets FASTE monteringsretning når dyrets egen
// bevegelsesretning var ukjent. Det er en kategorifeil: flere kamera PEKER
// bevisst ulike veier for å dekke ulike tilnærminger til samme sone, så
// «kamera A peker nord, kamera B peker øst» ble feiltolket som spredte/
// uenige observasjoner og SENKET confidence desto flere uavhengige kamera
// som bekreftet samme sone (ikke-monoton: 8 ferske kamera kunne gi lavere
// confidence enn 4). Denne filen dokumenterer rettingen — kun dyrets
// FAKTISKE bevegelsesretning (movementDirectionDeg, alltid null med mindre
// en bruker eksplisitt har satt den) skal påvirke enighets-komponenten.

const cfg = DEFAULT_ENGINE_CONFIG;
const NOW = new Date("2026-08-10T12:00:00.000Z").getTime();

let idCounter = 0;
function obs(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `eo-${idCounter}`,
    species: "hjort",
    timestamp: NOW,
    position: { latitude: 60.0, longitude: 10.0 },
    source: "camera",
    movementDirectionDeg: null,
    cameraDirectionDeg: null,
    count: 1,
    sex: null,
    age: null,
    trackType: null,
    cameraId: `cam-${idCounter}`,
    jaktlagId: "",
    dataQuality: 0.8,
    ...overrides,
  };
}

/**
 * Bygger `n` FERSKE kameraobservasjoner, hver fra et DISTINKT kamera, med
 * kameraets monteringsretning (cameraDirectionDeg) bevisst spredt over de
 * fire himmelretningene — men dyrets bevegelsesretning ALLTID ukjent (null).
 * Dette er nøyaktig scenarioet som utløste bugen: flere uavhengige kamera
 * som dekker ulike tilnærmingsveier til samme sone.
 */
function scatteredCameraObs(n: number) {
  const scatteredCameraBearings = [0, 90, 180, 270];
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push(
      obs({
        cameraId: `cam-${i}`,
        cameraDirectionDeg: scatteredCameraBearings[i % scatteredCameraBearings.length],
        movementDirectionDeg: null,
        timestamp: NOW,
      })
    );
  }
  return list;
}

// ---------------------------------------------------------------------------
// computeZoneConfidence — grunnleggende
// ---------------------------------------------------------------------------

test("computeZoneConfidence: null bidragsytende observasjoner gir eksakt 0", () => {
  assert.equal(computeZoneConfidence([], cfg, NOW), 0);
});

// ---------------------------------------------------------------------------
// computeZoneConfidence — regresjonstest for kritisk korrigering
// ---------------------------------------------------------------------------

test("computeZoneConfidence: flere UAVHENGIGE, ferske kamera med spredte monteringsretninger (men ukjent dyreretning) skal ALDRI senke confidence — monoton ikke-avtagende med antall observasjoner", () => {
  const counts = [1, 3, 5, 8];
  const confidences = counts.map((n) => computeZoneConfidence(scatteredCameraObs(n) as never, cfg, NOW));

  for (let i = 1; i < confidences.length; i++) {
    assert.ok(
      confidences[i] >= confidences[i - 1] - 1e-9,
      `REGRESJON: ${counts[i]} ferske, uavhengige kamera (spredte monteringsretninger, ukjent dyreretning) ga LAVERE ` +
        `confidence (${confidences[i]}) enn ${counts[i - 1]} kamera (${confidences[i - 1]}). Dette var nøyaktig bugen — ` +
        `flere kamera som PEKER ulike veier for å dekke ulike tilnærmingsveier ble feilaktig lest som "dyrene er uenige om ` +
        `retning" via cameraDirectionDeg-fallbacken i directionalConsistency(). Flere uavhengige, ferske bekreftelser av ` +
        `samme sone skal ALDRI kunne senke confidence.`
    );
  }
  // Og det skal faktisk stige merkbart fra 1 til 8 (volum+diversitet), ikke bare "ikke synke".
  assert.ok(
    confidences[confidences.length - 1] > confidences[0],
    `forventet at confidence faktisk øker fra 1 til 8 uavhengige ferske kamera, fikk ${confidences[0]} -> ${confidences[confidences.length - 1]}`
  );
});

// ---------------------------------------------------------------------------
// computeZoneConfidence — movementDirectionDeg driver konsistens-komponenten
// ---------------------------------------------------------------------------

test("computeZoneConfidence: identisk bevegelsesretning gir høyere confidence enn motsatt bevegelsesretning, alt annet likt", () => {
  const identical = [
    obs({ cameraId: "camA", movementDirectionDeg: 45, timestamp: NOW }),
    obs({ cameraId: "camB", movementDirectionDeg: 45, timestamp: NOW }),
  ];
  const opposite = [
    obs({ cameraId: "camA", movementDirectionDeg: 45, timestamp: NOW }),
    obs({ cameraId: "camB", movementDirectionDeg: 225, timestamp: NOW }),
  ];

  const identicalConfidence = computeZoneConfidence(identical as never, cfg, NOW);
  const oppositeConfidence = computeZoneConfidence(opposite as never, cfg, NOW);

  assert.ok(
    identicalConfidence > oppositeConfidence,
    `forventet at samstemt bevegelsesretning (45°/45°, confidence=${identicalConfidence}) gir høyere confidence enn ` +
      `motsatt bevegelsesretning (45°/225°, confidence=${oppositeConfidence}) — samme volum/diversitet/ferskhet ellers`
  );
});

test("computeZoneConfidence: cameraDirectionDeg er IRRELEVANT for confidence når movementDirectionDeg er null — samme resultat uansett hvilken kameraretning som settes", () => {
  // Før rettingen ville disse to scenariene gitt ULIK confidence, fordi
  // directionalConsistency ville falt tilbake til cameraDirectionDeg.
  const scenarioA = [
    obs({ cameraId: "cam-0", cameraDirectionDeg: 0, movementDirectionDeg: null, timestamp: NOW }),
    obs({ cameraId: "cam-1", cameraDirectionDeg: 90, movementDirectionDeg: null, timestamp: NOW }),
    obs({ cameraId: "cam-2", cameraDirectionDeg: 180, movementDirectionDeg: null, timestamp: NOW }),
    obs({ cameraId: "cam-3", cameraDirectionDeg: 270, movementDirectionDeg: null, timestamp: NOW }),
    obs({ cameraId: "cam-4", cameraDirectionDeg: 0, movementDirectionDeg: null, timestamp: NOW }),
  ];
  const scenarioB = [
    obs({ cameraId: "cam-0", cameraDirectionDeg: 45, movementDirectionDeg: null, timestamp: NOW }),
    obs({ cameraId: "cam-1", cameraDirectionDeg: 45, movementDirectionDeg: null, timestamp: NOW }),
    obs({ cameraId: "cam-2", cameraDirectionDeg: 45, movementDirectionDeg: null, timestamp: NOW }),
    obs({ cameraId: "cam-3", cameraDirectionDeg: 45, movementDirectionDeg: null, timestamp: NOW }),
    obs({ cameraId: "cam-4", cameraDirectionDeg: 45, movementDirectionDeg: null, timestamp: NOW }),
  ];

  const confidenceA = computeZoneConfidence(scenarioA as never, cfg, NOW);
  const confidenceB = computeZoneConfidence(scenarioB as never, cfg, NOW);

  assert.equal(
    confidenceA,
    confidenceB,
    `forventet EKSAKT samme confidence uansett cameraDirectionDeg-spredning (${confidenceA} vs ${confidenceB}) — ` +
      `cameraDirectionDeg skal ikke lenger påvirke consistency-komponenten i det hele tatt når movementDirectionDeg er null`
  );
});

// ---------------------------------------------------------------------------
// computeZoneConfidence — grenser
// ---------------------------------------------------------------------------

test("computeZoneConfidence: metter og går aldri over 1 eller under 0, selv i et ekstremt gunstig scenario", () => {
  const many = [];
  for (let i = 0; i < 50; i++) {
    many.push(
      obs({
        cameraId: `cam-extreme-${i}`,
        movementDirectionDeg: 45, // perfekt enighet
        timestamp: NOW, // maks ferskhet
      })
    );
  }
  const confidence = computeZoneConfidence(many as never, cfg, NOW);
  assert.ok(confidence <= 1, `forventet confidence <= 1, fikk ${confidence}`);
  assert.ok(confidence >= 0, `forventet confidence >= 0, fikk ${confidence}`);
  // Med 50 uavhengige, ferske, perfekt samstemte kilder bør vi være nær taket.
  assert.ok(confidence > 0.9, `forventet confidence nær metning (>0.9) i det gunstigste tenkelige scenariet, fikk ${confidence}`);
});

// ---------------------------------------------------------------------------
// confidenceLevelFromScore
// ---------------------------------------------------------------------------

test("confidenceLevelFromScore: bøtter riktig ved og rundt de konfigurerte terskelverdiene", () => {
  const t = cfg.confidenceThresholds;

  assert.equal(confidenceLevelFromScore(0, t), "lav");
  assert.equal(confidenceLevelFromScore(t.middels - 0.001, t), "lav");
  assert.equal(confidenceLevelFromScore(t.middels, t), "middels", "eksakt på middels-terskelen skal telle som middels (>=)");
  assert.equal(confidenceLevelFromScore(t.middels + 0.001, t), "middels");
  assert.equal(confidenceLevelFromScore(t.høy - 0.001, t), "middels");
  assert.equal(confidenceLevelFromScore(t.høy, t), "høy", "eksakt på høy-terskelen skal telle som høy (>=)");
  assert.equal(confidenceLevelFromScore(t.høy + 0.001, t), "høy");
  assert.equal(confidenceLevelFromScore(1, t), "høy");
});

// ---------------------------------------------------------------------------
// computeFallbackConfidence
// ---------------------------------------------------------------------------

test("computeFallbackConfidence: returnerer eksakt halvparten av computeZoneConfidence for samme input", () => {
  const observations = scatteredCameraObs(4);
  const full = computeZoneConfidence(observations as never, cfg, NOW);
  const fallback = computeFallbackConfidence(observations as never, cfg, NOW);
  assert.equal(fallback, full * 0.5);
});

test("computeFallbackConfidence: er også halvert i null-observasjons-tilfellet (0 * 0.5 = 0)", () => {
  assert.equal(computeFallbackConfidence([], cfg, NOW), 0);
});
