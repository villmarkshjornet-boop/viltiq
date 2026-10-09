import { ELG_ECOLOGY_PROFILE } from "./elg";
import { HJORT_ECOLOGY_PROFILE } from "./hjort";
import { RADYR_ECOLOGY_PROFILE } from "./radyr";
import type { SpeciesEcologyProfile } from "./types";
import type { Species } from "../types";

const ECOLOGY_PROFILES: Record<Species, SpeciesEcologyProfile> = {
  hjort: HJORT_ECOLOGY_PROFILE,
  radyr: RADYR_ECOLOGY_PROFILE,
  elg: ELG_ECOLOGY_PROFILE,
  // "annet" har ingen forskningsgjennomgang — nøytral, uten dokumenterte effekter.
  annet: {
    species: "annet",
    habitatSuitability: { evidence: "LOW", default: {} },
    winterSnowElevation: { evidence: "LOW", strength: 0 },
    springGreenupElevation: { evidence: "LOW", strength: 0 },
    roadSensitivity: { evidence: "LOW", strength: 0 },
    edgeAffinity: { evidence: "LOW", strength: 0 },
    windExposureSensitivity: { evidence: "LOW", strength: 0 },
    crepuscularActivity: { evidence: "LOW", strength: 0 },
    timeOfDayActivity: { evidence: "LOW", strength: 0 },
    rutBehavior: { evidence: "LOW", movementBoost: 0, months: [] },
    precipitationSensitivity: { evidence: "LOW", strength: 0 },
  },
};

export function getEcologyProfile(species: Species): SpeciesEcologyProfile {
  return ECOLOGY_PROFILES[species];
}

export { HJORT_ECOLOGY_PROFILE, RADYR_ECOLOGY_PROFILE, ELG_ECOLOGY_PROFILE };
export type { SpeciesEcologyProfile } from "./types";
