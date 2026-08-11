// Hjort — best utviklede økologiprofil (§15: første prioritet). Se
// docs/ENGINE_RESEARCH.md punkt 1 (snø/høyde), 3 (habitat — delt med rådyr
// sitt kulturlandskap-funn, men hjort er mer skogtilknyttet), 4 (brunst),
// 5 (vei). Tallene er kalibrert etter dokumentert RETNING, ikke presise
// forskningsverdier — se hver kildehenvisning for styrke.

import type { SpeciesEcologyProfile } from "./types";

export const HJORT_ECOLOGY_PROFILE: SpeciesEcologyProfile = {
  species: "hjort",

  habitatSuitability: {
    evidence: "MEDIUM",
    default: {
      skog: 0.8,
      myr: 0.4,
      jordbruk: 0.6,
      apent: 0.5,
      vann: 0.3,
      bebygd: 0.15,
      ukjent: 0.5,
    },
  },

  // docs punkt 1 — HIGH: NINA dokumenterer direkte at snø/høyde begrenser hjort om vinteren.
  winterSnowElevation: { evidence: "HIGH", strength: 0.9 },

  // Ikke direkte dokumentert for hjort i denne runden (kun for elg, punkt 2) — svak, forsiktig verdi.
  springGreenupElevation: { evidence: "LOW", strength: 0.2 },

  // docs punkt 5 — MEDIUM: unngåelsesretning dokumentert, terskel ikke tallfestet.
  roadSensitivity: { evidence: "MEDIUM", strength: 0.5 },

  // docs punkt 6 — LOW: prinsippet anerkjent, ingen tallfestet effekt funnet.
  edgeAffinity: { evidence: "LOW", strength: 0.3 },

  // docs punkt 7 — LOW: ingen forskning funnet, kun ren fysisk eksponering, svært svak vekt.
  windExposureSensitivity: { evidence: "LOW", strength: 0.15 },

  // docs punkt 8 — MEDIUM for prinsippet, ikke artsspesifikt kildebelagt i denne runden.
  crepuscularActivity: { evidence: "MEDIUM", strength: 0.4 },

  // docs punkt 4 — MEDIUM: samstemte, ikke-primære kilder, men konsistente på økt mobilitet i brunst.
  rutBehavior: { evidence: "MEDIUM", movementBoost: 0.6, months: [9, 10] },
};
