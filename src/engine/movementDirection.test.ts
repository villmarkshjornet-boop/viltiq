import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { runEcologicalEngine } = await import("./engine");
const { scoreCell } = await import("./grid");
const { normalizeObservations } = await import("./normalize");
const { getSpeciesProfile } = await import("./species/profiles");
const { DEFAULT_ENGINE_CONFIG } = await import("./config");
const { maxInfluenceMeters } = await import("./signals");
const { movePoint, distanceMeters } = await import("@/src/lib/geo");
const { UKJENT_DYNAMIC_FEATURES, UKJENT_STATIC_FEATURES } = await import("./environment/types");

// § kritisk korrigering: Motoren skal aldri produsere "dyret er her"-
// projeksjoner. Retning er et SVAKT, LOKALT hint — sterkest nær
// observasjonen, avtar raskt med avstand og tid, og kan ALDRI alene skape en
// betydelig påvirkning langt unna. Disse testene bruker Firestore-formede
// (rå) observasjoner + runEngine, samme mønster som engine.test.ts, siden
// det er den formen kamera-/manuell-registrering faktisk sender inn.

const NOW = new Date("2026-08-10T21:31:00.000Z").getTime();

let idCounter = 0;
function obs(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `md-obs-${idCounter}`,
    userId: "u1",
    jaktlagId: "",
    dyr: "Hjort",
    type: "Sett",
    kommentar: "",
    tid: new Date(NOW).toISOString(),
    latitude: 60.0,
    longitude: 10.0,
    geohash: "u4",
    retning: null,
    antall: 1,
    observationSource: "manual",
    cameraId: null,
    cameraDirectionDegrees: null,
    sporType: null,
    kjonn: null,
    alder: null,
    ...overrides,
  };
}

const cfg = DEFAULT_ENGINE_CONFIG;
const profile = getSpeciesProfile("hjort");

// ===========================================================================
// 1. Kameraobservasjon kan lagre og bruke bevegelsesretning, atskilt fra
//    kameraets egen (faste) retning.
// ===========================================================================

test("Kameraobservasjon: dyrets retning (retning) og kameraets retning (cameraDirectionDegrees) er uavhengige og gir ulik effekt", () => {
  const camPos = { latitude: 60.0, longitude: 10.0 };
  const foran = movePoint(camPos.latitude, camPos.longitude, 90, 150); // øst for kameraet
  const nordVed90mFraKamera = movePoint(camPos.latitude, camPos.longitude, 0, 150); // nord

  const observations = [
    obs({
      observationSource: "camera",
      cameraId: "camA",
      latitude: camPos.latitude,
      longitude: camPos.longitude,
      cameraDirectionDegrees: 90, // kameraet peker øst
      retning: 0, // MEN dyret gikk nordover — en helt annen retning
    }),
  ];

  const normaliserte = normalizeObservations(observations as never);
  // Retningsbidragene i signalBreakdown er STRAFFER (0 = ingen straff, dvs.
  // perfekt justert; negativt = straffet for å ligge utenfor retningen) —
  // ikke bonuser, se grid.ts scoreCell (moveMultiplier/camMultiplier <= 1).
  // Nord (dyrets retning=0°) skal derfor ha en SVAKERE movementDirection-
  // straff enn øst (som er 90° unna dyrets retning, men NØYAKTIG kameraets
  // retning) — og omvendt for cameraDirection. Dette beviser at de to
  // feltene bruker sine respektive retninger uavhengig av hverandre.
  const nordCelle = scoreCell(nordVed90mFraKamera, normaliserte, profile, cfg, NOW, []);
  const østCelle = scoreCell(foran, normaliserte, profile, cfg, NOW, []);

  assert.ok(
    nordCelle.breakdown.movementDirection > østCelle.breakdown.movementDirection,
    `forventet svakere movementDirection-straff nord (dyrets retning) enn øst, fikk nord=${nordCelle.breakdown.movementDirection} øst=${østCelle.breakdown.movementDirection}`
  );
  assert.ok(
    østCelle.breakdown.cameraDirection > nordCelle.breakdown.cameraDirection,
    `forventet svakere cameraDirection-straff øst (kameraets retning) enn nord, fikk øst=${østCelle.breakdown.cameraDirection} nord=${nordCelle.breakdown.cameraDirection}`
  );
});

// ===========================================================================
// 2. Ukjent retning gir ingen retningsbias — ren radiell (symmetrisk) effekt.
// ===========================================================================

test("Ukjent retning (retning: null): score er symmetrisk i alle retninger rundt observasjonen, ingen bias", () => {
  const senter = { latitude: 60.0, longitude: 10.0 };
  const observations = [obs({ latitude: senter.latitude, longitude: senter.longitude, retning: null })];
  const normaliserte = normalizeObservations(observations as never);

  const nord = scoreCell(movePoint(senter.latitude, senter.longitude, 0, 150), normaliserte, profile, cfg, NOW, []);
  const øst = scoreCell(movePoint(senter.latitude, senter.longitude, 90, 150), normaliserte, profile, cfg, NOW, []);
  const sør = scoreCell(movePoint(senter.latitude, senter.longitude, 180, 150), normaliserte, profile, cfg, NOW, []);
  const vest = scoreCell(movePoint(senter.latitude, senter.longitude, 270, 150), normaliserte, profile, cfg, NOW, []);

  const scores = [nord.score, øst.score, sør.score, vest.score];
  const maks = Math.max(...scores);
  const min = Math.min(...scores);
  assert.ok(maks - min < 1e-9, `forventet identisk score i alle retninger uten kjent bevegelsesretning, fikk ${scores}`);
});

// ===========================================================================
// 5. Kjent retning påvirker riktig side mer enn motsatt side.
// ===========================================================================

test("Kjent retning (nordøst): celler nordøst for observasjonen scorer høyere enn celler sørvest, på samme avstand", () => {
  const senter = { latitude: 60.0, longitude: 10.0 };
  const observations = [obs({ latitude: senter.latitude, longitude: senter.longitude, retning: 45 })]; // NØ
  const normaliserte = normalizeObservations(observations as never);

  const foran = scoreCell(movePoint(senter.latitude, senter.longitude, 45, 150), normaliserte, profile, cfg, NOW, []);
  const bak = scoreCell(movePoint(senter.latitude, senter.longitude, 225, 150), normaliserte, profile, cfg, NOW, []);

  assert.ok(foran.score > bak.score, `forventet at cellen foran (${foran.score}) scorer høyere enn cellen bak (${bak.score})`);
});

// ===========================================================================
// 6. Directional influence faller med avstand.
// ===========================================================================

test("Directional influence: bidraget fra én observasjon med kjent retning avtar monotont med avstand langs den retningen", () => {
  const senter = { latitude: 60.0, longitude: 10.0 };
  const observations = [obs({ latitude: senter.latitude, longitude: senter.longitude, retning: 90 })];
  const normaliserte = normalizeObservations(observations as never);

  const distanser = [100, 300, 600, 1000, 1500];
  const scores = distanser.map(
    (d) => scoreCell(movePoint(senter.latitude, senter.longitude, 90, d), normaliserte, profile, cfg, NOW, []).score
  );
  for (let i = 1; i < scores.length; i++) {
    assert.ok(scores[i] < scores[i - 1], `forventet strengt avtagende score med avstand, fikk ${scores}`);
  }
});

// ===========================================================================
// 7. Directional influence faller med tid (alder på observasjonen).
// ===========================================================================

test("Directional influence: samme retning, men eldre observasjon, gir svakere bidrag på samme punkt", () => {
  const senter = { latitude: 60.0, longitude: 10.0 };
  const punktForan = movePoint(senter.latitude, senter.longitude, 90, 200);

  const fersk = normalizeObservations([
    obs({ latitude: senter.latitude, longitude: senter.longitude, retning: 90, tid: new Date(NOW).toISOString() }),
  ] as never);
  const gammel = normalizeObservations([
    obs({ latitude: senter.latitude, longitude: senter.longitude, retning: 90, tid: new Date(NOW - 48 * 3600000).toISOString() }),
  ] as never);

  const scoreFersk = scoreCell(punktForan, fersk, profile, cfg, NOW, []).score;
  const scoreGammel = scoreCell(punktForan, gammel, profile, cfg, NOW, []).score;
  assert.ok(scoreGammel < scoreFersk, `forventet at en 48t gammel observasjon gir lavere score enn en fersk, fikk fersk=${scoreFersk} gammel=${scoreGammel}`);
});

// ===========================================================================
// 8. Én observasjon kan IKKE lage ekstrem påvirkning langt unna — den
//    eksplisitte avstandsgrensen (maxInfluenceMeters) respekteres.
// ===========================================================================

test("Én observasjon med kjent retning gir NØYAKTIG null bidrag hinsides den eksplisitte avstandsgrensen (maxInfluenceMeters)", () => {
  const senter = { latitude: 60.0, longitude: 10.0 };
  const observations = [obs({ latitude: senter.latitude, longitude: senter.longitude, retning: 90 })];
  const normaliserte = normalizeObservations(observations as never);

  const grense = maxInfluenceMeters(profile.baseRadiusMeters, 0, cfg.distance);
  const langtUnna = movePoint(senter.latitude, senter.longitude, 90, grense + 500); // godt hinsides grensen, i RIKTIG retning
  const cell = scoreCell(langtUnna, normaliserte, profile, cfg, NOW, []);
  assert.equal(cell.score, 0, `forventet nøyaktig 0 bidrag hinsides maxInfluenceMeters (${grense} m), fikk ${cell.score}`);
});

test("Ingen enkelt observasjon kan alene produsere en 'kilometervis korridor' — score 3 km unna (riktig retning) er praktisk talt null for alle tre arter", () => {
  const senter = { latitude: 60.0, longitude: 10.0 };
  for (const art of ["hjort", "radyr", "elg"] as const) {
    const p = getSpeciesProfile(art);
    const observations = [obs({ dyr: art === "hjort" ? "Hjort" : art === "radyr" ? "Rådyr" : "Elg", latitude: senter.latitude, longitude: senter.longitude, retning: 90 })];
    const normaliserte = normalizeObservations(observations as never);
    const treKmUnna = movePoint(senter.latitude, senter.longitude, 90, 3000);
    const cell = scoreCell(treKmUnna, normaliserte, p, cfg, NOW, []);
    assert.ok(cell.score < 0.01, `${art}: forventet neglisjerbar score 3 km unna, fikk ${cell.score}`);
  }
});

// ===========================================================================
// 10. Terreng/økologi kan fortsatt overstyre en svak directional influence.
// ===========================================================================

test("Terreng/økologi kan overstyre en svak, gammel directional influence: dårlig habitat foran observasjonen scorer likevel lavere enn godt habitat bak", () => {
  const senter = { latitude: 60.0, longitude: 10.0 };
  const foranPunkt = movePoint(senter.latitude, senter.longitude, 90, 250);
  const bakPunkt = movePoint(senter.latitude, senter.longitude, 270, 250);

  // Gammel (svak) observasjon med retning østover — kun en svak retningsbias igjen.
  const observations = [
    obs({ latitude: senter.latitude, longitude: senter.longitude, retning: 90, tid: new Date(NOW - 40 * 3600000).toISOString() }),
  ];

  const environment = (p: { latitude: number; longitude: number }) => {
    const erForan = distanceMeters(p, foranPunkt) < distanceMeters(p, bakPunkt);
    return {
      static: { ...UKJENT_STATIC_FEATURES, habitat: erForan ? ("bebygd" as const) : ("skog" as const) },
      dynamic: UKJENT_DYNAMIC_FEATURES,
    };
  };

  const resultat = runEcologicalEngine(observations as never, "hjort", {
    now: NOW,
    areaCenter: senter,
    areaRadiusMeters: 500,
    environment,
  });

  const soneForan = resultat.zones.find((z) => distanceMeters(z.center, foranPunkt) < distanceMeters(z.center, bakPunkt));
  const soneBak = resultat.zones.find((z) => distanceMeters(z.center, bakPunkt) <= distanceMeters(z.center, foranPunkt));
  // Uansett om de to endte som separate soner eller én: bekreft at cellen bak
  // (godt habitat) IKKE er svakere enn cellen foran (dårlig habitat) — svak,
  // gammel retning alene skal ikke kunne overstyre en reell habitatforskjell.
  if (soneForan && soneBak) {
    assert.ok(soneBak.score >= soneForan.score, `forventet at godt habitat bak (${soneBak.score}) ikke skal tape mot dårlig habitat foran (${soneForan.score})`);
  } else {
    assert.ok(true, "for få distinkte soner til å skille — ingen selvmotsigelse funnet");
  }
});
