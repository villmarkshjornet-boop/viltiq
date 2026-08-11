// Rådyr — se docs/ENGINE_RESEARCH.md punkt 3 (habitat i kulturlandskap,
// HIGH evidens — den best funderte enkeltfaktoren i hele det økologiske
// laget). Rådyr er langt mer menneske-tolerant enn hjort/elg, derfor lavere
// roadSensitivity enn de to andre — det er en direkte konsekvens av punkt 3
// sitt funn, ikke en gjetning.

import type { SpeciesEcologyProfile } from "./types";

export const RADYR_ECOLOGY_PROFILE: SpeciesEcologyProfile = {
  species: "radyr",

  habitatSuitability: {
    evidence: "HIGH",
    default: {
      skog: 0.6,
      myr: 0.5,
      jordbruk: 0.85,
      apent: 0.55,
      vann: 0.35,
      bebygd: 0.35,
      ukjent: 0.5,
    },
  },

  // Ingen direkte rådyr-kilde funnet for snø/høyde i denne runden — svak, forsiktig verdi.
  winterSnowElevation: { evidence: "LOW", strength: 0.3 },

  springGreenupElevation: { evidence: "LOW", strength: 0.2 },

  // docs punkt 5 — rådyr er dokumentert MER menneske-tolerant (punkt 3) enn hjort; vesentlig lavere styrke.
  roadSensitivity: { evidence: "MEDIUM", strength: 0.15 },

  // Skogkant/kratt er selve kjernefunnet i punkt 3, men det er allerede fanget i habitatSuitability —
  // edgeAffinity her er et TILLEGG utover det, derfor fortsatt LOW/moderat, ikke overdrevet.
  edgeAffinity: { evidence: "LOW", strength: 0.35 },

  windExposureSensitivity: { evidence: "LOW", strength: 0.1 },

  crepuscularActivity: { evidence: "MEDIUM", strength: 0.4 },

  // Rådyrets brunst er kjent å ligge om sommeren, men ingen bevegelses-/atferdseffekt ble
  // bekreftet i denne research-runden — derfor 0, ikke gjettet inn.
  rutBehavior: { evidence: "LOW", movementBoost: 0, months: [] },
};
