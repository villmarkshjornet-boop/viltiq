import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { resolveSpatialValidity } = await import("./environment/resolve");
const { runEcologicalEngine } = await import("./engine");
const { extractZones } = await import("./grid");
const { DEFAULT_ENGINE_CONFIG } = await import("./config");
const { UKJENT_DYNAMIC_FEATURES, UKJENT_STATIC_FEATURES } = await import("./environment/types");
const { movePoint, distanceMeters } = await import("@/src/lib/geo");

// V1.2.1 — Spatial Validity & Heatmap Rendering. Root cause (se sluttrapport
// for full A-K-forklaring): habitat nearest-neighbor sampling kunne gi en
// vanncelle et FJERNT landpunkts habitatklasse (§5 i oppdraget), siden
// prøvepunktavstanden (500 m-1,2 km) er langt grovere enn scoring-gridets
// ~150 m celler — dette lot i praksis motoren velge midten av en innsjø som
// "beste område", med en forklaring som feilaktig hevdet "Skogterreng".

// ===========================================================================
// resolveSpatialValidity — den rene beslutningsregelen (resolve.ts)
// ===========================================================================

test("resolveSpatialValidity: nærmeste prøvepunkt er selv vann -> water", () => {
  assert.equal(resolveSpatialValidity("vann", null, 500), "water");
  assert.equal(resolveSpatialValidity("vann", 50, 500), "water");
});

test("resolveSpatialValidity: nærmeste prøvepunkt er land, men et vannprøvepunkt finnes innenfor én prøvepunktavstand -> water (§5-forsiktighetsregelen)", () => {
  assert.equal(resolveSpatialValidity("skog", 300, 500), "water", "300 m < 500 m spacing -> for usikkert til å stole på landsvaret");
  assert.equal(resolveSpatialValidity("skog", 500, 500), "water", "eksakt på grensen skal fortsatt telle som usikkert");
});

test("resolveSpatialValidity: nærmeste prøvepunkt er land og nærmeste vannprøve er langt unna -> valid_land", () => {
  assert.equal(resolveSpatialValidity("skog", 1200, 500), "valid_land");
  assert.equal(resolveSpatialValidity("skog", null, 500), "valid_land", "ingen vannprøve i det hele tatt i analyseområdet");
});

test("resolveSpatialValidity: nærmeste prøvepunkt er ukjent (mislykket oppslag) OG ingen vannbevis i nærheten -> unknown, ALDRI automatisk avvist", () => {
  assert.equal(resolveSpatialValidity("ukjent", null, 500), "unknown");
});

test("resolveSpatialValidity: nærmeste prøvepunkt er ukjent, MEN et annet, vellykket prøvepunkt like ved er vann -> water (positivt vannbevis trumfer et mislykket nærmeste-oppslag)", () => {
  assert.equal(resolveSpatialValidity("ukjent", 100, 500), "water");
});

// ===========================================================================
// V1.2.2 ROOT CAUSE-KORRIGERING (Kristiansand): osmStatus (water.ts, en EGEN
// datakilde/oppløsning enn habitat-prøvegridet) er nå PRIMÆR og AUTORITATIV
// når den har et svar — habitat-prøvegrid-regelen over er nedgradert til et
// sikkerhetsnett for punkter OSM ikke sier noe om. Dette er akkurat fiksen
// for skjærgård-/smalt-sund-scenarioet: et habitat-prøvegrid med 500 m-1,2 km
// avstand kan aldri "se" en vannkanal smalere enn det, men OSM-kystlinjen
// evalueres LOKALT og geometrisk, uavhengig av prøvetettheten.
// ===========================================================================

test("resolveSpatialValidity: osmStatus='water' er AUTORITATIV, selv om habitat-prøvegridet ville sagt valid_land", () => {
  // Prøvegrid-signalene alene ville gitt "valid_land" (jf. testen over) —
  // men OSM sier vann, og skal vinne.
  assert.equal(resolveSpatialValidity("skog", 1200, 500, "water"), "water");
});

test("resolveSpatialValidity: osmStatus='land' er AUTORITATIV, selv om habitat-prøvegridets forsiktighetsregel ville sagt water", () => {
  // Prøvegrid-signalene alene ville gitt "water" (nærmeste vannprøve
  // innenfor én prøvepunktavstand, jf. §5-forsiktighetsregelen) — dette er
  // AKKURAT den falske positiven en for grov vann-prøve nær en reell
  // landflekk kunne gitt, og OSM korrigerer den.
  assert.equal(resolveSpatialValidity("skog", 300, 500, "land"), "valid_land");
});

test("resolveSpatialValidity: osmStatus='unknown' (ingen kystlinje/vannpolygon hentet her) faller tilbake til habitat-prøvegrid-regelen, IKKE en antakelse om land", () => {
  assert.equal(resolveSpatialValidity("vann", null, 500, "unknown"), "water", "fallback-regelen skal fortsatt fungere uendret");
  assert.equal(resolveSpatialValidity("skog", 1200, 500, "unknown"), "valid_land");
  assert.equal(resolveSpatialValidity("ukjent", null, 500, "unknown"), "unknown");
});

test("resolveSpatialValidity: osmStatus har standardverdi 'unknown' når parameteren utelates (bakoverkompatibel med V1.2.1s 3-argument-kall)", () => {
  assert.equal(resolveSpatialValidity("vann", null, 500), "water");
});

// ===========================================================================
// §15: stor innsjø i sentrum, skog på begge sider, ingen observasjoner —
// for alle tre arter skal primary/secondary hotspots og sonens
// representative celle være LAND, aldri vann.
// ===========================================================================

function buildLakeEnvironment(lakeCenter: { latitude: number; longitude: number }, lakeRadiusMeters: number) {
  return (point: { latitude: number; longitude: number }) => {
    const onLake = distanceMeters(point, lakeCenter) < lakeRadiusMeters;
    return {
      static: {
        ...UKJENT_STATIC_FEATURES,
        habitat: onLake ? ("vann" as const) : ("skog" as const),
        spatialValidity: onLake ? ("water" as const) : ("valid_land" as const),
        relativeElevationMeters: 0,
        roadDistanceMeters: 5000,
      },
      dynamic: UKJENT_DYNAMIC_FEATURES,
    };
  };
}

for (const species of ["hjort", "radyr", "elg"] as const) {
  test(`§15 [${species}]: stor innsjø i sentrum uten observasjoner — ingen sone/hotspot ligger på vann`, () => {
    const center = { latitude: 60.0, longitude: 10.0 };
    const lakeRadiusMeters = 900;
    const environment = buildLakeEnvironment(center, lakeRadiusMeters);

    const result = runEcologicalEngine([], species, {
      now: Date.now(), areaCenter: center, areaRadiusMeters: 3000, environment, debug: true,
    });

    assert.ok(result.zones.length >= 1, `forventet minst 1 sone for ${species}`);
    for (const zone of result.zones) {
      const distFromLakeCenter = distanceMeters(zone.center, center);
      assert.ok(
        distFromLakeCenter >= lakeRadiusMeters,
        `${species}: sone ${zone.id} sitt senter (${distFromLakeCenter.toFixed(0)} m fra innsjøsenter) ligger INNI innsjøen (radius ${lakeRadiusMeters} m)`
      );
    }
    assert.equal(result.debug?.waterCells ?? -1, result.debug?.waterCells, "debug skal rapportere et vannCelle-tall (sanity check på at debug faktisk kjørte)");
    assert.ok((result.debug?.waterCells ?? 0) > 0, "innsjøen skal faktisk ha gitt opphav til vann-klassifiserte celler i gridet");
  });
}

// ===========================================================================
// §16: analysesenter midt i vann — motoren skal IKKE anta senteret er en
// kandidat, men finne beste gyldige landareal rundt.
// ===========================================================================

test("§16: analysesenter plassert midt i innsjøen — motoren finner likevel beste gyldige LANDAREAL, ikke selve senteret", () => {
  const lakeCenter = { latitude: 60.0, longitude: 10.0 };
  const environment = buildLakeEnvironment(lakeCenter, 1200);

  const result = runEcologicalEngine([], "hjort", {
    now: Date.now(), areaCenter: lakeCenter, areaRadiusMeters: 3000, environment, debug: true,
  });

  assert.ok(result.zones.length >= 1, "forventet at motoren likevel finner minst én gyldig landsone rundt innsjøen");
  for (const zone of result.zones) {
    assert.ok(distanceMeters(zone.center, lakeCenter) >= 1200, "ingen sone skal sentreres inni innsjøen bare fordi analysesenteret selv er der");
  }
});

// ===========================================================================
// §17: centroid over vann — konstruer en sone der et geometrisk/vektet
// gjennomsnitt av de bidragende cellene ville havnet i vann, men den
// FAKTISKE (extractZones sin peak-celle-baserte) sonen skal fortsatt ligge
// på land.
// ===========================================================================

test("§17: 'centroid over vann' — hesteskoformet landområde rundt en vannstripe gir en sone hvis senter er en FAKTISK landcelle, ikke et gjennomsnitt som havner i vannet", () => {
  const cellSizeMeters = 150;
  const mergeRadiusMeters = 450;
  const cfg = DEFAULT_ENGINE_CONFIG;
  const emptyBreakdown = { recency: 0, repetition: 0, cameraDirection: 0, movementDirection: 0, cameraDiversity: 0, corridor: 0, ecology: 0 };

  // To land-«armer» (vest og øst) med lik score, atskilt av en vannstripe
  // midt imellom — et naivt geometrisk gjennomsnitt av alle høyt-scorede
  // celler ville landet PRESIS i vannstripen mellom dem.
  const center = { latitude: 60.0, longitude: 10.0 };
  const westArm = movePoint(center.latitude, center.longitude, 270, 500);
  const eastArm = movePoint(center.latitude, center.longitude, 90, 500);
  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((center.latitude * Math.PI) / 180);

  const cells: { center: { latitude: number; longitude: number }; score: number; breakdown: typeof emptyBreakdown; validity: "valid_land" | "water" }[] = [];
  for (const arm of [westArm, eastArm]) {
    for (let r = -3; r <= 3; r++) {
      for (let c = -3; c <= 3; c++) {
        const point = {
          latitude: arm.latitude + (r * cellSizeMeters) / metersPerDegLat,
          longitude: arm.longitude + (c * cellSizeMeters) / metersPerDegLon,
        };
        if (distanceMeters(point, arm) > 400) continue;
        cells.push({ center: point, score: 0.8, breakdown: { ...emptyBreakdown, ecology: 0.8 }, validity: "valid_land" });
      }
    }
  }
  // Vannstripen mellom armene — ville vært det geometriske midtpunktet.
  for (let r = -2; r <= 2; r++) {
    const point = { latitude: center.latitude + (r * cellSizeMeters) / metersPerDegLat, longitude: center.longitude };
    cells.push({ center: point, score: 0.75, breakdown: { ...emptyBreakdown, ecology: 0.75 }, validity: "water" });
  }

  const zones = extractZones(cells, cellSizeMeters, mergeRadiusMeters, cfg);
  assert.ok(zones.length >= 1, "forventet minst én sone");
  const geometricMidpoint = center; // midt mellom westArm og eastArm, og midt i vannstripen
  for (const zone of zones) {
    const distToMidpoint = distanceMeters(zone.center, geometricMidpoint);
    assert.ok(distToMidpoint > 50, `sone ${JSON.stringify(zone.center)} havnet for nær det geometriske midtpunktet (${distToMidpoint.toFixed(0)} m) — mistenkelig likt en centroid-bug`);
  }
});

// ===========================================================================
// §18: fersk observasjon nær vannkant — lokal påvirkning skal øke land-
// score rundt observasjonen, men vannet skal ikke bli hovedhotspot.
// ===========================================================================

test("§18: fersk hjorteobservasjon 80 m fra en innsjø — landceller rundt får høy score, men innsjøen blir ikke hovedhotspot", () => {
  const lakeCenter = { latitude: 60.0, longitude: 10.0 };
  const lakeRadiusMeters = 600;
  const environment = buildLakeEnvironment(lakeCenter, lakeRadiusMeters);
  const obsPoint = movePoint(lakeCenter.latitude, lakeCenter.longitude, 90, lakeRadiusMeters + 80); // 80 m fra bredden, på land

  const now = Date.now();
  const observations = [
    {
      id: "o1", userId: "u1", jaktlagId: "", dyr: "Hjort", type: "Sett", kommentar: "",
      tid: new Date(now).toISOString(), latitude: obsPoint.latitude, longitude: obsPoint.longitude, geohash: "u4",
      retning: null, antall: 1, observationSource: "camera", cameraId: "camA", cameraDirectionDegrees: null,
      sporType: null, kjonn: null, alder: null,
    },
  ];

  const result = runEcologicalEngine(observations as never, "hjort", {
    now, areaCenter: lakeCenter, areaRadiusMeters: 2000, environment, debug: true,
  });

  assert.ok(result.zones.length >= 1);
  const best = result.zones[0];
  assert.ok(distanceMeters(best.center, lakeCenter) >= lakeRadiusMeters, "beste sone skal IKKE ligge inni innsjøen");
  assert.ok(distanceMeters(best.center, obsPoint) < 500, "beste sone bør ligge nær den ferske observasjonen, ikke et vilkårlig annet sted");

  // Heatmapet skal ikke ha noen punkter inni innsjøen, selv med en sterk
  // observasjon rett ved bredden.
  const heatPointsOnLake = result.heatmapPoints.filter((p) => distanceMeters(p, lakeCenter) < lakeRadiusMeters);
  assert.equal(heatPointsOnLake.length, 0, "heatmapet skal ikke ha noen punkter inni den bekreftede vannflaten");
});

// ===========================================================================
// §19: observasjon registrert PÅ vann (dårlig GPS/faktisk kryssing) —
// systemet skal ikke krasje, ikke finne opp habitat, og ikke gjøre
// innsjøen til hotspot.
// ===========================================================================

test("§19: observasjon registrert 150 m ute i innsjøen — krasjer ikke, gjør IKKE innsjøen til hotspot", () => {
  const lakeCenter = { latitude: 60.0, longitude: 10.0 };
  const lakeRadiusMeters = 800;
  const environment = buildLakeEnvironment(lakeCenter, lakeRadiusMeters);
  const obsOnLake = movePoint(lakeCenter.latitude, lakeCenter.longitude, 45, 150); // godt inni innsjøen

  const now = Date.now();
  const observations = [
    {
      id: "o1", userId: "u1", jaktlagId: "", dyr: "Hjort", type: "Sett", kommentar: "",
      tid: new Date(now).toISOString(), latitude: obsOnLake.latitude, longitude: obsOnLake.longitude, geohash: "u4",
      retning: null, antall: 1, observationSource: "manual", cameraId: null, cameraDirectionDegrees: null,
      sporType: null, kjonn: null, alder: null,
    },
  ];

  assert.doesNotThrow(() => {
    const result = runEcologicalEngine(observations as never, "hjort", {
      now, areaCenter: lakeCenter, areaRadiusMeters: 2000, environment, debug: true,
    });
    assert.equal(result.observationsConsidered, 1, "observasjonen skal fortsatt være med i datagrunnlaget, ikke forkastet");
    for (const zone of result.zones) {
      assert.ok(distanceMeters(zone.center, lakeCenter) >= lakeRadiusMeters, "ingen sone skal havne inni innsjøen selv om observasjonen selv ligger der");
    }
  });
});

// ===========================================================================
// §20: heatmap-regresjon — tre distinkte scoreområder skal bevare
// rekkefølgen A < B < C i motorens RÅ (ikke render-transformerte) vekt, og
// V1.2 sin flate-platå tie-aware seleksjon skal fortsatt fungere.
// ===========================================================================

test("§20: tre distinkte scoreområder (svakt/middels/sterkt) bevarer rekkefølgen A < B < C i heatmapPoints sin vekt", () => {
  const base = { latitude: 60.0, longitude: 10.0 };
  const areaA = movePoint(base.latitude, base.longitude, 0, 3000);
  const areaB = movePoint(base.latitude, base.longitude, 120, 3000);
  const areaC = movePoint(base.latitude, base.longitude, 240, 3000);

  const environment = (point: { latitude: number; longitude: number }) => {
    let habitatQuality: "skog" | "myr" = "myr";
    if (distanceMeters(point, areaA) < 300) habitatQuality = "myr"; // svakest av de tre "gode" flekkene
    if (distanceMeters(point, areaB) < 300) habitatQuality = "skog";
    if (distanceMeters(point, areaC) < 300) habitatQuality = "skog";
    return {
      static: { ...UKJENT_STATIC_FEATURES, habitat: habitatQuality, spatialValidity: "valid_land" as const, relativeElevationMeters: 0, roadDistanceMeters: 5000 },
      dynamic: UKJENT_DYNAMIC_FEATURES,
    };
  };

  const now = Date.now();
  // Ferske observasjoner ved B og C gir dem tydelig mer lokalt bidrag enn A (kun miljø).
  const observations = [
    { id: "oB", userId: "u1", jaktlagId: "", dyr: "Hjort", type: "Sett", kommentar: "", tid: new Date(now).toISOString(), latitude: areaB.latitude, longitude: areaB.longitude, geohash: "u4", retning: null, antall: 1, observationSource: "camera", cameraId: "camB", cameraDirectionDegrees: null, sporType: null, kjonn: null, alder: null },
    { id: "oC1", userId: "u1", jaktlagId: "", dyr: "Hjort", type: "Sett", kommentar: "", tid: new Date(now).toISOString(), latitude: areaC.latitude, longitude: areaC.longitude, geohash: "u4", retning: null, antall: 1, observationSource: "camera", cameraId: "camC1", cameraDirectionDegrees: null, sporType: null, kjonn: null, alder: null },
    { id: "oC2", userId: "u1", jaktlagId: "", dyr: "Hjort", type: "Sett", kommentar: "", tid: new Date(now).toISOString(), latitude: areaC.latitude, longitude: areaC.longitude, geohash: "u4", retning: null, antall: 1, observationSource: "camera", cameraId: "camC2", cameraDirectionDegrees: null, sporType: null, kjonn: null, alder: null },
  ];

  const result = runEcologicalEngine(observations as never, "hjort", {
    now, areaCenter: base, areaRadiusMeters: 4000, environment,
  });

  const maxWeightNear = (p: { latitude: number; longitude: number }) =>
    Math.max(0, ...result.heatmapPoints.filter((hp) => distanceMeters(hp, p) < 350).map((hp) => hp.weight));

  const wA = maxWeightNear(areaA);
  const wB = maxWeightNear(areaB);
  const wC = maxWeightNear(areaC);
  assert.ok(wA > 0 && wB > 0 && wC > 0, `forventet at alle tre områder er representert i heatmapet, fikk A=${wA} B=${wB} C=${wC}`);
  assert.ok(wA < wB, `forventet A < B, fikk A=${wA} B=${wB}`);
  assert.ok(wB < wC, `forventet B < C, fikk B=${wB} C=${wC}`);
});
