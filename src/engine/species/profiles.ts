// ViltIQ Engine v1 — artsprofiler.
//
// Én motor, tre parametersett. Tallene under er en logisk FØRSTE modell
// basert på kjente, grove forskjeller mellom artene (hjemmeområde-størrelse,
// hvor territorielt/flokkbasert dyret er) — IKKE forskningsdata. De skal
// være enkle å justere etter hvert som ViltIQ samler erfaring, ikke fremstå
// som vitenskapelig fasit.

import type { EngineSource, Species } from "../types";

export type SpeciesProfile = {
  species: Species;
  /** Norsk visningsnavn, brukt i forklaringstekster. */
  label: string;
  /** Typisk påvirkningsradius (m) for én observasjon — "spatialDecay". */
  baseRadiusMeters: number;
  /** Halveringstid (timer) for tidsvekten — "temporalDecay". */
  timeHalfLifeHours: number;
  /** Hvor mye kameraets retning skal vektlegges som spatial bias (0–1). */
  cameraDirectionWeight: number;
  /** Hvor mye dyrets faktiske bevegelsesretning skal vektlegges (0–1) — sterkere enn kamerabias, jf. §9. */
  movementDirectionWeight: number;
  /** Hvor sterkt en registrert bevegelseskorridor skal forsterke celler langs den (0–1). */
  corridorWeight: number;
  /** Relativ tillit per datakilde. */
  sourceWeights: Record<EngineSource, number>;
};

/**
 * Hjort — FØRSTE PRIORITET (§15). Best utviklede profil: mest balanserte
 * retningsvekting (både kamera- og bevegelsesretning brukes aktivt), og
 * moderat halveringstid som gir god vekt til tidssekvenser mellom kamera
 * (§15 nevner eksplisitt "tidssekvenser mellom kamera" som noe motoren skal
 * være god på for hjort) uten å la observasjoner fra forrige uke dominere.
 */
export const HJORT_PROFILE: SpeciesProfile = {
  species: "hjort",
  label: "Hjort",
  baseRadiusMeters: 300,
  timeHalfLifeHours: 5,
  cameraDirectionWeight: 0.5,
  movementDirectionWeight: 0.7,
  corridorWeight: 0.6,
  sourceWeights: { camera: 1.0, manual: 0.9, track: 0.5 },
};

/**
 * Rådyr — mindre, mer territorielt hjemmeområde enn hjort/elg, så en
 * observasjon sier mer om et snevrere område (mindre baseRadius) og blir
 * raskere "utdatert" som posisjonsindikasjon (kortere halveringstid).
 */
export const RADYR_PROFILE: SpeciesProfile = {
  species: "radyr",
  label: "Rådyr",
  baseRadiusMeters: 200,
  timeHalfLifeHours: 4,
  cameraDirectionWeight: 0.45,
  movementDirectionWeight: 0.65,
  corridorWeight: 0.5,
  sourceWeights: { camera: 1.0, manual: 0.9, track: 0.5 },
};

/**
 * Elg — større hjemmeområde og lengre trekk enn hjort/rådyr, så en
 * observasjon er relevant for et bredere område over lengre tid (større
 * baseRadius, lengre halveringstid).
 */
export const ELG_PROFILE: SpeciesProfile = {
  species: "elg",
  label: "Elg",
  baseRadiusMeters: 450,
  timeHalfLifeHours: 7,
  cameraDirectionWeight: 0.5,
  movementDirectionWeight: 0.7,
  corridorWeight: 0.65,
  sourceWeights: { camera: 1.0, manual: 0.9, track: 0.55 },
};

const PROFILES: Record<Species, SpeciesProfile> = {
  hjort: HJORT_PROFILE,
  radyr: RADYR_PROFILE,
  elg: ELG_PROFILE,
  // "annet" scores aldri direkte (engine.ts avviser den), men profilen må
  // finnes slik at getSpeciesProfile er total og aldri kaster.
  annet: {
    species: "annet",
    label: "Annet",
    baseRadiusMeters: 250,
    timeHalfLifeHours: 5,
    cameraDirectionWeight: 0.4,
    movementDirectionWeight: 0.6,
    corridorWeight: 0.5,
    sourceWeights: { camera: 1.0, manual: 0.9, track: 0.5 },
  },
};

export function getSpeciesProfile(species: Species): SpeciesProfile {
  return PROFILES[species];
}
