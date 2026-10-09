// ViltIQ Engine — miljødatatyper. Se docs/ENGINE_RESEARCH.md for kildegrunnlaget
// bak HVILKE faktorer som hentes; denne filen er kun formen på dataene.

import type { EngineDataQuality, LatLng } from "../types";

/**
 * Grov arealtype fra NIBIO AR5 (Arealressurskart), forenklet til de klassene
 * artsprofilene faktisk skiller mellom. "ukjent" brukes både når oppslaget
 * feilet OG når AR5 selv ikke har klassifisert arealet — motoren skal aldri
 * late som "ukjent" betyr "dårlig habitat", kun at det ikke justerer scoren.
 */
export type HabitatClass = "skog" | "myr" | "jordbruk" | "apent" | "vann" | "bebygd" | "ukjent";

/**
 * V1.2.1 (§2-5 i spatial validity-oppdraget): et geografisk gyldighets-signal,
 * BEVISST separat fra `habitat` — habitat er en visningsklassifikasjon
 * ("hvilken arealtype ser dette punktet mest ut som"), spatialValidity er et
 * strengere spørsmål ("kan dette punktet i det hele tatt være et sted et dyr
 * oppholder seg / en hotspot velges fra"). Se resolve.ts sin
 * `resolveSpatialValidity()` for selve avgjørelsesregelen.
 *
 * - "valid_land": trygt å velge som sone-topp/hotspot-senter.
 * - "water": bekreftet (eller nær-sikkert, se resolve.ts) større vannflate —
 *   ALDRI en gyldig sone-topp/hotspot-kandidat (grid.ts sin extractZones()/
 *   engine.ts sin buildHeatmapPoints() filtrerer disse bort), men cellen kan
 *   fortsatt ha en score (f.eks. fra en observasjon nær bredden) — se
 *   filkommentaren i grid.ts for hvorfor dette ikke løses med en ren
 *   scorestraff.
 * - "invalid": reservert for fremtidige tilfeller av data motoren vet er
 *   ubrukelig (f.eks. utenfor dekningsområdet til datakildene) — produseres
 *   ikke av noen kode i dag, men behandles IDENTISK med "water" overalt
 *   filtreringen skjer, slik at en fremtidig produsent ikke krever
 *   pipeline-endringer andre steder.
 * - "unknown": ingen miljødata å vurdere ut fra (ren `runEngine` uten
 *   miljøresolver, ELLER et NIBIO-oppslag som feilet for akkurat dette
 *   punktet). ALDRI automatisk avvist — motoren skal ikke la en midlertidig
 *   API-feil eller fravær av miljølag stille alle soner.
 */
export type SpatialValidity = "valid_land" | "water" | "invalid" | "unknown";

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
  /** Se SpatialValidity over. */
  spatialValidity: SpatialValidity;
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
  spatialValidity: "unknown",
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
/**
 * V1.3 (§Q): `dataQuality` er en valgfri EKSTRA egenskap på selve
 * resolver-FUNKSJONEN (funksjoner er objekter i JS) — IKKE en endring av
 * kallsignaturen `(point) => EnvironmentalContext`, som ville vært en
 * brytende endring for all eksisterende bruk. `resolveEnvironmentContext()`
 * (resolve.ts) setter denne på resolveren den returnerer; kart.tsx sin
 * `setEnvironmentResolver(() => resolver)`-lagring bevarer OBJEKT-
 * REFERANSEN (samme funksjon), så egenskapen overlever uendret inn i React
 * state. Fraværende (`undefined`) for enhver håndbygd test-resolver som
 * ikke bryr seg om datakvalitet.
 */
export type EnvironmentResolver = ((point: LatLng) => EnvironmentalContext) & {
  dataQuality?: EngineDataQuality;
};
