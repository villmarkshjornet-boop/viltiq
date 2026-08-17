// ViltIQ Engine v1 — samlet kalibrering.
//
// Alle tall her er en fornuftig FØRSTE modell, ikke vitenskapelig fasit.
// Hver konstant har en kommentar som forklarer hva den GJØR — ikke en påstand
// om at verdien er bevist riktig. Juster her, ett sted, i stedet for å lete
// gjennom motoren etter spredte magiske tall.

export const ENGINE_VERSION = "ViltIQ Engine v1";

/**
 * Versjonerer INNHOLDET i `DEFAULT_ENGINE_CONFIG` separat fra selve
 * motor-koden (`ENGINE_VERSION`). Bump denne når du endrer en tallverdi her
 * (vekter, terskler, decay osv.) — IKKE når du endrer scoring-*logikken* i
 * grid.ts/signals.ts (det er ENGINE_VERSION sin jobb). Uten dette kan en
 * lagret prediction snapshot fra før en vekt-justering se ut som den kom fra
 * samme motor som en etter justeringen, selv om tallene bak var forskjellige
 * — noe som gjør senere kalibrering/hit-miss-evaluering (§21–24) upålitelig.
 */
export const CONFIG_VERSION = "1";

export type EngineConfig = {
  /** Rutestørrelse i det interne scoring-gridet. */
  cellSizeMeters: number;
  /** Hardt tak på antall ruter — beskytter mobilytelsen uavhengig av hvor spredt observasjonene er. */
  maxGridCells: number;
  /** Hvor mange ruter rundt hver observasjon som får padding utover selve observasjonsspennet. */
  gridPaddingRadiusFactor: number;

  timeDecay: {
    /**
     * Halveringstid i timer for tidsvekten. Ved 0 timer = full vekt (1.0).
     * Vekten halveres hver `halfLifeHours` time, og flater deretter gradvis
     * ut mot `backgroundFloor` i stedet for å gå mot 0 — gammel historikk
     * skal telle som svak bakgrunn, ikke forsvinne helt eller falle brått.
     */
    halfLifeHours: number;
    /** Laveste vekt en observasjon uansett alder kan bidra med (bakgrunnsnivå). */
    backgroundFloor: number;
  };

  /** Antall observasjoner en enkelt rute maksimalt "teller" mot (sqrt-skalert) — hindrer at én feilregistrering med antall=500 dominerer. */
  maxCountPerObservation: number;

  distance: {
    /**
     * Hvor mye observasjonens effektive radius vokser med alder (0 = ingen
     * vekst). Eldre observasjoner er mer usikre på nøyaktig posisjon, så de
     * får et litt bredere (men svakere) fotavtrykk.
     */
    ageRadiusGrowthPerHour: number;
    /** Tak på hvor mye alder kan vokse radiusen (multiplikator). */
    maxAgeRadiusMultiplier: number;
  };

  direction: {
    /**
     * Laveste retningsvekt rett bak et kamera/en bevegelsesretning (0–1).
     * 1.0 rett foran, denne verdien rett bak, glatt cosinus-overgang imellom
     * — bevisst IKKE en hard sektor-avgrensning.
     */
    behindFloor: number;
  };

  reinforcement: {
    /** Maks scorebonus (samme enhet som rå cellescore) for hver ekstra uavhengige kameraobservasjon i en sone, utover den første. */
    perExtraCameraBonus: number;
    /** Tak på total kamera-diversitetsbonus. */
    maxCameraDiversityBonus: number;
    /** Maks avstand (m) mellom to påfølgende observasjoner for at de kan inngå i en bevegelseskorridor. */
    corridorMaxLinkDistanceMeters: number;
    /** Maks tid (timer) mellom to påfølgende observasjoner for at de kan inngå i en bevegelseskorridor. */
    corridorMaxLinkHours: number;
    /** Maks avvik (grader) mellom to påfølgende retninger for at de regnes som "samme" korridor. */
    corridorBearingToleranceDeg: number;
    /** Hvor langt (m) korridoren projiseres forbi siste observasjon. */
    corridorProjectionMeters: number;
    /** Maks scorebonus en korridor kan gi celler nær projeksjonspunktet. */
    maxCorridorBonus: number;
  };

  zones: {
    /**
     * Radius (m) — nærliggende høyt scorede ruter innenfor denne avstanden
     * slås sammen til én sone. Dette er et GULV: engine.ts bruker faktisk
     * max(mergeRadiusMeters, artens baseRadiusMeters × 1.5), slik at en
     * enkelt observasjon aldri fragmenteres til flere soner for arter med
     * stor spatial radius (f.eks. elg).
     */
    mergeRadiusMeters: number;
    /** Laveste displayScore (0–100) en rute må ha for å bli sonesenter. */
    minZoneScore: number;
    /** Maks antall soner returnert per art. */
    maxZones: number;
    /**
     * Metning brukt til å skalere rå (ubegrenset) score til 0–100:
     * displayScore = 100 * (1 - e^(-raw / scoreSaturation)).
     * Ved raw == scoreSaturation blir displayScore ≈ 63.
     */
    scoreSaturation: number;
  };

  /** Terskler (0–100 displayScore) for aktivitetsnivå-etiketten. */
  levelThresholds: { moderat: number; høy: number; sværtHøy: number };

  /** Terskler (0–1) for confidence-etiketten. */
  confidenceThresholds: { middels: number; høy: number };

  confidence: {
    /** Antall bidragsytende observasjoner der metningskurven for "volum" når ~63 % av maks. */
    observationSaturationCount: number;
    /** Antall uavhengige kilder (kamera+manuell) der "diversitet"-kurven når ~63 % av maks. */
    sourceSaturationCount: number;
    /** Vekt (0–1) hver delkomponent har i confidence-snittet. */
    weights: { volume: number; diversity: number; consistency: number; recency: number };
  };

  ecology: {
    /**
     * Hvor mye 0–1 suitability bidrar i samme enhet som observasjonenes rå
     * score. Ved suitability=1.0 og en enkelt fersk observasjon (rå score
     * ~1) er ecologyWeight=3 valgt slik at ren økologisk suitability ALENE
     * gir en "Moderat" displayScore (jf. §T-eksempelet: høy suitability uten
     * observasjoner ≈ moderat score, lav confidence), mens et par ferske,
     * reelle observasjoner fortsatt klart dominerer totalen — se
     * docs/ENGINE_RESEARCH.md sitt "research priors vs. live data"-prinsipp.
     */
    weight: number;
  };
};

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  // 150 m — samme størrelsesorden som de eksisterende varmesone-/
  // prediksjonssone-radiene i kart.tsx (150–600 m), så motorens oppløsning
  // ikke virker urimelig finmasket eller grovkornet sammenlignet med det
  // brukerne allerede er vant til å se på kartet.
  cellSizeMeters: 150,
  maxGridCells: 2500,
  gridPaddingRadiusFactor: 2,

  timeDecay: {
    halfLifeHours: 5,
    backgroundFloor: 0.05,
  },

  maxCountPerObservation: 50,

  distance: {
    ageRadiusGrowthPerHour: 0.01, // +1 % radius per time
    maxAgeRadiusMultiplier: 1.5,
  },

  direction: {
    behindFloor: 0.35,
  },

  reinforcement: {
    perExtraCameraBonus: 0.8,
    maxCameraDiversityBonus: 2.5,
    corridorMaxLinkDistanceMeters: 3000,
    corridorMaxLinkHours: 3,
    corridorBearingToleranceDeg: 45,
    corridorProjectionMeters: 350,
    maxCorridorBonus: 1.5,
  },

  zones: {
    mergeRadiusMeters: 300,
    minZoneScore: 8,
    maxZones: 6,
    scoreSaturation: 6,
  },

  levelThresholds: { moderat: 25, høy: 50, sværtHøy: 75 },
  confidenceThresholds: { middels: 0.35, høy: 0.65 },

  confidence: {
    observationSaturationCount: 4,
    sourceSaturationCount: 2,
    weights: { volume: 0.35, diversity: 0.25, consistency: 0.25, recency: 0.15 },
  },

  ecology: {
    weight: 3,
  },
};
