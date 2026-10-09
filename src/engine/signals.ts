// ViltIQ Engine v1 — signaler.
//
// Rene, sideeffektfrie funksjoner som hver tolker ÉN ting ved en observasjon
// (hvor fersk, hvor nærme, hvilken retning, hvor mange dyr, hvilken kilde).
// grid.ts kombinerer disse til en rutescore. Ingen av funksjonene her vet noe
// om Firestore, kart eller UI.

import type { EngineConfig } from "./config";
import type { EngineSource } from "./types";

/**
 * Tidsvekt: 1.0 ved alder 0, halveres hver `halfLifeHours` time, og flater
 * gradvis ut mot `backgroundFloor` i stedet for å gå mot null — se
 * begrunnelse i config.ts. Negativ alder (fremtidig tidspunkt) klippes til 0
 * i stedet for å gi >1.0 eller krasje.
 */
export function timeWeight(ageHours: number, cfg: EngineConfig["timeDecay"]): number {
  const age = Math.max(0, ageHours);
  const decay = Math.exp((-Math.LN2 * age) / cfg.halfLifeHours);
  return cfg.backgroundFloor + (1 - cfg.backgroundFloor) * decay;
}

/**
 * Observasjonens effektive påvirkningsradius: artens grunnradius, justert
 * (svakt) opp med alder — en gammel observasjon er mer usikker på nøyaktig
 * posisjon, så den får et litt bredere, men samtidig svakere (jf. timeWeight)
 * fotavtrykk. Veksten er tak-begrenset (maxAgeRadiusMultiplier).
 */
export function effectiveRadiusMeters(
  baseRadiusMeters: number,
  ageHours: number,
  cfg: EngineConfig["distance"]
): number {
  const growth = 1 + Math.min(cfg.maxAgeRadiusMultiplier - 1, Math.max(0, ageHours) * cfg.ageRadiusGrowthPerHour);
  return baseRadiusMeters * growth;
}

/**
 * Avstandsvekt: Gaussisk falloff — sterk nær observasjonen, gradvis svakere
 * lenger unna, uten en brå avskjæring. Ved distanse == radius er vekten
 * ~0.61; ved 2×radius ~0.14; ved 3×radius ~0.01.
 */
export function distanceWeight(distanceMeters: number, effectiveRadius: number): number {
  if (effectiveRadius <= 0) return distanceMeters === 0 ? 1 : 0;
  const ratio = distanceMeters / effectiveRadius;
  return Math.exp(-0.5 * ratio * ratio);
}

/**
 * Eksplisitt, dokumentert hardt tak (m) på hvor langt UNNA observasjonen én
 * enkelt observasjon i det hele tatt kan bidra til en rutes score — se
 * config.ts sin `distance.maxInfluenceRadiusMultiplier`-dokumentasjon for
 * forskningsgrunnlaget. `distanceWeight` alene faller allerede mot ~0 lenge
 * før dette, men grensen skal være en EKSPLISITT garanti, ikke bare en
 * implisitt konsekvens av en eksponentiell kurve — "begrenset lokal
 * sannsynlighetsforskyvning, ikke en beregnet sluttposisjon".
 */
export function maxInfluenceMeters(
  baseRadiusMeters: number,
  ageHours: number,
  cfg: EngineConfig["distance"]
): number {
  return effectiveRadiusMeters(baseRadiusMeters, ageHours, cfg) * cfg.maxInfluenceRadiusMultiplier;
}

/** Antall dyr → vekt via sqrt-skalering (tak på maxCountPerObservation) — hindrer at én feilregistrering med et urealistisk høyt antall dominerer scoren alene. */
export function countWeight(count: number, maxCountPerObservation: number): number {
  const capped = Math.min(Math.max(count, 1), maxCountPerObservation);
  return Math.sqrt(capped);
}

export function sourceWeight(
  source: EngineSource,
  weights: Record<EngineSource, number>
): number {
  return weights[source] ?? 1;
}

/** Minste vinkelforskjell mellom to retninger (0–180 grader). */
export function angularDifferenceDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Retningsbias: hvor godt en kandidatretning (f.eks. retningen FRA en
 * observasjon TIL et rutesenter) stemmer med en referanseretning (kameraets
 * retning, eller dyrets bevegelsesretning). 1.0 rett foran, `floor` rett bak,
 * med en glatt cosinus-overgang — bevisst IKKE en hard sektor-avgrensning,
 * siden vi ikke later som vi kjenner en eksakt observasjonsvinkel.
 */
export function directionalAlignment(
  candidateBearingDeg: number,
  referenceDeg: number,
  floor: number
): number {
  const diff = angularDifferenceDeg(candidateBearingDeg, referenceDeg);
  const cos = Math.cos((diff * Math.PI) / 180); // 1 ved 0°, -1 ved 180°
  const t = (cos + 1) / 2; // 1 ved 0°, 0 ved 180°
  return floor + (1 - floor) * t;
}

/**
 * Ekstra "effektive alders"-timer for et SPOR (source === "track") basert på
 * hvor gammelt selve sporet/tegnet SÅ UT da jegeren fant det — IKKE fordi
 * observasjonen ble REGISTRERT lenger tilbake i tid (det er `timestamp`,
 * allerede håndtert av timeWeight). Et spor som ser gammelt ut representerer
 * trolig eldre dyreaktivitet enn et helt ferskt spor funnet på nøyaktig
 * samme registreringstidspunkt, så vi adderer denne offset-en til
 * ageHours FØR timeWeight/effectiveRadiusMeters regnes ut i grid.ts.
 *
 * Tallene under er en enkel, IKKE-vitenskapelig plassholder-kalibrering —
 * INGEN påstand om en bevist biologisk konstant (samme forbehold som resten
 * av config.ts) — kun ment å gi en svak, konservativ retningsjustering.
 * Fraværende trackFreshness (eller ikke-track kilde) gir alltid 0 — dette
 * er et rent no-op for all eksisterende/bakoverkompatibel data.
 */
export function trackFreshnessAgeOffsetHours(
  freshness: "fresh" | "days" | "old" | undefined
): number {
  switch (freshness) {
    case "fresh":
      return 0;
    case "days":
      return 48; // "noen dager" — plassholder, ikke en bevist biologisk konstant
    case "old":
      return 120; // "gammelt" — plassholder, ikke en bevist biologisk konstant
    default:
      return 0;
  }
}

// Artsisolasjon (§14) er strukturell, ikke et signal: engine.ts filtrerer
// EngineObservation[] til én art FØR noen av funksjonene over kalles, så en
// hjorteobservasjon aldri kan bidra til rådyr- eller elg-scoren.
