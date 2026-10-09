import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { runEcologicalEngine } = await import("./engine");
const { distanceMeters, movePoint } = await import("@/src/lib/geo");
const { UKJENT_DYNAMIC_FEATURES, UKJENT_STATIC_FEATURES } = await import("./environment/types");

// Alle disse testene bruker en MOCKET, synkron EnvironmentResolver — ingen
// nettverkskall. Dette er nøyaktig grensen §27 (determinisme, ingen eksternt
// kall) krever: selve scoringen (runEcologicalEngine) er ren og synkron,
// uansett hvor miljødataene til slutt kommer fra i appen.

const NOW_WINTER = new Date("2026-01-15T12:00:00.000Z").getTime();
const NOW_SPRING_LATE = new Date("2026-05-25T12:00:00.000Z").getTime();
const NOW_SUMMER = new Date("2026-07-01T12:00:00.000Z").getTime();

let idCounter = 0;
function obs(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `eco-obs-${idCounter}`,
    userId: "u1",
    jaktlagId: "",
    dyr: "Hjort",
    type: "Sett",
    kommentar: "",
    tid: new Date(NOW_WINTER).toISOString(),
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

// ===========================================================================
// Vinterhjort – høyde/snø
// ===========================================================================

test("Vinterhjort: lavtliggende/snøfattig sone får høyere score enn høytliggende/snørik sone, uten noen observasjoner", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const lowPoint = movePoint(center.latitude, center.longitude, 270, 1500); // vest, "dalbunn"
  const highPoint = movePoint(center.latitude, center.longitude, 90, 1500); // øst, "fjell"

  const environment = (p: { latitude: number; longitude: number }) => {
    const nearLow = distanceMeters(p, lowPoint) < distanceMeters(p, highPoint);
    return {
      static: {
        ...UKJENT_STATIC_FEATURES,
        habitat: "skog" as const,
        relativeElevationMeters: nearLow ? -250 : 350,
      },
      dynamic: { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: nearLow ? 0.05 : 0.55, temperatureC: nearLow ? 1 : -10 },
    };
  };

  const result = runEcologicalEngine([], "hjort", {
    now: NOW_WINTER,
    areaCenter: center,
    areaRadiusMeters: 2000,
    environment,
  });

  assert.ok(result.zones.length >= 1, "forventet minst én sone ut fra økologisk suitability alene");
  // Beste sone skal ligge på lavsiden — den er UNIFORMT bedre i dette
  // (bevisst binære) miljøoppsettet.
  assert.ok(
    distanceMeters(result.zones[0].center, lowPoint) < distanceMeters(result.zones[0].center, highPoint),
    `forventet at beste sone (score ${result.zones[0].score}) ligger nærmest det lavtliggende/snøfattige punktet`
  );
  // V1.2-KORRIGERING: lavsiden er ett sammenhengende, flatt platå (identisk
  // suitability over hele halvdelen) — den skal derfor bli ÉN sone, ikke
  // flere near-identiske soner slik den grådige sone-utvinningen fra før
  // V1.2 ville gitt (den fylte opp HELE maxZones-budsjettet fra platået,
  // se extractZones sin filkommentar for hele historikken). Høysiden kan
  // fortsatt danne sin egen, separate (og svakere) sone — det er korrekt og
  // ærlig, ikke en feil: to genuint ulike områder skal IKKE tvinges sammen.
  const lavsideSoner = result.zones.filter((z) => distanceMeters(z.center, lowPoint) < distanceMeters(z.center, highPoint));
  assert.equal(
    lavsideSoner.length,
    1,
    `forventet at det sammenhengende lavside-platået blir ÉN sone (ikke fragmentert), fikk ${lavsideSoner.length}`
  );
});

// ===========================================================================
// Vårtrekk
// ===========================================================================

test("Vårtrekk (elg): sent i vårtrekk-vinduet favoriseres høyereliggende områder", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  // Bevisst asymmetriske avstander (1500 m / 1650 m) slik at ingen rutesenter
  // i det interne scoring-gridet kan havne nøyaktig på symmetrilinjen mellom
  // punktene — en ren geometrisk koinsidens ved eksakt symmetri, ikke noe
  // motoren skal vurderes etter.
  const lowPoint = movePoint(center.latitude, center.longitude, 270, 1500);
  const highPoint = movePoint(center.latitude, center.longitude, 90, 1650);

  const environment = (p: { latitude: number; longitude: number }) => {
    const nearLow = distanceMeters(p, lowPoint) < distanceMeters(p, highPoint);
    return {
      static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: nearLow ? -250 : 250 },
      dynamic: UKJENT_DYNAMIC_FEATURES,
    };
  };

  const result = runEcologicalEngine([], "elg", {
    now: NOW_SPRING_LATE,
    areaCenter: center,
    areaRadiusMeters: 2000,
    environment,
  });

  assert.ok(result.zones.length >= 1);
  for (const zone of result.zones) {
    assert.ok(
      distanceMeters(zone.center, highPoint) < distanceMeters(zone.center, lowPoint),
      `forventet at sone ${zone.id} (score ${zone.score}) sent i vårtrekket ligger nærmest det høytliggende punktet`
    );
  }
});

// ===========================================================================
// Lokal observasjon overstyrer prior
// ===========================================================================

test("Lokal observasjon overstyrer prior: ecology favoriserer lavland, men ferske observasjoner høyere oppe flytter hovedsonen dit", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const lowPoint = movePoint(center.latitude, center.longitude, 270, 1500);
  const highPoint = movePoint(center.latitude, center.longitude, 90, 1500);

  const environment = (p: { latitude: number; longitude: number }) => {
    const nearLow = distanceMeters(p, lowPoint) < distanceMeters(p, highPoint);
    return {
      static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: nearLow ? -250 : 350 },
      dynamic: { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: nearLow ? 0.05 : 0.55, temperatureC: nearLow ? 1 : -10 },
    };
  };

  const p2 = movePoint(highPoint.latitude, highPoint.longitude, 30, 60);
  const p3 = movePoint(highPoint.latitude, highPoint.longitude, 150, 60);
  const observations = [
    obs({ latitude: highPoint.latitude, longitude: highPoint.longitude, observationSource: "camera", cameraId: "camA", tid: new Date(NOW_WINTER).toISOString() }),
    obs({ latitude: p2.latitude, longitude: p2.longitude, observationSource: "camera", cameraId: "camB", tid: new Date(NOW_WINTER - 10 * 60000).toISOString() }),
    obs({ latitude: p3.latitude, longitude: p3.longitude, observationSource: "camera", cameraId: "camC", tid: new Date(NOW_WINTER - 20 * 60000).toISOString() }),
  ];

  const result = runEcologicalEngine(observations as never, "hjort", {
    now: NOW_WINTER,
    areaCenter: center,
    areaRadiusMeters: 2000,
    environment,
  });

  assert.ok(result.zones.length >= 1);
  assert.ok(
    distanceMeters(result.zones[0].center, highPoint) < distanceMeters(result.zones[0].center, lowPoint),
    "forventet at tre ferske, lokale observasjoner flytter hovedsonen mot dem, til tross for at prior favoriserer lavlandet"
  );
});

// ===========================================================================
// Ingen observasjoner
// ===========================================================================

test("Ingen observasjoner: godt habitat gir en moderat sone med lav confidence, ikke ingenting og ikke skråsikkerhet", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "jordbruk" as const, relativeElevationMeters: -100 },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  });

  const result = runEcologicalEngine([], "radyr", {
    now: NOW_SUMMER,
    areaCenter: center,
    areaRadiusMeters: 1000,
    environment,
  });

  assert.ok(result.zones.length >= 1, "forventet at god habitat-suitability alene kan danne en sone");
  assert.equal(result.zones[0].confidenceLevel, "lav", "ingen observasjoner bak sonen skal alltid gi lav confidence");
  assert.equal(result.zones[0].observationCount, 0);
  assert.ok(result.zones[0].score > 0 && result.zones[0].score < 100);
});

// ===========================================================================
// Miljøbasert forklaring (§28 V1.1): Støtter/Nøytralt/Begrenser
// ===========================================================================

test("Ingen observasjoner: forklaringen bruker Støtter/Nøytralt/Begrenser i stedet for den generiske fallback-teksten", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, nearHabitatEdge: true },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  });

  const result = runEcologicalEngine([], "hjort", {
    now: NOW_SUMMER,
    areaCenter: center,
    areaRadiusMeters: 500,
    environment,
  });

  assert.ok(result.zones.length >= 1);
  const zone = result.zones[0];
  assert.ok(
    zone.explanation.startsWith("Miljøbasert vurdering"),
    `forventet miljøbasert forklaringstekst, fikk: "${zone.explanation}"`
  );
  assert.ok(!zone.explanation.includes("lite datagrunnlag"), "gammel generisk fallback-tekst skal ikke brukes når økologisk kontekst finnes");
  assert.ok(zone.dominantSignals.some((s) => s.startsWith("Støtter:")), "skogshabitat + kantsone bør gi minst én Støtter-linje");
  assert.ok(
    zone.dominantSignals.some((s) => s === "Nøytralt: Lite lokalt datagrunnlag"),
    "skal alltid nevne fravær av lokalt datagrunnlag som et nøytralt faktum"
  );
  assert.ok(
    zone.dominantSignals.some((s) => s.startsWith("Begrenser:") && s.includes("Ingen ferske observasjoner i området")),
    "skal alltid nevne fravær av ferske observasjoner under Begrenser"
  );
});

test("buildZoneExplanation uten ecology-kontekst beholder den gamle generiske fallback-teksten uendret", async () => {
  const { buildZoneExplanation } = await import("./explain");
  const { getSpeciesProfile } = await import("./species/profiles");
  const { explanation, dominantSignals } = buildZoneExplanation({
    species: getSpeciesProfile("hjort"),
    level: "Lav",
    center: { latitude: 60, longitude: 10 },
    contributingObservations: [],
    breakdown: { recency: 0, repetition: 0, cameraDirection: 0, movementDirection: 0, cameraDiversity: 0, corridor: 0, ecology: 0 },
    distinctCameraCount: 0,
    corridors: [],
    nowMs: NOW_SUMMER,
  });
  assert.equal(explanation, "Vurdert område med lite datagrunnlag for hjort.");
  assert.deepEqual(dominantSignals, []);
});

test("Habitat som klart svekker (myr for hjort) gir en Begrenser-linje om habitatet, ikke Støtter", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "myr" as const },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  });

  const result = runEcologicalEngine([], "hjort", {
    now: NOW_SUMMER,
    areaCenter: center,
    areaRadiusMeters: 500,
    environment,
  });

  assert.ok(result.zones.length >= 1);
  const zone = result.zones[0];
  const begrenserLine = zone.dominantSignals.find((s) => s.startsWith("Begrenser:"));
  assert.ok(begrenserLine?.includes("Myrterreng"), `forventet at myr nevnes i Begrenser-linjen, fikk: ${JSON.stringify(zone.dominantSignals)}`);
});

// ===========================================================================
// Blandet forklaring (V1.2 §21-23): økologi og lokal evidens skal begge
// kunne nevnes når begge faktisk bidrar — ikke forkastes fordi ÉN
// observasjon dukket opp.
// ===========================================================================

test("environment_plus_local: forklaringen nevner BÅDE miljø og lokal evidens, ikke bare observasjonstelling", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, nearHabitatEdge: true },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  });
  const observations = [
    obs({ latitude: center.latitude, longitude: center.longitude, observationSource: "camera", cameraId: "camA", tid: new Date(NOW_SUMMER - 10 * 60000).toISOString() }),
  ];

  const result = runEcologicalEngine(observations as never, "hjort", {
    now: NOW_SUMMER,
    areaCenter: center,
    areaRadiusMeters: 500,
    environment,
  });

  assert.ok(result.zones.length >= 1);
  const zone = result.zones[0];
  assert.equal(zone.predictionMode, "environment_plus_local", `forventet environment_plus_local for én fersk observasjon oppå god økologi, fikk ${zone.predictionMode}`);
  const støtterLinje = zone.dominantSignals.find((s) => s.startsWith("Støtter:")) ?? "";
  assert.ok(støtterLinje.includes("habitat") || støtterLinje.includes("Skogterreng"), `forventet at miljøet nevnes, fikk: "${støtterLinje}"`);
  assert.ok(
    /fersk|observasjon|kamera/i.test(støtterLinje),
    `forventet at den lokale evidensen OGSÅ nevnes (ikke bare miljøet), fikk: "${støtterLinje}"`
  );
  // Ingen duplisert bokføring: "X observasjoner siste Y" og "Siste registrering er Z gammel" skal ikke lenger begge være med som to av de øverste grunnene.
  const bokføringsLinjer = zone.dominantSignals.filter((s) => /observasjoner siste|siste registrering er/i.test(s));
  assert.ok(bokføringsLinjer.length <= 1, `forventet ikke duplisert bokføring blant de viktigste signalene, fikk: ${JSON.stringify(zone.dominantSignals)}`);
});

test("local_dominant: forklaringen prioriterer fersk lokal aktivitet, men kan fortsatt nevne miljøstøtte", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, nearHabitatEdge: true },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  });
  const observations = Array.from({ length: 5 }, (_, i) =>
    obs({
      latitude: center.latitude,
      longitude: center.longitude,
      observationSource: "camera",
      cameraId: `cam${i}`,
      tid: new Date(NOW_SUMMER - i * 5 * 60000).toISOString(),
    })
  );

  const result = runEcologicalEngine(observations as never, "hjort", {
    now: NOW_SUMMER,
    areaCenter: center,
    areaRadiusMeters: 500,
    environment,
  });

  assert.ok(result.zones.length >= 1);
  const zone = result.zones[0];
  assert.equal(zone.predictionMode, "local_dominant");
  const støtterLinje = zone.dominantSignals.find((s) => s.startsWith("Støtter:")) ?? "";
  assert.ok(/fersk|kamera|observasjon|gjentatte/i.test(støtterLinje), `forventet at lokal evidens prioriteres, fikk: "${støtterLinje}"`);
});

test("explanation-teksten er ALDRI en ren tautologi av nivået selv når ecology+observasjoner blandes", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  });
  const observations = [obs({ latitude: center.latitude, longitude: center.longitude, observationSource: "camera", cameraId: "camA" })];
  const result = runEcologicalEngine(observations as never, "hjort", { now: NOW_SUMMER, areaCenter: center, areaRadiusMeters: 500, environment });
  assert.ok(result.zones.length >= 1);
  assert.ok(
    !result.zones[0].explanation.toLowerCase().startsWith("vurdert område med"),
    `forventet en meningsfull forklaring når miljø+lokal evidens begge finnes, fikk tautologi: "${result.zones[0].explanation}"`
  );
});

test("environmentBreakdown (V1.2 §25): eksponerer per-faktor økologisk nedbrytning, ikke bare det aggregerte ecology-tallet", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, nearHabitatEdge: true },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  });
  const result = runEcologicalEngine([], "hjort", { now: NOW_SUMMER, areaCenter: center, areaRadiusMeters: 500, environment });
  assert.ok(result.zones.length >= 1);
  const eb = result.zones[0].environmentBreakdown;
  assert.ok(eb, "forventet environmentBreakdown på en økologisk sone");
  assert.equal(typeof eb?.habitat, "number");
  assert.equal(typeof eb?.edge, "number");
  assert.ok((eb?.edge ?? 0) > 1, "forventet at kantsone-bonusen synes i nedbrytningen (nearHabitatEdge=true)");
});

test("environmentBreakdown er undefined når motoren kjører uten miljødata (ren runEngine)", async () => {
  const { runEngine } = await import("./engine");
  const observations = [
    obs({ observationSource: "camera", cameraId: "camA", cameraDirectionDegrees: 90, tid: new Date(NOW_SUMMER).toISOString() }),
  ];
  const result = runEngine(observations as never, "hjort", { now: NOW_SUMMER });
  assert.ok(result.zones.length >= 1);
  assert.equal(result.zones[0].environmentBreakdown, undefined);
});

// ===========================================================================
// timeOfDay / precipitation (V1.3 §F/§G) — synlige i forklaringen, ikke bare i tallene
// ===========================================================================

test("environmentBreakdown (V1.3 §F/§G): timeOfDay og precipitation er med i den økologiske nedbrytningen på en sone uten lokale observasjoner", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const nightNow = new Date("2026-07-01T02:00:00.000Z").getTime(); // 2 timer FØR soloppgang under
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const },
    dynamic: {
      ...UKJENT_DYNAMIC_FEATURES,
      sunriseMs: new Date("2026-07-01T04:00:00.000Z").getTime(),
      sunsetMs: new Date("2026-07-01T22:00:00.000Z").getTime(),
      precipitationMm: 10, // kraftig nedbør
    },
  });
  const result = runEcologicalEngine([], "hjort", { now: nightNow, areaCenter: center, areaRadiusMeters: 500, environment });
  assert.ok(result.zones.length >= 1);
  const eb = result.zones[0].environmentBreakdown;
  assert.ok(eb, "forventet environmentBreakdown på en økologisk sone");
  assert.equal(eb?.timeOfDay, 1.05, `forventet hjort sitt nattbasisnivå 1.05, fikk ${eb?.timeOfDay}`);
  assert.ok((eb?.precipitation ?? 1) < 1, `forventet at kraftig nedbør demper precipitation-faktoren, fikk ${eb?.precipitation}`);

  // Selve poenget med §F/§G (jf. explain.ts-kravet i oppdraget): tallene skal
  // faktisk SYNES i forklaringen brukeren ser, ikke bare i den interne
  // nedbrytningen — ellers er signalet usynlig for brukeren.
  const alleLinjer = result.zones[0].dominantSignals.join(" | ");
  assert.ok(/[Nn]attaktivitet/.test(alleLinjer), `forventet at nattbasisnivået nevnes i forklaringen, fikk: "${alleLinjer}"`);
  assert.ok(/[Nn]edbør/.test(alleLinjer), `forventet at nedbør nevnes i forklaringen, fikk: "${alleLinjer}"`);
});

// ===========================================================================
// predictionMode (V1.1 §31)
// ===========================================================================

test("predictionMode: sone uten bidragsytende observasjoner er 'environment_only'", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  });
  const result = runEcologicalEngine([], "hjort", { now: NOW_SUMMER, areaCenter: center, areaRadiusMeters: 500, environment });
  assert.ok(result.zones.length >= 1);
  assert.equal(result.zones[0].predictionMode, "environment_only");
});

test("predictionMode: rene observasjonsbaserte soner (runEngine, ingen ecology) er 'local_dominant'", async () => {
  const { runEngine } = await import("./engine");
  const center = { latitude: 60.0, longitude: 10.0 };
  const observations = [
    obs({ latitude: center.latitude, longitude: center.longitude, observationSource: "camera", cameraId: "camA" }),
  ];
  const result = runEngine(observations as never, "hjort", { now: NOW_WINTER });
  assert.ok(result.zones.length >= 1);
  assert.equal(result.zones[0].predictionMode, "local_dominant");
});

test("predictionMode: nok ferske lokale observasjoner oppå en økologisk prior vipper over til 'local_dominant'", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const },
    dynamic: UKJENT_DYNAMIC_FEATURES,
  });
  const makeObs = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      obs({
        latitude: center.latitude,
        longitude: center.longitude,
        observationSource: "camera",
        cameraId: `cam${i}`,
        tid: new Date(NOW_WINTER - i * 5 * 60000).toISOString(),
      })
    );

  const engineOnly = runEcologicalEngine([], "hjort", { now: NOW_WINTER, areaCenter: center, areaRadiusMeters: 500, environment });
  const withOne = runEcologicalEngine(makeObs(1) as never, "hjort", { now: NOW_WINTER, areaCenter: center, areaRadiusMeters: 500, environment });
  const withFive = runEcologicalEngine(makeObs(5) as never, "hjort", { now: NOW_WINTER, areaCenter: center, areaRadiusMeters: 500, environment });

  // §36: Score(kun miljø) < Score(miljø + 1 fersk signal) < Score(miljø + flere uavhengige signaler).
  assert.ok(engineOnly.zones[0].score < withOne.zones[0].score, "ett ferskt lokalt signal skal øke scoren over miljø-baseline");
  assert.ok(withOne.zones[0].score < withFive.zones[0].score, "flere uavhengige signaler skal øke scoren ytterligere");

  assert.equal(engineOnly.zones[0].predictionMode, "environment_only");
  assert.equal(withOne.zones[0].predictionMode, "environment_plus_local", "ett enkelt signal skal ikke alene slå ut som lokalt dominert");
  assert.equal(withFive.zones[0].predictionMode, "local_dominant", "nok uavhengige ferske signaler skal til slutt dominere over miljøprioren");
});

// ===========================================================================
// Temperatur – artsskillet
// ===========================================================================

test("Temperatur-artsskille: samme kalde vintertemperatur svekker hjort mer enn rådyr", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const cold = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: 0 },
    dynamic: { ...UKJENT_DYNAMIC_FEATURES, temperatureC: -15, snowDepthMeters: 0.4 },
  });
  const mild = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: 0 },
    dynamic: { ...UKJENT_DYNAMIC_FEATURES, temperatureC: 2, snowDepthMeters: 0 },
  });

  const hjortCold = runEcologicalEngine([], "hjort", { now: NOW_WINTER, areaCenter: center, areaRadiusMeters: 500, environment: cold });
  const hjortMild = runEcologicalEngine([], "hjort", { now: NOW_WINTER, areaCenter: center, areaRadiusMeters: 500, environment: mild });
  const radyrCold = runEcologicalEngine([], "radyr", { now: NOW_WINTER, areaCenter: center, areaRadiusMeters: 500, environment: cold });
  const radyrMild = runEcologicalEngine([], "radyr", { now: NOW_WINTER, areaCenter: center, areaRadiusMeters: 500, environment: mild });

  const hjortDrop = hjortMild.zones[0].score - hjortCold.zones[0].score;
  const radyrDrop = radyrMild.zones[0].score - radyrCold.zones[0].score;

  assert.ok(
    hjortDrop > radyrDrop,
    `forventet at hjort svekkes mer av kulde enn rådyr (hjort-fall=${hjortDrop}, rådyr-fall=${radyrDrop})`
  );
});

// ===========================================================================
// Sesongendring
// ===========================================================================

test("Sesongendring: identisk område og fravær av observasjoner, men dato endret fra vinter til sommer, endrer ecological suitability", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const highElevationCold = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: 350 },
    dynamic: { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0.5, temperatureC: -8 },
  });

  const winterResult = runEcologicalEngine([], "hjort", {
    now: NOW_WINTER,
    areaCenter: center,
    areaRadiusMeters: 500,
    environment: highElevationCold,
  });
  const summerResult = runEcologicalEngine([], "hjort", {
    now: NOW_SUMMER,
    areaCenter: center,
    areaRadiusMeters: 500,
    environment: highElevationCold,
  });

  assert.notEqual(
    winterResult.zones[0]?.score,
    summerResult.zones[0]?.score,
    "samme høytliggende/snørike/kalde punkt skal vurderes ulikt vinter vs. sommer (vintersnø-straffen gjelder kun om vinteren)"
  );
  assert.ok(
    (summerResult.zones[0]?.score ?? 0) > (winterResult.zones[0]?.score ?? 0),
    "det samme punktet skal scorer høyere om sommeren enn om vinteren når det er høytliggende og snørikt"
  );
});

// ===========================================================================
// Vind + terreng
// ===========================================================================

test("Vind + terreng: le-side (skråning bort fra vinden) scorer likt eller høyere enn vindeksponert side, aldri omvendt", async () => {
  const { computeSpatialSuitability } = await import("./ecology/suitability");
  const { HJORT_ECOLOGY_PROFILE } = await import("./ecology/hjort");

  const windDirection = 270; // vind FRA vest
  const dynamic = { ...UKJENT_DYNAMIC_FEATURES, windDirectionDeg: windDirection, windSpeedMs: 8 };

  const exposed = computeSpatialSuitability(
    HJORT_ECOLOGY_PROFILE,
    "sommer",
    NOW_SUMMER,
    { ...UKJENT_STATIC_FEATURES, habitat: "skog", aspectDeg: 270 }, // skråningen vender rett mot vinden
    dynamic
  );
  const sheltered = computeSpatialSuitability(
    HJORT_ECOLOGY_PROFILE,
    "sommer",
    NOW_SUMMER,
    { ...UKJENT_STATIC_FEATURES, habitat: "skog", aspectDeg: 90 }, // skråningen vender bort fra vinden (le)
    dynamic
  );

  assert.ok(
    sheltered.suitability >= exposed.suitability,
    `forventet le-siden (${sheltered.suitability}) >= vindeksponert side (${exposed.suitability})`
  );
});

// ===========================================================================
// Kanttilfeller
// ===========================================================================

test("Kanttilfelle: miljøoppslag som returnerer 'ukjent' for alt krasjer ikke", () => {
  const environment = () => ({ static: UKJENT_STATIC_FEATURES, dynamic: UKJENT_DYNAMIC_FEATURES });
  const result = runEcologicalEngine([], "hjort", {
    now: NOW_WINTER,
    areaCenter: { latitude: 60, longitude: 10 },
    areaRadiusMeters: 1000,
    environment,
  });
  assert.ok(Number.isFinite(result.confidence));
});

test("Determinisme: samme input (inkl. miljøresolver) gir samme output", () => {
  const environment = () => ({
    static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: 50 },
    dynamic: { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0.1, temperatureC: -2 },
  });
  const options = { now: NOW_WINTER, areaCenter: { latitude: 60, longitude: 10 }, areaRadiusMeters: 800, environment };
  const r1 = runEcologicalEngine([], "hjort", options);
  const r2 = runEcologicalEngine([], "hjort", options);
  assert.deepEqual(r1, r2);
});

// ===========================================================================
// Hunting-zones-oppdraget §5/§6: per-sone forklaringer skal faktisk DIFFERE
// (ikke samme to generiske grunner uansett hva som driver hver sone), OG
// vann-masking skal holde for footprint-CELLENE (ikke bare zone.center).
// ===========================================================================

test("Per-sone forklaringer er REELT ulike: to soner drevet av ulike habitat-typer får ulike positiveReasons, ikke samme generiske grunn for begge", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  // To ISOLERTE gunstige "øyer" (bump-radius 400 m) over en BEVISST dårlig
  // bakgrunn (habitat "bebygd" + maksimal vinterstraff) som ligger UNDER
  // minZoneScore — se debug-verifikasjon: dette hindrer at hele analyseflaten
  // smelter sammen til ÉN kjempesone via extractZones' kjede-relative
  // absorpsjon (grid.ts), og garanterer to GENUINT separate soner. Bevisst
  // asymmetriske avstander/bearinger (1500m/270° vs 1650m/100°, samme knep
  // som "Vårtrekk (elg)"-testen over) slik at ingen rutesenter havner
  // nøyaktig på en symmetrilinje.
  const lowPoint = movePoint(center.latitude, center.longitude, 270, 1500);
  const highPoint = movePoint(center.latitude, center.longitude, 100, 1650);

  const environment = (p: { latitude: number; longitude: number }) => {
    const inLowBump = distanceMeters(p, lowPoint) < 400;
    const inHighBump = distanceMeters(p, highPoint) < 400;
    if (inLowBump) {
      return {
        static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const, relativeElevationMeters: -250 },
        dynamic: { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0.05, temperatureC: 1 },
      };
    }
    if (inHighBump) {
      // SAMME gunstige fysiske forhold (høyde/snø/temp) som lavbumpen —
      // KUN habitatklassen er ulik. Dette isolerer habitat som ENESTE
      // differensierende faktor mellom de to sonenes forklaring.
      return {
        static: { ...UKJENT_STATIC_FEATURES, habitat: "jordbruk" as const, relativeElevationMeters: -250 },
        dynamic: { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0.05, temperatureC: 1 },
      };
    }
    return {
      static: { ...UKJENT_STATIC_FEATURES, habitat: "bebygd" as const, relativeElevationMeters: 400 },
      dynamic: { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: 0.6, temperatureC: -10 },
    };
  };

  const result = runEcologicalEngine([], "hjort", {
    now: NOW_WINTER,
    areaCenter: center,
    areaRadiusMeters: 2200,
    environment,
  });

  assert.equal(result.zones.length, 2, "forventet nøyaktig to separate soner (skog-øy + jordbruk-øy), bakgrunnen skal være under minZoneScore");

  const skogSone = result.zones.find((z) => distanceMeters(z.center, lowPoint) < 400);
  const jordbrukSone = result.zones.find((z) => distanceMeters(z.center, highPoint) < 400);
  assert.ok(skogSone?.recommendation, "skog-sonen skal ha en recommendation");
  assert.ok(jordbrukSone?.recommendation, "jordbruk-sonen skal ha en recommendation");

  // IKKE bare "samme rekkefølge" — selve INNHOLDET skal avvike, direkte
  // drevet av at HVER sones egen habitatklasse er ulik (§5 i oppdraget: dette
  // er nøyaktig scenarioet brukeren klagde på — "Kulturlandskap/jordbruksmark
  // for hver sone" — her bekreftes at det IKKE skjer når habitatet faktisk
  // er forskjellig per sone).
  assert.notDeepEqual(
    skogSone!.recommendation!.positiveReasons,
    jordbrukSone!.recommendation!.positiveReasons,
    "de to sonenes positiveReasons skal faktisk avvike, ikke være identiske"
  );
  assert.ok(
    skogSone!.recommendation!.positiveReasons.some((r) => r.includes("Skogterreng")),
    "skog-sonen skal nevne Skogterreng som gunstig habitat"
  );
  assert.ok(
    jordbrukSone!.recommendation!.positiveReasons.some((r) => r.includes("Kulturlandskap/jordbruksmark")),
    "jordbruk-sonen skal nevne Kulturlandskap/jordbruksmark som gunstig habitat, IKKE Skogterreng"
  );
  assert.ok(
    !jordbrukSone!.recommendation!.positiveReasons.some((r) => r.includes("Skogterreng")),
    "jordbruk-sonen skal ALDRI arve skog-sonens habitat-tekst"
  );
});

test("Vann-masking holder for footprint-CELLENE, ikke bare zone.center: ingen sone strekker seg inn i 'water'-området selv når det området er kunstig gjort mest gunstig", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  // Asymmetriske avstander/bearinger (samme knep som over) — unngår at et
  // rutesenter havner eksakt på symmetrilinjen mellom vann/land, som ville
  // gitt en meningsløs eksakt avstands-uavgjort i assert-ene under.
  const waterPoint = movePoint(center.latitude, center.longitude, 270, 1500); // kunstig "vann", MEST gunstig miljø hvis masking ikke virket
  const landPoint = movePoint(center.latitude, center.longitude, 100, 1650); // "land", mindre gunstig miljø

  const environment = (p: { latitude: number; longitude: number }) => {
    const nearWater = distanceMeters(p, waterPoint) < distanceMeters(p, landPoint);
    return {
      static: {
        ...UKJENT_STATIC_FEATURES,
        habitat: "skog" as const,
        // Vannsiden er BEVISST miljømessig mer "gunstig" (lavere/varmere) enn
        // landsiden — en felle: hvis vann-maskingen ikke fungerte for
        // footprint-cellene, ville sonen "lekke" utover i vannet nettopp
        // FORDI det er den høyest scorende retningen.
        relativeElevationMeters: nearWater ? -250 : 50,
        spatialValidity: nearWater ? ("water" as const) : ("valid_land" as const),
      },
      dynamic: { ...UKJENT_DYNAMIC_FEATURES, snowDepthMeters: nearWater ? 0.02 : 0.2, temperatureC: nearWater ? 3 : -1 },
    };
  };

  const result = runEcologicalEngine([], "hjort", {
    now: NOW_WINTER,
    areaCenter: center,
    areaRadiusMeters: 2000,
    environment,
  });

  assert.ok(result.zones.length >= 1, "forventet minst én sone fra landsiden, selv om vannsiden 'lokker' med høyere miljøscore");

  for (const zone of result.zones) {
    assert.ok(
      distanceMeters(zone.center, landPoint) < distanceMeters(zone.center, waterPoint),
      `zone.center (${zone.id}) skal ligge på landsiden, aldri på den kunstig gunstige vannsiden`
    );
    const cells = zone.footprint?.cells ?? [];
    assert.ok(cells.length > 0, "sonen skal ha faktiske footprint-celler å sjekke");
    for (const cell of cells) {
      assert.ok(
        distanceMeters(cell, landPoint) < distanceMeters(cell, waterPoint),
        `footprint-celle i sone ${zone.id} skal ikke strekke seg inn i vann-halvdelen`
      );
    }
  }
});
