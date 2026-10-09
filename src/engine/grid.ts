// ViltIQ Engine v1 — grid og soner.
//
// Strategi (§17, §26): generer et rutenett rundt observasjonene, gi hver
// rute en score fra de rene signalfunksjonene i signals.ts, og slå sammen
// nærliggende høyt scorede ruter til soner. O(ruter × observasjoner) — for
// realistiske jaktlagsdatasett (titalls/lavthundretalls observasjoner) er
// dette trivielt raskt; maxGridCells setter et hardt ytelsestak uansett.

import { calcBearing, gridBoundaryPolygon, distanceMeters } from "@/src/lib/geo";
import type { EngineConfig } from "./config";
import {
  countWeight,
  directionalAlignment,
  distanceWeight,
  effectiveRadiusMeters,
  maxInfluenceMeters,
  sourceWeight,
  timeWeight,
  trackFreshnessAgeOffsetHours,
} from "./signals";
import { corridorBonusAt } from "./reinforcement";
import { movementProjectionScoreAt } from "./movement";
import type { SpeciesProfile } from "./species/profiles";
import type {
  ActivityLevel,
  EngineDebugCorridor,
  EngineObservation,
  EngineSignalBreakdown,
  LatLng,
} from "./types";
import type { SpatialValidity } from "./environment/types";

const METERS_PER_DEG_LAT = 111320;
/** For svakt bidrag til at det er verdt å fortsette å regne på — ren ytelsesoptimalisering. */
const MIN_RELEVANT_WEIGHT = 1e-4;

function emptyBreakdown(): EngineSignalBreakdown {
  return {
    recency: 0,
    repetition: 0,
    cameraDirection: 0,
    movementDirection: 0,
    cameraDiversity: 0,
    corridor: 0,
    ecology: 0,
    // V1.3 (§H): initialisert eksplisitt (ikke bare latt være `undefined`)
    // slik at denne funksjonens egen breakdown alltid summerer konsistent —
    // se types.ts sin EngineSignalBreakdown for hvorfor feltet likevel er
    // valgfritt (eldre, allerede eksisterende literaler andre steder).
    movementProjection: 0,
  };
}

export type ScoredCell = {
  center: LatLng;
  score: number;
  breakdown: EngineSignalBreakdown;
  /**
   * V1.2.1 (spatial validity): "unknown" når motoren kjører uten miljødata
   * (ren runEngine) — se environment/types.ts sin SpatialValidity for de
   * andre verdiene. Cellen KAN fortsatt ha en score (f.eks. fra en
   * observasjon nær en vannkant) selv med validity "water" — det er
   * extractZones()/buildHeatmapPoints() i engine.ts som bruker dette til å
   * nekte "water"/"invalid" å bli en sone-topp eller heatmap-kandidat, ikke
   * scoreCell() selv.
   */
  validity: SpatialValidity;
};

export type RawZone = {
  center: LatLng;
  radiusMeters: number;
  rawScore: number;
  breakdown: EngineSignalBreakdown;
  /**
   * V1.3 (§K/§L): den FAKTISKE, sammenhengende geografiske utstrekningen —
   * cellene extractZones() faktisk klassifiserte som del av denne sonen
   * (claimedZoneIndex under), IKKE en kunstig sirkel. `hull` er en
   * rutenett-kontur av HELE det krevde cellesettet (src/lib/geo.ts sin
   * gridBoundaryPolygon — se dens filkommentar for zone-hull-audit §21/§22:
   * erstattet det tidligere konvekse skroget nettopp fordi et EKTE konveks
   * skrog empirisk fylte igjen reelt tomrom, inkl. vann, mellom deler av en
   * ikke-konveks-formet sone), klart for polygon-rendering —
   * presentasjonslaget skal bruke `hull` direkte, aldri regne ut sitt eget
   * fra `center`+`radiusMeters`.
   */
  footprintCells: LatLng[];
  footprintHull: LatLng[];
};

/**
 * Tak på antall celler LAGRET per sone-footprint (zone.footprint.cells) — et
 * stort platå kan i prinsippet ha tusenvis av krevde celler, og
 * PAYLOAD-/ytelseshensynet for selve den lagrede listen gjelder fortsatt.
 *
 * VIKTIG (zone-hull-audit, §21/§22): dette taket gjelder KUN den lagrede
 * `footprintCells`-listen, IKKE lenger inputen til selve konturberegningen —
 * gridBoundaryPolygon() (src/lib/geo.ts) MÅ se HELE det krevde cellesettet
 * for å spore konturen riktig (i motsetning til det gamle konvekse skroget,
 * som virkelig bare trengte randpunktene). Kutter man cellene FØR konturen
 * beregnes (slik denne koden gjorde før audit-fiksen), risikerer man et
 * "bittet av" polygon som feilaktig stenger igjen en åpning som i
 * virkeligheten fortsetter forbi kuttet — se extractZones().
 */
const MAX_FOOTPRINT_CELLS = 300;

/**
 * Jevnt fordelt utvalg (stride) over en allerede-krevd celleliste — samme
 * prinsipp som engine.ts sin selectHeatmapPoints() (V1.2 §6): cellene ligger
 * her i grid-scan-rekkefølge (se relevant/scoredCells sin rad-major bygging
 * i buildGridCells), så et jevnt stride-utvalg sprer seg over HELE sonens
 * faktiske utstrekning i den lagrede `footprintCells`-listen, i stedet for
 * kun å beholde de N FØRSTE cellene extractZones tilfeldigvis fant (som
 * ville bitt av en hel kant/rad av en stor sone — spesielt synlig for
 * eventuell fremtidig bruk av footprintCells utover selve konturen, som nå
 * beregnes fra det UBESKÅRNE settet uansett, se MAX_FOOTPRINT_CELLS over).
 */
function evenlySampleCells(cells: readonly LatLng[], max: number): LatLng[] {
  if (cells.length <= max) return [...cells];
  const stride = cells.length / max;
  const sampled: LatLng[] = [];
  for (let k = 0; k < max; k++) sampled.push(cells[Math.floor(k * stride)]);
  return sampled;
}

export type AreaOfInterest = { center: LatLng; radiusMeters: number };

/**
 * Genererer rutesentre som dekker observasjonene pluss en margin (så
 * signalenes avstandsfalloff ikke kuttes brått ved kartutsnittets kant).
 * Rutestørrelsen skaleres opp automatisk (aldri ned) dersom det ellers ville
 * gitt flere ruter enn `maxGridCells` — deterministisk ytelsestak uten å
 * droppe observasjoner.
 *
 * `areaOfInterest` (valgfri) utvider dekningen til minst dette området selv
 * når det finnes få/ingen observasjoner — nødvendig for at motoren skal
 * kunne score et område ut fra miljø/økologi alene (§T i motor-oppdraget),
 * ikke bare rundt eksisterende observasjoner.
 */
export function buildGridCells(
  observations: readonly EngineObservation[],
  profile: SpeciesProfile,
  cfg: EngineConfig,
  areaOfInterest?: AreaOfInterest
): { cells: LatLng[]; cellSizeMeters: number } {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const o of observations) {
    minLat = Math.min(minLat, o.position.latitude);
    maxLat = Math.max(maxLat, o.position.latitude);
    minLon = Math.min(minLon, o.position.longitude);
    maxLon = Math.max(maxLon, o.position.longitude);
  }

  if (areaOfInterest) {
    const latSpan = areaOfInterest.radiusMeters / METERS_PER_DEG_LAT;
    const lonSpan =
      areaOfInterest.radiusMeters / (METERS_PER_DEG_LAT * Math.cos((areaOfInterest.center.latitude * Math.PI) / 180) || 1);
    minLat = Math.min(minLat, areaOfInterest.center.latitude - latSpan);
    maxLat = Math.max(maxLat, areaOfInterest.center.latitude + latSpan);
    minLon = Math.min(minLon, areaOfInterest.center.longitude - lonSpan);
    maxLon = Math.max(maxLon, areaOfInterest.center.longitude + lonSpan);
  }

  const paddingMeters = profile.baseRadiusMeters * cfg.gridPaddingRadiusFactor;
  const avgLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(avgLatRad) || 1;

  const padLat = paddingMeters / METERS_PER_DEG_LAT;
  const padLon = paddingMeters / metersPerDegLon;

  const lat0 = minLat - padLat;
  const lat1 = maxLat + padLat;
  const lon0 = minLon - padLon;
  const lon1 = maxLon + padLon;

  let cellSizeMeters = cfg.cellSizeMeters;
  let rows = Math.max(1, Math.ceil(((lat1 - lat0) * METERS_PER_DEG_LAT) / cellSizeMeters));
  let cols = Math.max(1, Math.ceil(((lon1 - lon0) * metersPerDegLon) / cellSizeMeters));

  if (rows * cols > cfg.maxGridCells) {
    const scale = Math.sqrt((rows * cols) / cfg.maxGridCells);
    cellSizeMeters *= scale;
    rows = Math.max(1, Math.ceil(((lat1 - lat0) * METERS_PER_DEG_LAT) / cellSizeMeters));
    cols = Math.max(1, Math.ceil(((lon1 - lon0) * metersPerDegLon) / cellSizeMeters));
  }

  const cells: LatLng[] = [];
  const latStep = (lat1 - lat0) / rows;
  const lonStep = (lon1 - lon0) / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        latitude: lat0 + latStep * (r + 0.5),
        longitude: lon0 + lonStep * (c + 0.5),
      });
    }
  }
  return { cells, cellSizeMeters };
}

/**
 * Score én rute mot alle observasjoner. Retningssignalene (kamera/bevegelse)
 * virker MULTIPLIKATIVT på observasjonens grunnbidrag — punkter foran
 * kameraet/bevegelsesretningen får opptil hele bidraget, punkter rett bak
 * får det dempet til `behindFloor`-andelen. `signalBreakdown` er diagnostisk
 * (til forklaring/debug) og summerer IKKE nødvendigvis eksakt til `score`,
 * siden de underliggende faktorene er multiplikative, ikke additive.
 */
export function scoreCell(
  point: LatLng,
  observations: readonly EngineObservation[],
  profile: SpeciesProfile,
  cfg: EngineConfig,
  nowMs: number,
  corridors: readonly EngineDebugCorridor[],
  ecologyScoreAt?: (point: LatLng) => number,
  ecologyValidityAt?: (point: LatLng) => SpatialValidity
): ScoredCell {
  const breakdown = emptyBreakdown();
  let total = 0;

  for (const o of observations) {
    const recordedAgeHours = (nowMs - o.timestamp) / 3600000;
    // Spor (source === "track") får en ekstra effektiv-alder-offset basert på
    // hvor gammelt sporet SÅ UT (trackFreshness) — se signals.ts sin
    // trackFreshnessAgeOffsetHours for begrunnelse. No-op (0) for alle andre
    // kilder og for spor uten trackFreshness satt — fullt bakoverkompatibelt.
    const freshnessOffsetHours =
      o.source === "track" ? trackFreshnessAgeOffsetHours(o.trackFreshness) : 0;
    const ageHours = recordedAgeHours + freshnessOffsetHours;
    const tWeight = timeWeight(ageHours, cfg.timeDecay);
    const radius = effectiveRadiusMeters(profile.baseRadiusMeters, ageHours, cfg.distance);
    const dist = distanceMeters(point, o.position);
    // Eksplisitt, dokumentert avstandsgrense (§ kritisk korrigering) — se
    // signals.ts sin maxInfluenceMeters()/config.ts sin
    // maxInfluenceRadiusMultiplier-dokumentasjon. I praksis identisk med
    // MIN_RELEVANT_WEIGHT-grensen under (distanceWeight er allerede ~0 her),
    // men gjør garantien EKSPLISITT og uavhengig av den eksponentielle
    // kurvens form, i stedet for en implisitt konsekvens av den.
    if (dist > maxInfluenceMeters(profile.baseRadiusMeters, ageHours, cfg.distance)) continue;
    const dWeight = distanceWeight(dist, radius);
    if (dWeight < MIN_RELEVANT_WEIGHT) continue;

    const cWeight = countWeight(o.count, cfg.maxCountPerObservation);
    const srcWeight = sourceWeight(o.source, profile.sourceWeights);
    const qualityFactor = 0.5 + 0.5 * o.dataQuality;

    const base = tWeight * dWeight * cWeight * srcWeight * qualityFactor;

    // V1.2 §27 (semantisk gjennomgang, konklusjon dokumentert): cameraDirectionDeg
    // brukes her IKKE som en surrogat-prediksjon av dyrets bevegelse — det er
    // movementDirectionDeg's jobb, og med klart sterkere vekt (se
    // movementDirectionWeight > cameraDirectionWeight per art). Dette er en
    // OBSERVASJONS-SYNLIGHETSBIAS: et kamera oppdager dyr lettere i det feltet
    // det faktisk peker mot enn rett bak seg, så et areal foran kameraet har
    // isolert sett høyere sannsynlighet for at ET DYR DER ville blitt sett —
    // ikke en påstand om hvor dette bestemte dyret er på vei. Samme grunn til
    // at confidence.ts sin directionalConsistency() bevisst IKKE bruker dette
    // feltet (se kommentaren der) — kamerabias er en deteksjons-egenskap ved
    // UTSTYRET, ikke et bevegelsessignal. Riktig som den er; ingen endring.
    let camMultiplier = 1;
    let moveMultiplier = 1;
    if (dist > 1) {
      const bearingFromObs = calcBearing(o.position, point);
      if (o.cameraDirectionDeg != null && profile.cameraDirectionWeight > 0) {
        const align = directionalAlignment(bearingFromObs, o.cameraDirectionDeg, cfg.direction.behindFloor);
        camMultiplier = 1 + (align - 1) * profile.cameraDirectionWeight;
      }
      if (o.movementDirectionDeg != null && profile.movementDirectionWeight > 0) {
        const align = directionalAlignment(bearingFromObs, o.movementDirectionDeg, cfg.direction.behindFloor);
        moveMultiplier = 1 + (align - 1) * profile.movementDirectionWeight;
      }
    }

    const contribution = base * camMultiplier * moveMultiplier;
    total += contribution;

    breakdown.repetition += base;
    if (ageHours <= profile.timeHalfLifeHours) breakdown.recency += base;
    breakdown.cameraDirection += base * (camMultiplier - 1);
    breakdown.movementDirection += base * (moveMultiplier - 1);

    // V1.3 (§H/§I, se movement.ts): additivt, asymmetrisk "forventet
    // posisjon"-bidrag fra DENNE observasjonens egen movementDirectionDeg +
    // alder — BEVISST separat fra moveMultiplier over (som kun vekter det
    // symmetriske fotavtrykket rundt observasjonens EGEN posisjon, aldri
    // flytter tyngdepunktet). Gjenbruker den SAMME `ecologyValidityAt`-
    // callbacken cellens egen validity allerede hentes fra under — samme
    // "punkt → SpatialValidity"-kontrakt, nå brukt til å gate projeksjonens
    // egen bane i stedet for cellens egen gyldighet.
    const movementContribution = movementProjectionScoreAt(point, o, profile, cfg, nowMs, ecologyValidityAt);
    total += movementContribution;
    breakdown.movementProjection = (breakdown.movementProjection ?? 0) + movementContribution;
  }

  const corridorBonus = corridorBonusAt(point, corridors, profile, cfg);
  total += corridorBonus;
  breakdown.corridor += corridorBonus;

  if (ecologyScoreAt) {
    const ecologyContribution = ecologyScoreAt(point);
    total += ecologyContribution;
    breakdown.ecology += ecologyContribution;
  }

  const validity = ecologyValidityAt ? ecologyValidityAt(point) : "unknown";

  return { center: point, score: total, breakdown, validity };
}

export function scoreGrid(
  cells: readonly LatLng[],
  observations: readonly EngineObservation[],
  profile: SpeciesProfile,
  cfg: EngineConfig,
  nowMs: number,
  corridors: readonly EngineDebugCorridor[],
  ecologyScoreAt?: (point: LatLng) => number,
  ecologyValidityAt?: (point: LatLng) => SpatialValidity
): ScoredCell[] {
  return cells.map((point) => scoreCell(point, observations, profile, cfg, nowMs, corridors, ecologyScoreAt, ecologyValidityAt));
}

/** displayScore = 100 × (1 − e^(−raw / saturation)) — se config.ts sin dokumentasjon av `scoreSaturation`. */
export function saturateScore(rawScore: number, saturation: number): number {
  if (saturation <= 0) return rawScore > 0 ? 100 : 0;
  return 100 * (1 - Math.exp(-Math.max(0, rawScore) / saturation));
}

function inverseSaturateScore(displayScore: number, saturation: number): number {
  const ratio = Math.min(0.999999, Math.max(0, displayScore / 100));
  return -saturation * Math.log(1 - ratio);
}

export function levelFromScore(score: number, thresholds: EngineConfig["levelThresholds"]): ActivityLevel {
  if (score >= thresholds.sværtHøy) return "Svært høy";
  if (score >= thresholds.høy) return "Høy";
  if (score >= thresholds.moderat) return "Moderat";
  return "Lav";
}

/**
 * Rutenett-bøtte-nøkkel for et punkt, skalert til cellstørrelsen — celler på
 * det regulære scoring-gridet havner så (nesten) alltid alene i sin egen
 * bøtte, og en celles 8 naboer havner i de 8 omkringliggende bøttene. Gjør
 * naboskapssøk i extractZones O(n) i stedet for O(n²): i stedet for å
 * sammenligne HVER celle mot ALLE andre, slår vi kun opp i de ~9 bøttene som
 * kan inneholde en reell nabo.
 */
function bucketKeyFor(point: LatLng, cellSizeMeters: number): [number, number] {
  const metersPerDegLat = 111320;
  const metersPerDegLon = metersPerDegLat * Math.cos((point.latitude * Math.PI) / 180) || 1;
  return [Math.round((point.latitude * metersPerDegLat) / cellSizeMeters), Math.round((point.longitude * metersPerDegLon) / cellSizeMeters)];
}

/**
 * KRITISK KORRIGERING (V1.2 §8-9): den forrige grådige peak-plukkingen
 * fragmenterte ÉN sammenhengende miljø-platå (flere hundre/tusen celler med
 * identisk/nær-identisk score, typisk for en habitat-flate — se
 * ecology/suitability.ts) til FLERE separate soner, fordi den bare
 * ekskluderte celler innenfor en FAST radius rundt hver allerede-plukkede
 * topp — et platå bredere enn 2×mergeRadiusMeters "lekker" da nye, nesten
 * identiske soner utover hele platået, og disse bruker opp store deler av
 * `maxZones`-budsjettet. Bekreftet empirisk: én 700 m habitat-blob ble til
 * 5 identiske soner med samme score/confidence/forklaring — OGSÅ etter at
 * miljøoppløsningen (resolve.ts) ble forbedret, fordi et ekte cold-start-
 * platå typisk dekker TUSENVIS av celler i et 5 km analyseområde, ikke bare
 * noen titalls (en tidligere O(n²)-variant av denne funksjonen falt derfor
 * stille tilbake til den grådige metoden for ethvert realistisk platå).
 *
 * Løsningen er CONNECTED-COMPONENT-klynging (bøtte-indeksert, O(n) — se
 * bucketKeyFor over): celler over terskelen som ligger geografisk
 * sammenhengende (innenfor ~1,5× cellstørrelsen fra en nabocelle i samme
 * komponent) slås sammen til ÉN sone — uansett hvor stort området er — med
 * komponentens EGEN toppcelle som senter/representant og en radius utledet
 * fra komponentens FAKTISKE geografiske utstrekning, ikke en fast konstant.
 * To genuint atskilte gode områder (ingen kjede av over-terskel-celler
 * mellom dem) forblir to separate komponenter/soner.
 */
export function extractZones(
  scoredCells: readonly ScoredCell[],
  cellSizeMeters: number,
  mergeRadiusMeters: number,
  cfg: EngineConfig
): RawZone[] {
  const minRawScore = inverseSaturateScore(cfg.zones.minZoneScore, cfg.zones.scoreSaturation);
  // V1.2.1 (spatial validity, §6-7 i oppdraget): "water"/"invalid"-celler
  // filtreres HELT bort fra kandidatpoolen her — ikke bare fra å kunne bli
  // en sone-TOPP, men fra selve komponent-utvidelsen. Dette garanterer, ved
  // KONSTRUKSJON (ikke bare "det pleier å funke"), at `peak.center` (som
  // blir zone.center i engine.ts, ALDRI et beregnet centroid — se
  // filkommentaren over extractZones) aldri kan være en vanncelle. "unknown"
  // (ingen miljødata, eller en enkelt mislykket habitat-oppslag) filtreres
  // BEVISST ikke bort — se SpatialValidity-dokumentasjonen i environment/types.ts.
  const relevant = scoredCells.filter(
    (c) => c.score >= minRawScore && c.validity !== "water" && c.validity !== "invalid"
  );
  if (relevant.length === 0) return [];

  const adjacencyThreshold = cellSizeMeters * 1.5;
  const n = relevant.length;

  const bucketOf: [number, number][] = new Array(n);
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const b = bucketKeyFor(relevant[i].center, cellSizeMeters);
    bucketOf[i] = b;
    const key = `${b[0]},${b[1]}`;
    const arr = buckets.get(key);
    if (arr) arr.push(i);
    else buckets.set(key, [i]);
  }

  // VIKTIG PRESISERING (funnet under egen live-verifikasjon av denne
  // fiksen — to iterasjoner før denne ga fortsatt feil resultat, se
  // versjonshistorikk): verken (1) en ren "sammenhengende celler over ÉN
  // GLOBAL absolutt terskel"-komponent, eller (2) "innenfor en fast
  // toleranse av DEN OPPRINNELIGE TOPPENS score", er nok alene.
  //
  // (1) alene kolliderer til ÉN kjempesone som dekker hele kartutsnittet
  // når miljø-baseline ligger jevnt over minZoneScore over store deler av
  // området (§10 i V1.2-oppdraget advarer eksplisitt om dette) — en fersk,
  // lokalt sterkere topp forsvinner da inn i samme sone som den brede,
  // middels gode bakgrunnen.
  //
  // (2) alene fragmenterer isteden en ENKELT, jevnt Gaussisk-avtagende topp
  // (f.eks. rundt et par ferske observasjoner) til FLERE nære, nesten
  // identiske soner — fordi en kontinuerlig avtagende hale ALDRI er "innenfor
  // toleranse av toppen" lenge nok til å telle som étt platå, men hver
  // "skall" utover i halen blir sin egen nye topp i neste runde.
  //
  // Løsningen er KJEDE-relativ toleranse: en nabocelle godtas hvis den enten
  // (a) ligger innenfor artens vanlige mergeRadiusMeters fra selve toppen
  // (tar UBETINGET med hele "skulderen" til én observasjons Gaussiske
  // decay — akkurat den opprinnelige, godt testede oppførselen), ELLER
  // (b) er innenfor RELATIVE_ZONE_PROMINENCE av NABOCELLEN DEN UTVIDES FRA I
  // KJEDEN (ikke av den opprinnelige toppen). Et EKTE flatt platå har
  // ~identisk score fra nabocelle til nabocelle og brer seg derfor fritt
  // via (b), mens en jevnt avtagende hale mister litt terreng for hvert
  // hopp og dør fort ut selv med en romslig per-hopp-toleranse.
  const RELATIVE_ZONE_PROMINENCE = 0.97;

  const order = relevant.map((_, i) => i).sort((a, b) => relevant[b].score - relevant[a].score);
  const claimed = new Array(n).fill(false);
  const rawZones: RawZone[] = [];

  // V1.2.2 KRITISK KORRIGERING (funnet via regresjonstest-matrisen for
  // multi-zone-uttrekk): et sterkt nok Gaussisk-avtagende enkelt-observasjons-
  // signal kunne FORTSATT fragmenteres til flere konsentriske "ring"-soner —
  // akkurat den bug-klassen den kjede-relative fiksen over var ment å
  // eliminere, men bare bevist for SVAKERE topper. Rotårsak: den absolutte
  // minZoneScore-terskelen og mergeRadiusMeters (den ubetingede "skulderen",
  // regel a over) er UAVHENGIGE tall — en STERK nok topps hale kan forbli
  // "relevant" (over minZoneScore) langt utenfor mergeRadiusMeters, i et
  // "foreldreløst" belte der verken regel (a) (for langt fra toppen) eller
  // regel (b) (for bratt hopp-til-hopp-fall der ute til å kjede seg tilbake)
  // fanger cellene. Den høyeste ukrevde cellen i DETTE beltet ble da behandlet
  // som en HELT NY topp i neste runde av `order`-løkken, og fikk sin EGEN
  // fulle ubetingede skulder (regel a) — selv om den bare er en nedoverbakke-
  // fortsettelse av den FØRSTE toppens hale, ikke et selvstendig funn.
  //
  // Fiksen: FØR en ukrevd celle får lov til å så en HELT NY sone, sjekk om
  // den har en UMIDDELBAR nabocelle (innenfor adjacencyThreshold — samme
  // avstand flood-fillen selv bruker for naboskap) som ALLEREDE er krevd OG
  // har lik eller høyere score. I så fall er denne cellen nedoverbakke fra
  // (eller på samme nivå som) et allerede forklart funn — den skal absorberes
  // inn i DEN sonen (og sonens radius utvides om nødvendig), IKKE så en ny.
  // For to genuint atskilte klynger (ingen slik nabo i det hele tatt innenfor
  // adjacencyThreshold) endrer dette ingenting — de forblir separate soner.
  // For et ekte flatt platå fanges praktisk talt alle celler allerede av
  // selve flood-fillen (regel b) før denne sjekken i det hele tatt blir
  // aktuell, så dette er et rent sikkerhetsnett der, ikke en atferdsendring.
  const claimedZoneIndex = new Array(n).fill(-1);
  const zoneMaxDist: number[] = [];

  function findAbsorbingZone(candidateIdx: number): number | null {
    const [latB, lonB] = bucketOf[candidateIdx];
    let bestZone: number | null = null;
    let bestScore = -Infinity;
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        const neighbors = buckets.get(`${latB + dLat},${lonB + dLon}`);
        if (!neighbors) continue;
        for (const j of neighbors) {
          if (!claimed[j] || claimedZoneIndex[j] < 0) continue;
          if (relevant[j].score < relevant[candidateIdx].score) continue;
          if (distanceMeters(relevant[candidateIdx].center, relevant[j].center) > adjacencyThreshold) continue;
          if (relevant[j].score > bestScore) {
            bestScore = relevant[j].score;
            bestZone = claimedZoneIndex[j];
          }
        }
      }
    }
    return bestZone;
  }

  for (const peakIdx of order) {
    if (rawZones.length >= cfg.zones.maxZones) break;
    if (claimed[peakIdx]) continue;

    const absorbingZone = findAbsorbingZone(peakIdx);
    if (absorbingZone != null) {
      claimed[peakIdx] = true;
      claimedZoneIndex[peakIdx] = absorbingZone;
      const distFromThatPeak = distanceMeters(rawZones[absorbingZone].center, relevant[peakIdx].center);
      if (distFromThatPeak > zoneMaxDist[absorbingZone]) {
        zoneMaxDist[absorbingZone] = distFromThatPeak;
        rawZones[absorbingZone] = {
          ...rawZones[absorbingZone],
          radiusMeters: Math.max(cellSizeMeters, mergeRadiusMeters / 2, Math.min(distFromThatPeak, mergeRadiusMeters * 3)),
        };
      }
      continue;
    }

    const peak = relevant[peakIdx];
    const thisZoneIndex = rawZones.length;

    claimed[peakIdx] = true;
    claimedZoneIndex[peakIdx] = thisZoneIndex;
    const stack = [peakIdx];
    let maxDistFromPeak = 0;

    while (stack.length > 0) {
      const cur = stack.pop() as number;
      const [curLatB, curLonB] = bucketOf[cur];
      for (let dLat = -1; dLat <= 1; dLat++) {
        for (let dLon = -1; dLon <= 1; dLon++) {
          const candidates = buckets.get(`${curLatB + dLat},${curLonB + dLon}`);
          if (!candidates) continue;
          for (const j of candidates) {
            if (claimed[j]) continue;
            if (distanceMeters(relevant[cur].center, relevant[j].center) > adjacencyThreshold) continue;
            const distFromPeak = distanceMeters(peak.center, relevant[j].center);
            // To måter en nabocelle kan høre til DENNE toppens sone:
            //  (a) den ligger innenfor artens vanlige mergeRadiusMeters fra
            //      selve toppen — tar UBETINGET med hele "skulderen" til en
            //      jevnt Gaussisk-avtagende topp (én observasjon/kamera),
            //      akkurat som den opprinnelige, godt testede oppførselen.
            //      Uten dette ville en enkelt observasjons decay-hale blitt
            //      til flere små soner (score dropper jevnt, ikke i platå).
            //  (b) den er en del av et sammenhengende MILJØ-PLATÅ som
            //      strekker seg utover mergeRadiusMeters — men da kreves
            //      score innenfor RELATIVE_ZONE_PROMINENCE av NABOCELLEN i
            //      kjeden (`cur`), IKKE av den opprinnelige toppen. Dette
            //      skiller et EKTE flatt platå (naboceller ~identiske, kjeden
            //      brer seg fritt) fra en jevnt AVTAGENDE Gaussisk hale (hvert
            //      hopp mister litt terreng, kjeden dør raskt ut selv med
            //      moderat toleranse per hopp) — se filkommentaren.
            const innenforFastRadius = distFromPeak <= mergeRadiusMeters;
            if (!innenforFastRadius && relevant[j].score < relevant[cur].score * RELATIVE_ZONE_PROMINENCE) continue;
            claimed[j] = true;
            claimedZoneIndex[j] = thisZoneIndex;
            stack.push(j);
            if (distFromPeak > maxDistFromPeak) maxDistFromPeak = distFromPeak;
          }
        }
      }
    }

    zoneMaxDist[thisZoneIndex] = maxDistFromPeak;
    rawZones.push({
      center: peak.center,
      // Radiusen reflekterer sonens faktiske utstrekning (aldri mindre enn
      // den tidligere minimumsstørrelsen), men tak-begrenset slik at én
      // sone aldri kan late som den dekker et helt kartutsnitt.
      radiusMeters: Math.max(cellSizeMeters, mergeRadiusMeters / 2, Math.min(maxDistFromPeak, mergeRadiusMeters * 3)),
      rawScore: peak.score,
      breakdown: peak.breakdown,
      // Fylles ut i ETTERBEHANDLINGEN under — absorpsjon (findAbsorbingZone)
      // kan legge celler til en sone ETTER at den allerede er pushet hit,
      // så footprint kan først samles inn når HELE order-løkken er ferdig.
      footprintCells: [],
      footprintHull: [],
    });
  }

  // V1.3 (§K/§L): samle inn de faktiske krevde cellene per sone NÅ som all
  // klynging OG absorpsjon er ferdig — én enkelt gjennomgang av `relevant`,
  // gruppert på `claimedZoneIndex` (allerede vedlikeholdt av løkken over,
  // se V1.2.2s fragmenteringsfiks). UBESKÅRNET her (se MAX_FOOTPRINT_CELLS
  // sin dokumentasjon over for hvorfor) — kuttingen skjer FØRST etter at
  // konturen er beregnet fra det fulle settet, rett under.
  const cellsByZone: LatLng[][] = rawZones.map(() => []);
  for (let i = 0; i < n; i++) {
    const zoneIdx = claimedZoneIndex[i];
    if (zoneIdx < 0) continue;
    cellsByZone[zoneIdx].push(relevant[i].center);
  }
  for (let zoneIdx = 0; zoneIdx < rawZones.length; zoneIdx++) {
    const allCells = cellsByZone[zoneIdx];
    // zone-hull-audit (§21/§22): rutenett-konturen (gridBoundaryPolygon,
    // src/lib/geo.ts) i stedet for et konveks skrog — se den funksjonens
    // filkommentar for hvorfor et EKTE konveks skrog empirisk viste seg å
    // "fylle igjen" reelt tomrom (opptil 1,8× arealet, inkludert vann-celler
    // som aldri ble krevd) mellom to tette, men ikke-konveks-formede deler
    // av samme sammenhengende sone.
    rawZones[zoneIdx] = {
      ...rawZones[zoneIdx],
      footprintCells: evenlySampleCells(allCells, MAX_FOOTPRINT_CELLS),
      footprintHull: gridBoundaryPolygon(allCells, cellSizeMeters),
    };
  }

  return rawZones;
}
