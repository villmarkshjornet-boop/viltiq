// ViltIQ Engine — delt, prosess-levetid cache for SISTE fulle motorresultat
// per art. Skrevet av Kart (som har posisjon + kan løse miljøkontekst), lest
// SYNKRONT av Hjem/Jakt slik at de kan vise "samme Intelligence Map-resultat"
// (§20/§25 i V1.2-oppdraget) uten selv å kalle nettverket — se app/index.tsx
// sin eksisterende "Hjem skal aldri vente på nettverk"-begrunnelse, som denne
// cachen bevarer uendret: leserne faller tilbake til sin egen raske,
// nettverksfrie runEngine()-beregning hvis ingenting (ferskt) er cachet ennå.
//
// Bevisst IKKE React Context/global store: et modul-nivå-singleton er nok
// siden Expo Router kjører én JS-runtime på tvers av skjermer, og leserne
// trenger kun en synkron øyeblikksverdi ved fokus, ikke live reaktivitet
// mens Kart står åpent samtidig — mobil viser uansett bare én skjerm om
// gangen. Ren, testbar, ingen Firestore/IO her (matcher resten av src/engine/).
//
// V1.3 (§ "cache-key"): en oppføring var opprinnelig KUN ferskhets-sjekket
// på alder (maxAgeMs, fast 30 min) — den visste ingenting om HVILKET areal,
// HVILKEN værsituasjon eller HVILKEN motorkonfigurasjon resultatet faktisk
// stammer fra. Det fungerte i praksis fordi Kart skriver ofte, men er ikke
// en ekte "er dette resultatet fortsatt gyldig for DENNE forespørselen"-
// sjekk. Cache-nøkkelen er nå eksplisitt og dokumentert langs disse aksene:
//   - species            (uendret — selve Map-nøkkelen)
//   - analysisArea       (senter+radius — se IntelligenceCacheContext.area)
//   - targetTimeBucket   (hvilket TIDSPUNKT analysen gjelder FOR, avledet av
//                          EngineResult.generatedAt — IKKE når den ble cachet)
//   - weatherVersion     (grov bucket av temperatur/vind — se WeatherSnapshot)
//   - engineConfigVersion/environmentVersion (CONFIG_VERSION m.fl. fra config.ts)
//   - observationVersion (antall observasjoner motoren fikk som input)
// BEVISST ALDRI: kartets rå viewport — se src/lib/analysisAnchor.ts sin
// filkommentar for hvorfor viewport aldri skal styre hva som analyseres/
// cachelagres, kun presentasjonen av et allerede låst analyseanker.
//
// Bakoverkompatibilitet: BEGGE nye parametre (context på set, requestContext
// på get) er valgfrie. Eksisterende kallere (app/index.tsx, app/jakt.tsx) som
// ikke sender dem, får UENDRET oppførsel (ren alder+konfigversjon-sjekk) —
// se test-filen for et eksplisitt regresjonsbevis på dette.

import { shouldReuseAnalysisAnchor } from "@/src/lib/analysisAnchor";
import type { LatLng } from "./types";
import type { EngineResult, Species } from "./types";
import { CONFIG_VERSION, ECOLOGY_MODEL_VERSION, ENVIRONMENT_SCHEMA_VERSION, SPECIES_PROFILE_VERSION } from "./config";

export type CachedIntelligenceResult = {
  result: EngineResult;
  /** true hvis result kom fra runEcologicalEngine (miljølag/økologisk prior brukt), false hvis ren observasjonsmotor. */
  ecological: boolean;
  resolvedAt: number;
};

/** Analyseområdet (senter+radius) et resultat faktisk dekker — se AnalysisAnchor i src/lib/analysisAnchor.ts. ALDRI kartets rå viewport. */
export type IntelligenceCacheArea = { center: LatLng; radiusMeters: number };

/** Grov værmåling (rå tall, IKKE forhåndsbucket-et — bucketing skjer i isSameWeatherBucket) brukt til å avgjøre om værsituasjonen har endret seg VESENTLIG siden resultatet ble cachet. */
export type IntelligenceCacheWeather = { temperatureC: number | null; windSpeedMs: number | null };

/**
 * Konteksten en gitt motorkjøring faktisk ble gjort i/for — dette ER den
 * dokumenterte cache-nøkkelen (utover selve arten, som fortsatt er Map-
 * nøkkelen i seg selv, se `cache` under). Alle felt er valgfrie/nullbare på
 * en måte som gjør "jeg vet ikke" til "ikke i seg selv en stale-grunn" (se
 * hver sammenligningsfunksjon under) — en manglende verdi skal ALDRI alene
 * tvinge fram en unødvendig ny motorkjøring.
 */
export type IntelligenceCacheContext = {
  /** null for et resultat uten definert analyseareal (bør i praksis ikke forekomme, men holder typen ærlig for ren runEngine() uten areaOfInterest). */
  area: IntelligenceCacheArea | null;
  /** null for en ren runEngine()-kjøring uten miljølag (ingen vær var involvert i scoringen). */
  weather: IntelligenceCacheWeather | null;
  /** Antall (normaliserte) observasjoner motoren fikk som input for DENNE kjøringen — en enkel, dokumentert proxy for "har datagrunnlaget endret seg" (observationVersion), IKKE en full hash av hver observasjon. */
  observationCount: number;
  /** Tidspunktet ANALYSEN faktisk gjelder FOR (targetTimeBucket) — IKKE når den ble cachet. Default = result.generatedAt på set, Date.now() på get (matcher runEngine/runEcologicalEngine sin egen `now`-default, se engine.ts RunEngineOptions.now). */
  targetTimeMs?: number;
};

type CachedVersions = {
  engineConfigVersion: string;
  environmentSchemaVersion: string;
  ecologyModelVersion: string;
  speciesProfileVersion: string;
};

type StoredContext = {
  area: IntelligenceCacheArea | null;
  weather: IntelligenceCacheWeather | null;
  observationCount: number;
  targetTimeMs: number;
};

type CacheEntry = CachedIntelligenceResult & {
  context: StoredContext;
  versions: CachedVersions;
};

const cache = new Map<Species, CacheEntry>();

/** Bucket-størrelse for targetTimeBucket — samme størrelsesorden som den eksisterende default maxAgeMs (30 min) og vær-cachens egen "stale etter"-terskel (20 min, se environment/cache.ts) — grovt nok til å ikke re-trigge på hvert sekund, fint nok til å skille "nå" fra en reelt annen målrettet analysetid (§3 i motoroppdraget om targetDateTime). */
const TIME_BUCKET_MS = 30 * 60_000;
/** Bucket-størrelse for temperatur (°C) — se isSameWeatherBucket. */
const TEMPERATURE_BUCKET_C = 2;
/** Bucket-størrelse for vindstyrke (m/s) — se isSameWeatherBucket. */
const WIND_BUCKET_MS = 2;

function timeBucket(whenMs: number): number {
  return Math.floor(whenMs / TIME_BUCKET_MS);
}

/**
 * Er de to analyseområdene "samme sted" nok til at et cachet resultat for
 * `stored` fortsatt kan gjenbrukes for `request`? Gjenbruker BEVISST samme
 * geografiske hysterese-regel som kartets eget analyseanker
 * (src/lib/analysisAnchor.ts sin shouldReuseAnalysisAnchor) i stedet for en
 * egen, parallell avstandsterskel — dette er nøyaktig samme spørsmål
 * ("er dette fortsatt samme analyseområde"), bare stilt av cache-laget i
 * stedet for kartets egen anker-effekt. `stored` spiller rollen som det
 * eksisterende, låste ankeret; `request` er kandidaten.
 */
export function isSameAnalysisArea(stored: IntelligenceCacheArea | null, request: IntelligenceCacheArea | null): boolean {
  if (!stored || !request) return true; // manglende areal på én av sidene er ikke i seg selv en stale-grunn
  return shouldReuseAnalysisAnchor(stored, request.center, request.radiusMeters);
}

function bucketOrNull(value: number | null, size: number): number | null {
  return value == null ? null : Math.round(value / size);
}

/**
 * Er værsituasjonen "samme" nok (grovt bucket-et, IKKE bit-eksakt — vær er
 * aldri identisk mellom to oppslag et par minutter fra hverandre, se
 * environment/resolve.ts sin egen "stale etter 20 min"-tankegang for samme
 * type avveining) til at et cachet resultat fortsatt kan gjenbrukes?
 */
export function isSameWeatherBucket(stored: IntelligenceCacheWeather | null, request: IntelligenceCacheWeather | null): boolean {
  if (!stored || !request) return true; // manglende vær på én av sidene er ikke i seg selv en stale-grunn
  return (
    bucketOrNull(stored.temperatureC, TEMPERATURE_BUCKET_C) === bucketOrNull(request.temperatureC, TEMPERATURE_BUCKET_C) &&
    bucketOrNull(stored.windSpeedMs, WIND_BUCKET_MS) === bucketOrNull(request.windSpeedMs, WIND_BUCKET_MS)
  );
}

function isSameAnalysisContext(stored: StoredContext, request: IntelligenceCacheContext): boolean {
  if (!isSameAnalysisArea(stored.area, request.area)) return false;
  if (!isSameWeatherBucket(stored.weather, request.weather)) return false;
  if (stored.observationCount !== request.observationCount) return false;
  if (timeBucket(stored.targetTimeMs) !== timeBucket(request.targetTimeMs ?? Date.now())) return false;
  return true;
}

function currentVersions(): CachedVersions {
  return {
    engineConfigVersion: CONFIG_VERSION,
    environmentSchemaVersion: ENVIRONMENT_SCHEMA_VERSION,
    ecologyModelVersion: ECOLOGY_MODEL_VERSION,
    speciesProfileVersion: SPECIES_PROFILE_VERSION,
  };
}

function sameVersions(a: CachedVersions, b: CachedVersions): boolean {
  return (
    a.engineConfigVersion === b.engineConfigVersion &&
    a.environmentSchemaVersion === b.environmentSchemaVersion &&
    a.ecologyModelVersion === b.ecologyModelVersion &&
    a.speciesProfileVersion === b.speciesProfileVersion
  );
}

/**
 * Kalt av Kart hver gang den har et ferdig, ferskt EngineResult for en art.
 * `context` er valgfri (§ bakoverkompatibilitet) — uteblir den, lagres
 * ingen areal-/vær-/observasjonskontekst, og oppføringen oppfører seg som
 * FØR denne utvidelsen (ren alder+konfigversjon-sjekk på lesesiden).
 */
export function setCachedIntelligenceResult(
  species: Species,
  result: EngineResult,
  ecological: boolean,
  context: IntelligenceCacheContext = { area: null, weather: null, observationCount: result.observationsConsidered }
): void {
  cache.set(species, {
    result,
    ecological,
    resolvedAt: Date.now(),
    context: {
      area: context.area,
      weather: context.weather,
      observationCount: context.observationCount,
      targetTimeMs: context.targetTimeMs ?? result.generatedAt,
    },
    versions: currentVersions(),
  });
}

/**
 * Lest av Hjem/Jakt. Returnerer null hvis intet er cachet ennå, hvis det
 * cachede resultatet er eldre enn `maxAgeMs` (uendret default-oppførsel,
 * 30 min — samme størrelsesorden som miljøets egen dynamiske værcache,
 * cache.ts sin dynamicWeatherCache), ELLER hvis motor-/miljøversjonen har
 * endret seg siden resultatet ble cachet (§ engineConfigVersion/
 * environmentVersion — beskytter mot en oppføring fra FØR en hot-reload
 * bumpet en kalibreringskonstant, sjekkes alltid, uavhengig av
 * `requestContext`). Sender kalleren i tillegg `requestContext` (§ areal/
 * vær/observationCount/targetTimeBucket), sjekkes disse OGSÅ — men KUN da,
 * slik at eksisterende kallere uten `requestContext` beholder nøyaktig sin
 * gamle oppførsel. Kalleren skal ved null alltid falle tilbake til sin egen
 * uendrede runEngine()-beregning, ALDRI selv trigge et nytt miljøoppslag
 * (det ville brutt "aldri vent på nettverk"-prinsippet).
 */
export function getCachedIntelligenceResult(
  species: Species,
  maxAgeMs = 30 * 60_000,
  requestContext?: IntelligenceCacheContext
): CachedIntelligenceResult | null {
  const entry = cache.get(species);
  if (!entry) return null;
  if (Date.now() - entry.resolvedAt > maxAgeMs) return null;
  if (!sameVersions(entry.versions, currentVersions())) return null;
  if (requestContext && !isSameAnalysisContext(entry.context, requestContext)) return null;
  return entry;
}

/** Kun til testing — nullstiller cachen mellom testtilfeller. */
export function clearCachedIntelligenceResults(): void {
  cache.clear();
}
