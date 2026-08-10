import type { CameraActivityLevel } from "./cameraActivity";
import { formaterPeriode, LAV_KONFIDENS_TERSKEL } from "./cameraActivity";

/**
 * Strukturerte, ferdig-beregnede tall en tekstgenerator (deterministisk i
 * dag, ekte AI-tjeneste senere) kan bygge en menneskelig oppsummering fra.
 * Dette er bevisst den ENESTE inngangen til oppsummeringen — selve
 * kamera-detaljskjermen skal ALDRI la en fremtidig AI telle rådata selv,
 * bare formulere en tekst ut fra disse allerede-beregnede feltene.
 */
export type KameraOppsummeringInput = {
  activeDays: number;
  observationEvents: number;
  totalAnimals: number;
  dominantSpecies: string | null;
  dominantSpeciesPercentage: number | null;
  observationsPerWeek: number;
  animalsPerWeek: number;
  peakTime: string | null;
  activityLevel: CameraActivityLevel;
  confidence: number;
};

const NIVÅ_TEKST: Record<CameraActivityLevel, string> = {
  low: "lav",
  medium: "middels",
  high: "høy",
};

/**
 * Deterministisk fallback-generator. Har nøyaktig samme inngang som en
 * fremtidig ekte AI-oppsummering skal bruke (se KameraOppsummeringInput) —
 * når en AI-tjeneste kobles på, er det denne funksjonens signatur
 * (input → string) en `genererKameraOppsummeringAI(input)` kan erstattes med,
 * uten å endre noe i kamera-detaljskjermen.
 */
export function genererKameraOppsummering(input: KameraOppsummeringInput): string {
  const periode = formaterPeriode(input.activeDays);

  if (input.confidence < LAV_KONFIDENS_TERSKEL) {
    if (input.observationEvents === 0) {
      return (
        `Kameraet har kun vært aktivt i ${periode}, og det er ikke registrert ` +
        `noen observasjoner ennå. Det er foreløpig for lite data til å gjøre ` +
        `en pålitelig vurdering av aktivitetsnivået.`
      );
    }
    return (
      `Kameraet har kun vært aktivt i ${periode}, med ${input.observationEvents} ` +
      `${observasjonsordForm(input.observationEvents)} registrert. Det er ` +
      `foreløpig for lite data til å gjøre en pålitelig vurdering av ` +
      `aktivitetsnivået.`
    );
  }

  const setninger: string[] = [];

  setninger.push(
    `Viltkameraet har vært aktivt i ${periode}. I perioden er det registrert ` +
      `${input.observationEvents} ${observasjonsordForm(input.observationEvents)} ` +
      `med totalt ${input.totalAnimals} ${dyrOrdForm(input.totalAnimals)}.`
  );

  if (input.dominantSpecies && input.dominantSpeciesPercentage != null) {
    setninger.push(
      `${input.dominantSpecies} står for ${input.dominantSpeciesPercentage} % ` +
        `av de registrerte dyrene og er klart mest observert ved dette kameraet.`
    );
  }

  if (input.peakTime) {
    setninger.push(`Aktiviteten har hovedsakelig vært registrert ${input.peakTime}.`);
  }

  setninger.push(
    `Basert på observasjonsmengde, hvor lenge kameraet har vært aktivt og ` +
      `utviklingen gjennom perioden vurderes aktiviteten ved kameraet som ` +
      `${NIVÅ_TEKST[input.activityLevel]}.`
  );

  return setninger.join(" ");
}

function observasjonsordForm(n: number): string {
  return n === 1 ? "observasjon" : "observasjoner";
}

function dyrOrdForm(n: number): string {
  return n === 1 ? "dyr" : "dyr"; // "dyr" er uendret i flertall på norsk
}
