import { hentTidsvekt, hentTimerSiden } from "./aktivitet";

export type CameraActivityLevel = "low" | "medium" | "high";

export type CameraActivityObservation = {
  tid: string;
  antall: number;
};

export type CameraActivityInput = {
  installedAt: Date;
  removedAt: Date | null; // null = fortsatt aktivt
  observations: CameraActivityObservation[];
  now?: Date; // for testbarhet — default new Date()
};

export type CameraActivityResult = {
  level: CameraActivityLevel;
  score: number;
  activeDays: number;
  observationEvents: number;
  totalAnimals: number;
  observationsPerWeek: number;
  animalsPerWeek: number;
  /** 0–1. Lav confidence betyr "for lite datagrunnlag", ikke nødvendigvis lav aktivitet. */
  confidence: number;
};

/** Under denne terskelen bør UI si "utilstrekkelig datagrunnlag" i stedet for å påstå et aktivitetsnivå. */
export const LAV_KONFIDENS_TERSKEL = 0.35;

const MS_PER_DAG = 24 * 60 * 60 * 1000;

/**
 * Vurderer hvor aktivt et viltkamera har vært — bevisst IKKE bare "totalt
 * antall dyr", siden 5 dyr på 2 dager er mer interessant enn 10 dyr på et
 * halvår. Vekter inn periodelengde, observasjonsrate, dyr-rate og hvor
 * nylige observasjonene er (via den delte hentTidsvekt()-vektingen fra
 * src/lib/aktivitet.ts, samme "ferskhet teller mer"-prinsipp som resten av
 * appen bruker for varmesoner) — men returnerer sin egen score/nivå, fordi
 * dette er et annet spørsmål enn "hvor varmt er det i et geografisk område
 * akkurat nå".
 */
export function calculateCameraActivity(
  input: CameraActivityInput
): CameraActivityResult {
  const now = input.now ?? new Date();
  const periodeSlutt = input.removedAt ?? now;

  const activeDays = Math.max(
    1,
    Math.round((periodeSlutt.getTime() - input.installedAt.getTime()) / MS_PER_DAG)
  );
  const uker = activeDays / 7;

  const observationEvents = input.observations.length;
  const totalAnimals = input.observations.reduce(
    (sum, o) => sum + (o.antall > 0 ? o.antall : 1),
    0
  );

  const observationsPerWeek = observationEvents / uker;
  const animalsPerWeek = totalAnimals / uker;

  const recencyScore = input.observations.reduce(
    (sum, o) => sum + hentTidsvekt(o.tid),
    0
  );

  // Sammensatt score: gjennomstrømning (per uke) + ferskhet. Ikke normalisert
  // mot totalt antall dyr alene, per designkrav.
  const score =
    observationsPerWeek * 3 + animalsPerWeek * 1.5 + recencyScore * 0.3;

  let level: CameraActivityLevel = "low";
  if (score >= 12) level = "high";
  else if (score >= 5) level = "medium";

  // Confidence: vokser med både hvor lenge kameraet har stått ute og hvor
  // mange observasjonshendelser vi har å basere en vurdering på. Et kamera
  // som har stått 2 dager uten treff skal IKKE gi et sikkert "lav aktivitet".
  const periodeKonfidens = Math.min(activeDays / 14, 1); // moden etter ~2 uker
  const datamengdeKonfidens = Math.min(observationEvents / 8, 1); // moden etter ~8 hendelser
  const confidence = Math.min(
    periodeKonfidens * 0.5 + datamengdeKonfidens * 0.5,
    1
  );

  return {
    level,
    score: Math.round(score * 10) / 10,
    activeDays,
    observationEvents,
    totalAnimals,
    observationsPerWeek: Math.round(observationsPerWeek * 100) / 100,
    animalsPerWeek: Math.round(animalsPerWeek * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/** Menneskevennlig periodetekst: "9 uker", "9 uker og 3 dager", "2 dager". */
export function formaterPeriode(dager: number): string {
  if (dager < 7) return `${dager} ${dager === 1 ? "dag" : "dager"}`;

  const uker = Math.floor(dager / 7);
  const restDager = dager % 7;
  const ukerTekst = `${uker} ${uker === 1 ? "uke" : "uker"}`;

  if (restDager === 0) return ukerTekst;
  return `${ukerTekst} og ${restDager} ${restDager === 1 ? "dag" : "dager"}`;
}

/** hentTimerSiden re-eksportert herfra for bekvemmelighet i kamera-relatert kode. */
export { hentTimerSiden };
