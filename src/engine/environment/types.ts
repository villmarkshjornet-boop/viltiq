// ViltIQ Engine — miljødatatyper. Se docs/ENGINE_RESEARCH.md for kildegrunnlaget
// bak HVILKE faktorer som hentes; denne filen er kun formen på dataene.

import type { LatLng } from "../types";

/**
 * Grov arealtype fra NIBIO AR5 (Arealressurskart), forenklet til de klassene
 * artsprofilene faktisk skiller mellom. "ukjent" brukes både når oppslaget
 * feilet OG når AR5 selv ikke har klassifisert arealet — motoren skal aldri
 * late som "ukjent" betyr "dårlig habitat", kun at det ikke justerer scoren.
 */
export type HabitatClass = "skog" | "myr" | "jordbruk" | "apent" | "vann" | "bebygd" | "ukjent";

export type StaticEnvironmentalFeatures = {
  elevationMeters: number | null;
  /** Høyde relativt til gjennomsnittet i analyseområdet — positiv = lokal rygg/høyde, negativ = lokal dalbunn/forsenkning. */
  relativeElevationMeters: number | null;
  /** Terrenghelning i grader, utledet fra naboprøvepunkter i det grove miljø-gridet (ikke fra egne ekstra API-kall). */
  slopeDegrees: number | null;
  /** Retningen skråningen vender (0–360, 0=nord). Null ved (tilnærmet) flatt terreng. */
  aspectDeg: number | null;
  habitat: HabitatClass;
  /** Null = ukjent/utenfor søkeradius — IKKE tolket som "uendelig langt unna vei". */
  roadDistanceMeters: number | null;
  /** Grov proxy for kantsone (§M): true hvis habitatklassen skiller seg fra minst én nabo i det grove miljø-gridet. */
  nearHabitatEdge: boolean;
};

export type DynamicEnvironmentalFeatures = {
  temperatureC: number | null;
  windSpeedMs: number | null;
  /** Meteorologisk konvensjon: retningen vinden kommer FRA (0–360). */
  windDirectionDeg: number | null;
  snowDepthMeters: number | null;
  precipitationMm: number | null;
  sunriseMs: number | null;
  sunsetMs: number | null;
};

export type EnvironmentalContext = {
  static: StaticEnvironmentalFeatures;
  dynamic: DynamicEnvironmentalFeatures;
};

export const UKJENT_STATIC_FEATURES: StaticEnvironmentalFeatures = {
  elevationMeters: null,
  relativeElevationMeters: null,
  slopeDegrees: null,
  aspectDeg: null,
  habitat: "ukjent",
  roadDistanceMeters: null,
  nearHabitatEdge: false,
};

export const UKJENT_DYNAMIC_FEATURES: DynamicEnvironmentalFeatures = {
  temperatureC: null,
  windSpeedMs: null,
  windDirectionDeg: null,
  snowDepthMeters: null,
  precipitationMm: null,
  sunriseMs: null,
  sunsetMs: null,
};

/**
 * Slår opp miljøkontekst for et punkt. Selve motorkjernen (grid.ts/engine.ts)
 * kaller ALDRI nettverket selv — den mottar kun en ferdig utfylt resolver som
 * denne, bygget av environment/resolve.ts. Dette holder scoringen synkron,
 * deterministisk og testbar uten nettverk (§27 i motor-oppdraget), selv når
 * miljødata kommer fra eksterne API-er.
 */
export type EnvironmentResolver = (point: LatLng) => EnvironmentalContext;
