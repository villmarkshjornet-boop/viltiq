// ViltIQ V1.5 — presentasjonshjelpere for sone-/heatmap-visning på kartet.
//
// BEVISST en presentasjonsfil i src/lib (samme prinsipp som heatmapRender.ts):
// endrer ALDRI motorens resultat (score, zone-medlemskap, footprint.hull) —
// kun HVORDAN et allerede ferdig PredictionZone/heatmap tegnes. Motoren
// forblir eneste sannhetskilde; denne filen vet ingenting om observasjoner,
// grid-celler eller scoring, kun om et allerede utledet PredictionMode.
//
// Bakgrunn (kold-start-visningsoppdraget): rå score over et stort,
// sammenhengende miljø-platå (cold start, ingen/få observasjoner) er ofte
// ekte flat — motoren har ærlig ikke noe mer presist å basere seg på ennå
// (se grid.ts sin extractZones()-dokumentasjon). Presentert med akkurat
// samme visuelle tyngde som en fersk, observasjonsbekreftet sone, leser dette
// som falsk presisjon ("dyret er akkurat her"). Denne filen gir kold-start
// (`environment_only`) en bevisst LETTERE visuell vekt, og glatter det rå
// rutenett-omrisset (gridBoundaryPolygon) til en rundere kontur — begge deler
// er ren rendering, ikke en endring av hva motoren faktisk fant.

import type { LatLng } from "./geo";
import type { PredictionMode } from "@/src/engine/types";

/** Kort merkelapp for et badge/kartikon — samme tre modi som motoren allerede skiller (PredictionMode), ingen ny klassifisering. */
export const PREDICTION_MODE_LABEL: Record<PredictionMode, string> = {
  environment_only: "Terreng",
  environment_plus_local: "Terreng + observasjon",
  local_dominant: "Observasjon",
};

/**
 * Fullsetning-forklaringen — FLYTTET hit fra EngineStatusPanel.tsx (som
 * tidligere hadde denne som en lokal, inline record) slik at kart.tsx sin
 * passive kartvisning og panelets aktive forklaring alltid viser NØYAKTIG
 * samme tekst for samme modus, ikke to parallelle strenger som kan drifte
 * fra hverandre over tid.
 */
export const PREDICTION_MODE_DESCRIPTION: Record<PredictionMode, string> = {
  environment_only: "Basert hovedsakelig på terreng og forhold",
  environment_plus_local: "Terreng og lokale observasjoner støtter området",
  local_dominant: "Sterk fersk lokal aktivitet",
};

/**
 * Visuell "tyngde" for en sones fyll/kontur basert på PredictionMode — BRUKT
 * SOM EN MULTIPLIKATOR oppå den eksisterende rangeringsbaserte tieringen
 * (zoneTierStyle i kart.tsx), ikke en erstatning for den. Rangering sier
 * "hvor god er denne sonen sammenlignet med de andre akkurat nå" — dette sier
 * "hvor mye av det er faktisk bekreftet av lokale data akkurat her". En
 * kold-start-sone (uansett rangering) skal ALDRI se like "sikker"/heldekket
 * ut som en fersk, observasjonsbekreftet sone — se kold-start-oppdragets §5/§9.
 */
export type ZoneVisualWeight = {
  /** Multipliseres inn i tier sin fillColor-alpha (0–1). */
  fillAlphaFactor: number;
  /** Multipliseres inn i tier sin strokeColor-alpha (0–1). */
  strokeAlphaFactor: number;
  /** Stiplet kontur for rene terrengantakelser — en ekstra, umiddelbart lesbar "dette er ikke bekreftet"-signatur uten mer tekst på kartet (§18: unngå tekststøy). */
  dashed: boolean;
};

export function zoneVisualWeight(predictionMode: PredictionMode): ZoneVisualWeight {
  switch (predictionMode) {
    case "environment_only":
      return { fillAlphaFactor: 0.45, strokeAlphaFactor: 0.7, dashed: true };
    case "environment_plus_local":
      return { fillAlphaFactor: 0.75, strokeAlphaFactor: 0.9, dashed: false };
    case "local_dominant":
      return { fillAlphaFactor: 1, strokeAlphaFactor: 1, dashed: false };
  }
}

/**
 * Multipliserer alpha-kanalen (siste 2 hex-siffer) i en "#RRGGBBAA"-farge med
 * `factor` (0–1) — ren fargearitmetikk, ingen ny fargepalett. Farger uten en
 * eksplisitt alpha-hale (ren "#RRGGBB", forutsettes 100%/"FF") håndteres også.
 */
export function scaleHexAlpha(hexColor: string, factor: number): string {
  const clampedFactor = Math.max(0, Math.min(1, factor));
  const hasAlpha = hexColor.length === 9;
  const base = hasAlpha ? hexColor.slice(0, 7) : hexColor;
  const currentAlpha = hasAlpha ? parseInt(hexColor.slice(7, 9), 16) : 255;
  const nextAlpha = Math.round(currentAlpha * clampedFactor);
  return `${base}${nextAlpha.toString(16).padStart(2, "0").toUpperCase()}`;
}

/** Maks antall punkter i INPUT-omrisset vi glatter — et uvanlig komplekst/forgrenet kold-start-platå skal ikke få rendering-kostnaden til å vokse ukontrollert (§13 i kold-start-oppdraget: ren ytelse, ingen visuell endring for de aller fleste soner). */
const MAX_SMOOTH_INPUT_POINTS = 200;

/**
 * Chaikin corner-cutting — en velkjent, avhengighetsfri metode for å glatte
 * et LUKKET polygon-omriss uten å bevege det bort fra sin faktiske
 * utstrekning (§8 i kold-start-oppdraget: "IKKE flytt hotspots, kun forbedre
 * rendering"). Hvert hjørne av det rå rutenett-omrisset (gridBoundaryPolygon)
 * erstattes med to punkter 25%/75% langs hver kant, gjentatt `iterations`
 * ganger — resultatet er en rundere, mer organisk kontur som fortsatt følger
 * nøyaktig samme underliggende form, kun uten de knivskarpe 90°-cellehjørnene.
 * `points` tolkes som en LUKKET ring (siste punkt kobles implisitt tilbake
 * til det første — samme konvensjon som <Polygon coordinates=...> allerede
 * bruker), IKKE en åpen linje.
 */
export function smoothPolygonRing(points: readonly LatLng[], iterations = 2): LatLng[] {
  if (points.length < 3) return [...points];
  // Et uvanlig detaljert omriss glattes med kun ÉN runde i stedet for å
  // hoppes helt over — fortsatt en synlig forbedring, uten at punktantallet
  // (som dobles per hjørne per runde) vokser urimelig for rendering.
  const effectiveIterations = points.length > MAX_SMOOTH_INPUT_POINTS ? Math.min(1, iterations) : iterations;

  let ring: readonly LatLng[] = points;
  for (let iter = 0; iter < effectiveIterations; iter++) {
    const next: LatLng[] = [];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const p0 = ring[i];
      const p1 = ring[(i + 1) % n];
      next.push({
        latitude: p0.latitude * 0.75 + p1.latitude * 0.25,
        longitude: p0.longitude * 0.75 + p1.longitude * 0.25,
      });
      next.push({
        latitude: p0.latitude * 0.25 + p1.latitude * 0.75,
        longitude: p0.longitude * 0.25 + p1.longitude * 0.75,
      });
    }
    ring = next;
  }
  return ring as LatLng[];
}
