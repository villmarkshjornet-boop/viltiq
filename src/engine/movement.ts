// ViltIQ Engine v1.3 — bevegelseskorridor fra ÉN observasjons kjente retning
// + alder (§H/§I i motoroppdraget).
//
// BEVISST FORSKJELLIG fra to andre, allerede eksisterende mekanismer:
//  - grid.ts sin scoreCell() `moveMultiplier`: en retnings-VEKTING
//    (multiplikativ bias) av det symmetriske Gaussiske fotavtrykket RUNDT
//    observasjonens EGEN posisjon — punkter foran bevegelsesretningen får
//    mer av det EKSISTERENDE bidraget, men tyngdepunktet flyttes aldri.
//  - reinforcement.ts sin computeMovementCorridors()/corridorBonusAt(): kjeder
//    FLERE observasjoner over tid til én inferert korridor (spatiotemporal
//    reinforcement på tvers av observasjoner).
//
// Denne filen: ÉN observasjons EGEN movementDirectionDeg + alder projiseres
// fremover til et "forventet posisjon"-punkt, med en EGEN, aldersavhengig
// Gaussisk spredning rundt DET punktet — et genuint asymmetrisk, ADDITIVT
// bidrag (breakdown.movementProjection), helt uavhengig av moveMultiplier og
// av korridor-mekanismen. "Ikke finn på retning" (§H): uten et kjent
// movementDirectionDeg er bidraget alltid nøyaktig 0 — ren tilleggseffekt,
// trekker aldri fra det eksisterende symmetriske fotavtrykket.

import { distanceMeters, movePoint } from "@/src/lib/geo";
import type { EngineConfig } from "./config";
import type { SpeciesProfile } from "./species/profiles";
import type { EngineObservation, LatLng } from "./types";
import type { SpatialValidity } from "./environment/types";

/** For svakt bidrag til at det er verdt å fortsette å regne på — ren ytelsesoptimalisering, samme prinsipp som grid.ts sin MIN_RELEVANT_WEIGHT. */
const MIN_RELEVANT_STRENGTH = 1e-4;

/**
 * Hvor mange punkter langs "strålen" fra observasjonen til det projiserte
 * punktet som sjekkes for gyldig geografi (§I: "ikke tegnet gjennom vann" —
 * ikke bare selve endepunktet). Adaptivt til projeksjonsdistansen (korte,
 * ferske projeksjoner trenger bare 1 sjekk), men tak-begrenset — ren
 * ytelsesbeskyttelse mot mange kall til en potensielt kostbar resolver.
 */
const MAX_PATH_VALIDITY_SAMPLES = 5;
const PATH_SAMPLE_SPACING_METERS = 200;

/**
 * Beregner det additive "forventet posisjon"-bidraget for ÉT punkt, fra ÉN
 * observasjons egen movementDirectionDeg + alder. Rent og sideeffektfritt —
 * samme kontrakt som grid.ts/signals.ts sine funksjoner.
 *
 * Oppførsel (§H/§I):
 * 1. Uten `movementDirectionDeg` → 0, umiddelbart.
 * 2. Projiserer et "forventet posisjon"-punkt fremover langs retningen,
 *    distanse = artens forventede hastighet × observasjonens alder i timer,
 *    tak-begrenset (`maxMovementProjectionMeters`) — aldri en ubegrenset,
 *    kilometerlang strek.
 * 3. Styrken (toppverdien, rett i det projiserte punktet) AVTAR med alder —
 *    en EGEN halveringstidskurve (`movementProjectionHalfLifeHours`), bevisst
 *    UTEN signals.ts sin timeWeight()-bakgrunnsgulv: en retningsprojeksjon
 *    blir stadig mer spekulativ jo eldre observasjonen er, og skal derfor
 *    kunne falme praktisk talt bort helt — ikke flate ut på et
 *    bakgrunnsnivå (riktig for selve TILSTEDEVÆRELSES-bidraget, feil for en
 *    retnings-PROJEKSJON).
 * 4. Den romlige spredningen (usikkerhetsradiusen) rundt det projiserte
 *    punktet VOKSER med alder (mer tid = flere mulige stier dyret kan ha
 *    tatt), tak-begrenset (`maxMovementUncertaintyMeters`) — en genuint
 *    ANNEN form enn signals.ts sin distanceWeight() (som bruker en fast
 *    radius per observasjon, ikke en som vokser med alder rundt et
 *    forskjøvet punkt).
 * 5. Artsavhengig via nye SpeciesProfile-felt (species/profiles.ts).
 * 6. Geografi-gatet: hvis `validityAt` er gitt og ETT ELLER FLERE punkter
 *    langs strålen fra observasjonen til det projiserte punktet er "water"
 *    eller "invalid", undertrykkes HELE bidraget (0) — vi later aldri som
 *    en projeksjon gjennom en innsjø er en troverdig forventet sti. Uten
 *    `validityAt` (ren `runEngine`, ingen miljøresolver) skjer INGEN
 *    gating — degraderer likt som resten av motoren gjør ved manglende
 *    miljødata (se grid.ts sin `ecologyValidityAt`), ALDRI tolket som vann.
 * 7. Eksplisitt, dokumentert hardt avstandstak
 *    (`cfg.movementProjection.hardCutoffUncertaintyMultiplier` ×
 *    usikkerhetsradiusen) garanterer at bidraget er nøyaktig 0 langt før en
 *    urealistisk avstand — samme filosofi som signals.ts sin
 *    maxInfluenceMeters(), men for DETTE bidraget.
 */
export function movementProjectionScoreAt(
  point: LatLng,
  observation: EngineObservation,
  profile: SpeciesProfile,
  cfg: EngineConfig,
  nowMs: number,
  validityAt?: (point: LatLng) => SpatialValidity
): number {
  // §H: "Ikke finn på retning" — uten kjent bevegelsesretning er dette
  // bidraget alltid nøyaktig 0. Rent additivt/tilleggende: det eksisterende
  // symmetriske fotavtrykket (grid.ts) er upåvirket av dette tidlige returet.
  if (observation.movementDirectionDeg == null) return 0;

  const ageHours = Math.max(0, (nowMs - observation.timestamp) / 3600000);

  // §H punkt 3: egen, gulvfri aldersdecay for PROJEKSJONENS styrke.
  const ageStrength = Math.exp((-Math.LN2 * ageHours) / profile.movementProjectionHalfLifeHours);
  if (ageStrength < MIN_RELEVANT_STRENGTH) return 0;

  // §H punkt 2: tak-begrenset projeksjonsdistanse — "ikke en rett
  // kilometerlang strek".
  const projectionDistance = Math.min(
    profile.maxMovementProjectionMeters,
    profile.expectedMovementSpeedMetersPerHour * ageHours
  );
  const expectedPoint = movePoint(
    observation.position.latitude,
    observation.position.longitude,
    observation.movementDirectionDeg,
    projectionDistance
  );

  // §H punkt 4: usikkerhetsradius vokser med alder, tak-begrenset.
  const uncertaintyRadius = Math.min(
    profile.maxMovementUncertaintyMeters,
    profile.movementProjectionBaseUncertaintyMeters + profile.movementUncertaintyGrowthFactor * ageHours
  );
  if (uncertaintyRadius <= 0) return 0;

  const dist = distanceMeters(point, expectedPoint);

  // §H punkt 7: eksplisitt hardt avstandstak, uavhengig av kurveformen.
  const hardCutoff = uncertaintyRadius * cfg.movementProjection.hardCutoffUncertaintyMultiplier;
  if (dist > hardCutoff) return 0;

  // §H punkt 4/7: Gaussisk falloff rundt DET PROJISERTE punktet — bevisst
  // en annen radius/senter enn signals.ts sin distanceWeight() (som er
  // sentrert på observasjonens EGEN posisjon med en fast radius).
  const spatialWeight = Math.exp(-0.5 * (dist / uncertaintyRadius) ** 2);
  if (spatialWeight < MIN_RELEVANT_STRENGTH) return 0;

  // §I: geografi-gating langs strålen, ikke bare endepunktet. Kjøres SIST
  // (etter alle de billige numeriske avvisningene over) slik at en
  // potensielt kostbar resolver kun kalles for punkter som uansett ville
  // gitt et relevant bidrag.
  if (validityAt != null && isPathThroughInvalidGeography(observation.position, observation.movementDirectionDeg, projectionDistance, validityAt)) {
    return 0;
  }

  return profile.movementProjectionWeight * ageStrength * spatialWeight;
}

/**
 * §I: sjekker et adaptivt antall punkter langs strålen fra `from` til det
 * projiserte punktet (distanse `distanceM` i retning `bearingDeg`) — ikke
 * bare selve endepunktet. "unknown" (manglende/mislykket miljødata for
 * akkurat dette punktet) og "valid_land" undertrykker IKKE — kun bekreftet
 * "water"/"invalid" gjør det (§J: manglende/usikker geografi skal aldri
 * automatisk tolkes som "ugyldig").
 */
function isPathThroughInvalidGeography(
  from: LatLng,
  bearingDeg: number,
  distanceM: number,
  validityAt: (point: LatLng) => SpatialValidity
): boolean {
  const sampleCount = Math.min(
    MAX_PATH_VALIDITY_SAMPLES,
    Math.max(1, Math.round(distanceM / PATH_SAMPLE_SPACING_METERS))
  );
  for (let i = 1; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const samplePoint = movePoint(from.latitude, from.longitude, bearingDeg, distanceM * t);
    const validity = validityAt(samplePoint);
    if (validity === "water" || validity === "invalid") return true;
  }
  return false;
}
