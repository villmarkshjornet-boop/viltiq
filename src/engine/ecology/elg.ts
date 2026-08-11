// Elg — se docs/ENGINE_RESEARCH.md punkt 2 (vårtrekk/høyde, MEDIUM evidens,
// regionalt datagrunnlag fra Nord-Trøndelag). Elg er generelt mer kulde-/
// snøtolerant enn hjort, derfor vesentlig svakere winterSnowElevation enn
// hjort sin — dette er en RETNINGSMESSIG rimelig antagelse (elg er kjent
// bedre tilpasset vinterforhold enn hjort, se docs punkt 1 sin sammenligning),
// ikke et direkte elg-spesifikt forskningsfunn i denne runden.

import type { SpeciesEcologyProfile } from "./types";

export const ELG_ECOLOGY_PROFILE: SpeciesEcologyProfile = {
  species: "elg",

  habitatSuitability: {
    evidence: "LOW",
    default: {
      skog: 0.85,
      myr: 0.55,
      jordbruk: 0.5,
      apent: 0.4,
      vann: 0.4,
      bebygd: 0.1,
      ukjent: 0.5,
    },
  },

  // Svak, forsiktig verdi — elg er kjent mer vintertolerant enn hjort (docs punkt 1), ikke direkte kildebelagt for elg selv.
  winterSnowElevation: { evidence: "LOW", strength: 0.25 },

  // docs punkt 2 — MEDIUM: regional NINA-relatert kilde, konsistent prinsipp, ikke landsdekkende.
  springGreenupElevation: { evidence: "MEDIUM", strength: 0.6 },

  // Ingen direkte elg-vei-kilde funnet i denne runden.
  roadSensitivity: { evidence: "LOW", strength: 0.4 },

  edgeAffinity: { evidence: "LOW", strength: 0.25 },

  windExposureSensitivity: { evidence: "LOW", strength: 0.15 },

  crepuscularActivity: { evidence: "MEDIUM", strength: 0.35 },

  // Elgens brunst faller i samme periode som hjortens, men ingen bevegelseseffekt
  // ble bekreftet for elg spesifikt i denne research-runden — derfor 0.
  rutBehavior: { evidence: "LOW", movementBoost: 0, months: [] },
};
