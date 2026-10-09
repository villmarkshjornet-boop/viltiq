import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { setCachedIntelligenceResult, getCachedIntelligenceResult, clearCachedIntelligenceResults } = await import(
  "./resultCache"
);
const { runEcologicalEngine } = await import("./engine");
const { UKJENT_DYNAMIC_FEATURES, UKJENT_STATIC_FEATURES } = await import("./environment/types");

const NOW = new Date("2026-08-10T12:00:00.000Z").getTime();

let idCounter = 0;
function engineResult(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    engineVersion: "ViltIQ Engine v1",
    configVersion: "1",
    species: "hjort",
    generatedAt: NOW,
    zones: [],
    confidence: 0.5,
    confidenceLevel: "middels",
    summary: `testresultat-${idCounter}`,
    signals: [],
    observationsConsidered: 0,
    heatmapPoints: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Manglende oppføring
// ---------------------------------------------------------------------------

test("getCachedIntelligenceResult: ingenting cachet for arten ennå gir null", () => {
  clearCachedIntelligenceResults();
  assert.equal(getCachedIntelligenceResult("hjort"), null);
});

// ---------------------------------------------------------------------------
// Sett og hent
// ---------------------------------------------------------------------------

test("setCachedIntelligenceResult + getCachedIntelligenceResult: umiddelbar henting for samme art gir tilbake nøyaktig samme resultat", () => {
  clearCachedIntelligenceResults();
  const result = engineResult();
  setCachedIntelligenceResult("hjort", result as never, true);

  const cached = getCachedIntelligenceResult("hjort");
  assert.ok(cached, "forventet en cachet oppføring for hjort");
  assert.equal(cached!.result, result, "forventet SAMME resultatobjekt tilbake, ikke en kopi");
  assert.equal(cached!.ecological, true);
  assert.equal(typeof cached!.resolvedAt, "number");
});

// ---------------------------------------------------------------------------
// Isolasjon mellom arter
// ---------------------------------------------------------------------------

test("setCachedIntelligenceResult: ulike arter er isolert fra hverandre", () => {
  clearCachedIntelligenceResults();
  const hjortResult = engineResult({ species: "hjort" });
  setCachedIntelligenceResult("hjort", hjortResult as never, false);

  assert.equal(
    getCachedIntelligenceResult("radyr"),
    null,
    "radyr skal ikke ha noen cachet oppføring bare fordi hjort ble satt"
  );

  const elgResult = engineResult({ species: "elg" });
  setCachedIntelligenceResult("elg", elgResult as never, true);

  const cachedHjort = getCachedIntelligenceResult("hjort");
  const cachedElg = getCachedIntelligenceResult("elg");
  assert.equal(cachedHjort!.result, hjortResult, "hjort-oppføringen skal være upåvirket av at elg ble satt etterpå");
  assert.equal(cachedElg!.result, elgResult);
});

// ---------------------------------------------------------------------------
// Ferskhet / maxAgeMs
// ---------------------------------------------------------------------------

test("getCachedIntelligenceResult: en romslig maxAgeMs gir fortsatt treff for en fersk oppføring", () => {
  clearCachedIntelligenceResults();
  const result = engineResult();
  setCachedIntelligenceResult("elg", result as never, false);

  const cached = getCachedIntelligenceResult("elg", 30 * 60_000);
  assert.ok(cached, "forventet treff med den vanlige 30-minutters default-terskelen");
  assert.equal(cached!.result, result);
});

test("getCachedIntelligenceResult: maxAgeMs=0 gir null for en oppføring som (uansett hvor lite) er eldre enn nøyaktig 0 ms", async () => {
  clearCachedIntelligenceResults();
  const result = engineResult();
  setCachedIntelligenceResult("radyr", result as never, false);

  // Ekte, liten forsinkelse slik at Date.now() garantert har rukket å bevege
  // seg forbi entry.resolvedAt — modulen bruker Date.now() direkte og har
  // ingen injiserbar klokke, så dette er den robuste måten å teste
  // grensetilfellet "eldre enn maxAgeMs" uten å anta et eksakt millisekundtall.
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(getCachedIntelligenceResult("radyr", 0), null);
  // Kontroll: samme oppføring er fortsatt der med en romslig terskel — dvs.
  // det er maxAgeMs=0 som gir null, ikke at oppføringen manglet/ble slettet.
  assert.ok(getCachedIntelligenceResult("radyr", 30 * 60_000), "oppføringen skal fortsatt finnes med en romslig terskel");
});

// ---------------------------------------------------------------------------
// clearCachedIntelligenceResults
// ---------------------------------------------------------------------------

test("clearCachedIntelligenceResults: tømmer cachen fullstendig for alle arter", () => {
  clearCachedIntelligenceResults();
  setCachedIntelligenceResult("hjort", engineResult() as never, false);
  setCachedIntelligenceResult("radyr", engineResult() as never, false);
  setCachedIntelligenceResult("elg", engineResult() as never, true);

  clearCachedIntelligenceResults();

  assert.equal(getCachedIntelligenceResult("hjort"), null);
  assert.equal(getCachedIntelligenceResult("radyr"), null);
  assert.equal(getCachedIntelligenceResult("elg"), null);
});

// ---------------------------------------------------------------------------
// Overskriving
// ---------------------------------------------------------------------------

test("setCachedIntelligenceResult: samme art satt to ganger overskriver — get returnerer det SISTE resultatet, ikke det første", () => {
  clearCachedIntelligenceResults();
  const first = engineResult({ summary: "første" });
  const second = engineResult({ summary: "andre" });

  setCachedIntelligenceResult("hjort", first as never, false);
  setCachedIntelligenceResult("hjort", second as never, true);

  const cached = getCachedIntelligenceResult("hjort");
  assert.equal(cached!.result, second);
  assert.notEqual(cached!.result, first);
  assert.equal(cached!.ecological, true, "ecological-flagget skal også være fra den siste set()-en");
});

// ---------------------------------------------------------------------------
// Tverr-skjerm-konsistens (V1.2 §17-19, §39 punkt M) — den arkitektoniske
// hovedhensikten med denne cachen: Kart, Hjem og Jakt skal alle vise NØYAKTIG
// den samme vurderingen for samme art/tidspunkt, ikke tre potensielt
// avvikende motorkjøringer. Dette er REGRESJONSTESTEN for den tidligere
// blokkerende bugen der runEngine (Jakt) og runEcologicalEngine (Kart) kunne
// gi ulikt nivå for de samme 4 observasjonene.
// ---------------------------------------------------------------------------

test("Tverr-skjerm-konsistens: Kart skriver ÉN ekte EngineResult til cachen — Hjem og Jakt sin lesing er referanselik, ikke en ny/avvikende motorkjøring", () => {
  clearCachedIntelligenceResults();
  const now = new Date("2026-08-10T12:00:00.000Z").getTime();
  const center = { latitude: 60.0, longitude: 10.0 };
  const observations = [
    {
      id: "o1", userId: "u1", jaktlagId: "", dyr: "Hjort", type: "Sett", kommentar: "",
      tid: new Date(now).toISOString(), latitude: center.latitude, longitude: center.longitude, geohash: "u4",
      retning: null, antall: 1, observationSource: "camera", cameraId: "camA", cameraDirectionDegrees: 90,
      sporType: null, kjonn: null, alder: null,
    },
  ];
  const environment = () => ({ static: { ...UKJENT_STATIC_FEATURES, habitat: "skog" as const }, dynamic: UKJENT_DYNAMIC_FEATURES });

  // Simulerer nøyaktig det Kart gjør: kjør motoren ÉN gang, skriv til cachen.
  const kartResultat = runEcologicalEngine(observations as never, "hjort", {
    now, areaCenter: center, areaRadiusMeters: 2000, environment,
  });
  setCachedIntelligenceResult("hjort", kartResultat, true);

  // Simulerer det Hjem OG Jakt gjør: les cachen, ALDRI kjør motoren selv.
  const hjemLeser = getCachedIntelligenceResult("hjort");
  const jaktLeser = getCachedIntelligenceResult("hjort");

  assert.ok(hjemLeser && jaktLeser, "begge skjermene skal finne en cachet oppføring etter at Kart har skrevet");
  assert.equal(hjemLeser!.result, kartResultat, "Hjem skal få TILBAKE SAMME objekt Kart skrev — ingen ny beregning");
  assert.equal(jaktLeser!.result, kartResultat, "Jakt skal få TILBAKE SAMME objekt Kart skrev — ingen ny beregning");
  assert.equal(hjemLeser!.result.zones[0]?.score, jaktLeser!.result.zones[0]?.score);
  assert.equal(hjemLeser!.result.zones[0]?.level, jaktLeser!.result.zones[0]?.level);
  assert.equal(hjemLeser!.result.zones[0]?.confidenceLevel, jaktLeser!.result.zones[0]?.confidenceLevel);
});

// ---------------------------------------------------------------------------
// V1.3 (§ cache-key): eksplisitt areal-/vær-/observasjon-/tid-kontekst.
// isSameAnalysisArea/isSameWeatherBucket eksporteres direkte for presise,
// isolerte enhetstester av selve sammenligningsreglene, i tillegg til
// integrasjonstestene under som går via get/set.
// ---------------------------------------------------------------------------

test("isSameAnalysisArea: gjenbruker EKSAKT samme hysterese som shouldReuseAnalysisAnchor — liten drift innenfor et anker regnes som samme areal", async () => {
  const { isSameAnalysisArea } = await import("./resultCache");
  const stored = { center: { latitude: 60, longitude: 10 }, radiusMeters: 5000 };
  const litenDrift = { center: { latitude: 60.001, longitude: 10 }, radiusMeters: 5000 }; // ~111 m — godt innenfor 0.4*5000=2000 m dead-zone
  assert.equal(isSameAnalysisArea(stored, litenDrift), true);
});

test("isSameAnalysisArea: reell forflytning til nytt område regnes IKKE som samme areal", async () => {
  const { isSameAnalysisArea } = await import("./resultCache");
  const stored = { center: { latitude: 60, longitude: 10 }, radiusMeters: 5000 };
  const langtUnna = { center: { latitude: 60.3, longitude: 10 }, radiusMeters: 5000 }; // ~33 km
  assert.equal(isSameAnalysisArea(stored, langtUnna), false);
});

test("isSameAnalysisArea: manglende areal på én av sidene er IKKE i seg selv en stale-grunn", async () => {
  const { isSameAnalysisArea } = await import("./resultCache");
  assert.equal(isSameAnalysisArea(null, { center: { latitude: 60, longitude: 10 }, radiusMeters: 5000 }), true);
  assert.equal(isSameAnalysisArea({ center: { latitude: 60, longitude: 10 }, radiusMeters: 5000 }, null), true);
});

test("isSameWeatherBucket: værmålinger innenfor samme grove bucket regnes som samme værsituasjon", async () => {
  const { isSameWeatherBucket } = await import("./resultCache");
  assert.equal(isSameWeatherBucket({ temperatureC: 5.2, windSpeedMs: 3.1 }, { temperatureC: 5.9, windSpeedMs: 3.4 }), true);
});

test("isSameWeatherBucket: en vesentlig endring i temperatur ELLER vind teller som en NY værsituasjon", async () => {
  const { isSameWeatherBucket } = await import("./resultCache");
  assert.equal(isSameWeatherBucket({ temperatureC: -2, windSpeedMs: 2 }, { temperatureC: 8, windSpeedMs: 2 }), false, "temperatursprang");
  assert.equal(isSameWeatherBucket({ temperatureC: 5, windSpeedMs: 1 }, { temperatureC: 5, windSpeedMs: 12 }), false, "vindsprang");
});

test("isSameWeatherBucket: manglende vær på én av sidene er IKKE i seg selv en stale-grunn (f.eks. en ren runEngine-oppføring)", async () => {
  const { isSameWeatherBucket } = await import("./resultCache");
  assert.equal(isSameWeatherBucket(null, { temperatureC: 5, windSpeedMs: 2 }), true);
});

// ---------------------------------------------------------------------------
// getCachedIntelligenceResult(species, maxAgeMs, requestContext) — den nye,
// valgfrie tredje parameteren. UTEN den (§ bakoverkompatibilitet) skal
// oppførselen være BYTE-FOR-BYTE identisk med FØR denne utvidelsen — se
// eksisterende tester over, som fortsatt kaller med 1-2 argumenter og
// fortsatt består uendret.
// ---------------------------------------------------------------------------

test("getCachedIntelligenceResult: uten requestContext ignoreres areal/vær/observasjonCount fullstendig (uendret gammel oppførsel)", () => {
  clearCachedIntelligenceResults();
  const result = engineResult();
  setCachedIntelligenceResult("hjort", result as never, true, {
    area: { center: { latitude: 60, longitude: 10 }, radiusMeters: 3000 },
    weather: { temperatureC: 5, windSpeedMs: 2 },
    observationCount: 4,
  });

  // Leseren spør uten kontekst i det hele tatt — akkurat som app/index.tsx og app/jakt.tsx gjør i dag.
  const cached = getCachedIntelligenceResult("hjort");
  assert.ok(cached, "manglende requestContext skal ALDRI alene gjøre en fersk oppføring stale");
  assert.equal(cached!.result, result);
});

test("getCachedIntelligenceResult: requestContext med samme areal/vær/observasjonCount/tidsbucket gir fortsatt treff", () => {
  clearCachedIntelligenceResults();
  const result = engineResult({ generatedAt: NOW });
  setCachedIntelligenceResult("hjort", result as never, true, {
    area: { center: { latitude: 60, longitude: 10 }, radiusMeters: 3000 },
    weather: { temperatureC: 5, windSpeedMs: 2 },
    observationCount: 4,
    targetTimeMs: NOW,
  });

  const cached = getCachedIntelligenceResult("hjort", 30 * 60_000, {
    area: { center: { latitude: 60.001, longitude: 10 }, radiusMeters: 3000 }, // ubetydelig drift
    weather: { temperatureC: 5.4, windSpeedMs: 2.2 }, // samme grove bucket
    observationCount: 4,
    targetTimeMs: NOW + 60_000, // 1 min senere, samme 30-min bucket
  });
  assert.ok(cached, "identisk (innenfor toleranse) kontekst skal fortsatt gi cache-treff");
});

test("getCachedIntelligenceResult: requestContext med et VESENTLIG annet areal gjør oppføringen stale (§ analysisArea, ALDRI viewport)", () => {
  clearCachedIntelligenceResults();
  const result = engineResult({ generatedAt: NOW });
  setCachedIntelligenceResult("hjort", result as never, true, {
    area: { center: { latitude: 60, longitude: 10 }, radiusMeters: 3000 },
    weather: null,
    observationCount: 0,
    targetTimeMs: NOW,
  });

  const cached = getCachedIntelligenceResult("hjort", 30 * 60_000, {
    area: { center: { latitude: 61, longitude: 12 }, radiusMeters: 3000 }, // et helt annet sted
    weather: null,
    observationCount: 0,
    targetTimeMs: NOW,
  });
  assert.equal(cached, null, "et resultat beregnet for ett areal skal ikke serveres for et vesentlig annet areal");
});

test("getCachedIntelligenceResult: requestContext med et VESENTLIG annet targetTimeMs gjør oppføringen stale (§ targetTimeBucket) selv om den er fersk (resolvedAt)", () => {
  clearCachedIntelligenceResults();
  const result = engineResult({ generatedAt: NOW });
  setCachedIntelligenceResult("hjort", result as never, true, {
    area: null,
    weather: null,
    observationCount: 0,
    targetTimeMs: NOW, // resultatet gjelder "nå" (10.aug 12:00)
  });

  // Forespørselen gjelder en HELT ANNEN målrettet analysetid (i morgen kl. 06) — selv om
  // oppføringen fortsatt er fersk (resolvedAt akkurat nå), er den beregnet for feil tidspunkt.
  const iMorgenTidlig = NOW + 18 * 3600000;
  const cached = getCachedIntelligenceResult("hjort", 30 * 60_000, {
    area: null,
    weather: null,
    observationCount: 0,
    targetTimeMs: iMorgenTidlig,
  });
  assert.equal(cached, null, "et resultat beregnet FOR nå skal ikke serveres som svar for en helt annen målrettet analysetid");
});

test("getCachedIntelligenceResult: requestContext med et annet observationCount gjør oppføringen stale (§ observationVersion)", () => {
  clearCachedIntelligenceResults();
  const result = engineResult({ generatedAt: NOW });
  setCachedIntelligenceResult("hjort", result as never, false, {
    area: null,
    weather: null,
    observationCount: 3,
    targetTimeMs: NOW,
  });

  const cached = getCachedIntelligenceResult("hjort", 30 * 60_000, {
    area: null,
    weather: null,
    observationCount: 4, // en ny observasjon kom inn siden Kart skrev
    targetTimeMs: NOW,
  });
  assert.equal(cached, null, "et endret antall input-observasjoner skal gjøre den cachede oppføringen stale");
});

test("setCachedIntelligenceResult: uten context-argument (§ bakoverkompatibilitet) — samme oppførsel som FØR denne utvidelsen for en enkel get() uten kontekst", () => {
  clearCachedIntelligenceResults();
  const result = engineResult();
  setCachedIntelligenceResult("elg", result as never, false); // ingen 4. argument, akkurat som app/index.tsx sitt eksisterende kall
  const cached = getCachedIntelligenceResult("elg");
  assert.ok(cached);
  assert.equal(cached!.result, result);
});
