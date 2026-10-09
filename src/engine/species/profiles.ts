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

  // ---------------------------------------------------------------------
  // V1.3 (§H/§I, se movement.ts): parametre for det NYE, additive
  // "forventet posisjon"-bidraget fra ÉN observasjons egen
  // movementDirectionDeg + alder — BEVISST ADSKILT fra movementDirectionWeight
  // over, som kun er en retnings-VEKTING av det eksisterende symmetriske
  // fotavtrykket rundt observasjonens EGEN posisjon (grid.ts sin scoreCell),
  // ikke en forskjøvet forventet posisjon. Ingen av tallene under er
  // bevist artsspesifikk gangfart — se hver konstants kommentar for hvilke
  // som ekko-siterer eksisterende forskningsbaserte tall fra config.ts sin
  // `distance`-dokumentasjon (rådyr/hjort/elg-forflytningsdistansene), og
  // hvilke som er rene, konservative plassholdere.
  // ---------------------------------------------------------------------
  /**
   * Forventet bevegelseshastighet (m/time) brukt til å PROJISERE et
   * "forventet posisjon"-punkt fremover langs observasjonens egen
   * movementDirectionDeg — se movement.ts. Distanse = denne × observasjonens
   * alder i timer, deretter tak-begrenset av `maxMovementProjectionMeters`.
   */
  expectedMovementSpeedMetersPerHour: number;
  /**
   * Hardt tak (m) på selve projeksjonsdistansen — "ikke en rett
   * kilometerlang strek" uansett hvor gammel observasjonen er.
   */
  maxMovementProjectionMeters: number;
  /** Gaussisk spredningsradius (m) rundt DET PROJISERTE PUNKTET ved observasjonsalder 0. */
  movementProjectionBaseUncertaintyMeters: number;
  /**
   * Hvor mye (m) spredningsradiusen vokser per time observasjonen eldes —
   * usikkerheten om hvilken FAKTISK sti dyret har gått øker med tiden
   * ("bredere jo større usikkerheten blir"), tak-begrenset av
   * `maxMovementUncertaintyMeters`.
   */
  movementUncertaintyGrowthFactor: number;
  /** Tak på spredningsradiusen, uansett hvor gammel observasjonen er. */
  maxMovementUncertaintyMeters: number;
  /**
   * Halveringstid (timer) for PROJEKSJONENS styrke — bevisst en EGEN (og
   * typisk kortere enn) `timeHalfLifeHours`: en retnings-projeksjon fremover
   * blir raskere spekulativ enn selve tilstedeværelsesbidraget (som har en
   * bakgrunnsgulv, jf. signals.ts sin timeWeight) — her tillates styrken å
   * falme praktisk talt bort helt, uten gulv.
   */
  movementProjectionHalfLifeHours: number;
  /**
   * Toppstyrken (samme enhet som et enkelt observasjonsbidrag,
   * signalBreakdown.movementProjection) projeksjonen kan gi ved
   * observasjonsalder 0, rett i det projiserte punktet.
   */
  movementProjectionWeight: number;
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

  // V1.3 §H/§I: expectedMovementSpeedMetersPerHour (150 m/t) er en
  // KONSERVATIV PLASSHOLDER — ingen kilde funnet i denne runden for en
  // faktisk m/t-forflytningsrate hos hjort. maxMovementProjectionMeters
  // (1450 m) derimot ekko-siterer et REELT tall: config.ts sin
  // `distance`-dokumentasjon oppgir "hjort medianforflytning ~1450 m for
  // dyr som flyktet (Frankrike, drivjakt)" — brukt her som selve TAKET på
  // projeksjonen, ikke som en påstått ganghastighet. Øvrige felt
  // (usikkerhet/halveringstid/vekt) er plassholdere kalibrert relativt til
  // artens øvrige, allerede etablerte tall (baseRadiusMeters/
  // timeHalfLifeHours/movementDirectionWeight) — hjort er "FØRSTE
  // PRIORITET" (§15) og får derfor høyest movementProjectionWeight.
  expectedMovementSpeedMetersPerHour: 150,
  maxMovementProjectionMeters: 1450,
  movementProjectionBaseUncertaintyMeters: 150,
  movementUncertaintyGrowthFactor: 40,
  maxMovementUncertaintyMeters: 900,
  movementProjectionHalfLifeHours: 3,
  movementProjectionWeight: 0.7,
};

/**
 * Rådyr — mindre, mer territorielt hjemmeområde enn hjort/elg, så en
 * observasjon sier mer om et snevrere område (mindre baseRadius).
 *
 * V1.1-MERKNAD (ikke endret denne runden): en egen research-runde
 * (se docs/ENGINE_RESEARCH.md V1.1-tillegg) fant norske, artsspesifikke tall
 * på rådyrs hjemmeområde-trofasthet (Bjar et al. 1991: 58 % av dyrene holdt
 * seg året rundt innenfor 2 km fra vinterområdet; sterk flerårig
 * territorietrofasthet hos bukk) som peker MOTSATT av begrunnelsen bak
 * timeHalfLifeHours=4 (kortest av de tre artene): et STEDBUNDET dyr betyr at
 * en observasjon trolig FORTSATT er gyldig lenger, ikke kortere. Dette er en
 * kjerneparameter i observasjons-decayen (ikke den økologiske prior-laget
 * V1.1 ellers reviderer), og en endring her bør gjennomføres som et eget,
 * målrettet kalibreringsarbeid med egen testdekning — bevisst IKKE endret
 * i denne V1.1-runden, kun dokumentert som et sterkt kildebelagt funn.
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

  // V1.3 §H/§I: maxMovementProjectionMeters (1000 m) ekko-siterer et REELT
  // tall — config.ts sin `distance`-dokumentasjon oppgir rådyrs
  // kortsiktige flukt/forflytningsdistanse til "~250 m (maks ~1 km,
  // Sveits)" — 1 km brukt her som selve taket på projeksjonen.
  // expectedMovementSpeedMetersPerHour (80 m/t) er en KONSERVATIV
  // PLASSHOLDER, satt LAVERE enn hjort/elg i tråd med den samme, allerede
  // dokumenterte rådyr-egenarten (Bjar et al. 1991, se kommentaren over
  // timeHalfLifeHours): et stedbundet, territorielt dyr med LITE
  // hjemmeområde beveger seg trolig mer begrenset per tidsenhet enn de
  // større, mer vandrende artene — IKKE en påstått målt ganghastighet. De
  // øvrige feltene (usikkerhet/halveringstid/vekt) er plassholdere, satt
  // lavest av de tre prioriterte artene i tråd med at rådyr-profilen også
  // har lavest movementDirectionWeight/corridorWeight over.
  expectedMovementSpeedMetersPerHour: 80,
  maxMovementProjectionMeters: 1000,
  movementProjectionBaseUncertaintyMeters: 120,
  movementUncertaintyGrowthFactor: 25,
  maxMovementUncertaintyMeters: 500,
  movementProjectionHalfLifeHours: 2,
  movementProjectionWeight: 0.55,
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

  // V1.3 §H/§I: expectedMovementSpeedMetersPerHour (130 m/t) ekko-siterer
  // et REELT tall — config.ts sin `distance`-dokumentasjon oppgir elgens
  // "forhøyet aktivitet i ~2t (~80–185 m/t udisturbet bevegelseshastighet)"
  // etter en forstyrrelse/observasjon; 130 m/t er midtpunktet av dette
  // spennet. maxMovementProjectionMeters (2700 m) gjenbruker samme
  // størrelsesorden som elgens allerede etablerte, dokumenterte
  // maxInfluenceMeters-tak i config.ts ("elg ≈2700 m") — ikke en ny,
  // selvstendig kilde, men en bevisst konsistent ytre grense for arten med
  // desidert størst hjemmeområde/lengst trekk av de tre. Øvrige felt
  // (usikkerhet/halveringstid/vekt) er plassholdere, satt størst av de tre
  // artene i tråd med elgs egne, allerede etablerte baseRadiusMeters/
  // timeHalfLifeHours.
  expectedMovementSpeedMetersPerHour: 130,
  maxMovementProjectionMeters: 2700,
  movementProjectionBaseUncertaintyMeters: 220,
  movementUncertaintyGrowthFactor: 60,
  maxMovementUncertaintyMeters: 1400,
  movementProjectionHalfLifeHours: 4,
  movementProjectionWeight: 0.65,
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
    // V1.3 §H/§I: rene, konservative plassholdere — INGEN artsspesifikk
    // kilde er meningsfull for "annet" (uprioritert samlekategori). Tallene
    // ligger midt mellom rådyr og hjort, samme prinsipp som
    // baseRadiusMeters (250) over allerede følger.
    expectedMovementSpeedMetersPerHour: 110,
    maxMovementProjectionMeters: 1200,
    movementProjectionBaseUncertaintyMeters: 170,
    movementUncertaintyGrowthFactor: 35,
    maxMovementUncertaintyMeters: 700,
    movementProjectionHalfLifeHours: 3,
    movementProjectionWeight: 0.5,
  },
};

export function getSpeciesProfile(species: Species): SpeciesProfile {
  return PROFILES[species];
}
