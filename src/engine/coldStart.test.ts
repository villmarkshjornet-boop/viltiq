import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { runEcologicalEngine } = await import("./engine");
const { UKJENT_DYNAMIC_FEATURES, UKJENT_STATIC_FEATURES } = await import("./environment/types");

// Regresjonstester for "Hjem"-dashbordets kaldstart-bug: app/index.tsx kalte
// tidligere runEngine() (kun observasjoner) for "beste område akkurat nå",
// som ALLTID gir 0 soner for en fersk bruker uten loggede observasjoner.
// Fiksen (ikke denne filens ansvar — se app/index.tsx) var å bruke
// runEcologicalEngine() i stedet, som kan score et område ut fra ren
// miljø-suitability alene. runEcologicalEngine hadde allerede full støtte for
// dette (jf. de øvrige "ingen observasjoner"-testene i
// ecologicalEngine.test.ts) — selve motoren er IKKE endret her, kun dekket
// med tester som låser kontrakten kaldstart-skjermen faktisk er avhengig av.
//
// Alle disse testene bruker en MOCKET, synkron EnvironmentResolver — ingen
// nettverkskall, samme mønster som ecologicalEngine.test.ts/spatialValidity.test.ts.

const NOW_SUMMER = new Date("2026-07-01T12:00:00.000Z").getTime();

/** Ensartet, "godt habitat"-miljø (skog, hjort default-suitability 0.8) over hele analyseområdet — ingen platå-brudd, ingen sesong-/snø-/vei-/kant-/vind-faktorer i spill. */
function excellentHabitatEnvironment() {
  return {
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, spatialValidity: "valid_land" as const, relativeElevationMeters: 0 },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  };
}

/** Samme oppsett, men et klart svakere (fortsatt gyldig LAND) habitat — myr, hjort default-suitability 0.4 — til E-testen under. */
function poorButValidHabitatEnvironment() {
  return {
    static: { ...UKJENT_STATIC_FEATURES, habitat: "myr" as const, spatialValidity: "valid_land" as const, relativeElevationMeters: 0 },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  };
}

/** Uniform, BEKREFTET vannflate over hele analyseområdet — til G-testen under. */
function allWaterEnvironment() {
  return {
    static: { ...UKJENT_STATIC_FEATURES, habitat: "vann" as const, spatialValidity: "water" as const },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  };
}

let idCounter = 0;
function obs(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `coldstart-obs-${idCounter}`,
    userId: "u1",
    jaktlagId: "",
    dyr: "Hjort",
    type: "Sett",
    kommentar: "",
    tid: new Date(NOW_SUMMER).toISOString(),
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

const AREA_CENTER = { latitude: 60.0, longitude: 10.0 };
const AREA_RADIUS_METERS = 800;

// ===========================================================================
// Test A/B/C/D — kaldstart (0 observasjoner) skal gi en brukbar sone MED
// footprint OG et heatmap, ikke bare et poeng-tall.
// ===========================================================================

test("Kaldstart: 0 observasjoner + godt habitat gir minst én sone (Test A)", () => {
  const result = runEcologicalEngine([], "hjort", {
    now: NOW_SUMMER,
    areaCenter: AREA_CENTER,
    areaRadiusMeters: AREA_RADIUS_METERS,
    environment: excellentHabitatEnvironment,
  });
  assert.ok(result.zones.length > 0, "forventet minst én sone ut fra ren miljø-suitability, uten noen observasjoner");
});

test("Kaldstart: sonen uten observasjoner har predictionMode 'environment_only' (Test B)", () => {
  const result = runEcologicalEngine([], "hjort", {
    now: NOW_SUMMER,
    areaCenter: AREA_CENTER,
    areaRadiusMeters: AREA_RADIUS_METERS,
    environment: excellentHabitatEnvironment,
  });
  assert.ok(result.zones.length > 0);
  assert.equal(result.zones[0].predictionMode, "environment_only");
});

test("Kaldstart: sonen har en populert footprint (mater Hjem sitt mini-kart-heatmap) (Test C)", () => {
  const result = runEcologicalEngine([], "hjort", {
    now: NOW_SUMMER,
    areaCenter: AREA_CENTER,
    areaRadiusMeters: AREA_RADIUS_METERS,
    environment: excellentHabitatEnvironment,
  });
  assert.ok(result.zones.length > 0);
  const zone = result.zones[0];
  assert.ok(zone.footprint, "forventet en footprint på kaldstart-sonen");
  assert.ok((zone.footprint?.cells.length ?? 0) > 0, "forventet minst én footprint-celle");
});

test("Kaldstart: hele det skårede gridet eksponeres som heatmapPoints, ikke bare klyngede soner (Test D)", () => {
  const result = runEcologicalEngine([], "hjort", {
    now: NOW_SUMMER,
    areaCenter: AREA_CENTER,
    areaRadiusMeters: AREA_RADIUS_METERS,
    environment: excellentHabitatEnvironment,
  });
  assert.ok(result.heatmapPoints.length > 0, "forventet et faktisk heatmap-overlay selv uten observasjoner");
});

// ===========================================================================
// Test E — scoren er GENUINT utledet av miljø-inputet, ikke en hardkodet
// "0 observasjoner -> fast tall"-snarvei.
// ===========================================================================

test("Kaldstart: scoren endrer seg meningsfullt med habitat-kvaliteten — IKKE en hardkodet konstant (Test E)", () => {
  const goodResult = runEcologicalEngine([], "hjort", {
    now: NOW_SUMMER,
    areaCenter: AREA_CENTER,
    areaRadiusMeters: AREA_RADIUS_METERS,
    environment: excellentHabitatEnvironment,
  });
  const poorResult = runEcologicalEngine([], "hjort", {
    now: NOW_SUMMER,
    areaCenter: AREA_CENTER,
    areaRadiusMeters: AREA_RADIUS_METERS,
    environment: poorButValidHabitatEnvironment,
  });

  assert.ok(goodResult.zones.length > 0 && poorResult.zones.length > 0, "begge miljøene skal fortsatt klare terskelen for en sone");
  const goodScore = goodResult.zones[0].score;
  const poorScore = poorResult.zones[0].score;
  assert.ok(
    goodScore - poorScore > 5,
    `forventet en meningsfull scoreforskjell mellom godt (${goodScore}) og svakere (${poorScore}) habitat — for liten/ingen forskjell tyder på et hardkodet kaldstart-tall`
  );
});

// ===========================================================================
// Test F — SAMME miljøresolver/samme runEcologicalEngine-kall, kun antall
// observasjoner endres fra 0 til 1: predictionMode skal bevege seg vekk fra
// 'environment_only', ikke stå stille eller kreve en annen motorfunksjon.
// ===========================================================================

test("Kaldstart -> første observasjon: predictionMode går fra 'environment_only' til noe annet med SAMME runEcologicalEngine-kall (Test F)", () => {
  const options = {
    now: NOW_SUMMER,
    areaCenter: AREA_CENTER,
    areaRadiusMeters: AREA_RADIUS_METERS,
    environment: excellentHabitatEnvironment,
  };

  const zeroObsResult = runEcologicalEngine([], "hjort", options);
  assert.ok(zeroObsResult.zones.length > 0);
  assert.equal(zeroObsResult.zones[0].predictionMode, "environment_only");

  const oneFreshObservation = [
    obs({
      latitude: AREA_CENTER.latitude,
      longitude: AREA_CENTER.longitude,
      observationSource: "camera",
      cameraId: "camA",
      tid: new Date(NOW_SUMMER).toISOString(),
    }),
  ];
  const oneObsResult = runEcologicalEngine(oneFreshObservation as never, "hjort", options);
  assert.ok(oneObsResult.zones.length > 0);
  assert.notEqual(
    oneObsResult.zones[0].predictionMode,
    "environment_only",
    `forventet at predictionMode beveget seg vekk fra 'environment_only' etter én fersk observasjon, fikk fortsatt ${oneObsResult.zones[0].predictionMode}`
  );
  assert.ok(
    ["environment_plus_local", "local_dominant"].includes(oneObsResult.zones[0].predictionMode),
    `uventet predictionMode: ${oneObsResult.zones[0].predictionMode}`
  );
  assert.ok(
    oneObsResult.zones[0].score >= zeroObsResult.zones[0].score,
    "én fersk lokal observasjon oppå samme miljø skal aldri gi en LAVERE score enn miljøet alene"
  );
});

// ===========================================================================
// Test G — fikset betyr "krev ikke observasjoner", IKKE "tving alltid frem
// en sone uansett hva". Et sted uten gyldig landareal skal fortsatt gi
// null (eller svært lavtscorende) soner.
// ===========================================================================

test("Kaldstart over bekreftet vann: gir INGEN soner og INGEN heatmap-punkter — fikset tvinger ikke frem en sone uansett grunnlag (Test G)", () => {
  const result = runEcologicalEngine([], "hjort", {
    now: NOW_SUMMER,
    areaCenter: AREA_CENTER,
    areaRadiusMeters: AREA_RADIUS_METERS,
    environment: allWaterEnvironment,
  });
  assert.equal(result.zones.length, 0, "et analyseområde som er 100 % bekreftet vann skal ikke produsere noen sone");
  assert.equal(result.heatmapPoints.length, 0, "vannceller skal heller ikke synes som heatmap-punkter");
});
