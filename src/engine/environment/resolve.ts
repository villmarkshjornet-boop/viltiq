// ViltIQ Engine — miljø-orkestrering: bygger et prøvepunkt-grid over
// analyseområdet, henter statiske trekk (høyde/habitat/vei) per prøvepunkt
// OG én dynamisk værmåling for hele området, og returnerer en ferdig
// EnvironmentResolver den rene scoringsmotoren kan slå opp i synkront.
//
// Ytelse (§26/§42): antall eksterne kall er bundet av ANTALL PRØVEPUNKTER
// (maxSamplePoints), UANSETT hvor fin den faktiske scoring-gridoppløsningen
// i grid.ts er — finere celler slår kun opp allerede-hentede prøvepunkt
// (nearest-neighbor for kategoriske trekk, bilineær interpolasjon for
// kontinuerlige), ingen ekstra nettverkskall. Vei og vær hentes med ÉTT kall
// hver for HELE området, ikke ett per punkt.
//
// V1.2-KORRIGERING (§1-3 i motor-oppdraget): maxSamplePoints=36 ga ved 5 km
// analyseradius (kartets faktiske maks) en prøvepunktavstand på ~2083 m —
// scoring-gridet på ~150 m ga da en FALSK følelse av geografisk presisjon,
// siden nearestSample() i praksis kopierte samme miljøverdi til enorme
// områder. To uavhengige tiltak retter dette, brukt SAMMEN (ikke bare ett):
//  1. maxSamplePoints hevet til 100 — halverer prøvepunktavstanden uten å
//     mangedoble antall eksterne kall (elevation/habitat er ubatchede
//     enkeltpunkt-kall; 100 er en bevisst avveining, målt i quantification-
//     testene og V1.2-sluttrapporten, ikke en gjetning).
//  2. Kontinuerlige trekk (høyde/relativ høyde) bilineær-interpoleres mellom
//     de fire nærmeste prøvepunktene i stedet for nearest-neighbor — gir en
//     glatt høydeflate selv med samme rå prøvetetthet. Kategoriske trekk
//     (habitat) er BEVISST fortsatt nearest-neighbor — semantisk feil å
//     interpolere "skog" og "jordbruk" som om de var tall på en skala.

import { distanceMeters } from "@/src/lib/geo";
import type { DataSourceStatus, EngineDataQuality, LatLng } from "../types";
import {
  dynamicWeatherCache,
  staticElevationCache,
  staticHabitatCache,
  staticRoadsCache,
  staticWaterCache,
  roundedCoordKey,
} from "./cache";
import { fetchDynamicEnvironmentWithStatus } from "./dynamic";
import { fetchElevationMetersWithStatus } from "./elevation";
import { fetchHabitatClassWithStatus } from "./habitat";
import { distanceToNearestRoadMeters, fetchRoadsNearWithStatus } from "./roads";
import { determineWaterStatusFromOsm, fetchWaterFeaturesNearWithStatus, EMPTY_WATER_FEATURES, type WaterFeatures } from "./water";
import {
  UKJENT_STATIC_FEATURES,
  type DynamicEnvironmentalFeatures,
  type EnvironmentResolver,
  type HabitatClass,
  type SpatialValidity,
  type StaticEnvironmentalFeatures,
} from "./types";

export type ResolveEnvironmentOptions = {
  /** Avstand (m) mellom prøvepunkter FØR maxSamplePoints ev. tvinger den opp. Default 500 m. */
  sampleSpacingMeters?: number;
  /** Hardt tak på antall prøvepunkter, uavhengig av områdets størrelse. Default DEFAULT_MAX_SAMPLE_POINTS (V1.2, hevet fra 36 — se filkommentar). */
  maxSamplePoints?: number;
};

/** Eksportert (ikke bare en inline-default) slik at tester/diagnostikk kan lese den faktiske verdien i stedet for å risikere en utdatert kopi. */
export const DEFAULT_SAMPLE_SPACING_METERS = 500;
/** V1.2: hevet fra 36 — se filkommentaren øverst for begrunnelsen (§1-3 i motoroppdraget). */
export const DEFAULT_MAX_SAMPLE_POINTS = 100;

type Sample = { point: LatLng; row: number; col: number; features: StaticEnvironmentalFeatures };

/**
 * V1.3 (§Q): teller nettverksFORSØK/-suksesser for en kilde som hentes PER
 * PRØVEPUNKT (høyde/habitat — én av disse per prøvepunkt i gridet, se
 * Promise.all under). Et cache-treff er BEVISST IKKE et "forsøk" her — en
 * gyldig (ikke utløpt) 7-dagers-cachet verdi er per definisjon tilgjengelig
 * data for terreng som praktisk talt aldri endrer seg (cache.ts sin
 * filkommentar), ikke noe som trenger et nytt nettverksforsøk for å telle
 * som "available". Se statusFromTracker() under for aggregeringsregelen.
 */
type AttemptTracker = { attempts: number; successes: number };

function createAttemptTracker(): AttemptTracker {
  return { attempts: 0, successes: 0 };
}

/**
 * V1.3 (§Q): aggregerer et prøvepunkt-vis AttemptTracker til ÉN kildestatus
 * for hele motorkjøringen (elevation/habitat henter ett tall PER prøvepunkt,
 * men EngineDataQuality har kun én status per kilde). Regelen er BEVISST
 * "minst ett vellykket forsøk holder kilden tilgjengelig", ikke "alle forsøk
 * må lykkes": et par tapte enkeltpunkter (f.eks. treg respons for én av 100
 * koordinater) er normal nettverksstøy og skal ikke maskeres som at HELE
 * kilden er nede, mens null suksesser blant faktiske forsøk (nøyaktig
 * V1.2.2-406-scenarioet, der ALLE kall til Overpass feilet) tydelig SKAL
 * rapporteres som "unavailable" — §Q: en feilet oppslag skal aldri tolkes
 * som "ingen data der ute", verken for én prøve eller for alle.
 */
function statusFromTracker(tracker: AttemptTracker): DataSourceStatus {
  if (tracker.attempts === 0) return "available"; // rent cache-treff (eller ingen nye forsøk trengtes) — se AttemptTracker sin doc-kommentar
  return tracker.successes > 0 ? "available" : "unavailable";
}

async function cachedElevation(point: LatLng, tracker: AttemptTracker): Promise<number | null> {
  const key = roundedCoordKey(point);
  const cached = staticElevationCache.get(key);
  if (cached !== undefined) return cached;
  const { value, status } = await fetchElevationMetersWithStatus(point);
  tracker.attempts += 1;
  if (status === "available") tracker.successes += 1;
  staticElevationCache.set(key, value);
  return value;
}

async function cachedHabitat(point: LatLng, tracker: AttemptTracker): Promise<HabitatClass> {
  const key = roundedCoordKey(point);
  const cached = staticHabitatCache.get(key);
  if (cached !== undefined) return cached as HabitatClass;
  const { value, status } = await fetchHabitatClassWithStatus(point);
  tracker.attempts += 1;
  if (status === "available") tracker.successes += 1;
  staticHabitatCache.set(key, value);
  return value;
}

/** Vei er like statisk som høyde/habitat, men er ett kall for HELE området — nøkkelen må derfor inkludere radius, ikke bare senterpunktet. */
async function cachedRoads(center: LatLng, radiusMeters: number): Promise<{ roads: LatLng[][]; status: DataSourceStatus }> {
  const key = `${roundedCoordKey(center)}:${Math.round(radiusMeters)}`;
  const cached = staticRoadsCache.get(key) as LatLng[][] | undefined;
  if (cached !== undefined) return { roads: cached, status: "available" };
  const { value, status } = await fetchRoadsNearWithStatus(center, radiusMeters);
  staticRoadsCache.set(key, value);
  return { roads: value, status };
}

/**
 * V1.2.2: vann-/kystlinjegeometri, ETT kall for HELE analyseområdet — samme
 * mønster som cachedRoads over. Dette er den PRIMÆRE, uavhengige
 * vann-datakilden (se water.ts sin filkommentar for hvorfor den erstattet
 * det grove habitat-prøvegridet som eneste kilde i V1.2.1).
 */
async function cachedWaterFeatures(
  center: LatLng,
  radiusMeters: number
): Promise<{ features: WaterFeatures; status: DataSourceStatus }> {
  const key = `${roundedCoordKey(center)}:${Math.round(radiusMeters)}`;
  const cached = staticWaterCache.get(key) as WaterFeatures | undefined;
  if (cached !== undefined) return { features: cached, status: "available" };
  const { value, status } = await fetchWaterFeaturesNearWithStatus(center, radiusMeters);
  staticWaterCache.set(key, value);
  return { features: value, status };
}

/**
 * V1.3 (§Q/§R): en gyldig cache-treff regnes "stale" når den er hentet nær
 * enden av vær-cachens 30-minutters levetid (cache.ts) — vær er den ENESTE
 * kilden dette gjelder for (§R: "kun der det gir mening"); statiske kilder
 * (høyde/habitat/vei/vann) har INGEN meningsfull "stale", se cachedElevation
 * m.fl. over, som aldri rapporterer noe annet enn "available"/"unavailable".
 * 20 min (2/3 av TTL-en) er bevisst IKKE terskelen for når cachen faktisk
 * slettes (det er fortsatt 30 min, TtlCache sin egen levetid) — det er
 * terskelen for når en ellers gyldig cachet værmåling er gammel nok til at
 * brukeren bør få vite at den ikke lenger er "fersk fra nå av".
 */
const WEATHER_STALE_AFTER_MS = 20 * 60000;

/** Vær endrer seg time for time (§43) — kort levetid, men fortsatt verdt å cache mot rask re-panorering/skjermbytte innenfor samme værvindu. */
async function cachedDynamicEnvironment(
  center: LatLng
): Promise<{ features: DynamicEnvironmentalFeatures; status: DataSourceStatus }> {
  const key = roundedCoordKey(center);
  const cached = dynamicWeatherCache.getWithAge(key);
  if (cached !== undefined) {
    const status: DataSourceStatus = cached.ageMs >= WEATHER_STALE_AFTER_MS ? "stale" : "available";
    return { features: cached.value as DynamicEnvironmentalFeatures, status };
  }
  const { value, status } = await fetchDynamicEnvironmentWithStatus(center);
  dynamicWeatherCache.set(key, value);
  return { features: value, status };
}

export type SampleGrid = {
  points: LatLng[];
  rows: number;
  cols: number;
  /** Rutenettets geometri — eksponert slik at bilineær interpolasjon kan regne fraksjonell rad/kolonne for et vilkårlig punkt uten et nytt søk. */
  startLat: number;
  startLon: number;
  latStep: number;
  lonStep: number;
};

export function buildCoarseSampleGrid(
  center: LatLng,
  radiusMeters: number,
  spacingMeters: number,
  maxPoints: number
): SampleGrid {
  // Ett enkelt sqrt-skaleringssteg er IKKE garantert å treffe under maxPoints
  // — Math.ceil etter skaleringen kan runde antall punkter opp over taket
  // igjen (funnet empirisk: 36-tak ga 49 faktiske punkter). Løkken gjentar
  // skaleringen til taket faktisk holder — §35 krever et HARDT tak på antall
  // eksterne kall, ikke en tilnærming.
  let spacing = spacingMeters;
  let sideCount = Math.max(1, Math.ceil((radiusMeters * 2) / spacing));
  let guard = 0;
  while ((sideCount + 1) ** 2 > maxPoints && guard < 10) {
    const scale = Math.sqrt((sideCount + 1) ** 2 / maxPoints);
    spacing *= scale * 1.01; // liten margin mot at neste Math.ceil runder rett tilbake over taket
    sideCount = Math.max(1, Math.ceil((radiusMeters * 2) / spacing));
    guard += 1;
  }
  const cols = sideCount + 1;
  const rows = sideCount + 1;

  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((center.latitude * Math.PI) / 180) || 1;
  const latStep = spacing / metersPerDegLat;
  const lonStep = spacing / metersPerDegLon;

  const points: LatLng[] = [];
  const startLat = center.latitude - (latStep * (rows - 1)) / 2;
  const startLon = center.longitude - (lonStep * (cols - 1)) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({ latitude: startLat + r * latStep, longitude: startLon + c * lonStep });
    }
  }
  return { points, rows, cols, startLat, startLon, latStep, lonStep };
}

/** Grov helning/aspekt fra naboprøvepunktenes høyde i det samme gridet — ingen ekstra API-kall. */
function estimateSlopeAspect(
  row: number,
  col: number,
  rows: number,
  cols: number,
  elevations: readonly (number | null)[],
  spacingMeters: number
): { slopeDegrees: number | null; aspectDeg: number | null } {
  const at = (r: number, c: number): number | null =>
    r >= 0 && r < rows && c >= 0 && c < cols ? elevations[r * cols + c] : null;

  const east = at(row, col + 1);
  const west = at(row, col - 1);
  const north = at(row - 1, col);
  const south = at(row + 1, col);

  if (east == null || west == null || north == null || south == null) {
    return { slopeDegrees: null, aspectDeg: null };
  }

  const gradEast = (east - west) / (2 * spacingMeters);
  const gradNorth = (north - south) / (2 * spacingMeters);
  const gradMagnitude = Math.sqrt(gradEast * gradEast + gradNorth * gradNorth);
  const slopeDegrees = (Math.atan(gradMagnitude) * 180) / Math.PI;

  if (gradMagnitude < 1e-6) return { slopeDegrees: 0, aspectDeg: null };

  // Nedoverbakke-retning (den siden skråningen "vender") — motsatt av gradienten, som peker oppover.
  const aspectRad = Math.atan2(-gradEast, -gradNorth);
  const aspectDeg = ((aspectRad * 180) / Math.PI + 360) % 360;
  return { slopeDegrees, aspectDeg };
}

/** Grov kantsone-proxy (§M): skiller habitatklassen seg fra minst én nabo i gridet? Ingen ekstra API-kall. */
function estimateNearHabitatEdge(
  row: number,
  col: number,
  rows: number,
  cols: number,
  habitats: readonly HabitatClass[]
): boolean {
  const at = (r: number, c: number): HabitatClass | null =>
    r >= 0 && r < rows && c >= 0 && c < cols ? habitats[r * cols + c] : null;
  const self = at(row, col);
  if (self == null || self === "ukjent") return false;
  const neighbors = [at(row, col - 1), at(row, col + 1), at(row - 1, col), at(row + 1, col)];
  return neighbors.some((n) => n != null && n !== "ukjent" && n !== self);
}

function nearestSample(point: LatLng, samples: readonly Sample[]): Sample | null {
  let best: Sample | null = null;
  let bestDist = Infinity;
  for (const s of samples) {
    const d = distanceMeters(point, s.point);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/**
 * Avstand (m) til nærmeste prøvepunkt som selv ble klassifisert som "vann" —
 * `null` hvis ingen av prøvepunktene i det hele tatt er vann. Ett enkelt
 * lineært søk til (samme kostnad som nearestSample over), gjenbruker
 * INGEN nye API-kall — kun de habitat-oppslagene som allerede er hentet.
 */
function nearestWaterDistance(point: LatLng, samples: readonly Sample[]): number | null {
  let best: number | null = null;
  for (const s of samples) {
    if (s.features.habitat !== "vann") continue;
    const d = distanceMeters(point, s.point);
    if (best == null || d < best) best = d;
  }
  return best;
}

/**
 * Spatial validity — V1.2.2 ROOT CAUSE-KORRIGERING (Kristiansand-regresjonen):
 * V1.2.1 bygget DENNE avgjørelsen utelukkende på det grove habitat-
 * prøvegridet (§ under, "habitatBasertForsiktighetsregel"). Det holder for
 * store, enkle vannflater (bekreftet i Molde-testen), men en skjærgård med
 * tette øyer/sund (Kristiansand) kan ha en vannkanal SMALERE enn
 * prøvepunktavstanden (500 m–1,2 km) — da lander ALDRI noe prøvepunkt i
 * akkurat den kanalen, og INGEN terskeljustering av "avstand til nærmeste
 * vannprøve" kan fikse et rent informasjonstap i selve prøvetakingen.
 *
 * Løsningen (§3/§14 i V1.2.2-oppdraget: "habitatklassifisering og geografisk
 * validitet trenger ikke ha samme datakilde eller oppløsning") er en EGEN,
 * uavhengig kilde — water.ts sin OSM-baserte kystlinje-/vannpolygon-geometri,
 * evaluert LOKALT (ingen nye nettverkskall) på scoring-gridets FULLE ~150 m
 * oppløsning, ikke bare på de sparsomme miljø-prøvepunktene.
 *
 * `osmStatus` (fra determineWaterStatusFromOsm, se water.ts) er nå PRIMÆR og
 * AUTORITATIV når den har et svar:
 *  - "water" → "water" (bekreftet).
 *  - "land" → "valid_land" (bekreftet) — habitatKLASSEN kan fortsatt være
 *    "ukjent" (NIBIO-oppslaget kan ha feilet uavhengig av OSM), det endrer
 *    ikke selve validity-svaret.
 *  - "unknown" (ingen kystlinje/vannpolygon hentet nær dette punktet — f.eks.
 *    et rent innlandsområde uten fjord/sjø, eller et mislykket Overpass-kall)
 *    → faller tilbake til den ELDRE, grovere habitat-prøvegrid-regelen under
 *    som et sikkerhetsnett, IKKE en antakelse om land.
 *
 * `habitat`-feltet selv er fortsatt UENDRET av denne regelen (§5 i V1.2.1-
 * oppdraget: "Spatial validity må være separat fra habitatklassifikasjonen").
 */
export function resolveSpatialValidity(
  nearestHabitat: HabitatClass,
  nearestWaterDistMeters: number | null,
  spacingMeters: number,
  osmStatus: "water" | "land" | "unknown" = "unknown"
): SpatialValidity {
  if (osmStatus === "water") return "water";
  if (osmStatus === "land") return "valid_land";
  return habitatBasertForsiktighetsregel(nearestHabitat, nearestWaterDistMeters, spacingMeters);
}

/**
 * V1.2.1s ORIGINALE regel — beholdt som SIKKERHETSNETT for punkter OSM-
 * kilden ikke har noe svar for (se resolveSpatialValidity over), ikke lenger
 * den eneste/primære avgjørelsen:
 *  1. Nærmeste prøvepunkt er selv vann → "water".
 *  2. Nærmeste prøvepunkt er land, MEN et vann-klassifisert prøvepunkt
 *     finnes innenfor ÉN prøvepunktavstand → "water" (føre-var).
 *  3. Nærmeste prøvepunkt er "ukjent" og ingen vannbevis → "unknown", ALDRI
 *     avvist automatisk.
 *  4. Ellers → "valid_land".
 */
function habitatBasertForsiktighetsregel(
  nearestHabitat: HabitatClass,
  nearestWaterDistMeters: number | null,
  spacingMeters: number
): SpatialValidity {
  if (nearestHabitat === "vann") return "water";
  if (nearestWaterDistMeters != null && nearestWaterDistMeters <= spacingMeters) return "water";
  if (nearestHabitat === "ukjent") return "unknown";
  return "valid_land";
}

/**
 * Bilineær interpolasjon av høyde mellom de fire nærmeste prøvepunktene i
 * det regulære rutenettet — gir en GLATT høydeflate mellom prøvepunktene i
 * stedet for nearest-neighbor sine harde, kilometerstore platåer (V1.2 §2-3).
 * Faller tilbake til nærmeste prøvepunkts rå verdi hvis noen av de fire
 * hjørnene mangler høydedata (f.eks. et mislykket Geonorge-kall) — aldri
 * `null` med mindre ALLE fire OG nearest-fallback mangler.
 */
export function bilinearElevationAt(point: LatLng, grid: SampleGrid, elevations: readonly (number | null)[]): number | null {
  const rowF = Math.min(Math.max((point.latitude - grid.startLat) / grid.latStep, 0), grid.rows - 1);
  const colF = Math.min(Math.max((point.longitude - grid.startLon) / grid.lonStep, 0), grid.cols - 1);
  const r0 = Math.floor(rowF);
  const c0 = Math.floor(colF);
  const r1 = Math.min(r0 + 1, grid.rows - 1);
  const c1 = Math.min(c0 + 1, grid.cols - 1);
  const fr = rowF - r0;
  const fc = colF - c0;

  const e00 = elevations[r0 * grid.cols + c0];
  const e01 = elevations[r0 * grid.cols + c1];
  const e10 = elevations[r1 * grid.cols + c0];
  const e11 = elevations[r1 * grid.cols + c1];
  if (e00 == null || e01 == null || e10 == null || e11 == null) return null;

  const top = e00 * (1 - fc) + e01 * fc;
  const bottom = e10 * (1 - fc) + e11 * fc;
  return top * (1 - fr) + bottom * fr;
}

/**
 * Løser miljøkonteksten for et helt analyseområde og returnerer en synkron
 * EnvironmentResolver. Feiler ALDRI — enkeltkall som mislykkes degraderer til
 * "ukjent" for akkurat det trekket, uten å stoppe resten av oppslaget
 * (Promise.all over uavhengige, allerede feil-svelgende kall).
 *
 * V1.3 (§Q): den returnerte resolveren har i tillegg en `dataQuality`-
 * egenskap (se EnvironmentResolver i types.ts) som rapporterer PER KILDE om
 * dette oppslaget faktisk lyktes — en observasjonell TILLEGGSVERDI, ikke en
 * endring av selve verdiene over (som fortsatt degraderer nøyaktig som før
 * ved feil). Se AttemptTracker/statusFromTracker/cachedDynamicEnvironment
 * over for hvordan hver kilde faktisk avgjør sin status.
 */
export async function resolveEnvironmentContext(
  areaCenter: LatLng,
  areaRadiusMeters: number,
  options: ResolveEnvironmentOptions = {}
): Promise<EnvironmentResolver> {
  const spacing = options.sampleSpacingMeters ?? DEFAULT_SAMPLE_SPACING_METERS;
  const maxPoints = options.maxSamplePoints ?? DEFAULT_MAX_SAMPLE_POINTS;

  const grid = buildCoarseSampleGrid(areaCenter, areaRadiusMeters, spacing, maxPoints);
  const { points, rows, cols } = grid;

  const elevationTracker = createAttemptTracker();
  const habitatTracker = createAttemptTracker();

  const [elevations, habitats, roadsResult, waterResult, dynamicResult] = await Promise.all([
    Promise.all(points.map((p) => cachedElevation(p, elevationTracker))),
    Promise.all(points.map((p) => cachedHabitat(p, habitatTracker))),
    cachedRoads(areaCenter, areaRadiusMeters + spacing),
    // Ekstra sikkerhetsnett (i praksis unødvendig — fetchWaterFeaturesNearWithStatus
    // svelger selv alle feil internt): hvis cachedWaterFeatures likevel skulle
    // kaste (f.eks. en fremtidig cache-implementasjonsendring), degraderer
    // dette til "unavailable" i stedet for å velte HELE Promise.all-en.
    cachedWaterFeatures(areaCenter, areaRadiusMeters + spacing).catch(
      (): { features: WaterFeatures; status: DataSourceStatus } => ({ features: EMPTY_WATER_FEATURES, status: "unavailable" })
    ),
    cachedDynamicEnvironment(areaCenter),
  ]);
  const roads = roadsResult.roads;
  const water = waterResult.features;
  const dynamic = dynamicResult.features;

  const dataQuality: EngineDataQuality = {
    elevation: statusFromTracker(elevationTracker),
    habitat: statusFromTracker(habitatTracker),
    roads: roadsResult.status,
    water: waterResult.status,
    weather: dynamicResult.status,
  };

  // Kystlinje-side-testen (water.ts sin coastlineSide) trenger en maks-
  // avstand for å unngå å ekstrapolere fra et kystlinjesegment som i
  // praksis er for langt unna til å si noe pålitelig om punktet — samme
  // radius som selve vann-hentingen ble gjort for.
  const maxCoastlineDistanceMeters = areaRadiusMeters + spacing;

  const validElevations = elevations.filter((e): e is number => e != null);
  const meanElevation =
    validElevations.length > 0 ? validElevations.reduce((a, b) => a + b, 0) / validElevations.length : null;

  const samples: Sample[] = points.map((point, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const elevation = elevations[i];
    const relativeElevation = elevation != null && meanElevation != null ? elevation - meanElevation : null;
    const { slopeDegrees, aspectDeg } = estimateSlopeAspect(row, col, rows, cols, elevations, spacing);
    return {
      point,
      row,
      col,
      features: {
        elevationMeters: elevation,
        relativeElevationMeters: relativeElevation,
        slopeDegrees,
        aspectDeg,
        habitat: habitats[i],
        roadDistanceMeters: distanceToNearestRoadMeters(point, roads),
        nearHabitatEdge: estimateNearHabitatEdge(row, col, rows, cols, habitats),
        // Overstyres alltid per SPØRREPUNKT i den returnerte resolveren under
        // (avhenger av spørrepunktets egen avstand til nærmeste vannprøve,
        // ikke av denne prøvens egen posisjon) — placeholder her er aldri lest.
        spatialValidity: "unknown",
      },
    };
  });

  // Den FAKTISKE prøvepunktavstanden etter at buildCoarseSampleGrid ev. har
  // skalert den opp for å holde seg innenfor maxPoints — IKKE input-verdien
  // `spacing`, som kan være mindre enn det gridet faktisk endte på (§ V1.2.1:
  // vann-forsiktighetsregelen må bruke den ekte oppløsningen).
  const effectiveSpacingMeters = grid.latStep * 111320;

  const resolver: EnvironmentResolver = (point: LatLng) => {
    if (samples.length === 0) return { static: UKJENT_STATIC_FEATURES, dynamic };

    const nearest = nearestSample(point, samples);
    if (!nearest) return { static: UKJENT_STATIC_FEATURES, dynamic };

    // Kontinuerlig (høyde/relativ høyde): bilineær interpolasjon over hele
    // rutenettet — glatt, ikke platå. Kategorisk/allerede-lokalt-avledet
    // (habitat/vei/kant/helning): nearest-neighbor fra nærmeste prøvepunkt,
    // bevisst UENDRET — å interpolere en habitatKLASSE ville vært semantisk
    // feil (§3 i motoroppdraget), og helning/aspekt/kant er allerede regnet
    // ut FRA nabosamplene på byggetidspunktet, ikke rå kontinuerlige verdier
    // i seg selv.
    const interpolatedElevation = bilinearElevationAt(point, grid, elevations) ?? nearest.features.elevationMeters;
    const interpolatedRelativeElevation =
      interpolatedElevation != null && meanElevation != null ? interpolatedElevation - meanElevation : null;

    const osmStatus = determineWaterStatusFromOsm(point, water, maxCoastlineDistanceMeters);
    const spatialValidity = resolveSpatialValidity(
      nearest.features.habitat,
      nearestWaterDistance(point, samples),
      effectiveSpacingMeters,
      osmStatus
    );

    return {
      static: {
        ...nearest.features,
        elevationMeters: interpolatedElevation,
        relativeElevationMeters: interpolatedRelativeElevation,
        spatialValidity,
      },
      dynamic,
    };
  };

  // V1.3 (§Q): satt på selve resolver-FUNKSJONEN (funksjoner er objekter i
  // JS), IKKE en endring av kallsignaturen — se EnvironmentResolver sin
  // doc-kommentar i types.ts for hvorfor dette holder bakoverkompatibiliteten
  // med alle eksisterende `resolver(point)`-kallere.
  resolver.dataQuality = dataQuality;
  return resolver;
}
