import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const {
  buildCoarseSampleGrid,
  bilinearElevationAt,
  resolveEnvironmentContext,
  DEFAULT_SAMPLE_SPACING_METERS,
  DEFAULT_MAX_SAMPLE_POINTS,
} = await import("./resolve");
const { dynamicWeatherCache, roundedCoordKey } = await import("./cache");
const { runEngine } = await import("../engine");

// §35 (V1.1): maxSamplePoints er et HARDT tak på antall eksterne kall per
// resolveEnvironmentContext-kall — antallet skal ALDRI overskride taket,
// uansett analyseradius. Kvantifiseringsagentens revisjon fant empirisk at
// radius=5000/spacing=500/maxPoints=36 ga 49 faktiske punkter (ett enkelt
// sqrt-skaleringssteg + Math.ceil rundet tilbake over taket).

test("buildCoarseSampleGrid: overskrider ALDRI maxPoints, for et bredt utvalg radius/spacing/tak", () => {
  const cases: { radius: number; spacing: number; max: number }[] = [
    { radius: 5000, spacing: 500, max: 36 },
    { radius: 5000, spacing: 500, max: 20 },
    { radius: 1000, spacing: 100, max: 36 },
    { radius: 2000, spacing: 250, max: 50 },
    { radius: 10000, spacing: 500, max: 36 },
    { radius: 300, spacing: 500, max: 36 },
  ];
  for (const c of cases) {
    const { points } = buildCoarseSampleGrid({ latitude: 60, longitude: 10 }, c.radius, c.spacing, c.max);
    assert.ok(
      points.length <= c.max,
      `radius=${c.radius} spacing=${c.spacing} max=${c.max}: fikk ${points.length} punkter, forventet <= ${c.max}`
    );
  }
});

test("buildCoarseSampleGrid: har et absolutt gulv på 2×2=4 punkter (kan aldri gå under det, selv med et urealistisk lavt tak)", () => {
  const { points } = buildCoarseSampleGrid({ latitude: 60, longitude: 10 }, 5000, 500, 1);
  assert.equal(points.length, 4, "et 2×2-grid (4 punkter) er det minste gridet buildCoarseSampleGrid kan konstruere");
});

test("buildCoarseSampleGrid: dekker fortsatt hele det oppgitte området (punktene spenner minst ut til radiusen)", () => {
  const center = { latitude: 60, longitude: 10 };
  const { points } = buildCoarseSampleGrid(center, 5000, 500, 36);
  assert.ok(points.length >= 4, "for lite areal dekket med under 4 punkter");
  const lats = points.map((p) => p.latitude);
  const spanMeters = (Math.max(...lats) - Math.min(...lats)) * 111320;
  assert.ok(spanMeters > 5000, `forventet at prøvepunktene spenner over minst radiusen (fikk ${spanMeters.toFixed(0)} m)`);
});

// ===========================================================================
// V1.2 §1-3 (kritisk korrigering): prøvepunktavstand ved 5 km analyseradius
// skal være VESENTLIG bedre enn V1.1s ~2083 m — og kontinuerlige trekk
// (høyde) skal interpoleres GLATT mellom prøvepunktene, ikke platå-hoppe.
// ===========================================================================

test("Prøvepunktavstand ved 5 km analyseradius er nå vesentlig bedre enn V1.1s ~2083 m", () => {
  const center = { latitude: 60, longitude: 10 };
  const { points, rows, cols } = buildCoarseSampleGrid(
    center,
    5000,
    DEFAULT_SAMPLE_SPACING_METERS,
    DEFAULT_MAX_SAMPLE_POINTS
  );
  // Faktisk avstand mellom to nabopunkter i samme rad.
  const a = points[0];
  const b = points[1];
  const spacingMeters =
    Math.abs(a.latitude - b.latitude) * 111320 || Math.abs(a.longitude - b.longitude) * 111320 * Math.cos((60 * Math.PI) / 180);
  console.log(`  V1.2: ${rows}x${cols}=${points.length} prøvepunkter, faktisk nabospacing ≈ ${spacingMeters.toFixed(0)} m (V1.1: ~2083 m)`);
  assert.ok(
    spacingMeters < 1500,
    `forventet prøvepunktavstand godt under V1.1s ~2083 m ved 5 km radius (default maxSamplePoints=${DEFAULT_MAX_SAMPLE_POINTS}), fikk ${spacingMeters.toFixed(0)} m`
  );
});

test("bilinearElevationAt: gir en GLATT, kontinuerlig verdi mellom prøvepunktene — ikke et nearest-neighbor-platå", () => {
  const center = { latitude: 60, longitude: 10 };
  const grid = buildCoarseSampleGrid(center, 2000, 500, 36); // liten, kontrollerbar rutenett
  // Konstruer en enkel, KJENT høydegradient — høyde stiger jevnt med kolonne
  // (østover) — slik at vi vet den matematisk RIKTIGE interpolerte verdien
  // hvor som helst i gridet, og kan skille bilineær interpolasjon fra
  // nearest-neighbor (som ville gitt en av de diskrete prøveverdiene, aldri
  // noe imellom).
  const elevations = grid.points.map((_, i) => {
    const col = i % grid.cols;
    return col * 100; // 0, 100, 200, ... m — lineær i kolonneretning
  });

  // Midt mellom kolonne 0 og kolonne 1 i første rad — forventet interpolert høyde ≈ 50 m.
  const midtpunkt = {
    latitude: grid.startLat,
    longitude: grid.startLon + grid.lonStep * 0.5,
  };
  const interpolert = bilinearElevationAt(midtpunkt, grid, elevations);
  assert.ok(interpolert != null);
  assert.ok(
    Math.abs(interpolert - 50) < 1,
    `forventet interpolert høyde ≈50 m midt mellom to prøvepunkter med høyde 0 og 100, fikk ${interpolert}`
  );

  // Et sted 90% av veien mot neste prøvepunkt skal gi en tilsvarende høy verdi
  // (kontinuerlig, IKKE et hopp til nærmeste prøvepunkts diskrete verdi).
  const nesten = {
    latitude: grid.startLat,
    longitude: grid.startLon + grid.lonStep * 0.9,
  };
  const interpolertNesten = bilinearElevationAt(nesten, grid, elevations);
  assert.ok(interpolertNesten != null);
  assert.ok(
    Math.abs(interpolertNesten - 90) < 1,
    `forventet interpolert høyde ≈90 m ved 90% posisjon mellom 0 og 100, fikk ${interpolertNesten}`
  );

  // To punkter tett ved hverandre (10 m fra hverandre, godt innenfor ett
  // prøvepunkt-mellomrom) skal gi TYDELIG ulike interpolerte høyder —
  // beviser at verdien varierer kontinuerlig og ikke bare hopper mellom et
  // lite antall diskrete platå-nivåer slik nearest-neighbor ville gjort.
  const p1 = { latitude: grid.startLat, longitude: grid.startLon + grid.lonStep * 0.5 };
  const p2 = { latitude: grid.startLat, longitude: grid.startLon + grid.lonStep * 0.52 };
  const v1 = bilinearElevationAt(p1, grid, elevations);
  const v2 = bilinearElevationAt(p2, grid, elevations);
  assert.ok(v1 != null && v2 != null && v1 !== v2, `forventet at to nærliggende punkter gir ULIKE interpolerte verdier (glatt flate), fikk v1=${v1} v2=${v2}`);
});

test("bilinearElevationAt: faller tilbake til null (ikke krasj) hvis et av de fire hjørnene mangler høydedata", () => {
  const center = { latitude: 60, longitude: 10 };
  const grid = buildCoarseSampleGrid(center, 2000, 500, 36);
  const elevations: (number | null)[] = grid.points.map(() => null); // alle mangler
  const midtpunkt = { latitude: grid.startLat, longitude: grid.startLon + grid.lonStep * 0.5 };
  assert.equal(bilinearElevationAt(midtpunkt, grid, elevations), null);
});

// ===========================================================================
// V1.3 §Q: EngineDataQuality — resolveEnvironmentContext() skal rapportere
// per-kilde nettverksstatus på selve resolver-funksjonen (`.dataQuality`),
// UTEN å endre noen av de eksisterende fallback-VERDIENE (null/"ukjent"/
// tomme lister) selv når et oppslag feiler. Bevisst helt OFFLINE — global
// fetch() erstattes med en syntetisk implementasjon per test, aldri et ekte
// nettverkskall, se createFakeFetch() under.
//
// Hver test bruker et EGET, unikt senterpunkt — resolve.ts sine TTL-cacher
// (staticElevationCache osv., se cache.ts) er modulnivå-singletons som deles
// mellom ALLE tester i denne filen; gjenbrukte koordinater ville latt en
// senere tests cache-TREFF stille maskere hva som faktisk ble (forsøkt)
// hentet i den testen.
// ===========================================================================

type FakeFetchFailures = Partial<Record<"elevation" | "habitat" | "roads" | "water" | "weather", "reject" | "http-error">>;

/**
 * Syntetisk stand-in for global fetch(): ruter på URL-en til riktig kildes
 * "vellykkede" svarform (samme JSON/tekst-kontrakt som elevation.ts/
 * habitat.ts/roads.ts/water.ts/dynamic.ts sine ekte parsere forventer), med
 * mulighet til å simulere at ÉN navngitt kilde enten kaster (nettverksfeil/
 * timeout) eller svarer med `!res.ok` (HTTP-feil) — de to feilklassene
 * fetchXWithStatus()-funksjonene begge slår sammen til status "unavailable".
 * Vei og vann deler samme Overpass-URL — skilles på om spørreteksten
 * inneholder "highway" (vei) eller ikke (vann, "natural"-spørring).
 */
function createFakeFetch(failures: FakeFetchFailures = {}) {
  return async (
    input: unknown,
    _init?: unknown
  ): Promise<{ ok: boolean; json: () => Promise<unknown>; text: () => Promise<string> }> => {
    const url = String(input);
    const fail = (key: keyof FakeFetchFailures): { ok: boolean; json: () => Promise<unknown>; text: () => Promise<string> } | null => {
      if (failures[key] === "reject") throw new Error(`simulert nettverksfeil (${key})`);
      if (failures[key] === "http-error") return { ok: false, json: async () => ({}), text: async () => "" };
      return null;
    };

    if (url.includes("ws.geonorge.no")) {
      return fail("elevation") ?? { ok: true, json: async () => ({ punkter: [{ z: 42 }] }), text: async () => "" };
    }
    if (url.includes("wms.nibio.no")) {
      return (
        fail("habitat") ?? {
          ok: true,
          json: async () => ({}),
          text: async () => "<x><artype_beskrivelse>Skog</artype_beskrivelse></x>",
        }
      );
    }
    if (url.includes("overpass-api.de")) {
      const isRoads = url.includes("highway");
      return fail(isRoads ? "roads" : "water") ?? { ok: true, json: async () => ({ elements: [] }), text: async () => "" };
    }
    if (url.includes("api.open-meteo.com")) {
      return (
        fail("weather") ?? {
          ok: true,
          json: async () => ({
            current: { temperature_2m: 5, wind_speed_10m: 10, wind_direction_10m: 180, snow_depth: 0, precipitation: 0 },
            daily: { sunrise: ["2026-08-19T05:00:00.000Z"], sunset: ["2026-08-19T20:00:00.000Z"] },
          }),
          text: async () => "",
        }
      );
    }
    throw new Error(`uventet URL i fake fetch: ${url}`);
  };
}

async function withFakeFetch<T>(failures: FakeFetchFailures, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  // @ts-expect-error — testdobbelen dekker kun de metodene resolve.ts-kjeden faktisk bruker (ok/json/text), ikke hele Fetch-kontrakten.
  globalThis.fetch = createFakeFetch(failures);
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("resolveEnvironmentContext: alle kilder rapporterer 'available' når alt lykkes", async () => {
  const center = { latitude: 61.0, longitude: 9.0 };
  await withFakeFetch({}, async () => {
    const resolver = await resolveEnvironmentContext(center, 500, { maxSamplePoints: 1 });
    assert.deepEqual(resolver.dataQuality, {
      elevation: "available",
      habitat: "available",
      roads: "available",
      water: "available",
      weather: "available",
    });
  });
});

test("resolveEnvironmentContext: én kilde som feiler HELT rapporteres 'unavailable', andre kilder er upåvirket (isolasjon)", async () => {
  const center = { latitude: 61.5, longitude: 9.5 };
  await withFakeFetch({ habitat: "reject" }, async () => {
    const resolver = await resolveEnvironmentContext(center, 500, { maxSamplePoints: 1 });
    assert.deepEqual(resolver.dataQuality, {
      elevation: "available",
      habitat: "unavailable",
      roads: "available",
      water: "available",
      weather: "available",
    });

    const ctx = resolver(center);
    // Fallback-VERDIEN er UENDRET fra før V1.3 — "ukjent", aldri noe annet,
    // uansett hva statusfeltet sier (§Q: dette er en OBSERVASJON, ikke en
    // ny scoringsregel).
    assert.equal(ctx.static.habitat, "ukjent");
    // Elevation er en UAVHENGIG kilde — habitat-feilen skal ikke smitte over
    // på et helt annet trekk.
    assert.equal(ctx.static.elevationMeters, 42);
  });
});

test("resolveEnvironmentContext: mislykket vei-oppslag ('unavailable') degraderer til NØYAKTIG samme roadDistanceMeters=null som et vellykket-men-tomt oppslag — statusfeltet er eneste forskjell", async () => {
  const centerOk = { latitude: 62.0, longitude: 8.0 };
  const centerFail = { latitude: 63.0, longitude: 8.0 };

  const okCtx = await withFakeFetch({}, async () => {
    const resolver = await resolveEnvironmentContext(centerOk, 500, { maxSamplePoints: 1 });
    assert.equal(resolver.dataQuality?.roads, "available");
    return resolver(centerOk);
  });

  const failCtx = await withFakeFetch({ roads: "reject" }, async () => {
    const resolver = await resolveEnvironmentContext(centerFail, 500, { maxSamplePoints: 1 });
    assert.equal(resolver.dataQuality?.roads, "unavailable");
    return resolver(centerFail);
  });

  // §Q sin kjernepåstand: en feilet vei-oppslag skal ALDRI tolkes som "ingen
  // vei i nærheten" — begge scenarioene gir samme null, kun status skiller dem.
  assert.equal(okCtx.static.roadDistanceMeters, null);
  assert.equal(failCtx.static.roadDistanceMeters, null);
});

test("resolveEnvironmentContext: HTTP-feilsvar (ikke bare kastede nettverksfeil) rapporteres også 'unavailable'", async () => {
  const center = { latitude: 64.5, longitude: 8.5 };
  await withFakeFetch({ elevation: "http-error" }, async () => {
    const resolver = await resolveEnvironmentContext(center, 500, { maxSamplePoints: 1 });
    assert.equal(resolver.dataQuality?.elevation, "unavailable");
    assert.equal(resolver.dataQuality?.habitat, "available");
  });
});

test("resolveEnvironmentContext: vær servert fra en cache NÆR utløp rapporteres 'stale', ikke 'available' — og trigger IKKE et nytt nettverkskall", async () => {
  const center = { latitude: 65.0, longitude: 8.0 };
  const key = roundedCoordKey(center);
  const cachedWeather = {
    temperatureC: -2,
    windSpeedMs: 3,
    windDirectionDeg: 90,
    snowDepthMeters: 0.1,
    precipitationMm: 0,
    sunriseMs: null,
    sunsetMs: null,
  };
  // Vær-cachens TTL er 30 min (cache.ts); resolve.ts sin WEATHER_STALE_AFTER_MS
  // er 20 min — en oppføring "satt" 25 min tilbake er fortsatt gyldig (ikke
  // utløpt), men SKAL rapporteres "stale". nowMs-parameteren finnes KUN for
  // at tester skal kunne simulere dette uten en faktisk 25 minutters ventetid.
  dynamicWeatherCache.set(key, cachedWeather, Date.now() - 25 * 60000);

  let weatherFetchWasCalled = false;
  const original = globalThis.fetch;
  // @ts-expect-error — se withFakeFetch() over for hvorfor testdobbelen ikke dekker hele Fetch-kontrakten.
  globalThis.fetch = async (input: unknown, init?: unknown) => {
    if (String(input).includes("api.open-meteo.com")) weatherFetchWasCalled = true;
    return createFakeFetch()(input, init as never);
  };
  try {
    const resolver = await resolveEnvironmentContext(center, 500, { maxSamplePoints: 1 });
    assert.equal(resolver.dataQuality?.weather, "stale");
    assert.equal(weatherFetchWasCalled, false, "et gyldig (ikke utløpt) cache-treff skal brukes direkte, ikke trigge et nytt kall");
  } finally {
    globalThis.fetch = original;
  }
});

test("resolveEnvironmentContext: FERSK vær-cache (godt innenfor stale-terskelen) rapporteres fortsatt 'available'", async () => {
  const center = { latitude: 66.0, longitude: 8.0 };
  const key = roundedCoordKey(center);
  const cachedWeather = {
    temperatureC: 1,
    windSpeedMs: 2,
    windDirectionDeg: 270,
    snowDepthMeters: 0,
    precipitationMm: 0,
    sunriseMs: null,
    sunsetMs: null,
  };
  // 2 minutter gammel — godt under 20-minutters stale-terskelen.
  dynamicWeatherCache.set(key, cachedWeather, Date.now() - 2 * 60000);
  await withFakeFetch({}, async () => {
    const resolver = await resolveEnvironmentContext(center, 500, { maxSamplePoints: 1 });
    assert.equal(resolver.dataQuality?.weather, "available");
  });
});

test("runEngine(): ingen miljøresolver i det hele tatt → EngineResult.dataQuality er undefined (ikke 'fallback' per kilde — det finnes ingen kilder å ha status for)", () => {
  const result = runEngine([], "hjort", { now: Date.now() });
  assert.equal(result.dataQuality, undefined);
});
