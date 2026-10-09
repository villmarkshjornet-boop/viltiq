// ViltIQ — Analysis Anchor & hysterese (V1.3 §C/§D, V1.5 §product-fix i
// motoroppdraget).
//
// V1.2.2 løste GPS-lock (analysen fulgte alltid brukerens posisjon, aldri
// kartet) ved å la `analyseSenter` følge kartets region direkte, debounced
// 500 ms. Det løste GPS-problemet, men skapte en ny svakhet: enhver
// panorering — også en liten, ubetydelig en — flyttet HELE analysegridet,
// så hotspotene "hoppet" selv når brukeren fortsatt så på samme terreng.
//
// V1.3 "løste" DET med geografisk hysterese: `shouldReuseAnalysisAnchor()`
// under lot ankeret stå stille for SMÅ panoreringer, men lot kartet
// (app/kart.tsx sin `onRegionChangeComplete` → `viewportCandidate`) AUTOMATISK
// flytte ankeret — og dermed trigge en ny motorkjøring, en NY prediksjon på et
// nytt sted — så snart panoreringen var stor nok til å krysse dead-zonen. Det
// var fortsatt feil produktoppførsel: brukeren opplevde at prediksjonen
// "hoppet" bare kameraet flyttet seg langt nok, uansett hvor stor terskelen
// var satt. Roten av problemet var ALDRI terskelens størrelse — det var at
// KAMERAET i det hele tatt fikk lov til å være triggeren.
//
// V1.5 KORRIGERING (produktregel, absolutt): panorering/zoom av kartet skal
// ALDRI, uansett avstand, av seg selv føre til en ny analyse. `analysisAnchor`
// (app/kart.tsx) settes nå KUN (a) én gang ved oppstart (GPS/første viewport
// etablerer det aller første ankeret), eller (b) når brukeren eksplisitt
// trykker "Analyser dette området". `onRegionChangeComplete` skriver kun til
// den rene kamera-/UI-tilstanden (`kartRegion`) — den rører ALDRI ankeret.
//
// Funksjonene i DENNE filen er fortsatt nyttige og UENDRET i selve
// signaturen/logikken — bare BRUKEN av dem i kart.tsx er endret:
//  1. deriveViewportRadiusMeters(): kartets region -> en analyseradius som
//     faktisk representerer det brukeren ser (§D), med margin og et
//     øvre tak (samme filosofi som V1.2.2s 5 km-tak, men nå avledet fra
//     viewporten i stedet for en fast brukerinnstilling).
//  2. shouldReuseAnalysisAnchor(): den geografiske hysterese-regelen (§C) —
//     IKKE lenger brukt til å AUTOMATISK flytte ankeret, men til å avgjøre
//     om "Analyser dette området"-knappen skal VISES (er viewporten flyttet
//     langt nok fra det låste ankeret til at en ny analyse ville vært
//     meningsfull?). Samme geografiske spørsmål, ny — eksplisitt,
//     brukerstyrt — konsekvens.

import { distanceMeters } from "@/src/lib/geo";
import type { LatLng } from "@/src/engine";

const METERS_PER_DEG_LAT = 111320;

/** Kartets nåværende region — samme form som components/MapView.types.ts sin Region, men uavhengig importert her for å holde denne filen fri for React/kart-avhengigheter. */
export type ViewportRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

/** Et låst analyseanker: senteret og radiusen SISTE motorkjøring faktisk dekket. */
export type AnalysisAnchor = { center: LatLng; radiusMeters: number };

/** Minste radius vi noensinne analyserer med, selv ved et ekstremt nært zoom — for lite gir et ustabilt, nesten meningsløst lite grid. */
export const MIN_ANALYSIS_RADIUS_METERS = 500;
/** Øvre tak — samme filosofi som V1.2.2s tidligere faste 5 km, men nå et tak PÅ den viewport-avledede radiusen, ikke selve verdien. Ytelseshensyn (§D: "unngå at hvert zoom-steg rescorer verden"), ikke en påstand om motorens faktiske rekkevidde. */
export const MAX_ANALYSIS_RADIUS_METERS = 5000;
/** Margin lagt til selve viewportens halvdiagonal, slik at heatmap/soner nær kartkanten har nødvendig kontekst og ikke kuttes kunstig (§D/§17 i V1.2.2-oppdraget om viewport-buffer, videreført her). */
const VIEWPORT_MARGIN_FACTOR = 1.3;

/**
 * Avleder en analyseradius (m) fra kartets synlige region — §D: "analyse-
 * området skal dekke kartområdet brukeren faktisk undersøker, med
 * nødvendig margin", i stedet for V1.2.2s faste `min(radiusKm×1000, 5000)`
 * som var uavhengig av selve zoomnivået. Bruker halve viewportens
 * DIAGONAL (ikke bare bredde eller høyde alene) som et konservativt mål på
 * "hvor langt fra senter er kartkanten", ganger inn en margin, og
 * klipper til [MIN_ANALYSIS_RADIUS_METERS, MAX_ANALYSIS_RADIUS_METERS].
 */
export function deriveViewportRadiusMeters(region: ViewportRegion): number {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((region.latitude * Math.PI) / 180) || 1;
  const halfHeightMeters = (region.latitudeDelta * METERS_PER_DEG_LAT) / 2;
  const halfWidthMeters = (region.longitudeDelta * metersPerDegLon) / 2;
  const halfDiagonalMeters = Math.hypot(halfHeightMeters, halfWidthMeters);
  const withMargin = halfDiagonalMeters * VIEWPORT_MARGIN_FACTOR;
  return Math.min(MAX_ANALYSIS_RADIUS_METERS, Math.max(MIN_ANALYSIS_RADIUS_METERS, withMargin));
}

export type HysteresisOptions = {
  /**
   * Hvor stor andel av det EKSISTERENDE ankerets radius senteret kan ha
   * flyttet seg og fortsatt regnes som "samme område" (§C: "Hvis viewport
   * fortsatt overlapper en stor del av eksisterende analyseområde, behold
   * eksisterende analyse"). 0.4 er valgt som en bevisst, dokumentert
   * avveining: lavt nok til at en reell forflytning til et NYTT jaktterreng
   * (typisk mer enn en skjerm-bredde unna) alltid trigger ny analyse, høyt
   * nok til at normal "undersøk sonen litt nærmere"-panorering (noen
   * hundre meter, jf. §C sitt eget eksempel) IKKE gjør det — ved en
   * 5 km-radiusanalyse tilsvarer 0.4 en dead-zone på ~2 km, godt over de
   * "100–300 m" testmatrisen (§Y-A) eksplisitt krever skal holde seg stabile.
   */
  centerFraction?: number;
  /**
   * Hvor mye STØRRE den nye viewport-avledede radiusen kan være enn det
   * eksisterende ankeret dekker, før vi likevel krever en ny analyse — selv
   * om senteret knapt har flyttet seg (typisk: brukeren zoomet kraftig ut).
   * 1.3 = samme marginfaktor som selve viewport-radiusen bruker, altså "en
   * ny analyse trengs først når den nye viewporten faktisk ber om synlig
   * mer areal enn det som allerede er dekket".
   */
  radiusGrowthFactor?: number;
};

const DEFAULT_HYSTERESIS: Required<HysteresisOptions> = {
  centerFraction: 0.4,
  radiusGrowthFactor: VIEWPORT_MARGIN_FACTOR,
};

/**
 * Den geografiske hysterese-regelen (§C): skal en eksisterende, allerede
 * kjørt analyse gjenbrukes for den nye viewporten, eller trengs en ny
 * motorkjøring? Ren funksjon — ingen debounce/timing her (det er et eget,
 * separat ansvar i kart.tsx, se §C: "500 ms debounce alene er ikke nok...
 * vi trenger begge").
 *
 * Regel: gjenbruk EKSISTERENDE anker hvis (a) det nye viewport-senteret
 * fortsatt ligger godt innenfor det ankeret allerede dekket, OG (b) den nye
 * viewporten ikke ber om vesentlig MER areal enn ankeret dekker. Ellers:
 * ny analyse, med et NYTT anker sentrert på den nye viewporten.
 */
export function shouldReuseAnalysisAnchor(
  anchor: AnalysisAnchor | null,
  newViewportCenter: LatLng,
  newViewportRadiusMeters: number,
  options: HysteresisOptions = {}
): boolean {
  if (!anchor) return false;
  const { centerFraction, radiusGrowthFactor } = { ...DEFAULT_HYSTERESIS, ...options };

  const centerDrift = distanceMeters(anchor.center, newViewportCenter);
  const centerStillCovered = centerDrift <= anchor.radiusMeters * centerFraction;
  const viewportStillFitsCoverage = newViewportRadiusMeters <= anchor.radiusMeters * radiusGrowthFactor;

  return centerStillCovered && viewportStillFitsCoverage;
}
