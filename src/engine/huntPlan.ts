// ViltIQ Engine v1.4 — HuntPlan ("Jaktplan").
//
// Denne filen bygger EN KONKRET jaktplan for ÉN allerede rangert sone
// (PredictionZone), for et gitt planlagt tidspunkt (targetDateTimeMs) — ren,
// IO-fri mapping/utledningslogikk, samme filosofi som snapshot.ts: ingen
// Firestore, ingen nettverk, fullt testbar med node:test alene.
//
// KRITISK PRINSIPP (§2.13/§3.4, gjelder også HuntPlan selv om §2.13 er
// skrevet under Hunting Zones-delen av oppdraget): HuntPlan finner ALDRI på
// noe. Den KONSUMERER kun tall/tekst motoren allerede har regnet ut
// (PredictionZone, ZoneRecommendation, EnvironmentalContext, SpeciesProfile/
// SpeciesEcologyProfile) og kombinerer dem deterministisk. Ingen LLM, ingen
// fri tekstgenerering, ingen ny, parallell scoring-algoritme.
//
// ===========================================================================
// §3.9 — vindgeometri (anbefalt innmarsjretning), utledet FRA BUNNEN AV her:
//
// `dynamic.windDirectionDeg` er meteorologisk konvensjon: retningen vinden
// KOMMER FRA (se environment/types.ts). Klassisk, velkjent jaktregel: gå MOT
// vinden ("vind i fjeset") slik at egen lukt blåser BAKOVER — bort fra
// sonen — i stedet for FORAN jegeren og inn mot dyra.
//
// Fysikken: luft (og lukt) beveger seg i retningen vinden blåser MOT, altså
// (windDirectionDeg + 180) % 360. Hvis jegeren beveger seg med kompasskurs
// LIK windDirectionDeg (dvs. rett MOT der vinden kommer fra), er jegerens
// EGEN posisjon — sett FRA sonen — alltid på (windDirectionDeg + 180) % 360,
// nøyaktig den retningen vinden uansett blåser mot. Jegerens lukt drifter
// da videre i SAMME retning bort fra sonen, aldri tilbake mot den.
//
// Konklusjon (bekreftet med konkrete gradseksempler i huntPlan.test.ts):
//   recommendedApproachDirectionDeg = windDirectionDeg
// Dette er IKKE et tilfeldig sammenfall eller en lat identitets-mapping —
// det er den ENESTE kompasskursen som oppfyller "vind i fjeset"-betingelsen.
// Eksempel: vind fra nord (0°) -> jegeren går med kurs 0° (nordover) inn mot
// sonen. Jegeren ankommer da fra sør, og egen lukt (som vinden uansett bærer
// sørover) drifter videre bort fra sonen i stedet for foran jegeren inn i den.
// ===========================================================================
//
// §3.7 — targetDateTime og fremtidig vær: `computeRecommendedTimeWindow`
// (explain.ts) tar sunrise/sunsetMs som EKSPLISITTE parametre og har INGEN
// intern Date.now()/"nå"-default — den er allerede trygg å bruke for et
// vilkårlig, ikke-nødvendigvis-nåværende tidspunkt. Den USTABILE delen er
// UPPSTRØMS: `environment.dynamic` (vind/temperatur/sunrise/sunset) kommer
// fra en "nåværende forhold"-værtjeneste (Open-Meteo, se
// environment/resolve.ts), IKKE en værvarsel-API for en vilkårlig fremtidig
// dato. For en plan langt frem i tid er derfor `environment.dynamic` en
// ÆRLIG, men potensielt UTDATERT stedfortreder for de faktiske forholdene på
// selve jakttidspunktet — se `computeWeatherStalenessCaveat` under, som
// gjør denne begrensningen eksplisitt og synlig i planen i stedet for å late
// som fremtidig vær ble hentet.

import { distanceMeters, movePoint, vindRetningLabel } from "@/src/lib/geo";
import { computeRecommendedTimeWindow, deriveDataFreshness } from "./explain";
import { getEcologyProfile } from "./ecology/profiles";
import type { SpeciesEcologyProfile } from "./ecology/types";
import { getSpeciesProfile } from "./species/profiles";
import type { SpeciesProfile } from "./species/profiles";
import type { EnvironmentalContext, DynamicEnvironmentalFeatures } from "./environment/types";
import type {
  EngineObservation,
  LatLng,
  PredictionZone,
  RecommendedTimeWindow,
  Species,
  ZoneFootprint,
} from "./types";

// ---------------------------------------------------------------------------
// Typer
// ---------------------------------------------------------------------------

export type WindAssessment = {
  /** `null` når miljødata for punktet ikke har kjent vindretning (§Q-lignende ærlighet — ALDRI tolket som vindstille). */
  windDirectionDeg: number | null;
  windSpeedMs: number | null;
  /** Menneskelesbar norsk retning (vindRetningLabel, src/lib/geo.ts) — "ukjent" når windDirectionDeg er null. */
  windDirectionLabel: string;
  /** Anbefalt innmarsjKURS (grader) — kompasskursen jegeren bør GÅ mens hen nærmer seg sonen, se filkommentaren øverst for den fulle geometriske utledningen. `null` når vindretning er ukjent — ALDRI en gjettet kurs. */
  recommendedApproachDirectionDeg: number | null;
  recommendedApproachLabel: string;
  /** Kort, IKKE-tilfeldig forklaringssetning bygget deterministisk fra gradene over — se §3.9. */
  note: string;
};

export type ExpectedMovement = {
  from?: LatLng;
  toward?: LatLng;
  directionDeg?: number;
  /** 0–1. ALDRI vist som sikkert faktum i genererte tekster når lav — se §3.11 og huntPlan.test.ts. */
  confidence: number;
  basis: "observation_corridor" | "crepuscular_habitat_shift" | "insufficient_data";
  /** Kort, ærlig forklaring på HVORFOR dette grunnlaget (eller mangel på grunnlag) ble valgt — samme hedging-språk som resten av motoren (§34: "sannsynlig", "kan", "vurder", ALDRI "dyret er her"). */
  note: string;
};

export type HuntPlanAlternative = {
  zoneId: string;
  rank: number;
  /** KUN generert når data faktisk støtter et konkret, differensierende vilkår (§3.12) — se computeAlternatives. */
  condition: string;
};

/** Kompakt projeksjon av sonen planen gjelder — IKKE en duplisering av hele PredictionZone, kun det planen faktisk trenger å referere/vise (§ oppdraget). */
export type HuntPlanZoneRef = {
  id: string;
  rank: number;
  score: number;
  confidence: number;
  center: LatLng;
  footprint?: ZoneFootprint;
};

export type HuntPlan = {
  id: string;
  /** Se resultCache.ts/config.ts sine eksisterende versjons-/nøkkelkonsepter — DETERMINISTISK avledet fra `species` + `engineResultGeneratedAt` (se stablePredictionSnapshotId under), IKKE en ny, frittstående ID-generator. `zone.id` alene (f.eks. "hjort-zone-1") er kun stabilt INNAD i ÉN motorkjøring (engine.ts sin `${species}-zone-${index+1}`), ikke på tvers av kjøringer — se filkommentaren i buildHuntPlan. */
  predictionSnapshotId: string;
  zoneId: string;
  species: Species;
  /** ISO 8601 — det jegeren faktisk planlegger FOR, ikke nødvendigvis "nå". */
  targetDateTime: string;
  primaryZone: HuntPlanZoneRef;
  /** Se §3.8/computeRecommendedPosition — ALDRI et sentroide, og ALDRI presentert som mer presist enn dataene faktisk støtter. */
  recommendedPosition: LatLng;
  positionReasoning: string[];
  approach: WindAssessment;
  expectedMovement: ExpectedMovement;
  timeWindows: RecommendedTimeWindow[];
  /** Gjenbruker DIREKTE zone.recommendation sin Støtter/Begrenser-klassifisering (explain.ts) — ingen egen, parallell tekstgenerator. */
  reasons: { positive: string[]; negative: string[] };
  alternatives: HuntPlanAlternative[];
  /** Gjenbruker zone.recommendation.dataFreshness — samme konsept som ZoneRecommendation, se explain.ts sin deriveDataFreshness. */
  dataFreshness: "lav" | "middels" | "god";
  generatedAt: number;
};

export type BuildHuntPlanOptions = {
  /**
   * Kjente observasjoner med reell `movementDirectionDeg` — kilden til
   * `expectedMovement` sin "observation_corridor" (§3.11). Valgfri, SAMME
   * `EngineObservation`-form motoren allerede bruker (types.ts) — IKKE en ny
   * observasjonskilde eller en ny normaliseringssti. Uten den (eller uten
   * treff nær sonen) faller `expectedMovement` tilbake til et
   * skumrings-/demringsbasert eller "insufficient_data"-grunnlag.
   */
  nearbyObservations?: readonly EngineObservation[];
  /**
   * Kun til testing/eksplisitt overstyring — "nå", brukt UTELUKKENDE til
   * §3.7 sin ferskhets-/staleness-vurdering av `environment.dynamic` relativt
   * til `targetDateTimeMs` (se computeWeatherStalenessCaveat). Samme mønster
   * som RunEngineOptions.now (engine.ts) / nowMs (movement.ts) — ALDRI et
   * skjult, internt Date.now()-kall som gjør funksjonen ikke-deterministisk
   * uten at kalleren kan overstyre det i en test.
   */
  nowMs?: number;
};

// ---------------------------------------------------------------------------
// Konstanter
// ---------------------------------------------------------------------------

/** Samme terskel som ecology/suitability.ts sin windExposureFactor() bruker for "svak vind: neglisjerbar praktisk effekt" — gjenbrukt her for konsistent språk, ikke et nytt, uavhengig tall. */
const WEAK_WIND_THRESHOLD_MS = 2;

/**
 * Hvor mange ganger sonens EGEN radius en observasjon kan ligge unna
 * sonesenteret og fortsatt regnes som "nær sonen" for expectedMovement sin
 * observasjonsbaserte gren. 2× er bevisst romsligere enn selve sonens
 * footprint (som allerede er sammenhengende, se grid.ts), fordi en
 * observasjon som PEKER inn mot sonen fra like utenfor selve footprinten
 * fortsatt er et reelt, relevant retningssignal — samme prinsipp som
 * movement.ts sin hardCutoffUncertaintyMultiplier (en eksplisitt, romslig,
 * men ENDELIG grense, ikke en ubegrenset søkeradius).
 */
const NEARBY_OBSERVATION_RADIUS_MULTIPLIER = 2;

/** Samme størrelsesorden som movement.ts sin MIN_RELEVANT_STRENGTH (1e-4), men en størrelsesorden høyere: dette er en terskel for om noe i det hele tatt skal VISES i UI (ikke en ren ytelsesoptimalisering), så et litt strengere krav enn "ikke helt null" er riktigere her. */
const MIN_MOVEMENT_CONFIDENCE = 1e-3;

/**
 * Øvre tak på confidence for det rent skumrings-/demringsbaserte
 * bevegelsesgrunnlaget ("crepuscular_habitat_shift") — BEVISST lavere enn
 * hva et faktisk retningsbærende observasjonsgrunnlag kan nå
 * (observation_corridor kan i prinsippet nærme seg 1.0 for en helt fersk
 * observasjon). Dette grunnlaget sier KUN "generelt mer aktivitet ventet nå",
 * ALDRI en posisjon eller retning — 0.5 er en forsiktig, dokumentert
 * ENGINE-kalibrering, ikke en forskningsverdi.
 */
const CREPUSCULAR_MOVEMENT_MAX_CONFIDENCE = 0.5;

/**
 * windExposureSensitivity er LOW-evidens (0.08) for ALLE tre prioriterte
 * arter (hjort/rådyr/elg, se ecology/hjort.ts, radyr.ts, elg.ts) — det gir
 * windExposure et smalt, praktisk verdiområde nær 1.0 (maks avvik
 * ~0.08 × 1 × 0.2 = 0.016, se suitability.ts sin windExposureFactor()). En
 * romslig terskel (f.eks. 0.05) ville ALDRI trigget i praksis. 0.005 er
 * kalibrert til dette faktiske, smale båndet.
 */
const MEANINGFUL_WIND_EXPOSURE_DELTA = 0.005;

/** Maks antall alternative soner en plan i det hele tatt vurderer — samme "ikke overveldende liste"-prinsipp som resten av UI-et (§ oppdraget nevner "Plan B", entall/få, ikke en full liste). */
const MAX_ALTERNATIVES = 2;

/**
 * Hvor lenge frem i tid (fra `nowMs`) `targetDateTimeMs` kan ligge før
 * `environment.dynamic` (vind/temperatur/sunrise/sunset, hentet for "nå") IKKE
 * lenger er en ærlig stedfortreder for forholdene PÅ selve jakttidspunktet —
 * se computeWeatherStalenessCaveat. Samme størrelsesorden (3 timer) som
 * explain.ts sin FRESHNESS_GOD_MAX_AGE_MINUTES, brukt her analogt: en
 * ENGINE-kalibrering, ikke en værmeldings-nøyaktighetspåstand.
 */
const WEATHER_STALENESS_CAVEAT_THRESHOLD_MS = 3 * 3600_000;

// ---------------------------------------------------------------------------
// §3.9 — vindvurdering/innmarsj
// ---------------------------------------------------------------------------

function computeWindApproach(dynamic: DynamicEnvironmentalFeatures): WindAssessment {
  if (dynamic.windDirectionDeg == null) {
    return {
      windDirectionDeg: null,
      windSpeedMs: dynamic.windSpeedMs,
      windDirectionLabel: "ukjent",
      recommendedApproachDirectionDeg: null,
      recommendedApproachLabel: "ukjent",
      note: "Vindretning er ukjent for dette punktet — kan ikke beregne en geometrisk innmarsjanbefaling. Vurder vindforholdene på stedet før du velger tilnærming.",
    };
  }

  const windDirectionDeg = dynamic.windDirectionDeg;
  // §3.9: se filkommentaren øverst — dette ER den korrekte "vind i
  // fjeset"-kursen, ikke en placeholder.
  const recommendedApproachDirectionDeg = windDirectionDeg;
  const windDirectionLabel = vindRetningLabel(windDirectionDeg);
  const recommendedApproachLabel = vindRetningLabel(recommendedApproachDirectionDeg);

  const speedNote =
    dynamic.windSpeedMs == null
      ? "Vindstyrke er ukjent."
      : dynamic.windSpeedMs < WEAK_WIND_THRESHOLD_MS
        ? `Svak vind (${dynamic.windSpeedMs.toFixed(1)} m/s) — retningen har mindre praktisk betydning, men følg den der det er mulig.`
        : `Vind ${dynamic.windSpeedMs.toFixed(1)} m/s.`;

  return {
    windDirectionDeg,
    windSpeedMs: dynamic.windSpeedMs,
    windDirectionLabel,
    recommendedApproachDirectionDeg,
    recommendedApproachLabel,
    note: `Vinden kommer fra ${windDirectionLabel} (${Math.round(windDirectionDeg)}°). Nærm deg sonen med kurs mot ${recommendedApproachLabel} (vind i fjeset) slik at egen lukt blåser bort fra området i stedet for mot det. ${speedNote}`,
  };
}

// ---------------------------------------------------------------------------
// §3.11 — forventet bevegelse
// ---------------------------------------------------------------------------

/**
 * §3.11: prøver, i prioritert rekkefølge, ÉTT av to REELLE grunnlag før den
 * ærlig gir opp:
 *  1. En fersk, retningsbærende observasjon nær sonen — projisert fremover
 *     med SAMME modell som movement.ts sin movementProjectionScoreAt bruker
 *     (artens expectedMovementSpeedMetersPerHour/maxMovementProjectionMeters/
 *     movementProjectionHalfLifeHours, samme movePoint-projeksjon), men her
 *     for å FÅ SELVE PUNKTET (og en enkel skalar confidence), ikke en
 *     rutescore — movementProjectionScoreAt returnerer en score for ETT
 *     GITT punkt, ikke det projiserte punktet selv, så den kan ikke kalles
 *     direkte for dette formålet. Ingen ny biologi — samme tallsett, samme
 *     formel, brukt til et annet uttrekk.
 *  2. Artens EGEN, allerede kildebelagte crepuscularActivity (ecology/*.ts)
 *     kombinert med et REELT beregnet skumrings-/demringsvindu
 *     (computeRecommendedTimeWindow, explain.ts) — KUN en generell
 *     "økt aktivitet ventet"-antagelse, ALDRI en retning eller posisjon.
 * Gir ALDRI opphav til en fabrikkert retning/posisjon — se
 * "insufficient_data"-grenen og huntPlan.test.ts.
 */
function computeExpectedMovement(
  zone: PredictionZone,
  profile: SpeciesProfile,
  ecologyProfile: SpeciesEcologyProfile,
  environment: EnvironmentalContext,
  targetDateTimeMs: number,
  nearbyObservations: readonly EngineObservation[]
): ExpectedMovement {
  const searchRadiusMeters = zone.radiusMeters * NEARBY_OBSERVATION_RADIUS_MULTIPLIER;
  const candidates = nearbyObservations.filter(
    (o) =>
      o.species === zone.species &&
      o.movementDirectionDeg != null &&
      distanceMeters(o.position, zone.center) <= searchRadiusMeters
  );

  if (candidates.length > 0) {
    const newest = candidates.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
    const ageHours = Math.max(0, (targetDateTimeMs - newest.timestamp) / 3600000);
    // Samme aldersdecay-formel som movement.ts sin ageStrength — se
    // filkommentaren over for hvorfor movementProjectionScoreAt selv ikke
    // kan gjenbrukes direkte for å FÅ punktet.
    const confidence = Math.exp((-Math.LN2 * ageHours) / profile.movementProjectionHalfLifeHours);

    if (confidence >= MIN_MOVEMENT_CONFIDENCE) {
      const projectionDistance = Math.min(
        profile.maxMovementProjectionMeters,
        profile.expectedMovementSpeedMetersPerHour * ageHours
      );
      const directionDeg = newest.movementDirectionDeg as number;
      const toward = movePoint(newest.position.latitude, newest.position.longitude, directionDeg, projectionDistance);

      return {
        from: newest.position,
        toward,
        directionDeg,
        confidence: Math.round(confidence * 100) / 100,
        basis: "observation_corridor",
        note:
          confidence >= 0.5
            ? `Nylig registrert bevegelsesretning (mot ${vindRetningLabel(directionDeg)}) gir et rimelig grunnlag for en forventet posisjon.`
            : "Bevegelsesretning er kjent, men observasjonen er ikke lenger fersk — forventet posisjon er usikker.",
      };
    }
  }

  const crepuscular = ecologyProfile.crepuscularActivity;
  if (crepuscular.strength > 0 && environment.dynamic.sunriseMs != null && environment.dynamic.sunsetMs != null) {
    const windows = computeRecommendedTimeWindow(environment.dynamic.sunriseMs, environment.dynamic.sunsetMs, crepuscular);
    const withinWindow = windows.some((w) => targetDateTimeMs >= w.startMs && targetDateTimeMs <= w.endMs);
    if (withinWindow) {
      const confidence = Math.min(CREPUSCULAR_MOVEMENT_MAX_CONFIDENCE, crepuscular.strength);
      return {
        confidence: Math.round(confidence * 100) / 100,
        basis: "crepuscular_habitat_shift",
        note: "Tidspunktet faller i en periode med normalt økt aktivitet for arten (skumring/demring) — økt bevegelse er sannsynlig, men ingen spesifikk retning kan utledes uten en fersk observasjon.",
      };
    }
  }

  return {
    confidence: 0,
    basis: "insufficient_data",
    note: "Utilstrekkelig grunnlag for å anslå forventet bevegelse — ingen fersk observasjon med kjent retning nær sonen, og ikke en tydelig skumrings-/demringsperiode for arten på dette tidspunktet.",
  };
}

// ---------------------------------------------------------------------------
// §3.8 — anbefalt posisjon innad i sonen
// ---------------------------------------------------------------------------

/**
 * §3.8: `zone.center` er, PER KONSTRUKSJON (se grid.ts sin extractZones()),
 * ALLEREDE sonens høyest scorede enkeltrute ("peak.center"), ALDRI et
 * geometrisk gjennomsnitt/sentroide av footprinten — se filkommentaren i
 * extractZones. `PredictionZone.footprint.cells` inneholder kun POSISJONER
 * (LatLng[]), ingen per-celle score (se ZoneFootprint i types.ts) — det
 * finnes derfor INGEN mer presis, ærlig utledbar posisjon innad i sonen enn
 * `zone.center` selv med dagens eksponerte data. Å plukke et ANNET punkt fra
 * `footprint.cells` uten score å rangere dem etter ville vært akkurat den
 * typen fabrikkert presisjon §3.4/§2.13 forbyr.
 *
 * Dette ER likevel IKKE bare "bruk centeret og la det stå" — funksjonen
 * dokumenterer AKTIVT, i `positionReasoning`, både (a) at punktet allerede
 * er sonens topp-punkt (ikke et sentroide), (b) et ekte sekundærsignal når
 * det finnes (nærhet til habitatkant, fra samme miljødata som scoret sonen),
 * og (c) begrensningen ærlig — se §3.8 sitt krav om at UI aldri skal tro
 * punktet er mer presist enn det faktisk er.
 */
function computeRecommendedPosition(
  zone: PredictionZone,
  environment: EnvironmentalContext
): { position: LatLng; reasoning: string[] } {
  const reasoning: string[] = [
    "Punktet er sonens høyest scorede rute — samme punkt sonen faktisk ble bygget rundt — ikke et geometrisk gjennomsnitt/sentroide av hele sonens utstrekning.",
  ];
  if (environment.static.nearHabitatEdge) {
    reasoning.push("Punktet ligger nær en habitatovergang (kantsone), som støtter valget som stå-/siktepunkt.");
  }
  reasoning.push(
    "Motoren lagrer ikke score per enkeltcelle innad i sonen utover selve toppcellen, så et mer presist punkt enn dette kan ikke utledes ærlig fra dagens data."
  );
  return { position: zone.center, reasoning };
}

// ---------------------------------------------------------------------------
// §3.12 — alternativer ("Plan B")
// ---------------------------------------------------------------------------

/**
 * §3.12: en alternativ sone får KUN være med hvis den har en genuint
 * differensierende, ALLEREDE BEREGNET egenskap å knytte et vilkår til — her:
 * en meningsfullt annerledes `environmentBreakdown.windExposure` enn
 * hovedsonen (se ecology/suitability.ts sin windExposureFactor — HØYERE tall
 * = mer i le, LAVERE tall = mer værutsatt). INGEN generisk "vurder også
 * denne"-plassholder, og INGEN spekulasjon om en KONKRET fremtidig
 * vindretning (§3.4) — kun det vi faktisk kan lese av dagens
 * environmentBreakdown for begge soner.
 */
function computeAlternatives(zone: PredictionZone, allZones: readonly PredictionZone[]): HuntPlanAlternative[] {
  const primaryExposure = zone.environmentBreakdown?.windExposure;
  if (primaryExposure == null) return [];

  const candidates = allZones
    .filter((z) => z.id !== zone.id && z.species === zone.species && z.rank != null)
    .sort((a, b) => (a.rank as number) - (b.rank as number))
    .slice(0, MAX_ALTERNATIVES);

  const alternatives: HuntPlanAlternative[] = [];
  for (const candidate of candidates) {
    const candidateExposure = candidate.environmentBreakdown?.windExposure;
    if (candidateExposure == null) continue;
    const delta = candidateExposure - primaryExposure;
    if (Math.abs(delta) < MEANINGFUL_WIND_EXPOSURE_DELTA) continue;

    const condition =
      delta > 0
        ? `Hovedsonen er for øyeblikket noe mer værutsatt — sone #${candidate.rank} ligger mer i le. Vurder denne som alternativ hvis det blåser mye.`
        : `Sone #${candidate.rank} er for øyeblikket mer værutsatt enn hovedsonen. Vurder denne som alternativ i stille/rolig vær.`;

    alternatives.push({ zoneId: candidate.id, rank: candidate.rank as number, condition });
  }
  return alternatives;
}

// ---------------------------------------------------------------------------
// §3.7 — ferskhets-/staleness-advarsel for fremtidige planer
// ---------------------------------------------------------------------------

/**
 * Se filkommentaren øverst (§3.7): `environment.dynamic` representerer
 * forhold "nå" (eller ved en tidligere motorkjøring), ALDRI et faktisk
 * værvarsel for en fremtidig `targetDateTimeMs`. Returnerer `null` (ingen
 * advarsel) når planen gjelder nær fremtid — ELLER faktisk gjelder FORTID
 * (en allerede gjennomført/forbi-passert plan har ikke dette problemet på
 * samme måte). Returnerer en EKSPLISITT, ærlig advarselstekst når gapet er
 * stort nok til at det ville vært misvisende å late som vind-/
 * værinformasjonen i planen gjelder selve jakttidspunktet.
 */
function computeWeatherStalenessCaveat(targetDateTimeMs: number, nowMs: number): string | null {
  if (targetDateTimeMs - nowMs <= WEATHER_STALENESS_CAVEAT_THRESHOLD_MS) return null;
  return "Vind- og værdata i denne planen gjelder forholdene som var kjent da planen ble generert, ikke nødvendigvis forholdene på selve jakttidspunktet, som ligger et stykke frem i tid. Sjekk værmelding på nytt nærmere jaktstart.";
}

// ---------------------------------------------------------------------------
// predictionSnapshotId
// ---------------------------------------------------------------------------

/**
 * `zone.id` (f.eks. "hjort-zone-1", se engine.ts) er kun stabilt INNAD i ÉN
 * motorkjøring — indeksbasert på rangeringsrekkefølgen i akkurat DET
 * EngineResult-et, ikke en global, tidløs identifikator (se resultCache.ts
 * sin egen dokumenterte cache-nøkkel-problematikk for samme underliggende
 * innsikt: et resultat er kun meningsfullt sammen med NÅR/for hvilken
 * kjøring det gjelder). En HuntPlan må kunne spores tilbake til NØYAKTIG
 * hvilken kjøring `zone` kom fra — deterministisk avledet fra `species` +
 * `engineResultGeneratedAt` (= EngineResult.generatedAt), samme mønster som
 * snapshot.ts sin `calculatedAt`/`validFrom`-kobling til `result.generatedAt`.
 */
// Eksportert (V1.5 viewport-anker-fiksen, app/kart.tsx): kartets egen
// sone-identitet på tvers av en anker-/analysegrense (§ "zone.id er kun
// indeksbasert INNAD i én motorkjøring, samme id-streng kan referere til en
// helt annen geografisk sone etter en NY analyse") gjenbruker NØYAKTIG denne
// samme strengen/mønsteret som identifikator — ingen andre, parallell
// snapshot-id skal finnes noe sted i kodebasen.
export function stablePredictionSnapshotId(species: Species, engineResultGeneratedAt: number): string {
  return `${species}-${engineResultGeneratedAt}`;
}

// ---------------------------------------------------------------------------
// buildHuntPlan
// ---------------------------------------------------------------------------

/**
 * Bygger en komplett `HuntPlan` for `zone`, for tidspunktet `targetDateTimeMs`.
 * Ren mapping/utledning — ingen IO, ingen ny scoring. `allZones` (samme
 * `EngineResult.zones` array `zone` selv kom fra) brukes KUN til §3.12 sine
 * alternativer. `environment` er ALLEREDE SLÅTT OPP av kalleren (typisk
 * `environmentResolver(zone.center)`, samme resolver som selve
 * motorkjøringen brukte — kart.tsx sin `EnvironmentResolver`-tilstand, se
 * environment/types.ts) — samme mønster som snapshot.ts sin
 * `buildPredictionSnapshot(result, context)`: denne funksjonen tar imot
 * ferdig kontekst, den slår aldri opp/henter noe selv.
 *
 * NB: `species`-parameteren fra den illustrative skissen i oppdraget er
 * BEVISST FJERNET her — `zone.species` er allerede den autoritative kilden,
 * og å ta imot arten på nytt som et eget argument ville bare åpnet for en
 * stille (og meningsløs) inkonsistens mellom `zone.species` og et feilaktig
 * `species`-argument. `engineResultGeneratedAt` er OBLIGATORISK (ikke
 * valgfritt) — se stablePredictionSnapshotId over for hvorfor den er
 * nødvendig og ikke kan utledes fra `zone` alene (kalleren har den allerede,
 * som `EngineResult.generatedAt` fra kjøringen `zone` kom fra).
 */
export function buildHuntPlan(
  zone: PredictionZone,
  allZones: readonly PredictionZone[],
  environment: EnvironmentalContext,
  targetDateTimeMs: number,
  engineResultGeneratedAt: number,
  options: BuildHuntPlanOptions = {}
): HuntPlan {
  const nowMs = options.nowMs ?? Date.now();
  const species = zone.species;
  const profile = getSpeciesProfile(species);
  const ecologyProfile = getEcologyProfile(species);

  const approach = computeWindApproach(environment.dynamic);
  const expectedMovement = computeExpectedMovement(
    zone,
    profile,
    ecologyProfile,
    environment,
    targetDateTimeMs,
    options.nearbyObservations ?? []
  );
  const { position: recommendedPosition, reasoning: positionReasoning } = computeRecommendedPosition(zone, environment);
  const timeWindows = computeRecommendedTimeWindow(
    environment.dynamic.sunriseMs,
    environment.dynamic.sunsetMs,
    ecologyProfile.crepuscularActivity
  );
  const alternatives = computeAlternatives(zone, allZones);

  // §N/§O (explain.ts): zone.recommendation er ALLEREDE de samme
  // Støtter/Begrenser-grunnene og samme dataFreshness-vurdering — gjenbrukt
  // DIREKTE, ingen ny, parallell klassifisering. Fallback via
  // deriveDataFreshness (også fra explain.ts, samme funksjon engine.ts selv
  // bruker) dekker kun det usannsynlige tilfellet der `zone` ble konstruert
  // uten en `recommendation` (typen tillater det, selve motoren setter den
  // alltid — se engine.ts).
  const positiveReasons = [...(zone.recommendation?.positiveReasons ?? [])];
  const negativeReasons = [...(zone.recommendation?.negativeReasons ?? [])];
  const dataFreshness =
    zone.recommendation?.dataFreshness ??
    deriveDataFreshness(zone.confidenceLevel, zone.newestObservationAgeMinutes, zone.observationCount);

  const weatherCaveat = computeWeatherStalenessCaveat(targetDateTimeMs, nowMs);
  if (weatherCaveat) negativeReasons.push(weatherCaveat);

  const predictionSnapshotId = stablePredictionSnapshotId(species, engineResultGeneratedAt);

  return {
    id: `${predictionSnapshotId}-${zone.id}-plan-${targetDateTimeMs}`,
    predictionSnapshotId,
    zoneId: zone.id,
    species,
    targetDateTime: new Date(targetDateTimeMs).toISOString(),
    primaryZone: {
      id: zone.id,
      rank: zone.rank ?? 1,
      score: zone.score,
      confidence: zone.confidence,
      center: zone.center,
      footprint: zone.footprint,
    },
    recommendedPosition,
    positionReasoning,
    approach,
    expectedMovement,
    timeWindows,
    reasons: { positive: positiveReasons, negative: negativeReasons },
    alternatives,
    dataFreshness,
    generatedAt: nowMs,
  };
}
