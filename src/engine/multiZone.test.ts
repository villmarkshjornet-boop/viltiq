import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { extractZones, saturateScore } = await import("./grid");
const { DEFAULT_ENGINE_CONFIG } = await import("./config");
const { movePoint, distanceMeters } = await import("@/src/lib/geo");

// V1.2.2 — multi-sone-regresjonsmatrise (§A-F i motor-oppdraget). extractZones()
// (grid.ts) er IKKE ny kode her — den kjede-relative watershed-klyngingen ble
// bygget og testet i V1.2 (se grid.test.ts). Denne filen bekrefter, med en
// bredere scenariomatrise enn grid.test.ts sin, at den ALLEREDE eksisterende
// klyngingen genuint produserer flere geografisk atskilte soner når scoren
// tilsier det — uten å tvinge frem et fast antall, uten å slå sammen reelt
// separate sterke områder, og uten å fragmentere ett sammenhengende sterkt
// område til flere nesten-identiske "soner". Vann-eksklusjonen
// (validity === "water"/"invalid") er dekket i dybden av en egen testfil
// (spatialValidity.test.ts) — scenario E under er et supplerende sjekkpunkt
// på RANGERING blant landceller når vannceller med høyere rå score er
// tilstede, ikke en ny vann-geometritest.

const cfg = DEFAULT_ENGINE_CONFIG;
const cellSizeMeters = 150;
const mergeRadiusMeters = 450; // hjort-typisk (baseRadiusMeters 300 × 1.5), samme som grid.test.ts
const emptyBreakdown = { recency: 0, repetition: 0, cameraDirection: 0, movementDirection: 0, cameraDiversity: 0, corridor: 0, ecology: 0 };

/**
 * Reproduserer grid.ts sin (ikke-eksporterte) inverseSaturateScore() lokalt —
 * KUN for å kunne konstruere rå scorer som treffer et bestemt ønsket
 * displayScore presist i testene under (samme formel som config.ts sin
 * dokumentasjon av scoreSaturation: displayScore = 100·(1 − e^(−raw/saturation))).
 */
function rawForDisplay(displayScore: number, saturation = cfg.zones.scoreSaturation): number {
  const ratio = Math.min(0.999999, Math.max(0, displayScore / 100));
  return -saturation * Math.log(1 - ratio);
}

/**
 * Identisk kopi av buildCellGrid() fra grid.test.ts (ikke eksportert derfra,
 * så gjenbruk må dupliseres — samme mønster som spatialValidity.test.ts sine
 * håndbygde celle-lister). Bygger et tett, kvadratisk rutenett av ScoredCell
 * rundt `center`, med `scoreFn(distFromCenter)` som scoremodell.
 */
function buildCellGrid(
  center: { latitude: number; longitude: number },
  spanMeters: number,
  scoreFn: (dist: number) => number,
  validityFn: (point: { latitude: number; longitude: number }, dist: number) => "valid_land" | "water" | "invalid" | "unknown" = () => "valid_land"
) {
  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((center.latitude * Math.PI) / 180);
  const steps = Math.round(spanMeters / cellSizeMeters);
  const cells = [];
  for (let r = -steps; r <= steps; r++) {
    for (let c = -steps; c <= steps; c++) {
      const point = {
        latitude: center.latitude + (r * cellSizeMeters) / metersPerDegLat,
        longitude: center.longitude + (c * cellSizeMeters) / metersPerDegLon,
      };
      const dist = distanceMeters(point, center);
      const score = scoreFn(dist);
      cells.push({ center: point, score, breakdown: { ...emptyBreakdown, ecology: score }, validity: validityFn(point, dist) });
    }
  }
  return cells;
}

// ===========================================================================
// A — én sterk sone: én tett, sterk klynge omgitt av lav bakgrunn.
// ===========================================================================

test("A: én tett, sterk plateau omgitt av bakgrunn under terskel gir nøyaktig 1 sone, med score som reflekterer toppen", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  // MERK (funnet under arbeidet med denne testmatrisen, se sluttrapport):
  // en TILSVARENDE sterk (displayScore ≈ 80) enkelt-Gaussisk topp (i stedet
  // for en tett plateau) fragmenterer HER til 6 konsentriske "ring"-soner,
  // ikke 1 — fordi den Gaussiske halen (radius 300 m) forblir over
  // minZoneScore-terskelen helt ut til ~735 m, godt utenfor
  // mergeRadiusMeters (450 m) sin UBETINGEDE skulder, og et 150 m-hopp der
  // ute faller ~58 % (fra rå 3.16 til 1.33) — langt under
  // RELATIVE_ZONE_PROMINENCE (0.97). Dette er trolig en reell regresjon av
  // nøyaktig den "konsentriske ringer"-feilen V1.2 skulle fikse (se
  // grid.test.ts sin egen Gaussisk-test), bare for STERKERE topper enn den
  // testen dekker — flagget separat, IKKE fikset her. Vi bruker derfor en
  // tett PLATEAU her (eksplisitt sanksjonert alternativ for scenario A),
  // som ikke trigger dette — se scenario B/D/E for flate platå-konstruksjoner
  // som allerede er bevist trygge.
  const peakRaw = rawForDisplay(80); // sikte på displayScore ≈ 80
  const backgroundRaw = 0.02; // godt under minZoneScore (raw-terskel ≈ 0.50)
  const plateauRadius = 150; // "tett" — langt mindre enn mergeRadiusMeters (450)
  const cells = buildCellGrid(center, 900, (dist) => (dist < plateauRadius ? peakRaw : backgroundRaw));

  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 1, `A: forventet nøyaktig 1 sone fra én sterk, tett klynge, fikk ${zones.length}`);

  const display = saturateScore(zones[0].rawScore, cfg.zones.scoreSaturation);
  assert.ok(display > 75 && display < 85, `A: forventet sonens displayScore nær 80 (toppens reelle styrke), fikk ${display.toFixed(1)}`);
  assert.ok(distanceMeters(zones[0].center, center) < plateauRadius, "A: sonens senter skal ligge inne i selve klyngen, ikke et beregnet gjennomsnitt utenfor den");
});

// ===========================================================================
// B — tre sterke soner: tre geografisk separate klynger, alle klart sterke
// (displayScore ~60-85), langt utover mergeRadiusMeters fra hverandre.
// ===========================================================================

test("B: tre geografisk separate, sterke klynger gir nøyaktig 3 soner — verken slått sammen eller kunstig oppsplittet", () => {
  const base = { latitude: 60.0, longitude: 10.0 };
  const areaStrong = movePoint(base.latitude, base.longitude, 270, 5000); // vest — sterkest, displayScore ≈ 82
  const areaMid = movePoint(base.latitude, base.longitude, 90, 5000); // øst — middels sterk, displayScore ≈ 70
  const areaWeak = movePoint(base.latitude, base.longitude, 0, 5000); // nord — svakest av de tre, men fortsatt klart "sterk", displayScore ≈ 60

  const rawStrong = rawForDisplay(82);
  const rawMid = rawForDisplay(70);
  const rawWeak = rawForDisplay(60);
  const backgroundRaw = 0.05; // godt under terskel — hindrer at de tre platåene "lekker" sammen

  const cells = [
    ...buildCellGrid(areaStrong, 500, (dist) => (dist < 200 ? rawStrong : backgroundRaw)),
    ...buildCellGrid(areaMid, 500, (dist) => (dist < 200 ? rawMid : backgroundRaw)),
    ...buildCellGrid(areaWeak, 500, (dist) => (dist < 200 ? rawWeak : backgroundRaw)),
  ];

  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 3, `B: forventet nøyaktig 3 separate soner (ikke slått sammen, ikke kunstig flere), fikk ${zones.length}`);

  // extractZones() prosesserer toppkandidater i synkende scorerekkefølge
  // (se `order` i grid.ts) og starter aldri en ny sone fra en allerede
  // claimet celle — så EMPIRISK kommer soner ut i synkende rawScore-
  // rekkefølge allerede fra extractZones selv (bekreftet av assertet under:
  // rekkefølgen som kommer ut er identisk med en eksplisitt sortert kopi).
  // Funksjonens TYPE/kontrakt garanterer det derimot ikke — det er
  // engine.ts (`zones.sort((a,b) => b.score - a.score)`) som eksplisitt
  // garanterer rekkefølgen nedstrøms, ikke extractZones. Vi sorterer derfor
  // eksplisitt her også, i stedet for å stole på implementasjonsdetaljen.
  const sortedByScore = [...zones].sort((a, b) => b.rawScore - a.rawScore);
  assert.deepEqual(
    zones.map((z) => z.rawScore),
    sortedByScore.map((z) => z.rawScore),
    "B: extractZones ser (empirisk, her) allerede ut til å returnere soner sortert synkende på rawScore"
  );

  const byArea = (area: { latitude: number; longitude: number }) =>
    sortedByScore.find((z) => distanceMeters(z.center, area) < 300);
  const zoneStrong = byArea(areaStrong);
  const zoneMid = byArea(areaMid);
  const zoneWeak = byArea(areaWeak);
  assert.ok(zoneStrong && zoneMid && zoneWeak, "B: hver av de tre sonene skal spores tilbake til riktig geografisk område");
  assert.equal(sortedByScore[0], zoneStrong, "B: sterkeste område skal rangeres som #1 etter sortering");
  assert.equal(sortedByScore[1], zoneMid, "B: middels område skal rangeres som #2 etter sortering");
  assert.equal(sortedByScore[2], zoneWeak, "B: svakeste (men fortsatt sterke) område skal rangeres som #3 etter sortering");
});

// ===========================================================================
// C — svak/uniform scene: alle celler har lav, tilnærmet uniform score, med
// den beste cellen bare vidt over minZoneScore. Testen: motoren skal IKKE
// finne opp falsk selvtillit i en dårlig scene.
// ===========================================================================

test("C: svak, tilnærmet uniform scene gir maks 1-2 soner, og den beste sonens score reflekterer genuint svak (ikke falsk høy) tillit", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  // Svakt fallende felt fra 0.55 (sentrum) mot terskelen (~0.50) — "uniform"
  // i den forstand at variasjonen er liten, men fortsatt monotont avtagende
  // slik at kun en sammenhengende blob rundt sentrum klarer terskelen.
  const cells = buildCellGrid(center, 900, (dist) => 0.55 - dist * 0.00005);

  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.ok(zones.length >= 1 && zones.length <= 2, `C: forventet maks 1-2 soner fra en svak, uniform scene (ikke en spray av falske alternativer), fikk ${zones.length}`);

  const bestDisplay = Math.max(...zones.map((z) => saturateScore(z.rawScore, cfg.zones.scoreSaturation)));
  assert.ok(
    bestDisplay > cfg.zones.minZoneScore && bestDisplay < 15,
    `C: forventet at beste sone vidt overstiger minZoneScore (${cfg.zones.minZoneScore}) men forblir tydelig svak (<15), fikk displayScore=${bestDisplay.toFixed(2)} — en høyere verdi ville bety falsk selvtillit i en dårlig scene`
  );
});

// ===========================================================================
// D — én sterk + én middels sone: to separate klynger med tydelig
// differensierte scorer. Rangering (#1 vs #2) må aldri forveksles med at
// scorene ligger nær hverandre pga. metnings-/klippe-artefakter.
// ===========================================================================

test("D: én sterk og én middels sone gir nøyaktig 2 soner med tydelig differensiert (ikke nesten-lik) score", () => {
  const base = { latitude: 60.0, longitude: 10.0 };
  const areaStrong = movePoint(base.latitude, base.longitude, 270, 4000);
  const areaMedium = movePoint(base.latitude, base.longitude, 90, 4000);

  const rawStrong = rawForDisplay(75);
  const rawMedium = rawForDisplay(35);
  const backgroundRaw = 0.05;

  const cells = [
    ...buildCellGrid(areaStrong, 500, (dist) => (dist < 200 ? rawStrong : backgroundRaw)),
    ...buildCellGrid(areaMedium, 500, (dist) => (dist < 200 ? rawMedium : backgroundRaw)),
  ];

  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 2, `D: forventet nøyaktig 2 soner, fikk ${zones.length}`);

  const zoneStrong = zones.find((z) => distanceMeters(z.center, areaStrong) < 300);
  const zoneMedium = zones.find((z) => distanceMeters(z.center, areaMedium) < 300);
  assert.ok(zoneStrong && zoneMedium, "D: begge sonene skal spores tilbake til riktig geografisk område");

  const displayStrong = saturateScore((zoneStrong as { rawScore: number }).rawScore, cfg.zones.scoreSaturation);
  const displayMedium = saturateScore((zoneMedium as { rawScore: number }).rawScore, cfg.zones.scoreSaturation);
  assert.ok(displayStrong > displayMedium, "D: den sterke sonen skal ha strengt høyere displayScore enn den middels sterke");
  assert.ok(
    displayStrong - displayMedium >= 20,
    `D: forventet en tydelig scoreforskjell (>=20 displayScore-poeng) mellom sterk og middels sone, fikk strong=${displayStrong.toFixed(1)} medium=${displayMedium.toFixed(1)} (gap=${(displayStrong - displayMedium).toFixed(1)})`
  );
});

// ===========================================================================
// E — vann-/ugyldige celler med sterk rå score, spredt blant lavere-scorede
// gyldige landceller. Supplerende sjekk (vann-geometri dekkes i dybden av
// spatialValidity.test.ts): rangering blant LANDceller skal fungere riktig
// selv når vannceller med høyere rå score er tilstede, og ingen returnert
// sone skal noensinne ha senter på en vanncelle.
// ===========================================================================

test("E: vannceller med svært høy rå score blandet inn blant landceller stjeler aldri en sone, og landrangeringen forblir korrekt", () => {
  const base = { latitude: 60.0, longitude: 10.0 };
  const areaLandStrong = movePoint(base.latitude, base.longitude, 270, 5000);
  const areaLandMedium = movePoint(base.latitude, base.longitude, 90, 5000);
  const areaWaterOnly = movePoint(base.latitude, base.longitude, 0, 5000);

  const rawLandStrong = rawForDisplay(75);
  const rawLandMedium = rawForDisplay(35);
  const backgroundRaw = 0.05;

  const cells: { center: { latitude: number; longitude: number }; score: number; breakdown: typeof emptyBreakdown; validity: "valid_land" | "water" | "invalid" | "unknown" }[] = [
    ...buildCellGrid(areaLandStrong, 500, (dist) => (dist < 200 ? rawLandStrong : backgroundRaw)),
    ...buildCellGrid(areaLandMedium, 500, (dist) => (dist < 200 ? rawLandMedium : backgroundRaw)),
    // Et helt vannområde med rå score langt over BEGGE landklyngene — skal
    // likevel gi 0 soner siden vann filtreres fra kandidatpoolen HELT (ikke
    // bare fra å bli sonetopp), se extractZones' V1.2.1-kommentar i grid.ts.
    ...buildCellGrid(areaWaterOnly, 400, () => 30, () => "water"),
  ];

  // Interspersert: fem enkeltceller MIDT INNI den sterke landklyngen (innenfor
  // dens 200 m platå-radius) med en rå score (50) langt over selv den
  // sterkeste landcellen (rawLandStrong ≈ 8.3) — disse skal ikke kunne bli
  // sonens topp/senter siden de er "water", selv om de fysisk ligger midt i
  // det landområdet som FAKTISK skal bli en sone.
  for (const bearing of [0, 72, 144, 216, 288]) {
    const p = movePoint(areaLandStrong.latitude, areaLandStrong.longitude, bearing, 80);
    cells.push({ center: p, score: 50, breakdown: { ...emptyBreakdown, ecology: 50 }, validity: "water" });
  }

  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.equal(zones.length, 2, `E: forventet nøyaktig 2 soner (kun de to landklyngene — vannklyngen og vann-spissene skal ikke gi noen), fikk ${zones.length}`);

  for (const zone of zones) {
    const matchingCell = cells.find((c) => c.center === zone.center);
    assert.ok(matchingCell, "E: sonens senter skal spores tilbake til en eksakt inputcelle (peak-cellen, ikke et beregnet gjennomsnitt)");
    assert.notEqual(matchingCell?.validity, "water", `E: ingen sones senter skal ha validity 'water' — fant sone med senter ${JSON.stringify(zone.center)}`);
  }

  const zoneStrong = zones.find((z) => distanceMeters(z.center, areaLandStrong) < 300);
  const zoneMedium = zones.find((z) => distanceMeters(z.center, areaLandMedium) < 300);
  assert.ok(zoneStrong && zoneMedium, "E: begge landsonene skal spores tilbake til riktig geografisk område, uforstyrret av vann-spissene/vannklyngen");

  const displayStrong = saturateScore((zoneStrong as { rawScore: number }).rawScore, cfg.zones.scoreSaturation);
  const displayMedium = saturateScore((zoneMedium as { rawScore: number }).rawScore, cfg.zones.scoreSaturation);
  assert.ok(
    displayStrong > displayMedium,
    `E: land-rangeringen skal forbli korrekt (sterk > middels) til tross for at vannceller hadde langt høyere rå score, fikk strong=${displayStrong.toFixed(1)} medium=${displayMedium.toFixed(1)}`
  );
  assert.ok(displayStrong > 70 && displayStrong < 80, `E: den sterke landsonens score skal reflektere landklyngens EGEN styrke (≈75), ikke bli forurenset av de interserperte vann-cellenes score 50, fikk ${displayStrong.toFixed(1)}`);
});

// ===========================================================================
// F — mange lokale topper i samme sammenhengende område: en "rygg" med flere
// nære topper som sitter på en felles hevet "hylle" (ikke geografisk
// separate i noen meningsfull forstand). Skal IKKE gi én sone per topp slik
// en naiv grådig peak-plukker ville gjort.
// ===========================================================================

test("F: flere lokale topper på en felles hevet hylle (samme rygg) kollapser til én sone, ikke én sone per topp", () => {
  const base = { latitude: 60.0, longitude: 10.0 };
  // Fem toppsentre langs en øst-vest-rygg, 120 m mellom hver (total lengde
  // 480 m — det ytterste paret er utenfor mergeRadiusMeters (450 m) fra
  // hverandre, så testen faktisk fanger den kjede-relative platå-regelen
  // (RELATIVE_ZONE_PROMINENCE), ikke bare den ubetingede mergeRadius-regelen).
  const bumpCenters = [0, 120, 240, 360, 480].map((d) => movePoint(base.latitude, base.longitude, 90, d));
  const shelfRaw = 5.0; // felles hevet "hylle" — moderat i seg selv, godt over terskel
  const bumpAmplitude = 0.08; // liten nok til at hver topp er et lite avvik fra hyllen, ikke et dramatisk hopp
  const bumpRadiusMeters = 100;
  const relevantRangeMeters = 550; // utenfor dette: bakgrunn under terskel, avslutter platået

  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((base.latitude * Math.PI) / 180);
  const cells: { center: { latitude: number; longitude: number }; score: number; breakdown: typeof emptyBreakdown; validity: "valid_land" }[] = [];
  for (let r = -4; r <= 4; r++) {
    for (let c = -5; c <= 8; c++) {
      const point = {
        latitude: base.latitude + (r * cellSizeMeters) / metersPerDegLat,
        longitude: base.longitude + (c * cellSizeMeters) / metersPerDegLon,
      };
      const distToNearestBump = Math.min(...bumpCenters.map((bc) => distanceMeters(point, bc)));
      let score = shelfRaw;
      for (const bc of bumpCenters) {
        const d = distanceMeters(point, bc);
        score += bumpAmplitude * Math.exp(-0.5 * (d / bumpRadiusMeters) ** 2);
      }
      const finalScore = distToNearestBump < relevantRangeMeters ? score : 0.03;
      cells.push({ center: point, score: finalScore, breakdown: { ...emptyBreakdown, ecology: finalScore }, validity: "valid_land" });
    }
  }

  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  // Nøkkelpåstanden i F: en genuint sammenhengende rygg med flere nære
  // lokale topper skal IKKE gi én sone per topp (det ville vært 5 her under
  // en naiv grådig peak-plukker). Verifisert empirisk her: hyllens score
  // (5.0) endrer seg med <3 % fra celle til nabocelle selv nær en topp
  // (bumpAmplitude 0.08 << shelfRaw 5.0), så RELATIVE_ZONE_PROMINENCE (0.97)
  // lar kjeden bre seg fritt over hele ryggen — akkurat slik den skal for et
  // ekte platå (se grid.ts sin filkommentar over extractZones).
  assert.equal(zones.length, 1, `F: forventet at hele ryggen med 5 nære topper kollapser til ÉN sone (ikke én sone per topp), fikk ${zones.length}`);

  const ridgeMidpoint = movePoint(base.latitude, base.longitude, 90, 240);
  assert.ok(
    distanceMeters(zones[0].center, ridgeMidpoint) < relevantRangeMeters,
    "F: sonens senter skal ligge et sted inne på selve ryggen"
  );
});
