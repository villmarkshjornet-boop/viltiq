// Jaktanbefaling-nyttig-oppdraget §2-4 — ren tekst-KOMPOSISJON av felt
// HuntPlan/PredictionZone allerede har regnet ut. INGEN ny scoring, INGEN
// AI/fri tekstgenerering — samme prinsipp som resten av motorens
// forklaringslag (explain.ts): deterministisk, samme input gir alltid samme
// tekst. Bevisst i src/lib (ikke src/engine) — dette er presentasjon, ikke
// beregning, akkurat som heatmapRender.ts/zonePresentation.ts.

import type { HuntPlan } from "@/src/engine/huntPlan";
import type { PredictionZone } from "@/src/engine/types";
import { avstandLabel, distanceMeters, type LatLng } from "@/src/lib/geo";

/**
 * §2: "Hvordan ville ViltIQ jaktet dette?" — en kort, sammenhengende
 * jaktbeskrivelse (2–4 setninger) syntetisert fra `positionReasoning`,
 * `approach`, `expectedMovement` og `timeWindows`. IKKE en mekanisk
 * sammenlimning av de eksisterende .note-strengene — egne, naturlige
 * setninger bygget fra de RÅ feltene (windDirectionDeg, basis, confidence,
 * dataFreshness), men ALDRI mer selvsikre enn de underliggende feltene
 * tilsier:
 *   - Tilnærming: hedget etter om vindretning i det hele tatt er kjent, OG
 *     etter `plan.dataFreshness` (samme "hvor mye bør UI-et stole på dette"-
 *     signal som allerede vises som badge nederst i panelet — narrativet skal
 *     aldri motsi den badgen).
 *   - Bevegelse: hedget etter `expectedMovement.basis`/`confidence` — ALDRI
 *     "dyret er der"-språk, kun "tyder på"/"kan" (§34-språket motoren selv
 *     bruker), og ALDRI en retning når grunnlaget er insufficient_data.
 * Klokkeslett formateres bevisst IKKE her (samme skille som explain.ts sin
 * computeRecommendedTimeWindow — UI-ets jobb) — kun dawn/dusk nevnes generisk.
 */
export function buildHowViltIQWouldHunt(plan: HuntPlan): string {
  const sentences: string[] = [];
  const lowConfidence = plan.dataFreshness === "lav";

  // Hvor — kun den narrativt meningsfulle EKSTRA grunnen (habitatovergang),
  // aldri den alltid-tilstedeværende metodologiske "høyest scorede rute"-
  // disclaimeren (den forklarer HVORDAN punktet ble funnet, ikke HVORFOR det
  // er et godt sted å sikte fra — ikke egnet som narrativ-åpning).
  const harHabitatovergang = plan.positionReasoning.some((r) => r.toLowerCase().includes("habitatovergang"));
  if (harHabitatovergang) {
    sentences.push("Anbefalt ståsted ligger nær en habitatovergang, som gjør det til et naturlig siktepunkt.");
  }

  // Tilnærming (vind) — tre nivåer, ALDRI mer selvsikkert enn dataene:
  //  1) vindretning ukjent -> ingen retning nevnt i det hele tatt.
  //  2) vindretning kjent, men planens samlede datagrunnlag er lavt ->
  //     presentert som ett MULIG alternativ, ikke en bestemt anbefaling.
  //  3) vindretning kjent OG rimelig datagrunnlag -> en direkte anbefaling.
  if (plan.approach.windDirectionDeg == null) {
    sentences.push("ViltIQ har ikke grunnlag for å anbefale en bestemt tilnærmingsretning her, siden vindretningen er ukjent.");
  } else if (lowConfidence) {
    sentences.push(
      `ViltIQ har begrenset grunnlag for å anbefale en bestemt tilnærming her, men vindforholdene peker mot ${plan.approach.recommendedApproachLabel} som et mulig alternativ.`
    );
  } else {
    sentences.push(`ViltIQ ville nærmet seg fra ${plan.approach.recommendedApproachLabel}, med vinden i fjeset bort fra området.`);
  }

  // Forventet bevegelse — direkte fra expectedMovement.basis/confidence,
  // samme tre grunnlag som motoren selv skiller mellom (huntPlan.ts).
  if (plan.expectedMovement.basis === "insufficient_data") {
    sentences.push("Det finnes ikke nok grunnlag til å si noe om forventet bevegelse akkurat nå.");
  } else if (plan.expectedMovement.basis === "crepuscular_habitat_shift") {
    sentences.push("Tidspunktet faller i en periode med normalt økt aktivitet for arten, men uten en bestemt retning å basere seg på.");
  } else if (plan.expectedMovement.confidence >= 0.5) {
    sentences.push("En fersk registrert bevegelsesretning tyder på at dette kan fortsette å være et relevant område.");
  } else {
    sentences.push("Det finnes en registrert bevegelsesretning, men observasjonen er ikke lenger fersk, så dette bør vurderes med et forbehold.");
  }

  // Tidsvindu — vevd inn som en kort avsluttende setning KUN når motoren
  // faktisk har funnet ett, generisk (dawn/dusk), aldri et oppdiktet klokkeslett.
  if (plan.timeWindows.length > 0) {
    const first = plan.timeWindows[0];
    sentences.push(first.type === "dawn" ? "Dette faller sammen med et morgenvindu med normalt økt aktivitet." : "Dette faller sammen med et kveldsvindu med normalt økt aktivitet.");
  }

  return sentences.join(" ");
}

export type ObservationSummary = {
  /** `false` når sonen ikke har NOEN bidragsytende observasjoner — kalleren viser da en ærlig "ingen ferske observasjoner"-linje i stedet for oppdiktede tall. */
  hasObservations: boolean;
  count: number;
  distinctCameraCount: number;
  newestAgeMinutes: number;
};

/**
 * §4: REN faktaoppsummering fra `PredictionZone` sine tallfelt — bevisst IKKE
 * hentet fra den blandede `reasons.positive/negative`-listen (som slår
 * sammen miljø- og observasjonssignaler, se explain.ts sin resolveOrderedReasons),
 * nettopp for å garantere at "Observasjoner"-blokken ALDRI kan inneholde et
 * terreng-/værsignal ved en feil.
 */
export function summarizeObservations(zone: PredictionZone): ObservationSummary {
  return {
    hasObservations: zone.observationCount > 0,
    count: zone.observationCount,
    distinctCameraCount: zone.distinctCameraCount,
    newestAgeMinutes: zone.newestObservationAgeMinutes,
  };
}

/** "for 3 timer siden" / "for 12 minutter siden" — samme størrelsesorden-logikk som explain.ts sin formatSpan, men UI-vendt presens i stedet for "siste X". */
export function formatObservationAge(minutes: number): string {
  if (minutes < 60) return `for ${Math.max(1, Math.round(minutes))} minutter siden`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `for ${hours} time${hours === 1 ? "" : "r"} siden`;
  const days = Math.round(minutes / 1440);
  return `for ${days} dag${days === 1 ? "" : "er"} siden`;
}

/**
 * "Gjør 'Hvor?' konkret: Anbefalt jaktpost"-oppdraget — REN presentasjon av
 * felt `HuntPlan` allerede har (`recommendedPosition`/`positionReasoning`/
 * `approach`), samme mønster som resten av denne filen: INGEN ny
 * beregning, ALDRI en oppdiktet egenskap (utsikt/vegetasjon/kulefang/skjul/
 * skytesektor/sti/høyde/avstand-til-dyr) motoren faktisk ikke har data på.
 */
export type RecommendedPostSummary = {
  /**
   * Foretrekker positionReasoning sitt FAKTISKE ekstra-innhold (f.eks.
   * habitatovergang-linjen, se huntPlan.ts sin computeRecommendedPosition)
   * fremfor en generisk setning — men de to ALLTID-tilstedeværende linjene
   * (den metodologiske "høyest scorede rute"-forklaringen og den ærlige
   * "lagrer ikke score per enkeltcelle"-presiseringen) regnes ikke som
   * meningsfullt NARRATIV innhold her (de forklarer HVORDAN punktet ble
   * funnet, ikke hvorfor det er et godt sted å sikte fra) — uten dem faller
   * teksten tilbake til den eksplisitt spesifiserte, ærlige standardsetningen.
   */
  hvorfor: string;
  /**
   * En KORT, egen setning bygget av `approach.recommendedApproachLabel` —
   * bevisst IKKE en kopi av `approach.note` (den fulle vind-begrunnelsen
   * vises allerede i "Vind"-seksjonen rett under, se HuntPlanPanel.tsx —
   * å gjenta hele avsnittet her ville gjort panelet unødvendig langt uten å
   * tilføre noe nytt). Samme hedging-prinsipp som resten av filen: ALDRI en
   * retning når `recommendedApproachDirectionDeg` er ukjent.
   */
  hvordan: string;
  /** `null` når `userLocation` ikke er gitt (eller ukjent) — UI-et skal da IKKE vise noen avstand i det hele tatt, aldri en gjettet/falsk verdi. */
  distanceLabel: string | null;
};

const POSITION_REASONING_FILLER_MARKERS = [
  "høyest scorede rute",
  "lagrer ikke score per enkeltcelle",
];

const RECOMMENDED_POST_FALLBACK_TEXT =
  "ViltIQ anbefaler dette punktet basert på eksisterende vurdering av området, vind og forventet bevegelse.";

export function buildRecommendedPostSummary(plan: HuntPlan, userLocation?: LatLng | null): RecommendedPostSummary {
  const meaningfulReasoning = plan.positionReasoning.filter(
    (line) => !POSITION_REASONING_FILLER_MARKERS.some((marker) => line.toLowerCase().includes(marker))
  );
  const hvorfor = meaningfulReasoning.length > 0 ? meaningfulReasoning.join(" ") : RECOMMENDED_POST_FALLBACK_TEXT;

  const hvordan =
    plan.approach.recommendedApproachDirectionDeg != null
      ? `Nærm deg fra ${plan.approach.recommendedApproachLabel} — se «Vind» under for full begrunnelse.`
      : "Ikke nok grunnlag for en anbefalt tilnærmingsretning akkurat nå.";

  const distanceLabel = userLocation
    ? `${avstandLabel(distanceMeters(userLocation, plan.recommendedPosition))} fra deg`
    : null;

  return { hvorfor, hvordan, distanceLabel };
}
