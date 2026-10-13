import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, {
  Circle,
  Heatmap,
  HEATMAP_GRADIENT,
  Marker,
  Polygon,
  PROVIDER_GOOGLE,
} from "@/components/MapView";
import type { LongPressEvent, MapViewHandle } from "@/components/MapView";
import type { Region } from "@/components/MapView.types";

import RetningVelger from "@/components/RetningVelger";
import {
  deactivateCamera,
  saveCamera,
  subscribeToVisibleCameras,
  updateCamera,
  type Viltkamera,
} from "@/src/services/cameras";
import {
  subscribeToJaktlagLocations,
  syncUserLocation,
  type MedlemPosisjon,
  type UserPosition,
} from "@/src/services/location";
import { getAktivtJaktlagId } from "@/src/services/jaktlag";
import { auth } from "@/src/config/firebase";
import {
  deleteObservation,
  saveObservation,
  subscribeToNearbyObservations,
  subscribeToObservationsByCamera,
} from "@/src/services/observations";
import {
  KART_PUNKT_TYPER,
  saveMapPoint,
  subscribeToVisibleMapPoints,
  type MapPoint,
} from "@/src/services/mapPoints";
import { getSettings, saveSettings } from "@/src/services/settings";
import type { Observasjon, SporType } from "@/src/types/observation";
import {
  dyrEmoji,
  hentRelativTid,
} from "@/src/lib/aktivitet";
import {
  anonymiserPosisjon,
  buildSector,
  movePoint,
} from "@/src/lib/geo";
import { applyHeatmapRenderWeight } from "@/src/lib/heatmapRender";
import {
  deriveViewportRadiusMeters,
  shouldReuseAnalysisAnchor,
  MAX_ANALYSIS_RADIUS_METERS,
  type AnalysisAnchor,
} from "@/src/lib/analysisAnchor";
import {
  runEngine,
  runEcologicalEngine,
  resolveEnvironmentContext,
  buildPredictionSnapshot,
  shouldSaveSnapshot,
  DEFAULT_SNAPSHOT_MIN_INTERVAL_MS,
  type Species as EngineSpecies,
  type EnvironmentResolver,
  type PredictionZone,
  type PredictionMode,
  type HeatmapPoint,
  type EngineResult,
  type LatLng,
  logIntelligenceDebug,
} from "@/src/engine";
import { setCachedIntelligenceResult, getCachedIntelligenceResult } from "@/src/engine/resultCache";
import { zoneVisualWeight, scaleHexAlpha, smoothPolygonRing } from "@/src/lib/zonePresentation";
import { savePredictionSnapshot } from "@/src/services/predictions";
// HuntPlan-oppdraget (§3): buildHuntPlan()/HuntPlan bygges av en parallell
// motoroppgave i src/engine/huntPlan.ts (NY fil — kart.tsx eier kun
// VISNINGEN, ikke selve vind-/bevegelses-/rangeringslogikken der). Kartet
// kaller funksjonen akkurat som runEngine/runEcologicalEngine over — én
// deterministisk motorkall, ingen egen parallell beregning her.
import { buildHuntPlan, stablePredictionSnapshotId, type HuntPlan } from "@/src/engine/huntPlan";
import { color as uiColor, radius as uiRadius, spacing as uiSpacing, zIndex as uiZ, elevation as uiElevation, minTouchTarget, glass as uiGlass, alpha as uiAlpha, typography as uiType } from "@/src/design/tokens";
import Surface from "@/components/ui/Surface";
import Toggle from "@/components/ui/Toggle";
import BottomSheet, { type SheetSnap } from "@/components/ui/BottomSheet";
import ModalSheet from "@/components/ui/ModalSheet";
import EngineStatusPanel from "@/components/ui/EngineStatusPanel";
import HuntPlanPanel, { MEANINGFUL_MOVEMENT_CONFIDENCE } from "@/components/ui/HuntPlanPanel";
import { MarkerBadge, MarkerRing, StableMarker } from "@/components/ui/Marker";
import { visAlert } from "@/src/lib/confirmAlert";

// ─── Typer ────────────────────────────────────────────────────────────────────

type MapPin = { latitude: number; longitude: number };

type AktivSone = {
  id: string;
  dyr: string;
  latitude: number;
  longitude: number;
  antall: number;
  tidLabel: string;
  type: "nå" | "snart";
};

type PinAction = "menu" | "kamera" | "dyr" | "spor" | "annet";
type CameraView = "info" | "observasjon" | "rediger";

// ─── Konstanter ───────────────────────────────────────────────────────────────

// react-native-maps sin Heatmap.gradient-prop vil ha vanlige (ikke
// readonly) arrays — HEATMAP_GRADIENT selv er `as const` for andre
// forbrukere (LeafletMapImpl), så én mutbar kopi lages her, én gang.
const heatmapGradientProp = {
  colors: [...HEATMAP_GRADIENT.colors],
  startPoints: [...HEATMAP_GRADIENT.startPoints],
  colorMapSize: HEATMAP_GRADIENT.colorMapSize,
};

// V1.3 (§K/§L): hevet fra 32 — heatmapets grid-celler ligger cfg.cellSizeMeters
// (150 m, src/engine/config.ts) fra hverandre, og radius er i SKJERM-PIKSLER,
// ikke meter (se Heatmap-kommentaren under). Ved zoom-nivåene brukeren faktisk
// analyserer et område på, ga 32 px for lite overlapp mellom nabo-celler til
// at feltet leste som én sammenhengende sone — det så ut som spredte,
// isolerte prikker i stedet (§L). 42 px, kombinert med den økte
// blur/radius-andelen i LeafletMapImpl.tsx (0.7 → 0.9), gir bredere,
// mykere overlappende "stempler" som smelter sammen til en flate ved typisk
// analysezoom, uten å endre selve vektene som sendes inn (samme
// heatmapRenderPoints, kun presentasjon).
const HEATMAP_POINT_RADIUS = 42;

// Hunting-zones-oppdraget §7: matcher motorens egen zones.maxZones-hensikt
// ("få, meningsfulle soner") — kartet viser aldri flere soner enn dette selv
// om motoren i prinsippet returnerte flere, se visteHotspots under.
const MAX_VISIBLE_ZONES = 5;

/**
 * Hunting-zones-oppdraget §1: rangeringsbasert visuell hierarki for
 * sonepolygoner/-ringer på kartet — "#1 skal være øyeblikkelig synlig som
 * ViltIQs anbefaling", ikke bare noe brukeren må trykke seg frem til. Rene,
 * deterministiske presentasjonsverdier avledet fra SAMME uiColor.levelHøy-
 * tone (design-tokens, ingen nye farger oppfunnet her) — jo lavere
 * rangering (høyere rank-tall), jo svakere/mer transparent. Rank 4/5
 * (innenfor motorens egen maxZones-tak, se config.ts) deler samme, svakeste
 * tier som rank 3 — en femte sone skal fortsatt være LESBAR, ikke visuell støy.
 */
// Kold-start-visningsoppdraget §5/§9: rangering (rank) og datagrunnlag
// (predictionMode) er to UAVHENGIGE akser — en cold-start-sone kan fortsatt
// være #1 (best av det som finnes), men skal ALDRI se like "bekreftet" ut
// som en observasjonsdrevet sone. `zoneVisualWeight` (src/lib/zonePresentation)
// gir den andre aksen; multiplisert inn i den eksisterende rank-baserte
// tieringen under, ikke en erstatning for den.
function zoneTierStyle(rank: number, predictionMode: PredictionMode) {
  const base = (() => {
    if (rank <= 1) {
      return {
        ringSize: 32,
        ringColor: uiColor.levelHøy,
        strokeColor: uiColor.levelHøy,
        strokeWidth: 2.5,
        fillColor: uiColor.levelHøy + "40", // ~25% — klart synlig, men obscurerer ikke heatmapet/kartet under
      };
    }
    if (rank === 2) {
      return {
        ringSize: 24,
        ringColor: uiColor.levelHøy + "CC", // ~80%
        strokeColor: uiColor.levelHøy + "B3", // ~70%
        strokeWidth: 1.75,
        fillColor: uiColor.levelHøy + "26", // ~15%
      };
    }
    return {
      ringSize: 18,
      ringColor: uiColor.levelHøy + "80", // ~50%
      strokeColor: uiColor.levelHøy + "66", // ~40%
      strokeWidth: 1,
      fillColor: uiColor.levelHøy + "14", // ~8%
    };
  })();

  const weight = zoneVisualWeight(predictionMode);
  return {
    ...base,
    fillColor: scaleHexAlpha(base.fillColor, weight.fillAlphaFactor),
    strokeColor: scaleHexAlpha(base.strokeColor, weight.strokeAlphaFactor),
    ringColor: scaleHexAlpha(base.ringColor, weight.strokeAlphaFactor),
    lineDashPattern: weight.dashed ? [8, 6] : undefined,
  };
}

const dyrListe    = ["Rådyr", "Elg", "Hjort", "Rev"];
const dyrFilter   = ["Alle", ...dyrListe];
/** Registrering (nytt pin/spor/kamera) skal IKKE tilby Rev som valg — kun
 * jaktbare arter registreres aktivt. "Rev" beholdes i dyrListe/dyrFilter selv
 * (motorberegning + visningsfilter for evt. allerede lagrede Rev-observasjoner). */
const dyrRegistrerbar = dyrListe.filter((d) => d !== "Rev");
/** De tre artene Hjem sin art-karusell støtter (§3 i art-karusell-oppdraget) — "Alle"/"Rev" har ingen egen hero der, så et filtervalg av dem skriver ikke selectedSpecies. */
const KARUSELL_ART_FRA_DYR: Partial<Record<string, EngineSpecies>> = { Hjort: "hjort", Rådyr: "radyr", Elg: "elg" };

// ─── "Åpne kart fra Hjem"-fokusering ───────────────────────────────────────
//
// Kart-fokuseringsoppdraget: Hjem sin "Åpne kart"-knapp navigerer hit med
// focusLat/focusLng (senteret av Hjem sin anbefalte sone) — effekten under
// (§"Fokuser kart") brukte tidligere en FAST 0.10° delta rundt kun DETTE
// punktet, uavhengig av hvor brukerens EGEN posisjon lå. Resultatet: et
// altfor tett utsnitt uten terrengkontekst når sonen lå noen kilometer unna
// brukeren (og motsatt: et utsnitt som ikke fanget opp sonens faktiske
// utstrekning når den var stor). Målet her er samme "fit bounds + padding"-
// oppførsel som f.eks. Google Maps gir ved åpning av et søkeresultat: vis
// BÅDE brukerens posisjon OG hele den anbefalte sonens fotavtrykk, med nok
// margin til at omkringliggende terreng er synlig — IKKE et gjettet fast
// zoomnivå.
//
// Sonens EKTE fotavtrykk (footprint.hull, samme konvekse skrog kartets egen
// polygon-rendering allerede bruker, se lenger ned) hentes fra DEN SAMME
// delte resultCache.ts Hjem nettopp skrev til (§20/§25) — Hjem har alltid
// rukket å kjøre sin egen motor/cache-skriveeffekt FØR brukeren rekker å
// trykke "Åpne kart" og komme hit, så et cache-treff her er det normale
// tilfellet, ikke unntaket. Uteblir det (cache tom/utløpt/annen art), faller
// vi tilbake til KUN det rå focusLat/focusLng-punktet — fortsatt riktig
// oppført sammen med brukerposisjonen, bare uten sonens egen utstrekning.
//
// Bevisst IKKE en ny motorkjøring her — vi LESER kun et allerede beregnet
// resultat, akkurat som Hjem/Jakt sin egen cache-lesing. Kartets EGEN
// analysisAnchor-drevne motorkjøring (lenger ned i filen) er helt urørt og
// tar uansett over cache-oppføringen for arten kort tid etter mount — denne
// fokuseringen er kun det ENGANGS initiale kamera-utsnittet.

/** Nedre grense for fokus-deltaen — hindrer "gate-nivå" overzooming når sonen ligger rett ved/på brukerens posisjon. ~0.05° ≈ 5,5 km nord-sør, dvs. fortsatt en tydelig regional oversikt (til sammenligning: gate-nivå-zoom i denne kodebasen bruker delta ned mot 0.005–0.01). */
const FOCUS_MIN_DELTA = 0.05;
/** Øvre grense for fokus-deltaen — hindrer et ubrukelig "hele fylket"-utsnitt hvis brukeren skulle stå uvanlig langt fra sonen (analyseradiusen er normalt langt mindre enn dette). ~0.8° ≈ 89 km nord-sør. */
const FOCUS_MAX_DELTA = 0.8;
/** Marginfaktor rundt selve fit-bounds-utstrekningen (brukerposisjon + sonens fotavtrykk) — 1,6× gir ca. 30 % luft på hver side, slik at ingen av de to punktene havner helt i kartkanten (§"generøs padding" i oppdraget). */
const FOCUS_PADDING_FACTOR = 1.6;

const METERS_PER_LAT_DEGREE = 111_320;

/**
 * Sonens fotavtrykk som en liste med punkter fit-bounds-utregningen kan
 * spenne over — foretrekker det EKTE konvekse skroget (footprint.hull,
 * samme kilde som polygon-rendering, se lenger ned i filen), og faller kun
 * tilbake til en grov firepunkts sirkel-approksimasjon (senter ± radiusMeters
 * i fire himmelretninger) hvis sonen mangler et brukbart hull.
 */
function sonefotavtrykkPunkter(sone: PredictionZone): LatLng[] {
  const hull = sone.footprint?.hull;
  if (hull && hull.length >= 3) return hull;
  const latRad = (sone.center.latitude * Math.PI) / 180;
  const dLat = sone.radiusMeters / METERS_PER_LAT_DEGREE;
  const dLng = sone.radiusMeters / (METERS_PER_LAT_DEGREE * Math.max(Math.cos(latRad), 0.01));
  return [
    sone.center,
    { latitude: sone.center.latitude + dLat, longitude: sone.center.longitude },
    { latitude: sone.center.latitude - dLat, longitude: sone.center.longitude },
    { latitude: sone.center.latitude, longitude: sone.center.longitude + dLng },
    { latitude: sone.center.latitude, longitude: sone.center.longitude - dLng },
  ];
}

/**
 * Bygger en Region som (med padding) omslutter alle `punkter` — samme
 * "fit bounds"-idé som kartbiblioteker flest sin fitBounds()/fitToCoordinates(),
 * her implementert selv siden MapViewHandle (components/MapView.types.ts) kun
 * eksponerer imperativ animateToRegion(region), ikke en egen bounds-variant.
 * Deltaene klemmes til [FOCUS_MIN_DELTA, FOCUS_MAX_DELTA] (§ moderat
 * oversiktszoom, aldri gate-nivå, aldri et ubrukelig fylkesutsnitt).
 */
function fitRegionRundtPunkter(punkter: LatLng[]): Region {
  const breddegrader = punkter.map((p) => p.latitude);
  const lengdegrader = punkter.map((p) => p.longitude);
  const minLat = Math.min(...breddegrader);
  const maxLat = Math.max(...breddegrader);
  const minLng = Math.min(...lengdegrader);
  const maxLng = Math.max(...lengdegrader);
  const clamp = (delta: number) => Math.min(FOCUS_MAX_DELTA, Math.max(FOCUS_MIN_DELTA, delta));
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: clamp((maxLat - minLat) * FOCUS_PADDING_FACTOR),
    longitudeDelta: clamp((maxLng - minLng) * FOCUS_PADDING_FACTOR),
  };
}
const sporTypeListe: SporType[] = [
  "Fotspor", "Avføring", "Beitespor", "Liggeplass", "Feiing", "Annet",
];
const kjonnListe = ["Hann", "Hunn"];
const alderListe = ["Kalv", "Ungdyr", "Voksen"];

const retningListe = [
  { label: "N",  grader: 0   },
  { label: "NØ", grader: 45  },
  { label: "Ø",  grader: 90  },
  { label: "SØ", grader: 135 },
  { label: "S",  grader: 180 },
  { label: "SV", grader: 225 },
  { label: "V",  grader: 270 },
  { label: "NV", grader: 315 },
];

// ─── Hjelpefunksjoner ─────────────────────────────────────────────────────────

// Kalkuler aktive soner basert på klokkeslett-mønster fra historiske observasjoner.
// "nå"-soner: observasjoner innen ±1.5h av nåværende klokkeslett (alle dager).
// "snart"-soner: observasjoner i vinduet +1h fra nå → prosjekter 100m bakover.
function buildAktiveSoner(obs: Observasjon[]): AktivSone[] {
  const nå    = new Date();
  const nåH   = nå.getHours() + nå.getMinutes() / 60;
  const snartH = (nåH + 1) % 24;
  const soner: AktivSone[] = [];

  for (const dyr of dyrListe) {
    const medGps = obs.filter(
      (o) => o.dyr === dyr && o.latitude != null && o.longitude != null
    );

    // Nå-vindu: ±1.5t
    const nåRel = medGps.filter((o) => {
      const h   = new Date(o.tid).getHours() + new Date(o.tid).getMinutes() / 60;
      const d   = Math.abs(h - nåH);
      return Math.min(d, 24 - d) <= 1.5;
    });
    if (nåRel.length >= 2) {
      const sumLat = nåRel.reduce((s, o) => s + (o.latitude as number), 0);
      const sumLon = nåRel.reduce((s, o) => s + (o.longitude as number), 0);
      const h = Math.floor(nåH);
      const m = Math.floor((nåH - h) * 60);
      soner.push({
        id: `aktiv-nå-${dyr}`,
        dyr,
        latitude:  sumLat / nåRel.length,
        longitude: sumLon / nåRel.length,
        antall: nåRel.length,
        tidLabel: `Aktivt ~${h}:${m.toString().padStart(2, "0")}`,
        type: "nå",
      });
    }

    // Snart-vindu: ±1t rundt (nå + 1h), minst 3 obs
    const snartRel = medGps.filter((o) => {
      const h   = new Date(o.tid).getHours() + new Date(o.tid).getMinutes() / 60;
      const d   = Math.abs(h - snartH);
      return Math.min(d, 24 - d) <= 1.0;
    });
    if (snartRel.length >= 3) {
      const sumLat = snartRel.reduce((s, o) => s + (o.latitude as number), 0);
      const sumLon = snartRel.reduce((s, o) => s + (o.longitude as number), 0);
      const centroid = {
        latitude:  sumLat / snartRel.length,
        longitude: sumLon / snartRel.length,
      };
      // Prosjekter 100m bakover i bevegelsesretning (dyrene er på vei mot dette stedet)
      const medDir  = snartRel.filter((o) => o.retning != null);
      const avgDir  = medDir.length > 0
        ? medDir.reduce((s, o) => s + (o.retning as number), 0) / medDir.length
        : null;
      const pos = avgDir != null
        ? movePoint(centroid.latitude, centroid.longitude, (avgDir + 180) % 360, 100)
        : centroid;

      const h = Math.floor(snartH);
      const m = Math.floor((snartH - h) * 60);
      soner.push({
        id: `aktiv-snart-${dyr}`,
        dyr,
        latitude:  pos.latitude,
        longitude: pos.longitude,
        antall: snartRel.length,
        tidLabel: `Forventes ~${h}:${m.toString().padStart(2, "0")}`,
        type: "snart",
      });
    }
  }

  return soner;
}

function formatDato(verdi?: any): string {
  if (!verdi) return "Ukjent dato";
  let dato: Date;
  if (typeof verdi === "string") {
    dato = new Date(verdi);
  } else if (typeof verdi?.toDate === "function") {
    dato = verdi.toDate();
  } else {
    return "Ukjent dato";
  }
  if (Number.isNaN(dato.getTime())) return "Ukjent dato";
  return dato.toLocaleDateString("no-NO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function installertVarighet(verdi?: any): string {
  if (!verdi) return "Ukjent";
  const dato: Date = typeof verdi === "string" ? new Date(verdi)
    : typeof verdi?.toDate === "function" ? verdi.toDate() : new Date(NaN);
  if (Number.isNaN(dato.getTime())) return "Ukjent";
  const dager = Math.floor((Date.now() - dato.getTime()) / 86400000);
  if (dager <= 0) return "Satt opp i dag";
  if (dager === 1) return "1 dag";
  return `${dager} dager`;
}

// Enkel +/- steg-velger for antall dyr i en observasjon.
function AntallStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.stepperRow}>
      <Pressable onPress={() => onChange(Math.max(1, value - 1))} style={styles.stepperBtn}>
        <Ionicons name="remove" size={16} color="#CFE7DB" />
      </Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable onPress={() => onChange(value + 1)} style={styles.stepperBtn}>
        <Ionicons name="add" size={16} color="#CFE7DB" />
      </Pressable>
    </View>
  );
}

// Delt header for bunnark-underskjemaer — tilbake til meny + lukk helt.
function FormHeader({
  title, sub, onBack, onClose,
}: { title: string; sub?: string; onBack?: () => void; onClose: () => void }) {
  return (
    <View style={styles.pinHeader}>
      <View style={styles.pinHeaderLeft}>
        {onBack && (
          <Pressable onPress={onBack} style={styles.backStepBtn}>
            <Ionicons name="chevron-back" size={18} color="#CFE7DB" />
          </Pressable>
        )}
        <View>
          <Text style={styles.pinTitle}>{title}</Text>
          {!!sub && <Text style={styles.pinSub}>{sub}</Text>}
        </View>
      </View>
      <Pressable onPress={onClose} style={styles.closeBtn}>
        <Ionicons name="close" size={18} color="#9CA3AF" />
      </Pressable>
    </View>
  );
}

// ─── Hovedkomponent ───────────────────────────────────────────────────────────

export default function KartScreen() {
  const params = useLocalSearchParams<{
    focusLat?: string;
    focusLng?: string;
    filter?:   string;
    /** "1" — slå på ViltIQ Heatmap automatisk (brukt av "Vis i kart" fra Hjem/Jakt). */
    heatmap?:  string;
    /** Jaktplan-produktflyt-oppdraget §1: "1" — åpne Jaktplan-arket automatisk for beste synlige sone én gang etter mount (brukt av "Planlegg jakten" fra Jakt-fanen). Se auto-åpne-effekten lenger ned. */
    openPlan?: string;
  }>();
  const router = useRouter();
  const mapRef = useRef<MapViewHandle | null>(null);
  // På web kobles mapRef til den ekte imperative kart-instansen først når
  // Leaflet er ferdig lastet asynkront (se components/MapView.web.tsx) —
  // ikke synkront som på native. Uten dette flagget i avhengighetslisten
  // under kan fokuseringseffekten rekke å kjøre (og stille gjøre ingenting,
  // siden mapRef.current fortsatt er null) før kartet faktisk er klart, og
  // kjører aldri på nytt siden ingen av de andre avhengighetene endres
  // igjen — dyplenking (f.eks. "Vis i kart" fra "beste område" på
  // hjemskjermen) ville da svikte stille på web.
  const [mapReady, setMapReady] = useState(false);

  const [loading,      setLoading]      = useState(true);
  const [savingPin,    setSavingPin]    = useState(false);
  const [errorText,    setErrorText]    = useState("");
  const [mapMode,      setMapMode]      = useState<"terrain" | "satellite">("terrain");
  // §bugrapport V1.3: brukeren ba om et kompass — kartet tillater rotasjon
  // (ingen eksisterende atferd endres her), så "nord" er ikke alltid opp.
  // `mapHeading` speiler kartets FAKTISKE kompassretning (0 = nord-opp),
  // lest via mapRef.getCamera() etter hver fullførte region-endring — selve
  // kompass-nålen tegnes med MOTSATT rotasjon av denne, se compassWrap under.
  const [mapHeading,   setMapHeading]    = useState(0);
  const [radiusKm,     setRadiusKm]     = useState<10 | 25 | 50>(50);
  const [userLocation, setUserLocation] = useState<UserPosition | null>(null);
  // V1.2.2 KORRIGERING: motoren analyserte tidligere ALLTID området rundt
  // userLocation, uansett hvor brukeren hadde panorert kartet — bekreftet
  // feil ved faktisk testing (GPS i Kristiansand, men brukeren undersøkte et
  // jaktterreng langt unna). `analyseSenter` er kartets EGEN region-senter
  // (satt fra onRegionChangeComplete under, debounced), IKKE userLocation.
  // userLocation brukes fortsatt uendret til: initial kartposisjon,
  // posisjon-prikken på kartet, og "min posisjon"-knappen — se de stedene i
  // JSX-en under, urørt av denne endringen.
  const [kartRegion, setKartRegion] = useState<Region | null>(null);
  const regionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [observasjoner, setObservasjoner] = useState<Observasjon[]>([]);
  const [kameraer,     setKameraer]     = useState<Viltkamera[]>([]);
  const [mapPoints,    setMapPoints]    = useState<MapPoint[]>([]);
  const [filterOpen,   filterOpenSet]   = useState(false);
  const [aktivtFilter,   setAktivtFilter]   = useState(params.filter || "Alle");
  // Feltrapport (fysisk enhet, V1.3): "analyserer jeg område for jakt ... får
  // jeg ingen heatmap" — sporet til at dette laget stod AV som standard med
  // mindre Kart ble åpnet via en dyplenke med `?heatmap=1` (fra "Planlegg
  // jakten"/"Se på kart"). Åpner brukeren Kart-fanen direkte (den vanlige
  // veien, ingen dyplenke), fikk de aldri se motorens heatmap i det hele tatt
  // — uansett hvor mange ganger de trykket "Analyser dette området" — uten
  // noen indikasjon på at det bare var et skjult lag-valg. Dette ER appens
  // kjernefunksjon ("Intelligence Layer"), så den skal være PÅ som standard;
  // `?heatmap=1` fra dyplenker er nå bare en no-op (laget er uansett på).
  const [visPrediksjon,  setVisPrediksjon]  = useState(true);
  // Motor-tidsvindu (§18 i motor-oppdraget) — "nå" = ingen ekstra filter
  // (motorens egen tidsvekting, se signals.ts timeWeight, gjør allerede at
  // ferske signaler dominerer); "6t"/"24t" filtrerer bort observasjoner
  // eldre enn vinduet FØR de sendes til motoren, som en hard, forståelig
  // grense brukeren selv velger — ikke en endring i selve decay-matematikken.
  const [tidsvindu, setTidsvindu] = useState<"nå" | "6t" | "24t">("nå");
  const [visKameraer,    setVisKameraer]    = useState(true);
  const [visAktiveSoner, setVisAktiveSoner] = useState(false);
  const [visSporAnnet,   setVisSporAnnet]   = useState(true);
  const [visEiendomsgrenser, setVisEiendomsgrenser] = useState(false);
  const [visObservasjoner, setVisObservasjoner] = useState(true);
  const [medlsPosisjon,  setMedlsPosisjon]  = useState<MedlemPosisjon[]>([]);
  // Miljøoppslag (høyde/habitat/vær/snø/vind) til den økologiske prioren i
  // motoren — kun løst NÅR "Prediksjon" faktisk er slått på (nettverkskall,
  // ikke noe kartet trenger med mindre brukeren ber om det). Null = ikke
  // (ferdig) løst ennå; prediksjonsoner faller da tilbake til den rene
  // observasjonsmotoren under, uendret fra tidligere oppførsel.
  const [environmentResolver, setEnvironmentResolver] = useState<EnvironmentResolver | null>(null);

  // ── STEG 3: presentasjonslag (ren UI — påvirker aldri motor/datalogikk) ──
  const { width: skjermBredde, height: skjermHøyde } = useWindowDimensions();
  const erDesktop = skjermBredde >= 900;
  const [lagmenyÅpen, setLagmenyÅpen] = useState(false);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("collapsed");
  // V1.2 Steg 7 (§30-33): hvilken av motorens EGNE klyngede soner brukeren
  // har valgt å se forklaringen for. Faller automatisk tilbake til beste
  // sone (visteHotspots[0]) når valget ikke lenger finnes blant de viste
  // sonene (art-filter byttet, ny motorkjøring ga andre soner) — se
  // hotspotSone under. Ingen egen reset-effekt nødvendig.
  const [valgtHotspotId, setValgtHotspotId] = useState<string | null>(null);

  // ── HuntPlan (Jaktplan) §3.1/§3.15: id-en til sonen en jaktplan er åpen
  // for — null = ingen plan åpen. Bevisst en id (ikke sonen selv), samme
  // "slå opp i den ferske listen"-mønster som hotspotSone under, slik at en
  // ny motorkjøring aldri kan la panelet vise en foreldet sone-referanse.
  // IKKE navigasjon bort fra Kart (§3.15) — kun en modal/ark OVER kartet.
  const [huntPlanZoneId, setHuntPlanZoneId] = useState<string | null>(null);
  const [huntPlanTargetMs, setHuntPlanTargetMs] = useState<number>(() => Date.now());

  // ── Langtrykk-meny og nye punkter ──
  const [selectedPin,  setSelectedPin]  = useState<MapPin | null>(null);
  const [pinAction,    setPinAction]    = useState<PinAction | null>(null);

  const [valgtDyr,   setValgtDyr]   = useState("Rådyr");
  const [antallPin,  setAntallPin]  = useState(1);
  const [retningPin, setRetningPin] = useState<number | null>(null);

  const [kameraNavn,     setKameraNavn]     = useState("");
  const [kameraRetningNy, setKameraRetningNy] = useState(0);

  const [sporDyr,        setSporDyr]        = useState<string | null>(null);
  const [sporTypeValgt,  setSporTypeValgt]  = useState<SporType>("Fotspor");
  const [sporKommentar,  setSporKommentar]  = useState("");

  const [annetType,      setAnnetType]      = useState<string>(KART_PUNKT_TYPER[0]);
  const [annetNavn,      setAnnetNavn]      = useState("");
  const [annetKommentar, setAnnetKommentar] = useState("");

  // ── Valgt eksisterende kamera ──
  const [selectedCamera, setSelectedCamera] = useState<Viltkamera | null>(null);
  const [cameraView,     setCameraView]     = useState<CameraView>("info");
  const [cameraObsListe, setCameraObsListe] = useState<Observasjon[]>([]);
  const [savingCameraAction, setSavingCameraAction] = useState(false);

  const [regDyr,       setRegDyr]       = useState("Rådyr");
  const [regAntall,    setRegAntall]    = useState(1);
  const [regKjonn,     setRegKjonn]     = useState<string | null>(null);
  const [regAlder,     setRegAlder]     = useState<string | null>(null);
  const [regKommentar, setRegKommentar] = useState("");
  // Hvilken vei DYRET gikk — IKKE det samme som kameraets faste retning
  // (selectedCamera.directionDegrees). Valgfritt (§ kritisk korrigering):
  // regRetningKjent styrer om regRetning i det hele tatt sendes med ved lagring.
  const [regRetningKjent, setRegRetningKjent] = useState(false);
  const [regRetning,      setRegRetning]      = useState(0);

  const [editNavn,     setEditNavn]     = useState("");
  const [editRetning,  setEditRetning]  = useState(0);
  const [editNotat,    setEditNotat]    = useState("");

  // ─── Initialisering ───────────────────────────────────────────────────────

  useEffect(() => {
    let unsubObs: (() => void) | null = null;
    let unsubCam: (() => void) | null = null;
    let unsubPts: (() => void) | null = null;
    let unsubLoc: (() => void) | null = null;
    // Uten denne vakten: hvis skjermen unmountes mens en av await-ene under
    // fortsatt venter, blir cleanup-funksjonen kalt FØR unsub*-variablene er
    // satt (de er fortsatt null på det tidspunktet) — lytterne som opprettes
    // etter det lekker for resten av appens levetid. Samme mønster som
    // allerede brukt riktig i app/kamera/[id].tsx og observations.ts.
    let aktiv = true;

    (async () => {
      try {
        setLoading(true);
        const settings = await getSettings();
        if (!aktiv) return;
        setRadiusKm(settings.radiusKm);

        const aktivtJaktlagId = await getAktivtJaktlagId();
        if (!aktiv) return;

        // Kamera- og kartpunktlyttere (Firestore) — egne + jaktlagets
        try {
          unsubCam = subscribeToVisibleCameras(
            aktivtJaktlagId,
            (items) => setKameraer(items.filter((k) => k.active)),
            () => { /* stille — kartet fungerer uten kameraer */ }
          );
          unsubPts = subscribeToVisibleMapPoints(
            aktivtJaktlagId,
            (items) => setMapPoints(items),
            () => { /* stille */ }
          );
        } catch { /* ikke innlogget ennå */ }

        // Jaktlag-medlemmers live-posisjoner
        if (aktivtJaktlagId) {
          unsubLoc = subscribeToJaktlagLocations(aktivtJaktlagId, setMedlsPosisjon);
        }

        const perm = await Location.requestForegroundPermissionsAsync();
        if (!aktiv) return;
        if (perm.status !== "granted") {
          setErrorText("Lokasjon ble ikke godkjent.");
          setLoading(false);
          return;
        }

        // Feltrapport (fysisk enhet, V1.3): kartet ble stående i "Laster..."
        // på ubestemt tid uten noen feilmelding — `getCurrentPositionAsync`
        // har ingen innebygd timeout, og et kaldt GPS-fix (innendørs, første
        // oppslag etter appstart) kan henge svært lenge. Samme
        // timeout+siste-kjente-posisjon-mønster som src/services/location.ts
        // sin getUserPosition() nå bruker.
        const pos = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Posisjon tok for lang tid")), 12000)
          ),
        ]).catch(() => Location.getLastKnownPositionAsync());
        if (!aktiv) return;
        if (!pos) {
          setErrorText("Fant ikke posisjonen din — sjekk GPS/stedstjenester og prøv igjen.");
          setLoading(false);
          return;
        }
        const center = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setUserLocation(center);
        await syncUserLocation(center);
        if (!aktiv) return;

        unsubObs = subscribeToNearbyObservations(
          { center, radiusKm: settings.radiusKm },
          (items) => {
            setObservasjoner(
              [...items].sort(
                (a, b) => new Date(b.tid).getTime() - new Date(a.tid).getTime()
              )
            );
            setLoading(false);
          },
          (error) => {
            setErrorText(error.message || "Klarte ikke hente observasjoner.");
            setLoading(false);
          }
        );
      } catch (e: any) {
        if (!aktiv) return;
        setErrorText(e?.message || "Noe gikk galt.");
        setLoading(false);
      }
    })();

    return () => {
      aktiv = false;
      if (unsubObs) unsubObs();
      if (unsubCam) unsubCam();
      if (unsubPts) unsubPts();
      if (unsubLoc) unsubLoc();
    };
  }, []);

  // Observasjoner registrert på det valgte kameraet (via cameraId)
  useEffect(() => {
    if (!selectedCamera) { setCameraObsListe([]); return; }
    const unsub = subscribeToObservationsByCamera(
      selectedCamera.id,
      selectedCamera.jaktlagId,
      (items) => setCameraObsListe(items),
      () => setCameraObsListe([])
    );
    return () => unsub();
  }, [selectedCamera]);

  // ─── Kartevent ────────────────────────────────────────────────────────────

  // V1.2.2 KORRIGERING: fyres når brukeren er FERDIG å panorere/zoome
  // (Leaflet "moveend"/"zoomend", react-native-maps sin native
  // onRegionChangeComplete — se MapView.types.ts). Debounces selve
  // state-oppdateringen (ikke bare event-fyringen, som allerede er
  // "ferdig-bevegelse", ikke per-pixel) med 500 ms, slik at rask,
  // gjentatt panorering ("panorer raskt flere ganger") ikke trigger en full
  // miljøoppslag+motorkjøring-kaskade for hvert mellomsteg — kun den SISTE
  // regionen etter at kartet har fått "hvile kort" faktisk publiseres.
  function handleMapRegionChangeComplete(region: Region) {
    if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
    regionDebounceRef.current = setTimeout(() => {
      setKartRegion(region);
    }, 500);
    // Kompasset (se mapHeading) må holdes i sync med kartets faktiske
    // rotasjon — `getCamera()` finnes kun på den native react-native-maps-
    // instansen (ikke web-stubben), derfor try/catch i stedet for en egen
    // platform-sjekk: et evt. manglende kompass på web er helt greit.
    mapRef.current?.getCamera?.()
      .then((cam) => setMapHeading(cam.heading ?? 0))
      .catch(() => {});
  }

  function handleMapLongPress(e: LongPressEvent) {
    setSelectedPin(e.nativeEvent.coordinate);
    setPinAction("menu");
    setValgtDyr("Rådyr");
    setAntallPin(1);
    setRetningPin(null);
    setKameraNavn("");
    setKameraRetningNy(0);
    setSporDyr(null);
    setSporTypeValgt("Fotspor");
    setSporKommentar("");
    setAnnetType(KART_PUNKT_TYPER[0]);
    setAnnetNavn("");
    setAnnetKommentar("");
    filterOpenSet(false);
    setSelectedCamera(null);
  }

  function closePinPanel() {
    setSelectedPin(null);
    setPinAction(null);
  }

  // ─── Lagre fra langtrykk-meny ──────────────────────────────────────────────

  async function lagreKameraFraMeny() {
    if (!selectedPin || savingPin) return;
    try {
      setSavingPin(true);
      await saveCamera({
        name:      kameraNavn.trim() || `Viltkamera ${kameraer.length + 1}`,
        latitude:  selectedPin.latitude,
        longitude: selectedPin.longitude,
        directionDegrees: kameraRetningNy,
      });
      closePinPanel();
      visAlert("Kamera lagret", "Viltkameraet er plassert på kartet.");
    } catch (e: any) {
      visAlert("Feil", e?.message || "Klarte ikke lagre kamera.");
    } finally {
      setSavingPin(false);
    }
  }

  async function lagreDyrFraMeny() {
    if (!selectedPin || savingPin) return;
    try {
      setSavingPin(true);
      const { offline } = await saveObservation({
        dyr:      valgtDyr,
        type:     "Sett dyr",
        kommentar: "Lagt inn fra kart",
        tid:      new Date().toISOString(),
        latitude:  selectedPin.latitude,
        longitude: selectedPin.longitude,
        retning:  retningPin,
        antall:   antallPin,
        observationSource: "manual",
      });
      closePinPanel();
      // Feltrapport (fysisk enhet, V1.3): "ingen rapport" på en observasjon
      // brukeren nettopp registrerte — saveObservation() faller STILLE
      // tilbake til en lokal offline-kø ved nettverks-/Firestore-feil (se
      // src/services/observations.ts) og ga FØR denne endringen akkurat samme
      // "Lagret"-melding uansett, så brukeren hadde ingen måte å vite at
      // observasjonen ikke faktisk nådde serveren (og dermed ikke dukker opp
      // i Logg/kartet før den har synkronisert).
      visAlert(
        "Lagret",
        offline
          ? "Observasjonen er lagret lokalt og synkroniseres neste gang du har nett."
          : "Observasjonen er lagret."
      );
    } catch (e: any) {
      visAlert("Feil", e?.message || "Klarte ikke lagre observasjon.");
    } finally {
      setSavingPin(false);
    }
  }

  async function lagreSporFraMeny() {
    if (!selectedPin || savingPin) return;
    try {
      setSavingPin(true);
      const { offline } = await saveObservation({
        dyr:      sporDyr ?? "Ukjent",
        type:     "Spor",
        kommentar: sporKommentar.trim() || "Spor registrert fra kart",
        tid:      new Date().toISOString(),
        latitude:  selectedPin.latitude,
        longitude: selectedPin.longitude,
        retning:  null,
        observationSource: "track",
        sporType: sporTypeValgt,
      });
      closePinPanel();
      visAlert(
        "Spor lagret",
        offline
          ? "Sporet er lagret lokalt og synkroniseres neste gang du har nett."
          : "Sporet er registrert på kartet."
      );
    } catch (e: any) {
      visAlert("Feil", e?.message || "Klarte ikke lagre spor.");
    } finally {
      setSavingPin(false);
    }
  }

  async function lagreAnnetFraMeny() {
    if (!selectedPin || savingPin) return;
    try {
      setSavingPin(true);
      await saveMapPoint({
        latitude:  selectedPin.latitude,
        longitude: selectedPin.longitude,
        pointType: annetType,
        label:     annetNavn,
        kommentar: annetKommentar,
      });
      closePinPanel();
      visAlert("Lagret", "Punktet er lagret på kartet.");
    } catch (e: any) {
      visAlert("Feil", e?.message || "Klarte ikke lagre punktet.");
    } finally {
      setSavingPin(false);
    }
  }

  // ─── Handlinger på eksisterende kamera ─────────────────────────────────────

  async function lagreObservasjonFraKamera() {
    if (!selectedCamera || savingCameraAction) return;
    try {
      setSavingCameraAction(true);
      const { offline } = await saveObservation({
        dyr:      regDyr,
        type:     "Sett dyr",
        kommentar: regKommentar.trim() || "Registrert fra viltkamera",
        tid:      new Date().toISOString(),
        latitude:  null,
        longitude: null,
        retning:  regRetningKjent ? regRetning : null,
        antall:   regAntall,
        observationSource: "camera",
        cameraId: selectedCamera.id,
        kjonn:    regKjonn,
        alder:    regAlder,
      });
      setCameraView("info");
      visAlert(
        "Lagret",
        offline
          ? "Observasjonen er lagret lokalt og synkroniseres neste gang du har nett."
          : "Observasjonen er registrert på kameraet."
      );
    } catch (e: any) {
      visAlert("Feil", e?.message || "Klarte ikke lagre observasjon.");
    } finally {
      setSavingCameraAction(false);
    }
  }

  async function redigerKamera() {
    if (!selectedCamera || savingCameraAction) return;
    try {
      setSavingCameraAction(true);
      await updateCamera(selectedCamera.id, {
        name: editNavn.trim() || selectedCamera.name,
        directionDegrees: editRetning,
        notes: editNotat,
      });
      setCameraView("info");
      visAlert("Lagret", "Kameraet er oppdatert.");
    } catch (e: any) {
      visAlert("Feil", e?.message || "Klarte ikke oppdatere kamera.");
    } finally {
      setSavingCameraAction(false);
    }
  }

  async function fjernKamera(id: string) {
    try {
      await deactivateCamera(id);
      setSelectedCamera(null);
      setCameraView("info");
    } catch (e: any) {
      visAlert("Feil", e?.message || "Klarte ikke fjerne kamera.");
    }
  }

  function bekreftFjernKamera() {
    if (!selectedCamera) return;
    visAlert(
      "Fjerne viltkamera?",
      "Kameraet fjernes fra kartet, men tidligere observasjoner og statistikk beholdes.",
      [
        { text: "Avbryt", style: "cancel" },
        {
          text: "Fjern kamera",
          style: "destructive",
          onPress: () => fjernKamera(selectedCamera.id),
        },
      ]
    );
  }

  // ─── Sporpunkt (rask spor-registrering ved GPS-posisjon) ───────────────────

  // Feltrapport (fysisk enhet, V1.3): "sporpunkt-knappen fungerer ikke, den
  // lagrer ett rådyr spor. bare tull, jeg må kunne bestemme hvilket spor jeg
  // ser" — knappen lagret FØR umiddelbart med `valgtDyr` sin daværende
  // (ofte forlatte/standard) verdi, uten å spørre. Åpner nå i stedet den
  // ALLEREDE eksisterende "Spor"-panelet (samme art-/sportype-velger som
  // langtrykk-menyen bruker) forhåndsutfylt med brukerens egen (anonymiserte,
  // samme personvern som før) posisjon — ingen ny UI, bare samme
  // bekreftelses-steg manuell sporregistrering allerede har.
  function åpneSporpunktValg() {
    if (!userLocation) return;
    const p = anonymiserPosisjon(userLocation.latitude, userLocation.longitude);
    setSelectedPin(p);
    setPinAction("spor");
    setSporDyr(null);
    setSporTypeValgt("Fotspor");
    setSporKommentar("");
  }

  // Global sletting (§14 i STEG 4-oppdraget): brukeren skal kunne slette en
  // registrering fra KARTET også, ikke bare fra Logg. deleteObservation
  // treffer samme Firestore-dokument uansett hvor kallet kommer fra, så
  // motorens neste beregning (heatmap/soner) leser automatisk den oppdaterte
  // observasjonslisten — ingen egen "cache" å rydde opp separat.
  function bekreftSlettObservasjonFraKart(obs: Observasjon) {
    visAlert(
      "Slette registreringen?",
      `${obs.dyr} · ${obs.type} fjernes fra kartet, historikken og ViltIQs analysegrunnlag.`,
      [
        { text: "Avbryt", style: "cancel" },
        {
          text: "Slett",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteObservation(obs.id);
            } catch (e: any) {
              visAlert("Feil", e?.message || "Klarte ikke slette registreringen.");
            }
          },
        },
      ]
    );
  }

  // ─── Beregnede verdier ────────────────────────────────────────────────────

  const filtrerteObs = useMemo(() => {
    if (!aktivtFilter || aktivtFilter === "Alle") return observasjoner;
    return observasjoner.filter((o) => o.dyr === aktivtFilter);
  }, [observasjoner, aktivtFilter]);

  const obsMedGps = useMemo(
    () => filtrerteObs.filter((o) => o.latitude != null && o.longitude != null),
    [filtrerteObs]
  );

  // Vanlige dyreobservasjoner (manuelt/kamera) — vises som dyrebobler
  const dyrObsMedGps = useMemo(
    () => obsMedGps.filter((o) => o.observationSource !== "track"),
    [obsMedGps]
  );

  // Sporregistreringer — vises med eget ikon, kan skjules
  const sporObsMedGps = useMemo(
    () => obsMedGps.filter((o) => o.observationSource === "track"),
    [obsMedGps]
  );

  const kameraSektorCoords = useMemo(() => {
    if (!selectedCamera) return null;
    return buildSector(
      { latitude: selectedCamera.latitude, longitude: selectedCamera.longitude },
      140,
      selectedCamera.directionDegrees,
      70
    );
  }, [selectedCamera]);

  const sisteObs = useMemo(() => filtrerteObs.slice(0, 3), [filtrerteObs]);

  const obs24tMedGps = useMemo(
    () => obsMedGps.filter((o) => (Date.now() - new Date(o.tid).getTime()) <= 86400000),
    [obsMedGps]
  );

  // V1.5 KORRIGERING (produktregel, absolutt — se src/lib/analysisAnchor.ts
  // sin filkommentar for hele historikken): V1.3s geografiske hysterese
  // reduserte "prediksjonen hopper ved panorering" til KUN å skje ved en STOR
  // nok panorering — men det var fortsatt feil produktoppførsel. Brukeren
  // skal ALDRI oppleve at kameraet alene flytter en allerede beregnet
  // prediksjon, uansett hvor langt kartet panoreres/zoomes. `analysisAnchor`
  // er derfor nå det GEOGRAFISK LÅSTE ankeret siste motorkjøring faktisk
  // dekket, og settes KUN i to situasjoner:
  //   (a) FØRSTE gang appen har noe å analysere i det hele tatt (GPS/initial
  //       viewport etablerer det aller første ankeret, se effekten under) —
  //       og ALDRI igjen automatisk etter det, heller ikke ved videre
  //       GPS-drift;
  //   (b) et EKSPLISITT brukertrykk på "Analyser dette området"
  //       (se reanalyserHer() under).
  // Kartets region (`kartRegion`/`viewportCandidate`) kan bevege seg helt
  // fritt UTEN at ankeret følger med — `onRegionChangeComplete` skriver KUN
  // til `kartRegion`, aldri til `analysisAnchor`. Se `kanReanalysere` under
  // for hvordan den samme geografiske hysterese-regelen (shouldReuseAnalysisAnchor)
  // nå brukes til noe helt annet enn før: KUN til å avgjøre CTA-synlighet,
  // aldri til å selv trigge en ny analyse.
  const [analysisAnchor, setAnalysisAnchor] = useState<AnalysisAnchor | null>(null);

  // Den "kandidat"-regionen en NY analyse VILLE dekket hvis brukeren ba om
  // det akkurat nå — kartets egen region når den finnes (med en
  // viewport-avledet radius, §D), ellers userLocation som fallback FØR
  // kartets første region-hendelse. Rent presentasjons-/kandidatformål (§ "kan
  // brukes til UI-logikk, men ikke til å flytte eksisterende analyse") —
  // IKKE koblet til analysisAnchor med mindre brukeren eksplisitt ber om det.
  const viewportCandidate = useMemo(() => {
    if (kartRegion) {
      return {
        center: { latitude: kartRegion.latitude, longitude: kartRegion.longitude },
        radiusMeters: deriveViewportRadiusMeters(kartRegion),
      };
    }
    if (userLocation) {
      // Kald start, ingen region-hendelse ennå — samme sjenerøse (tak-
      // begrensede) radius som V1.2.2 brukte som standard, inntil kartet
      // selv rapporterer sin faktiske region.
      return { center: { latitude: userLocation.latitude, longitude: userLocation.longitude }, radiusMeters: MAX_ANALYSIS_RADIUS_METERS };
    }
    return null;
  }, [kartRegion?.latitude, kartRegion?.longitude, kartRegion?.latitudeDelta, kartRegion?.longitudeDelta, userLocation?.latitude, userLocation?.longitude]);

  // Etablerer det ALLER FØRSTE ankeret, nøyaktig én gang (§9: "GPS kan
  // etablere initial analysisAnchor... men når prediction er laget skal
  // GPS-drift ikke flytte prediction"). Vokteren er `analysisAnchor === null`
  // — så snart ankeret er satt (uansett om det var fra GPS eller en
  // eksplisitt reanalyse), gjør IKKE denne effekten noe mer, selv om
  // `viewportCandidate` fortsetter å endre seg (GPS-drift, panorering, osv.).
  // Ingen debounce/hysterese trengs her — dette er en engangs "har vi noe å
  // analysere ennå?"-sjekk, ikke en løpende re-evaluering.
  useEffect(() => {
    if (analysisAnchor !== null) return;
    if (!viewportCandidate) return;
    setAnalysisAnchor(viewportCandidate);
  }, [viewportCandidate, analysisAnchor]);

  const analyseSenter: LatLng | null = analysisAnchor?.center ?? null;
  const analyseRadiusMeter = analysisAnchor?.radiusMeters ?? MAX_ANALYSIS_RADIUS_METERS;

  // §CTA "Analyser dette området" — DEN ENESTE andre veien (utenom det
  // initiale ankeret over) et nytt `analysisAnchor` kan oppstå. Gjenbruker
  // shouldReuseAnalysisAnchor (samme geografiske dead-zone-regel som §C)
  // for å avgjøre om viewporten har beveget seg langt nok fra det låste
  // ankeret til at en ny analyse ville vært meningsfull — men bruker
  // resultatet KUN til CTA-synlighet, ALDRI til å selv sette et nytt anker.
  const kanReanalysereHer =
    analysisAnchor != null &&
    viewportCandidate != null &&
    !shouldReuseAnalysisAnchor(analysisAnchor, viewportCandidate.center, viewportCandidate.radiusMeters);

  /** Den ENESTE funksjonen i hele kartet som flytter et allerede etablert analysisAnchor. Kalt UTELUKKENDE av et eksplisitt brukertrykk på "Analyser dette området" (se JSX under) — aldri fra en kart-/region-hendelse. */
  function reanalyserHer() {
    if (!viewportCandidate) return;
    // `environmentResolver` nullstilles i SAMME hendelseshåndterer (ikke i en
    // reaktiv useEffect senere) — React 18 batcher begge state-oppdateringene
    // inn i ÉN render. Uten dette ville heatmapPerArt-useMemoen (avhengig av
    // BÅDE environmentResolver OG analyseSenter) rukket å kjøre motoren for
    // det NYE ankeret med den GAMLE (feil-områdets) resolveren i render-fasen
    // FØR noen effekt fikk sjanse til å nullstille noe — en reell (om enn
    // kortvarig) geografisk feilkobling, avdekket av
    // .e2e-scratch/viewportDoesNotMutatePrediction.mjs sin "eksakt ÉN ny
    // motorkjøring"-påstand. Se også resetEffekten ved analysisAnchor-bytte
    // over, som dekker samme nullstilling defensivt for andre ev. fremtidige
    // kall-steder.
    setEnvironmentResolver(null);
    setAnalysisAnchor(viewportCandidate);
  }

  // Selve sone-VALGET (valgtHotspotId/huntPlanZoneId) er kun meningsfullt
  // for de sonene DEN SAMME analysen produserte — se zoneIdentity()/
  // zoneListSnapshotId under. Når analysisAnchor faktisk BYTTES UT (ikke
  // den initiale null->verdi-etableringen over) er dette signalet om at en
  // GENUINT ny analyse er i gang: nullstill valget, ellers kan en gammel
  // valgt-id ("hjort-zone-2") ved et uhell matche en NY sone med samme
  // indeksbaserte id, men på et helt annet geografisk sted (§10-12).
  const forrigeAnkerRef = useRef<AnalysisAnchor | null>(null);
  useEffect(() => {
    if (analysisAnchor && __DEV__) {
      // V1.5 utvikler-diagnostikk (samme "kun __DEV__, aldri i prod"-mønster
      // som logIntelligenceDebug): ÉN linje per gang det LÅSTE ankeret
      // faktisk endres — den geografiske sannhetskilden viewport-stabilitets-
      // testscript i .e2e-scratch/ leser for å bevise at panorering/zoom
      // ALENE aldri produserer en ny linje her.
      // eslint-disable-next-line no-console
      console.log(
        `analysisAnchor: center=${analysisAnchor.center.latitude.toFixed(5)},${analysisAnchor.center.longitude.toFixed(5)} radiusMeters=${analysisAnchor.radiusMeters.toFixed(0)}`
      );
    }
    if (forrigeAnkerRef.current !== null && analysisAnchor !== null && forrigeAnkerRef.current !== analysisAnchor) {
      setValgtHotspotId(null);
      setHuntPlanZoneId(null);
      // KRITISK (avdekket av .e2e-scratch/viewportDoesNotMutatePrediction.mjs
      // sin "eksakt ÉN ny motorkjøring"-påstand): `environmentResolver` er
      // FAKTISK bundet til FORRIGE anker sitt geografiske område (den er
      // resultatet av `resolveEnvironmentContext(analyseSenter, ...)` for det
      // GAMLE senteret, se effekten under). Uten denne nullstillingen ville
      // heatmapPerArt-useMemo-en (som avhenger av BÅDE environmentResolver OG
      // analyseSenter/analyseRadiusMeter) kortvarig kjøre motoren for det NYE
      // ankeret med det GAMLE miljøoppslaget — en reell, om enn kortvarig,
      // feilkobling (score for feil sted, ikke bare et unødvendig ekstra
      // motorkjøring-logglinje). Nullstilling her tvinger heatmapPerArt til
      // midlertidig å falle tilbake til den rene, alltid-korrekte
      // observasjonsmotoren (runEngine) for det nye ankeret helt til en fersk
      // resolver for DET området faktisk er løst.
      setEnvironmentResolver(null);
    }
    forrigeAnkerRef.current = analysisAnchor;
  }, [analysisAnchor]);

  // Løs miljøkontekst (høyde/habitat/vær/snø/vind) for den økologiske
  // prioren KUN når "Prediksjon" er slått på og vi har et analysesenter å ta
  // utgangspunkt i — dette er eksterne nettverkskall (Geonorge/NIBIO/
  // Open-Meteo/Overpass, se src/engine/environment), ikke noe kartet skal
  // gjøre uoppfordret. Feiler oppslaget (offline e.l.), forblir resolveren
  // null og prediksjonsoner faller tilbake til den rene, alltid-tilgjengelige
  // observasjonsmotoren under — kartet skal ALDRI blokkere eller krasje på
  // et mislykket miljøoppslag.
  //
  // Async-sikkerhet (§7/§16 i korrigeringsoppdraget): `aktiv`-mønsteret under
  // er allerede Reacts standard vern mot at en TREG, ELDRE analyse
  // overskriver en NYERE — hver gang `analyseSenter` endres (bruker
  // panorerer til nytt område), kjører effekten på nytt, og OPPRYDDINGEN fra
  // FORRIGE kjøring setter DEN sin `aktiv=false` FØR den nye kjøringen
  // starter. Et sent-ankommende resolve-resultat fra et FORLATT kartområde
  // kan derfor aldri publiseres — ingen ny request-id-mekanisme trengs
  // utover dette allerede eksisterende mønsteret.
  useEffect(() => {
    if (!visPrediksjon || !analyseSenter) return;
    let aktiv = true;

    resolveEnvironmentContext(analyseSenter, analyseRadiusMeter)
      .then((resolver) => { if (aktiv) setEnvironmentResolver(() => resolver); })
      .catch(() => { /* stille — kartet fungerer uten miljødata, se fallback under */ });

    return () => { aktiv = false; };
  }, [visPrediksjon, analyseSenter, analyseRadiusMeter]);

  // Motor-tidsvindu (§18): filtrer INPUT til motoren, ikke selve
  // decay-matematikken — "nå" sender alt inn uendret (motorens egen
  // tidsvekting prioriterer allerede ferskt, se signals.ts timeWeight),
  // "6t"/"24t" er en hard, forståelig grense brukeren selv velger.
  const observasjonerITidsvindu = useMemo(() => {
    if (tidsvindu === "nå") return observasjoner;
    const grenseMs = tidsvindu === "6t" ? 6 * 3600000 : 24 * 3600000;
    const nå = Date.now();
    return observasjoner.filter((o) => nå - new Date(o.tid).getTime() <= grenseMs);
  }, [observasjoner, tidsvindu]);

  // Per-art motorresultat. ALLE fire arter (Hjort/Rådyr/Elg/Rev) vurderes av
  // ViltIQ Engine v1 (src/engine) — kartet sender kun inn observasjonene og
  // viser resultatet, det er ALDRI kart.tsx selv som regner ut score/
  // confidence. Rev har ingen egen artsprofil ennå og mappes til motorens
  // nøytrale "annet"-profil (samme profil normalizeSpecies() allerede bruker
  // for enhver ukjent art) — IKKE en egen parallell beregning lenger (se
  // gjennomgangen som fjernet den tidligere beregnEnkelPrediksjonssone()).
  // Motoren kjører alltid, uavhengig av "Prediksjon"-bryteren — den bryteren
  // styrer kun (a) om det tyngre økologiske miljølaget hentes (nettverkskall)
  // og (b) om selve heatmap-gradienten TEGNES, se aktivHeatmap/JSX under.
  // Motoren isolerer selv arten (§14 i motor-oppdraget), så kartet trenger
  // ikke filtrere observasjoner per art før kallet.
  const { besteMotorSone, heatmapPerArt } = useMemo(() => {
    const motorArter: Record<string, EngineSpecies> = { Hjort: "hjort", Rådyr: "radyr", Elg: "elg", Rev: "annet" };

    const heatmap: Partial<Record<string, { species: EngineSpecies; points: HeatmapPoint[]; zone: PredictionZone | null; result: EngineResult }>> = {};
    let beste: PredictionZone | null = null;

    for (const dyr of dyrListe) {
      const motorArt = motorArter[dyr];

      // debug:true kun i __DEV__ — se logIntelligenceDebug-effekten under.
      // Billig nok til alltid å regnes ut i dev (noen ekstra O(n)-tellinger/
      // sorteringer over et grid som uansett allerede er scoret), og gir
      // GRID/SCORE/HEATMAP/ZONES-instrumenteringen (V1.2.1 §21) faktisk noe
      // å vise i konsollen i stedet for å alltid falle tilbake til "ingen
      // debug-info"-linjen.
      // V1.2.2: areaCenter er nå analyseSenter (kartets region), IKKE
      // userLocation — se analyseSenter-definisjonen over.
      const resultat = (environmentResolver && analyseSenter)
        ? runEcologicalEngine(observasjonerITidsvindu, motorArt, {
            areaCenter: analyseSenter,
            areaRadiusMeters: analyseRadiusMeter,
            environment: environmentResolver,
            debug: __DEV__,
          })
        : runEngine(observasjonerITidsvindu, motorArt, { debug: __DEV__ });

      // Heatmap (§5–§8 i STEG 4-oppdraget): vektede grid-punkter fra HELE
      // motorens skårede flate, ikke bare klyngede soner — samme sannhets-
      // kilde som besteMotorSone under, kun uklynget. Hele `resultat`
      // beholdes også (ikke bare points/zone) — se prediction-snapshot-
      // effekten under, som trenger engineVersion/configVersion/summary osv.
      const sone = resultat.zones[0] ?? null;
      heatmap[dyr] = { species: motorArt, points: resultat.heatmapPoints, zone: sone, result: resultat };
      if (!sone) continue;
      // V1.3 §W: dette SAMMENLIGNER kun de fire artenes egne beste-sone-score
      // for å velge HVILKEN art som "vinner" — det summerer/blander ALDRI
      // scorene deres. `beste` blir alltid én enkelt PredictionZone fra ett
      // enkelt art-rent motorresultat (sammen med `sone.species`), aldri et
      // konstruert gjennomsnitt/max av flere arters heatmap-vekter.
      if (!beste || sone.score > beste.score) beste = sone;
    }

    return { besteMotorSone: beste, heatmapPerArt: heatmap };
  }, [observasjonerITidsvindu, environmentResolver, analyseSenter, analyseRadiusMeter]);

  // V1.2 Steg 6: Kart er skrive-siden av den delte Intelligence-cachen
  // (resultCache.ts) — Hjem og Jakt leser herfra i stedet for å kjøre sin
  // egen (potensielt avvikende) motor på de samme observasjonene, se §17–19
  // i motor-oppdraget. En egen effekt (ikke inne i useMemo over) fordi dette
  // er en bevisst side-effekt, ikke en del av selve utregningen.
  useEffect(() => {
    // V1.3 (§ cache-key): den eksplisitte konteksten resultatet faktisk ble
    // beregnet i/for — analyseSenter/analyseRadiusMeter er ANKERET (aldri
    // kartets rå viewport, se analysisAnchor.ts), ikke tegneposisjonen.
    // Værmålingen leses fra SAMME environmentResolver-kall scoringen selv
    // brukte for dette senteret, ingen ny/parallell værhenting.
    const weather = environmentResolver && analyseSenter ? environmentResolver(analyseSenter).dynamic : null;
    const cacheContext = {
      area: analyseSenter ? { center: analyseSenter, radiusMeters: analyseRadiusMeter } : null,
      weather: weather ? { temperatureC: weather.temperatureC, windSpeedMs: weather.windSpeedMs } : null,
      observationCount: observasjonerITidsvindu.length,
    };
    for (const dyr of dyrListe) {
      const entry = heatmapPerArt[dyr];
      if (!entry) continue;
      setCachedIntelligenceResult(entry.species, entry.result, environmentResolver != null, cacheContext);
      // V1.2 §39: rå utvikler-diagnostikk i devtools-konsollen, aldri i
      // produksjonsbuilds — kun for arten som faktisk driver "beste sone".
      if (__DEV__ && besteMotorSone && entry.species === besteMotorSone.species) {
        logIntelligenceDebug(entry.result);
      }
    }
  }, [heatmapPerArt, environmentResolver, besteMotorSone, analyseSenter, analyseRadiusMeter, observasjonerITidsvindu]);

  // Prediction snapshots (§21–24 i motor-oppdraget): lagre et komprimert
  // øyeblikksbilde av motorens vurdering per art, kraftig throttlet (§28 —
  // ALDRI et nytt Firestore-skriv på hver re-render). Kun mens brukeren er
  // innlogget og har en posisjon (samme areal som den økologiske motor-
  // kjøringen over bruker). Lagringsfeil skal ALDRI påvirke kartets egen
  // visning — se catch under. jaktlagId settes til "" her bevisst:
  // savePredictionSnapshot() løser det EGENTLIGE feltet som skrives til
  // Firestore på nytt selv (samme mønster som observations.ts/felling.ts),
  // så verdien herfra er kun et kortlevd, ubrukt plassholder-felt.
  const sisteSnapshotRef = useRef<Partial<Record<string, number>>>({});
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !analyseSenter) return;
    const areaRadiusMeters = analyseRadiusMeter;
    const nå = Date.now();

    for (const dyr of dyrListe) {
      const entry = heatmapPerArt[dyr];
      if (!entry || !entry.zone) continue;
      const nøkkel = entry.species;
      if (!shouldSaveSnapshot(sisteSnapshotRef.current[nøkkel], nå, DEFAULT_SNAPSHOT_MIN_INTERVAL_MS)) continue;

      // Settes FØR async-kallet, ikke etter — unngår flere samtidige
      // lagringer av samme art hvis effekten trigges igjen før forrige
      // lagring er ferdig.
      sisteSnapshotRef.current[nøkkel] = nå;
      // V1.2.2: areaCenter er analyseSenter (kartets region) — snapshotet
      // skal beskrive HVA som faktisk ble analysert, ikke brukerens GPS.
      const snapshot = buildPredictionSnapshot(entry.result, {
        userId: uid,
        jaktlagId: "",
        areaCenter: analyseSenter,
        areaRadiusMeters,
        ecologyUsed: environmentResolver != null,
      });
      savePredictionSnapshot(snapshot).catch(() => {
        // Stille — snapshot-lagring er et fremtidig valideringsgrunnlag,
        // ikke noe kartet skal blokkere eller varsle brukeren om ved feil.
      });
    }
  }, [heatmapPerArt, analyseSenter, analyseRadiusMeter, environmentResolver]);

  // Heatmap-laget følger det aktive artsfilteret (§8: "Ikke bland rådyr-,
  // elg- og hjortedata til ett uforståelig heatkart når én art er valgt").
  // Uten et spesifikt artsfilter ("Alle") vises heatmapet for arten med
  // høyest score akkurat nå — aldri en blanding av flere arters data.
  //
  // V1.3 §W (Alle-modus audit): "høyest score akkurat nå" betyr HELE det
  // uklyngede resultatet (heatmapPoints OG zones) til DEN ENE arten som eier
  // besteMotorSone (se heatmapPerArt-loopen over: hver art kjøres gjennom
  // motoren HELT SEPARAT, med sin egen runEngine/runEcologicalEngine-kjøring
  // og sin egen liste med soner — `besteDyr` her plukker bare UT hvilket av
  // disse fire allerede-ferdige, art-rene resultatene som skal vises, den
  // regner ikke noe nytt). Det finnes IKKE noen skjult
  // max(hjort, rådyr, elg)-sammenslåing av selve heatmap-vektene eller
  // sonene et sted i denne funksjonen — `heatmapPerArt[besteDyr]` er akkurat
  // det samme objektet som ville blitt vist om brukeren selv hadde trykket på
  // "Hjort" (eller hvilken art som vant). Bekreftet ved lesing 2026-08:
  // logikken er allerede biologisk sund og krever ingen endring, kun denne
  // dokumentasjonen.
  const aktivHeatmap = useMemo(() => {
    if (aktivtFilter !== "Alle") return heatmapPerArt[aktivtFilter] ?? null;
    const besteDyr = dyrListe.find((d) => heatmapPerArt[d]?.species && besteMotorSone?.species === heatmapPerArt[d]?.species);
    return besteDyr ? heatmapPerArt[besteDyr] ?? null : null;
  }, [aktivtFilter, heatmapPerArt, besteMotorSone]);

  // V1.2.1 §10-11: kartlagets EGET renderWeight, adskilt fra motorens
  // faktiske (absolutte) score — se src/lib/heatmapRender.ts for hvorfor.
  // `aktivHeatmap.points` (motorens sannhet) forblir uendret; kun denne
  // avledede kopien sendes til <Heatmap>.
  const heatmapRenderPoints = useMemo(
    () => (aktivHeatmap ? applyHeatmapRenderWeight(aktivHeatmap.points) : []),
    [aktivHeatmap]
  );

  // V1.2 Steg 7 (§30-33): opptil MAX_VISIBLE_ZONES REELT distinkte områder
  // fra motorens egen klynging (result.zones, se grid.ts sin extractZones —
  // samme sannhetskilde som heatmap-laget), ikke bare den ene beste sonen.
  // Etter Steg 3-fiksen (kjede-relativ watershed) er disse nå genuint
  // separate områder, ikke nesten-identiske duplikater av samme platå, så
  // det er trygt å vise flere uten å drukne kartet i like blobs.
  //
  // Hunting-zones-oppdraget §7: hevet fra 3 til MAX_VISIBLE_ZONES (5) —
  // brukeren skal kunne se "alternativ 2 og 3" (og opptil 4/5 der de
  // faktisk finnes), samme tak som motorens egen zones.maxZones (config.ts),
  // ikke en ny, uavhengig grense kartet finner på selv.
  const visteHotspots = useMemo<PredictionZone[]>(() => {
    const soner = aktivHeatmap?.result.zones ?? (besteMotorSone ? [besteMotorSone] : []);
    return soner.slice(0, MAX_VISIBLE_ZONES);
  }, [aktivHeatmap, besteMotorSone]);

  // V1.5 (§10-12, zone-identitet på tvers av en anker-/analysegrense):
  // `zone.id` (f.eks. "hjort-zone-1", se engine.ts) er kun stabilt INNAD i ÉN
  // motorkjøring — indeksbasert på rangeringsrekkefølgen i akkurat DEN
  // kjøringen. Etter at analysisAnchor er byttet ut (§ eksplisitt reanalyse)
  // kan en HELT ANNEN geografisk sone få nøyaktig samme id-streng. Sone-VALG
  // som overlever på tvers av en re-render (valgtHotspotId/huntPlanZoneId)
  // identifiserer derfor sonen med BÅDE hvilken motorkjøring den kom fra
  // (predictionSnapshotId — samme `${species}-${engineResultGeneratedAt}`-
  // mønster som huntPlan.ts sin stablePredictionSnapshotId, gjenbrukt her
  // uendret, ikke en ny parallell id) OG selve zone.id. Reset-effekten over
  // (ved analysisAnchor-bytte) nullstiller allerede valget ved enhver reell
  // ny analyse — denne id-skopingen er en eksplisitt EKSTRA sikring, per
  // oppdragets egen anbefaling, som gjør at en gammel id uansett aldri kan
  // matche en ny, geografisk annerledes sone selv om reset-effekten av en
  // eller annen grunn skulle utebli.
  function generatedAtForSpecies(species: EngineSpecies): number | null {
    if (aktivHeatmap?.species === species) return aktivHeatmap.result.generatedAt;
    const dyr = dyrListe.find((d) => heatmapPerArt[d]?.species === species);
    return dyr ? heatmapPerArt[dyr]?.result.generatedAt ?? null : null;
  }
  function zoneIdentity(sone: PredictionZone): string {
    const generatedAt = generatedAtForSpecies(sone.species);
    return generatedAt != null ? `${stablePredictionSnapshotId(sone.species, generatedAt)}:${sone.id}` : sone.id;
  }

  // Kold-start-visningsoppdraget §5: "Vis heatmapet mer subtilt" når HELE
  // det synlige resultatet er ren terrengantakelse — ALLE synlige soner
  // environment_only, ingen observasjonsbidrag noe sted. Rent presentasjon
  // (opacity), rører ALDRI selve vektene/gradienten — se heatmapRenderPoints,
  // uendret. `false` (full, vanlig opasitet) når det ikke finnes noen synlig
  // sone i det hele tatt — det er IKKE et cold-start-signal, bare "ingenting
  // å vise ennå".
  const heatmapErRentTerrengbasert = useMemo(
    () => visteHotspots.length > 0 && visteHotspots.every((s) => s.predictionMode === "environment_only"),
    [visteHotspots]
  );

  // Kold-start-visningsoppdraget §8/§13: glatter det rå rutenett-omrisset
  // (zone.footprint.hull, se grid.ts sin gridBoundaryPolygon) til en rundere
  // kontur for RENDERING — samme geografiske utstrekning, ikke et nytt
  // omriss. Beregnet ÉN gang per faktisk endring i visteHotspots (§13: ikke
  // per frame), ikke inline i selve JSX-mapet under.
  const smoothedFootprintByZone = useMemo(() => {
    const map = new Map<string, LatLng[]>();
    for (const sone of visteHotspots) {
      const hull = sone.footprint?.hull;
      if (hull && hull.length >= 3) map.set(zoneIdentity(sone), smoothPolygonRing(hull));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoneIdentity er en ren funksjon av visteHotspots+aktivHeatmap/besteMotorSone (via generatedAtForSpecies), ikke egen state.
  }, [visteHotspots]);

  // Sonen som faktisk forklares når brukeren trykker på en hotspot-markør —
  // den brukeren sist valgte blant visteHotspots, eller beste sone som
  // standard. Alltid tilgjengelig (ikke lenger avhengig av "Prediksjon"-
  // bryteren) — dette ER nå appens ENESTE "beste område"-kilde, se
  // statusInnhold().
  const hotspotSone = visteHotspots.find((s) => zoneIdentity(s) === valgtHotspotId) ?? visteHotspots[0] ?? null;

  // ── HuntPlan (§3.1): sonen en åpen jaktplan gjelder for — slått opp i
  // SAMME ferske visteHotspots-liste som hotspotSone over, ikke en frossen
  // kopi fra da knappen ble trykket.
  const huntPlanZone = useMemo(
    () => (huntPlanZoneId ? visteHotspots.find((s) => zoneIdentity(s) === huntPlanZoneId) ?? null : null),
    [huntPlanZoneId, visteHotspots, aktivHeatmap, heatmapPerArt]
  );
  // §3.16: styrer kartets "kun ÉN sones detaljer om gangen"-modus mens en
  // jaktplan er åpen — se overlay-filtrene i JSX-en under.
  const erJaktplanAktiv = huntPlanZoneId !== null;

  // Motoren krever et løst EnvironmentResolver-oppslag (samme forutsetning
  // som den økologiske motoren over) — når det mangler (f.eks. "Prediksjon"
  // ikke slått på ennå), vises en ærlig statusbeskjed i panelet i stedet for
  // å late som en plan finnes (§3.4: aldri fabrikkert sikkerhet).
  const huntPlanUnavailableReason = !environmentResolver
    ? "Slå på Prediksjon i Kartlag for å beregne en jaktplan her."
    : null;

  // buildHuntPlan() krever `engineResultGeneratedAt` — det ENGINE-KJØRING
  // huntPlanZone faktisk kom fra (§ stablePredictionSnapshotId i
  // huntPlan.ts), ikke Date.now(). aktivHeatmap.result er den kjøringen NÅR
  // artsfilteret matcher; ellers slås heatmapPerArt opp direkte på art
  // (dekker fallback-grenen der visteHotspots kommer fra besteMotorSone).
  const huntPlanEngineResultGeneratedAt = useMemo(
    () => (huntPlanZone ? generatedAtForSpecies(huntPlanZone.species) : null),
    [huntPlanZone, aktivHeatmap, heatmapPerArt]
  );

  const huntPlan = useMemo<HuntPlan | null>(() => {
    if (!huntPlanZone || !environmentResolver || huntPlanEngineResultGeneratedAt == null) return null;
    try {
      return buildHuntPlan(
        huntPlanZone,
        visteHotspots,
        environmentResolver(huntPlanZone.center),
        huntPlanTargetMs,
        huntPlanEngineResultGeneratedAt
      );
    } catch {
      return null;
    }
  }, [huntPlanZone, visteHotspots, environmentResolver, huntPlanTargetMs, huntPlanEngineResultGeneratedAt]);

  function apneJaktplan(sone: PredictionZone) {
    setHuntPlanZoneId(zoneIdentity(sone));
    setHuntPlanTargetMs(Date.now());
  }

  function lukkJaktplan() {
    setHuntPlanZoneId(null);
  }

  // Jaktplan-produktflyt-oppdraget §1/§2: "Planlegg jakten" fra Jakt-fanen
  // sender `openPlan=1` sammen med de allerede eksisterende focusLat/focusLng/
  // filter/heatmap-parameterne (se den eksisterende fokuserings-effekten over)
  // — denne effekten åpner Jaktplan-arket for `hotspotSone` (samme "beste
  // synlige sone"-kilde som resten av kartet allerede bruker, nå riktig
  // artsfiltrert siden `aktivtFilter` allerede leses fra `params.filter` ved
  // mount) automatisk ÉN gang, via SAMME apneJaktplan()/HuntPlanPanel som det
  // manuelle "Planlegg jakt her"-trykket på en sone bruker — ingen ny
  // Jaktplan-vei, kun en ekstra automatisk trigger av den eksisterende. Ren
  // ledningstrekking: ingen ny motor-/utregningslogikk. `autoOpenedPlanRef`
  // sikrer at dette skjer maks ÉN gang per navigasjon hit — uten den ville
  // enhver senere re-render (f.eks. etter at brukeren selv lukker arket)
  // risikere å åpne det på nytt av seg selv, som ville vært uventet/irriterende
  // UX. Uten `openPlan=1` i URL-en (den vanlige "trykk på Kart-fanen"-veien,
  // eller den eksisterende "Se på kart"-lenken) gjør denne effekten
  // ingenting — kartet oppfører seg nøyaktig som før.
  const autoOpenedPlanRef = useRef(false);
  useEffect(() => {
    if (params.openPlan !== "1") return;
    if (autoOpenedPlanRef.current) return;
    if (!hotspotSone) return;
    autoOpenedPlanRef.current = true;
    // Feltrapport (fysisk enhet, V1.3): "Planlegg jakten stenger med en
    // gang" — arket blinket opp og lukket seg selv momentant. Mistenkt
    // årsak: samme trykk som navigerte HIT (fra "Planlegg jakten"-knappen
    // på forrige skjerm) kan rekke å bli levert en gang til idet
    // ModalSheet sin fullskjerm-bakgrunn (`onPress={onClose}`, se
    // ModalSheet.tsx) monteres rett oppå samme skjermposisjon — en kjent
    // kategori "touch bleed-through"-feil ved navigasjon+auto-åpnet modal i
    // samme gest. En kort forsinkelse før selve åpningen lar det opprinnelige
    // trykket rekke å avslutte før bakgrunnen blir trykkbar.
    const t = setTimeout(() => apneJaktplan(hotspotSone), 400);
    return () => clearTimeout(t);
  }, [params.openPlan, hotspotSone]);

  // Feltrapport (fysisk enhet, V1.3): "Planlegg jakten" ga verken feilmelding
  // eller noe merket på kartet — ingen indikasjon på HVORFOR (f.eks. manglende
  // posisjon/miljødata gjør at `hotspotSone` aldri blir noe, se visteHotspots/
  // besteMotorSone over). Stille ingenting er alltid en dårlig sluttilstand,
  // uansett underliggende årsak — denne varsler ÆRLIG (ikke en oppdiktet
  // forklaring) hvis ingen sone dukket opp innen rimelig tid, i stedet for at
  // brukeren står igjen uten noe å gå videre på. Varsler maks ÉN gang per
  // navigasjon hit, og ALDRI hvis planen faktisk åpnet seg i mellomtiden.
  const openPlanTimeoutWarnedRef = useRef(false);
  useEffect(() => {
    if (params.openPlan !== "1") return;
    const t = setTimeout(() => {
      if (autoOpenedPlanRef.current || openPlanTimeoutWarnedRef.current) return;
      openPlanTimeoutWarnedRef.current = true;
      visAlert(
        "Fant ingen sone ennå",
        "ViltIQ har ikke nok grunnlag (posisjon/miljødata/observasjoner) til å foreslå en jaktplan for området akkurat nå. Sjekk at posisjon er aktivert, og prøv «Analyser dette området» på kartet."
      );
    }, 10000);
    return () => clearTimeout(t);
  }, [params.openPlan]);

  // FJERNET (V1.2, arkitekturbeslutning): en tidligere "hotspot-sektor" som
  // pekte "hvilken vei" rundt hotspot-sonen, beregnet fra en egen sirkulær
  // gjennomsnitt av rå `retning`-felt blant nærliggende observasjoner. Dette
  // var PARALLELL prediksjonslogikk i UI — motoren selv eksponerer ingen
  // autoritativ bearing på en PredictionZone (signalBreakdown.movementDirection
  // og .corridor er scorebidrag, ikke retningsvinkler), så sektoren kunne i
  // prinsippet peke en annen vei enn det motorens egen scoring/heatmap
  // faktisk uttrykker. "Motoren er sannhetskilden" — inntil motoren selv
  // eksponerer et ekte, tidsavtagende directional-hint-felt på en sone
  // (dokumentert som en mulig V1.3-retning), skal kartet IKKE tegne en egen
  // retningspil. Heatmap-gradienten bærer den geografiske directional
  // influence-informasjonen i mellomtiden. Kameraets EGEN fysiske
  // retningssektor (kameraSektorCoords over) er UBERØRT — det er
  // utstyrsmetadata, ikke en prediksjon.

  // Tidbaserte aktive soner (klokkeslett-mønster)
  const aktiveSoner = useMemo<AktivSone[]>(() => {
    if (!visAktiveSoner) return [];
    return buildAktiveSoner(observasjoner);
  }, [visAktiveSoner, observasjoner]);

  // ─── Fokuser kart ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapRef.current || !userLocation) return;
    void mapReady; // trigger re-kjøring når web-kartets ref faktisk kobles til (se kommentar ved mapReady)
    const fLat = params.focusLat ? Number(params.focusLat) : null;
    const fLng = params.focusLng ? Number(params.focusLng) : null;
    if (fLat && fLng && !Number.isNaN(fLat) && !Number.isNaN(fLng)) {
      // Fra Hjem ("Åpne kart") — fit-bounds rundt BÅDE brukerens posisjon OG
      // den anbefalte sonens fotavtrykk (§ "Åpne kart fra Hjem"-fokusering
      // over), ikke lenger et fast tett utsnitt rundt kun ett punkt. Sonen
      // hentes fra DEN SAMME delte cachen (resultCache.ts) Hjem nettopp
      // skrev til — samme kanoniske resultat, ingen ny motorkjøring her.
      const species = params.filter ? KARUSELL_ART_FRA_DYR[params.filter] : undefined;
      const cachedSone = species ? getCachedIntelligenceResult(species)?.result.zones[0] ?? null : null;
      const fokusPunkt: LatLng = { latitude: fLat, longitude: fLng };
      const punkter = cachedSone ? [userLocation, ...sonefotavtrykkPunkter(cachedSone)] : [userLocation, fokusPunkt];
      mapRef.current.animateToRegion(fitRegionRundtPunkter(punkter), 600);
    } else {
      mapRef.current.animateToRegion(
        { latitude: userLocation.latitude, longitude: userLocation.longitude, latitudeDelta: 0.6, longitudeDelta: 0.6 },
        600
      );
    }
  }, [params.focusLat, params.focusLng, params.filter, userLocation, mapReady]);

  // "Hva skjer nå"-innholdet delt mellom desktop-panelet og mobilens bottom
  // sheet (§16/§24) — samme data, to ulike beholdere. Motoren er nå appens
  // ENESTE "beste område"-kilde (se hotspotSone over) — ingen egen parallell
  // heatZones-basert visning lenger.
  function statusInnhold(compact: boolean, medHeadline = true) {
    if (loading) {
      return (
        <View style={styles.bottomRow}>
          <ActivityIndicator size="small" color={uiColor.primary} />
          <Text style={styles.bottomLoadText}>Laster...</Text>
        </View>
      );
    }
    if (errorText) {
      return <Text style={styles.bottomError}>{errorText}</Text>;
    }
    if (hotspotSone) {
      return (
        <>
          {/* V1.3 §N/§O: engine.ts bygger nå recommendation for hver sone
              (samme Støtter/Begrenser-grunner som explanation/dominantSignals,
              ingen ny beregning her) — se PredictionZone.recommendation i
              types.ts og buildZoneRecommendation() i explain.ts. */}
          <EngineStatusPanel zone={hotspotSone} recommendation={hotspotSone.recommendation} compact={compact} showScore userLocation={userLocation} />
          {!compact && medHeadline && (
            <>
              <Text style={styles.bottomMeta}>
                {obs24tMedGps.length} obs siste 24t · {kameraer.length} kamera
              </Text>
              {sisteObs.slice(0, 2).map((obs) => (
                <View key={obs.id} style={styles.recentRow}>
                  <Text style={styles.recentEmoji}>{dyrEmoji(obs.dyr)}</Text>
                  <Text style={styles.recentAnimal}>{obs.dyr}</Text>
                  <Text style={styles.recentTime}>{hentRelativTid(obs.tid)}</Text>
                  {obs.retning != null && (
                    <Ionicons
                      name="navigate" size={12} color={uiColor.primary}
                      style={{ transform: [{ rotate: `${obs.retning}deg` }] }}
                    />
                  )}
                </View>
              ))}
              <Pressable style={styles.moreLinkRow} onPress={() =>
                mapRef.current?.animateToRegion(
                  { latitude: hotspotSone.center.latitude, longitude: hotspotSone.center.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 },
                  500
                )
              }>
                <Text style={styles.moreLinkText}>Sentrer kart</Text>
                <Ionicons name="chevron-forward" size={13} color={uiColor.primary} />
              </Pressable>
            </>
          )}
          {/* HuntPlan-oppdraget §3.1: åpner planen i et ARK OVER kartet
              (ModalSheet), ALDRI en navigasjon bort fra Kart (§3.15). Vist i
              alle ikke-kompakte visninger av statusInnhold() — både desktop-
              panelet og mobilens utvidede bottom sheet. */}
          {!compact && (
            <Pressable style={styles.planKnapp} onPress={() => apneJaktplan(hotspotSone)}>
              <Ionicons name="compass-outline" size={16} color={uiColor.primaryText} />
              <Text style={styles.planKnappText}>Planlegg jakt her</Text>
            </Pressable>
          )}
        </>
      );
    }
    if (compact) {
      return <Text style={styles.noDataText}>Ingen observasjoner innen {radiusKm} km.</Text>;
    }
    if (!medHeadline) {
      // Headlinen er allerede vist i den alltid-synlige oppsummeringen over
      // (mobil bottom sheet) — ikke gjenta den her, kun tilleggshintet.
      return <Text style={styles.noDataText}>Langtrykk på kartet for å legge til punkt.</Text>;
    }
    return (
      <Text style={styles.noDataText}>
        Ingen observasjoner innen {radiusKm} km.{"\n"}Langtrykk på kartet for å legge til punkt.
      </Text>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>

        {/* ── Kart ── */}
        {userLocation ? (
          <MapView
            ref={(r) => { mapRef.current = r; if (r) setMapReady(true); }}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            mapType={mapMode}
            initialRegion={{
              latitude:      userLocation.latitude,
              longitude:     userLocation.longitude,
              latitudeDelta: 0.6,
              longitudeDelta: 0.6,
            }}
            showsUserLocation
            showsMyLocationButton={false}
            showPropertyBoundaries={visEiendomsgrenser}
            onLongPress={handleMapLongPress}
            onPress={() => { setSelectedCamera(null); filterOpenSet(false); }}
            onRegionChangeComplete={handleMapRegionChangeComplete}
          >
            {/* Radius-sirkel — V1.2.2: sentrert på analyseSenter (kartets
                region etter panorering), ikke lenger alltid userLocation,
                ellers ville sirkelen løyet om hvor motoren faktisk ser. */}
            <Circle
              center={analyseSenter ?? userLocation}
              radius={radiusKm * 1000}
              strokeWidth={1.5}
              strokeColor="rgba(44,195,107,0.4)"
              fillColor="rgba(44,195,107,0.04)"
            />

            {/* Hunting-zones-oppdraget §1 (lag-rekkefølge): "topo → heatmap →
                soner → observasjoner/kamera/spor → jaktlag". ViltIQ heatmap
                (§5–§7 i STEG 4-oppdraget) er den UNDERLIGGENDE "Intelligence
                Layer" — motorens sannsynlighetslandskap for den aktive arten
                — og skal derfor tegnes FØR (altså visuelt UNDER, siden
                JSX-rekkefølge = lag-rekkefølge på både Leaflet og
                react-native-maps) sone-polygonene/-ringene, observasjons-
                markørene og jaktlagets posisjoner under. Tidligere lå dette
                laget lengst NEDE i treet (dermed øverst/oppå alt annet) —
                det begravde både sonepolygonene og observasjonsmarkørene
                under gradienten i stedet for omvendt. Flyttet hit, rett
                under radius-sirkelen; selve punktene/vektene (heatmapRenderPoints)
                er UENDRET, dette er ren presentasjons-rekkefølge.

                STEG 5 §7 — zoom-oppførsel er VERIFISERT, ikke bygget på nytt:
                radius er i SKJERM-piksler, ikke geografiske meter, på begge
                plattformer (leaflet.heat sin simpleheat-motor på web, Google
                Maps' HeatmapTileProvider via react-native-maps på native).
                Se components/LeafletMapImpl.tsx sin Heatmap-komponent for
                web-implementasjonen. */}
            {visPrediksjon && !erJaktplanAktiv && heatmapRenderPoints.length > 0 && (
              <Heatmap
                points={heatmapRenderPoints}
                radius={HEATMAP_POINT_RADIUS}
                gradient={heatmapGradientProp}
                // Kold-start-visningsoppdraget §5: uendret (biblioteksdefault)
                // opasitet når det finnes ekte lokal evidens noe sted i
                // resultatet — kun dempet ved REN terrengantakelse, se
                // heatmapErRentTerrengbasert over.
                opacity={heatmapErRentTerrengbasert ? 0.55 : undefined}
              />
            )}

            {/* Sektoroverlegg — valgt kameras retningsfelt */}
            {kameraSektorCoords && !erJaktplanAktiv && (
              <Polygon
                coordinates={kameraSektorCoords}
                fillColor="rgba(96,165,250,0.20)"
                strokeColor="rgba(96,165,250,0.55)"
                strokeWidth={1.5}
              />
            )}

            {/* Tidbaserte aktive soner — HuntPlan-oppdraget §3.16: skjult
                mens en jaktplan er åpen ("ikke vis 25 overlays samtidig"). */}
            {!erJaktplanAktiv && aktiveSoner.map((s) => (
              <Circle
                key={s.id}
                center={{ latitude: s.latitude, longitude: s.longitude }}
                radius={s.type === "nå" ? 200 : 150}
                strokeWidth={2}
                strokeColor={s.type === "nå"
                  ? "rgba(34,211,238,0.7)"
                  : "rgba(168,85,247,0.7)"}
                fillColor={s.type === "nå"
                  ? "rgba(34,211,238,0.12)"
                  : "rgba(168,85,247,0.12)"}
              />
            ))}

            {/* V1.3 (§K/§L): sonens FAKTISKE geografiske utstrekning —
                zone.footprint.hull, de faktisk krevde grid-cellenes konvekse
                skrog fra extractZones() (src/engine/grid.ts), IKKE en
                kunstig sirkel rundt zone.center. Tegnes UNDER rangerings-
                ringene under (JSX-rekkefølge = lag-rekkefølge på både
                Leaflet og react-native-maps).

                Hunting-zones-oppdraget §1: rangeringsbasert visuell hierarki
                (zoneTierStyle, definert ovenfor komponenten) — #1 tydelig
                grønn kontur+fylling, #2 merkbart svakere, #3 (og #4/#5,
                innenfor motorens egne maxZones-tak) subtilest. Den valgte
                sonen (trykket/åpen i panelet) får i tillegg en liten
                strokeWidth-boost OVENPÅ sin rangerings-tier — men rangeringen
                er fortsatt PRIMÆRSIGNALET, ikke valgt-status alene (§ "på ett
                sekund se hvor ViltIQ mener jeg bør være", ikke bare ved å
                trykke). Et skrog med under 3 punkter (en liten/enkelt-celle-
                sone — se convexHull() i src/lib/geo.ts) har intet
                meningsfullt polygon å tegne og hoppes derfor over. */}
            {/* HuntPlan-oppdraget §3.16: mens en plan er åpen vises KUN den
                planlagte sonens polygon/ring, ikke de andre 1–4 sonene —
                "ikke vis 25 overlays samtidig". */}
            {(erJaktplanAktiv ? visteHotspots.filter((s) => zoneIdentity(s) === huntPlanZoneId) : visteHotspots).map((sone) => {
              const hull = smoothedFootprintByZone.get(zoneIdentity(sone));
              if (!hull || hull.length < 3) return null;
              const rank = sone.rank ?? 1;
              const tier = zoneTierStyle(rank, sone.predictionMode);
              const erValgtFootprint = sone.id === hotspotSone?.id;
              return (
                <Polygon
                  key={`footprint-${zoneIdentity(sone)}`}
                  coordinates={hull}
                  strokeColor={tier.strokeColor}
                  strokeWidth={erValgtFootprint ? tier.strokeWidth + 0.75 : tier.strokeWidth}
                  fillColor={tier.fillColor}
                  lineDashPattern={tier.lineDashPattern}
                />
              );
            })}

            {/* V1.2.2 KORRIGERING (§10-11 i korrigeringsoppdraget): hotspots
                var tidligere store dyre-emoji-PINNER — det leser visuelt som
                "dyret står akkurat her", falsk presisjon motoren aldri
                påstår. Erstattet med diskrete, tallrangerte RINGER (samme
                MarkerRing-primitiv som allerede fantes for akkurat dette
                formålet, se komponentens egen kommentar: "en pin ville løyet
                om presisjon"). Ringene forblir trykkbare for å velge/åpne
                forklaringen. Trykk på EN ring gjør den til valgt sone OG
                åpner forklaringen samlet.

                Hunting-zones-oppdraget §1/§4: ring-STØRRELSE og -FARGE er nå
                rangeringsbasert (zoneTierStyle), ikke bare valgt/ikke-valgt —
                #1 er alltid størst/klarest uansett om den er trykket akkurat
                nå. Rangeringstall+score ("#1 · 68") vises nå for ALLE synlige
                soner (også #1), og #1 får i tillegg en liten "ANBEFALT"-
                merkelapp — rangeringen skal være øyeblikkelig synlig, ikke
                noe brukeren må trykke seg frem til for å oppdage. */}
            {(erJaktplanAktiv ? visteHotspots.filter((s) => zoneIdentity(s) === huntPlanZoneId) : visteHotspots).map((sone) => {
              const rank = sone.rank ?? 1;
              const tier = zoneTierStyle(rank, sone.predictionMode);
              const erValgt = sone.id === hotspotSone?.id;
              return (
                <StableMarker
                  key={zoneIdentity(sone)}
                  coordinate={{ latitude: sone.center.latitude, longitude: sone.center.longitude }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  onPress={() => { setValgtHotspotId(zoneIdentity(sone)); setSheetSnap("expanded"); }}
                >
                  <View style={styles.hotspotRingWrap}>
                    <MarkerRing
                      variant="hotspot"
                      size={erValgt ? tier.ringSize + 4 : tier.ringSize}
                      color={tier.ringColor}
                    />
                  </View>
                  <View style={[styles.hotspotScoreBadge, rank > 1 && styles.hotspotScoreBadgeSecondary]} pointerEvents="none">
                    <Text style={styles.hotspotScoreText}>#{rank} · {Math.round(sone.score)}</Text>
                  </View>
                  {/* V1.3: mens Jaktplan-arket er åpent for NETTOPP denne
                      sonen, viser HuntPlan sin egen markør (under) allerede
                      en "ANBEFALT POST"-merkelapp på SAMME koordinat
                      (recommendedPosition = zone.center for primærsonen) —
                      denne badgen droppes da for å unngå to overlappende
                      merkelapper på samme punkt. Utenfor jaktplan-visningen
                      (vanlig hotspot-browsing) vises den som før. */}
                  {rank === 1 && !(erJaktplanAktiv && zoneIdentity(sone) === huntPlanZoneId) && (
                    <View style={styles.hotspotAnbefaltWrap} pointerEvents="none">
                      <Text style={styles.hotspotAnbefaltText}>ANBEFALT</Text>
                    </View>
                  )}
                </StableMarker>
              );
            })}

            {/* Observasjonsmarkører — dyr sett (manuelt/kamera). Sonesenteret
                over er et beregnet grid-punkt fra motoren, ikke koordinatet
                til en enkelt observasjon, så det er ikke lenger behov for å
                filtrere bort en "sådde sonen"-observasjon her. */}
            {visObservasjoner && !erJaktplanAktiv && dyrObsMedGps.map((o) => (
              <StableMarker
                key={o.id}
                coordinate={{ latitude: o.latitude as number, longitude: o.longitude as number }}
                anchor={{ x: 0.5, y: 1 }}
                title={`${o.dyr} · ${o.type}`}
                description={o.kommentar || undefined}
                onPress={() => bekreftSlettObservasjonFraKart(o)}
              >
                <MarkerBadge
                  kind="observation"
                  size="sm"
                  emoji={dyrEmoji(o.dyr)}
                  accentColor={o.dyr === "Rev" ? uiColor.levelHøy : undefined}
                />
              </StableMarker>
            ))}

            {/* Sporregistreringer */}
            {visSporAnnet && !erJaktplanAktiv && sporObsMedGps.map((o) => (
              <StableMarker
                key={o.id}
                coordinate={{ latitude: o.latitude as number, longitude: o.longitude as number }}
                anchor={{ x: 0.5, y: 1 }}
                title={`Spor${o.sporType ? " · " + o.sporType : ""}`}
                description={o.kommentar || undefined}
                onPress={() => bekreftSlettObservasjonFraKart(o)}
              >
                <MarkerBadge kind="spor" size="sm" icon="paw-outline" />
              </StableMarker>
            ))}

            {/* "Annet"-kartpunkter */}
            {visSporAnnet && !erJaktplanAktiv && mapPoints.map((p) => (
              <StableMarker
                key={p.id}
                coordinate={{ latitude: p.latitude, longitude: p.longitude }}
                anchor={{ x: 0.5, y: 1 }}
                title={p.label || p.pointType}
                description={p.kommentar || undefined}
              >
                <MarkerBadge kind="annet" size="sm" icon="pricetag-outline" />
              </StableMarker>
            ))}

            {/* Kameramarkører */}
            {/* Feltrapport (fysisk enhet, V1.3): bekreftet via lag-panelets
                "Kamera · N"-telling at dataen FAKTISK ankommer (N ≥ 1) —
                likevel ingenting synlig, selv med eksplisitt størrelse OG
                collapsable={false}. To uavhengige, begrunnede gjetninger på
                selve TIMINGEN (StableMarker sin forsinkede flipp) har IKKE
                løst det. I stedet for en tredje gjetning: fjerner hele
                timing-variabelen. `tracksViewChanges` er HELE TIDEN `true`
                her (ikke StableMarker) — SDK-en tar da et nytt native
                snapshot på HVER re-render i stedet for å stole på ett
                bestemt tidsvindu. Dyrere (flere snapshots over tid), men for
                et fåtall viltkamera-markører er kostnaden ubetydelig
                sammenlignet med at de rett og slett ikke vises. Hvis
                markøren FORTSATT ikke dukker opp med dette, er det et
                endelig, ugjendrivelig bevis på at årsaken IKKE er
                snapshot-timing i det hele tatt (se egen kommentar ved
                MarkerBadge sin rotasjon under for neste steg i så fall). */}
            {visKameraer && !erJaktplanAktiv && kameraer.map((k) => (
              <Marker
                key={k.id}
                coordinate={{ latitude: k.latitude, longitude: k.longitude }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges
                onPress={() => {
                  setSelectedCamera(k);
                  setCameraView("info");
                  setSelectedPin(null);
                }}
              >
                <View style={styles.cameraPinWrap} collapsable={false}>
                  <View style={styles.cameraDirArrowWrap} pointerEvents="none">
                    <Ionicons
                      name="navigate"
                      size={14}
                      color={uiColor.info}
                      style={{ transform: [{ rotate: `${k.directionDegrees}deg` }] }}
                    />
                  </View>
                  <MarkerBadge kind="kamera" size="md" icon="camera" />
                </View>
              </Marker>
            ))}

            {/* Jaktlag-medlemmers live-posisjoner */}
            {!erJaktplanAktiv && medlsPosisjon.map((m) => (
              <StableMarker
                key={`medl-${m.uid}`}
                coordinate={{ latitude: m.latitude, longitude: m.longitude }}
                anchor={{ x: 0.5, y: 1 }}
                title={m.epost || "Jeger"}
              >
                <MarkerBadge kind="party" size="sm" emoji={(m.epost?.[0] ?? "J").toUpperCase()} />
              </StableMarker>
            ))}

            {/* HuntPlan-oppdraget §3.16: mens en plan er åpen — KUN det
                anbefalte punktet (egen markør, tydelig ulik sonens egen
                rangerings-ring), en tilnærmings-sektor (buildSector, samme
                primitiv som kameraets retningsfelt over) langs
                approach.recommendedApproachDirectionDeg, og — KUN når
                expectedMovement faktisk har en retning OG en meningsfull
                confidence (samme terskel som HuntPlanPanel sin tekst-hedging,
                se MEANINGFUL_MOVEMENT_CONFIDENCE) — en dempet bevegelsespil.
                Motoren er sannhetskilden for alle tre punktene/retningene;
                kartet tegner kun det motoren allerede har regnet ut. */}
            {erJaktplanAktiv && huntPlan && (
              <>
                {/* recommendedApproachDirectionDeg er `null` når motoren ikke
                    kjenner vindretningen for punktet (§3.9 i huntPlan.ts) —
                    ALDRI en gjettet kurs, så sektoren tegnes rett og slett
                    ikke i det tilfellet i stedet for å late som en retning
                    finnes. */}
                {huntPlan.approach.recommendedApproachDirectionDeg != null && (
                  <Polygon
                    key="huntplan-approach-sector"
                    coordinates={buildSector(
                      huntPlan.recommendedPosition,
                      90,
                      huntPlan.approach.recommendedApproachDirectionDeg,
                      36
                    )}
                    fillColor="rgba(44,195,107,0.22)"
                    strokeColor="rgba(44,195,107,0.65)"
                    strokeWidth={1.5}
                  />
                )}
                {huntPlan.expectedMovement.directionDeg != null &&
                  huntPlan.expectedMovement.confidence >= MEANINGFUL_MOVEMENT_CONFIDENCE && (
                    <Polygon
                      key="huntplan-movement-arrow"
                      coordinates={buildSector(
                        huntPlan.expectedMovement.from ?? huntPlan.primaryZone.center,
                        130,
                        huntPlan.expectedMovement.directionDeg,
                        20
                      )}
                      fillColor="rgba(96,165,250,0.20)"
                      strokeColor="rgba(96,165,250,0.55)"
                      strokeWidth={1.5}
                    />
                  )}
                <Marker
                  key="huntplan-position"
                  coordinate={huntPlan.recommendedPosition}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={false}
                >
                  <View style={styles.huntPlanTargetWrap} pointerEvents="none">
                    <Ionicons name="locate" size={22} color={uiColor.primary} />
                  </View>
                  {/* V1.3 "Anbefalt jaktpost": samme merkelapp-mønster som
                      hotspotAnbefaltWrap/hotspotAnbefaltText over (rank 1-
                      hotspoten) — gjenbruker eksisterende visuelt språk i
                      stedet for å finne opp et nytt. */}
                  <View style={styles.hotspotAnbefaltWrap} pointerEvents="none">
                    <Text style={styles.hotspotAnbefaltText}>ANBEFALT POST</Text>
                  </View>
                </Marker>
              </>
            )}

            {/* Valgt ny-pin — der brukeren nettopp trykket for å registrere noe */}
            {selectedPin && (
              <Marker coordinate={selectedPin} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
                <MarkerBadge kind="candidate" size="md" icon="add" />
              </Marker>
            )}
          </MapView>
        ) : (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#2CC36B" />
          </View>
        )}

        {/* ── Premium-oppdraget: den gamle navBar-en (solid, full bredde,
            med "Tilbake"-tekst + "Dyrekart"-tittel + innfelt toggle) brøt
            med resten av skjermens allerede etablerte flytende glass-språk
            (controlBtn/filterChip) — en tung, tradisjonell "app bar" midt i
            et ellers luftig kart. Erstattet med to UAVHENGIGE, flytende
            elementer i samme glass-stil som kontrollkolonnen: en liten
            sirkulær ikon-knapp (ingen tekst — samme konvensjon som
            Google/Apple Maps sin egen tilbake-knapp) og toggle-pillen,
            nå flytende i stedet for innrammet i en bar. Tittelen
            ("Dyrekart") er fjernet helt — redundant når brukeren allerede
            er på kartet, og fjerning av den var selve kjernen i "rotete"-
            tilbakemeldingen. */}
        <Pressable onPress={() => router.back()} style={styles.floatingBackBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={uiColor.textPrimary} />
        </Pressable>

        <View style={[styles.mapToggle, styles.mapToggleFloating]}>
          <Pressable
            onPress={() => setMapMode("terrain")}
            style={[styles.toggleItem, mapMode === "terrain" && styles.toggleItemActive]}
          >
            <Text style={[styles.toggleText, mapMode === "terrain" && styles.toggleTextActive]}>
              Topo
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMapMode("satellite")}
            style={[styles.toggleItem, mapMode === "satellite" && styles.toggleItemActive]}
          >
            <Text style={[styles.toggleText, mapMode === "satellite" && styles.toggleTextActive]}>
              Satellitt
            </Text>
          </Pressable>
        </View>

        {/* ── "Analyser dette området" — DEN ENESTE knappen i hele kartet som
            kan flytte analysisAnchor (se reanalyserHer() og filkommentaren
            ved analysisAnchor-state over). Vises KUN når viewporten faktisk
            har beveget seg langt nok fra det låste ankeret til at en ny
            analyse ville dekket noe reelt annet (kanReanalysereHer — samme
            geografiske hysterese-regel som §C, men her brukt UTELUKKENDE til
            synlighet). Panorering/zoom ALENE gjør ALDRI noe mer enn å vise
            denne knappen — trykket er obligatorisk. Skjult mens en jaktplan
            er åpen (samme "kun én sones detaljer om gangen"-filosofi som
            resten av §3.16-overlayene). */}
        {kanReanalysereHer && !erJaktplanAktiv && !selectedPin && !selectedCamera && (
          <View style={styles.reanalyserWrap} pointerEvents="box-none">
            <Pressable style={styles.reanalyserKnapp} onPress={reanalyserHer} hitSlop={4}>
              <Ionicons name="refresh-outline" size={16} color={uiColor.primaryText} />
              <Text style={styles.reanalyserKnappText}>Analyser dette området</Text>
            </Pressable>
          </View>
        )}

        {/* ── Artsfilter — alltid synlig rad, ikke en gjemt dropdown (§22) ── */}
        {!selectedPin && !selectedCamera && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterBar}
            contentContainerStyle={styles.filterBarContent}
          >
            {dyrFilter.map((dyr) => {
              const active = aktivtFilter === dyr;
              return (
                <Pressable
                  key={dyr}
                  onPress={() => {
                    setAktivtFilter(dyr);
                    // §3 i art-karusell-oppdraget: Kart sitt artsfilter og Hjem sin
                    // art-karusell deler ett valg via settings.ts — skriv tilbake KUN
                    // for de tre artene karusellen faktisk støtter, se KARUSELL_ART_FRA_DYR.
                    const karusellArt = KARUSELL_ART_FRA_DYR[dyr];
                    if (karusellArt) {
                      getSettings()
                        .then((s) => saveSettings({ ...s, selectedSpecies: karusellArt }))
                        .catch(() => {});
                    }
                  }}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                    {dyr !== "Alle" && dyrEmoji(dyr) + " "}{dyr}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* ── Høyre kontrollkolonne: kartlag, registrer spor, min posisjon ──
            Konsoliderer det som før var 7 spredte venstre-knapper + 1 høyre-
            knapp til én forutsigbar kolonne (§8 Overlay management). */}
        {!selectedPin && !selectedCamera && (
          <View style={styles.controlColumn}>
            {/* §bugrapport V1.3: kompass — kartet tillater rotasjon, så "opp"
                er ikke alltid nord. Nåla roterer MOTSATT av kartets faktiske
                kompassretning (mapHeading, holdt i sync i
                handleMapRegionChangeComplete) slik at den alltid peker mot
                ekte nord uansett hvordan kartet er dreid. Trykk nullstiller
                rotasjonen (samme konvensjon som Google/Apple Maps sin egen
                kompass-knapp) — samme controlBtn-stil som resten av kolonnen,
                ingen ny visuell stil oppfunnet for dette. */}
            <Pressable
              style={styles.controlBtn}
              hitSlop={4}
              onPress={() => mapRef.current?.animateCamera?.({ heading: 0 }, { duration: 300 })}
            >
              {/* Feltrapport V1.3: "kompasset må være synlig" — et generisk
                  Ionicons-ikon + en 9px-bokstav leste tydeligvis ikke som et
                  kompass blant tre andre sirkulære ikon-knapper. Erstattet
                  med en EKTE to-tonet kompassnål (samme CSS-trekant-mønster
                  som MarkerBadge sin "tail" allerede bruker i denne filen,
                  ikke et nytt visuelt triks) — grønn N-halvdel/dempet
                  S-halvdel er den universelle kompass-konvensjonen
                  (Google/Apple Maps bruker nøyaktig samme to-tone-prinsipp),
                  umulig å forveksle med et vanlig ikon. */}
              <View style={{ alignItems: "center", transform: [{ rotate: `${-mapHeading}deg` }] }}>
                <View style={styles.compassNeedleNorth} />
                <View style={styles.compassNeedleSouth} />
              </View>
            </Pressable>

            <Pressable
              style={[styles.controlBtn, lagmenyÅpen && styles.controlBtnActive]}
              onPress={() => setLagmenyÅpen((v) => !v)}
              hitSlop={4}
            >
              <Ionicons name="layers-outline" size={20} color={lagmenyÅpen ? uiColor.primary : uiColor.textSecondary} />
            </Pressable>

            <Pressable
              style={[styles.controlBtn, !userLocation && styles.controlBtnDisabled]}
              onPress={åpneSporpunktValg}
              disabled={!userLocation}
              hitSlop={4}
            >
              <Ionicons name="footsteps-outline" size={20} color={uiColor.textSecondary} />
            </Pressable>

            {userLocation && (
              <Pressable
                style={styles.controlBtn}
                hitSlop={4}
                onPress={() =>
                  mapRef.current?.animateToRegion(
                    { latitude: userLocation.latitude, longitude: userLocation.longitude, latitudeDelta: 0.06, longitudeDelta: 0.06 },
                    400
                  )
                }
              >
                <Ionicons name="locate" size={20} color={uiColor.textSecondary} />
              </Pressable>
            )}
          </View>
        )}

        {/* ── Kartlag-panel ── Én samlet kontroll (§21), erstatter 5 spredte
            av/på-knapper. STEG 5 §6: gruppert i "ViltIQ" (motorens egne lag)
            og "Registreringer" (rådata brukeren/kameraene har samlet inn),
            slik at det er tydelig hva som er en prediksjon og hva som er en
            faktisk observasjon. */}
        {lagmenyÅpen && !selectedPin && !selectedCamera && (
          <Surface variant="elevated" style={[styles.layersPanel, uiElevation.panel]}>
            {/* Feltrapport (fysisk enhet, V1.3): "ingen måte å minimere den
                på igjen" — panelet hadde KUN layers-knappen i kontroll-
                kolonnen som lukke-mekanisme, ikke noe synlig på selve
                kortet. Samme X-mønster som HuntPlanPanel/ModalSheet sine
                andre paneler, ikke en ny lukke-stil. */}
            <View style={styles.layersPanelHeader}>
              <Text style={styles.layersPanelTitle}>Kartlag</Text>
              <Pressable onPress={() => setLagmenyÅpen(false)} hitSlop={10}>
                <Ionicons name="close" size={18} color={uiColor.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.layersGroupTitle}>ViltIQ</Text>
            {/* Feltrapport (fysisk enhet, V1.3): tallene i parentes er et
                bevisst, midlertidig diagnosevindu — de skiller "data kom
                aldri frem" (0) fra "data finnes, men vises ikke" (>0 uten
                noe synlig på kartet), uten at brukeren trenger konsoll/Mac.
                Fjernes når kamera-/heatmap-rapportene er bekreftet løst. */}
            <Toggle label={`Motor (heatmap) · ${heatmapRenderPoints.length} pkt`} icon="analytics-outline" active={visPrediksjon} onToggle={() => setVisPrediksjon((v) => !v)} accentColor="#A78BFA" />
            {/* Motor-tidsvindu (§18) — hvor langt tilbake motoren ser etter
                signaler. Kompakt 3-valgs segmentkontroll, samme visuelle
                mønster som Topo/Satellitt-bryteren i navBar. */}
            <View style={styles.tidsvinduRad}>
              {(["nå", "6t", "24t"] as const).map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setTidsvindu(v)}
                  style={[styles.tidsvinduBtn, tidsvindu === v && styles.tidsvinduBtnActive]}
                >
                  <Text style={[styles.tidsvinduTxt, tidsvindu === v && styles.tidsvinduTxtActive]}>
                    {v === "nå" ? "Nå" : `Siste ${v}`}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Toggle label="Aktive soner" icon="time-outline" active={visAktiveSoner} onToggle={() => setVisAktiveSoner((v) => !v)} accentColor="#22D3EE" />

            <Text style={styles.layersGroupTitle}>Registreringer</Text>
            <Toggle label={`Observasjoner · ${observasjoner.length}`} icon="eye-outline" active={visObservasjoner} onToggle={() => setVisObservasjoner((v) => !v)} accentColor="#34D399" />
            <Toggle label="Spor og andre punkter" icon="footsteps-outline" active={visSporAnnet} onToggle={() => setVisSporAnnet((v) => !v)} accentColor={uiColor.warning} />
            <Toggle label={`Kamera · ${kameraer.length}`} icon="camera" active={visKameraer} onToggle={() => setVisKameraer((v) => !v)} accentColor={uiColor.info} />
            {/* Feltrapport (fysisk enhet, V1.3): "eiendomsgrenser fungerer
                ikke, kommer ingenting der" — stemmer, men ikke en bug: dette
                laget (Kartverket/Geonorge-matrikkelkart) er KUN implementert
                for web (se MapView.web.tsx) — components/MapView.tsx (native)
                stripper `showPropertyBoundaries` stille, med vilje, fordi
                react-native-maps aldri fikk en tilsvarende native
                implementasjon. Å la bryteren stå synlig og ikke-fungerende
                på native er verre enn å skjule den — en bryter som ikke gjør
                noe er akkurat den typen "stille ingenting" som har vært
                kjernen i flere av de andre feltrapportene. Ekte native
                eiendomsgrenser er et eget, ikke-trivielt arbeid (ny
                datakilde/rendering for react-native-maps), ikke noe som
                løses som en del av denne opprydningen. */}
            {Platform.OS === "web" && (
              <Toggle label="Eiendomsgrenser" icon="map-outline" active={visEiendomsgrenser} onToggle={() => setVisEiendomsgrenser((v) => !v)} accentColor="#FB923C" />
            )}
          </Surface>
        )}

        {/* ── Aktive soner — kort legend, plassert til venstre for å aldri kollidere med engine-panelet/høyre-kolonnen ── */}
        {visAktiveSoner && !selectedPin && !selectedCamera && aktiveSoner.length > 0 && !lagmenyÅpen && (
          <View style={styles.aktivLegend}>
            {aktiveSoner.slice(0, 4).map((s) => (
              <View key={s.id} style={styles.predLegendRad}>
                <View style={[styles.predLegendDot, {
                  backgroundColor: s.type === "nå" ? "#22D3EE" : "#A855F7",
                }]} />
                <Text style={styles.predLegendTxt}>
                  {dyrEmoji(s.dyr)} {s.dyr} · {s.tidLabel}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Desktop: kompakt status-/engine-panel over kartet (§16) ──
            Samme statusInnhold()-data som mobilens bottom sheet — motorens
            svar når Prediksjon er på, ellers samme "beste område" som før. */}
        {erDesktop && !selectedPin && !selectedCamera && (
          <Surface variant="elevated" style={[styles.enginePanelDesktop, uiElevation.panel]}>
            {statusInnhold(false)}
          </Surface>
        )}

        {/* ── Kameradetaljpanel (bunn-ark) ── */}
        {selectedCamera && !selectedPin && (
          <ScrollView
            style={styles.cameraPanel}
            contentContainerStyle={styles.cameraPanelContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {cameraView === "info" && (
              <>
                <View style={styles.cameraPanelHeader}>
                  <View style={styles.cameraPanelLeft}>
                    <View style={styles.cameraIconBadge}>
                      <Ionicons name="camera" size={18} color="#60A5FA" />
                    </View>
                    <View>
                      <Text style={styles.cameraPanelTitle}>{selectedCamera.name}</Text>
                      <Text style={styles.cameraPanelCoord}>
                        {selectedCamera.latitude.toFixed(4)}, {selectedCamera.longitude.toFixed(4)}
                      </Text>
                    </View>
                  </View>
                  <Pressable onPress={() => setSelectedCamera(null)} style={styles.closeBtn}>
                    <Ionicons name="close" size={18} color="#6B8A76" />
                  </Pressable>
                </View>

                <View style={styles.cameraPanelStats}>
                  <View style={styles.cameraStat}>
                    <Text style={styles.cameraStatLabel}>Satt opp</Text>
                    <Text style={styles.cameraStatValue}>{formatDato(selectedCamera.installedAt)}</Text>
                  </View>
                  <View style={styles.cameraStat}>
                    <Text style={styles.cameraStatLabel}>Aktivt</Text>
                    <Text style={styles.cameraStatValue}>{installertVarighet(selectedCamera.installedAt)}</Text>
                  </View>
                  <View style={styles.cameraStat}>
                    <Text style={styles.cameraStatLabel}>Obs.</Text>
                    <Text style={styles.cameraStatValue}>{cameraObsListe.length}</Text>
                  </View>
                </View>

                <View style={styles.cameraPanelStats}>
                  <View style={styles.cameraStat}>
                    <Text style={styles.cameraStatLabel}>Batteri</Text>
                    <Text style={styles.cameraStatValue}>{selectedCamera.batteryStatus}</Text>
                  </View>
                  <View style={styles.cameraStat}>
                    <Text style={styles.cameraStatLabel}>Minnekort</Text>
                    <Text style={styles.cameraStatValue}>{selectedCamera.memoryCardStatus}</Text>
                  </View>
                  <View style={styles.cameraStat}>
                    <Text style={styles.cameraStatLabel}>Åte</Text>
                    <Text style={styles.cameraStatValue}>{selectedCamera.baitStatus}</Text>
                  </View>
                </View>

                <View style={styles.cameraHistSection}>
                  <View style={styles.cameraHistHeader}>
                    <Text style={styles.cameraHistTitle}>Siste registreringer</Text>
                    <View style={styles.cameraHistBadge}>
                      <Text style={styles.cameraHistBadgeText}>{cameraObsListe.length}</Text>
                    </View>
                  </View>

                  {cameraObsListe.length === 0 ? (
                    <Text style={styles.cameraHistEmpty}>
                      Ingen observasjoner registrert på dette kameraet ennå.
                    </Text>
                  ) : (
                    cameraObsListe.slice(0, 5).map((obs) => (
                      <View key={obs.id} style={styles.cameraHistRow}>
                        <Text style={styles.cameraHistEmoji}>{dyrEmoji(obs.dyr)}</Text>
                        <View style={styles.cameraHistBody}>
                          <Text style={styles.cameraHistAnimal}>
                            {obs.dyr}{obs.antall > 1 ? ` ×${obs.antall}` : ""}
                            <Text style={styles.cameraHistType}> · {obs.type}</Text>
                          </Text>
                          <Text style={styles.cameraHistTime}>{hentRelativTid(obs.tid)}</Text>
                        </View>
                      </View>
                    ))
                  )}
                </View>

                <View style={styles.cameraActionsGrid}>
                  <Pressable
                    onPress={() => {
                      setRegDyr("Rådyr"); setRegAntall(1);
                      setRegKjonn(null); setRegAlder(null); setRegKommentar("");
                      setRegRetningKjent(false); setRegRetning(0);
                      setCameraView("observasjon");
                    }}
                    style={styles.cameraActionBtn}
                  >
                    <Ionicons name="paw-outline" size={16} color="#2CC36B" />
                    <Text style={styles.cameraActionBtnText}>Registrer observasjon</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => router.push(`/kamera/${selectedCamera.id}`)}
                    style={styles.cameraActionBtn}
                  >
                    <Ionicons name="stats-chart-outline" size={16} color="#60A5FA" />
                    <Text style={styles.cameraActionBtnText}>Se statistikk</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      setEditNavn(selectedCamera.name);
                      setEditRetning(selectedCamera.directionDegrees);
                      setEditNotat(selectedCamera.notes);
                      setCameraView("rediger");
                    }}
                    style={styles.cameraActionBtn}
                  >
                    <Ionicons name="create-outline" size={16} color="#FCD34D" />
                    <Text style={styles.cameraActionBtnText}>Rediger kamera</Text>
                  </Pressable>

                  <Pressable
                    onPress={bekreftFjernKamera}
                    style={[styles.cameraActionBtn, styles.cameraActionBtnDanger]}
                  >
                    <Ionicons name="trash-outline" size={16} color="#F87171" />
                    <Text style={styles.cameraActionBtnTextDanger}>Fjern kamera</Text>
                  </Pressable>
                </View>
              </>
            )}

            {cameraView === "observasjon" && (
              <>
                <FormHeader
                  title="Registrer observasjon"
                  sub={selectedCamera.name}
                  onBack={() => setCameraView("info")}
                  onClose={() => setSelectedCamera(null)}
                />

                <Text style={styles.pinLabel}>Dyr</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chipRow}>
                    {dyrRegistrerbar.map((dyr) => {
                      const a = regDyr === dyr;
                      return (
                        <Pressable key={dyr} onPress={() => setRegDyr(dyr)}
                          style={[styles.pinChip, a && styles.pinChipActive]}>
                          <Text style={[styles.pinChipText, a && styles.pinChipTextActive]}>
                            {dyrEmoji(dyr)} {dyr}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>

                <Text style={styles.pinLabel}>Antall</Text>
                <AntallStepper value={regAntall} onChange={setRegAntall} />

                <Text style={styles.pinLabel}>Kjønn (valgfritt)</Text>
                <View style={styles.chipRow}>
                  {kjonnListe.map((kj) => {
                    const a = regKjonn === kj;
                    return (
                      <Pressable key={kj} onPress={() => setRegKjonn((p) => (p === kj ? null : kj))}
                        style={[styles.pinChip, a && styles.pinChipActive]}>
                        <Text style={[styles.pinChipText, a && styles.pinChipTextActive]}>{kj}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.pinLabel}>Alder (valgfritt)</Text>
                <View style={styles.chipRow}>
                  {alderListe.map((al) => {
                    const a = regAlder === al;
                    return (
                      <Pressable key={al} onPress={() => setRegAlder((p) => (p === al ? null : al))}
                        style={[styles.pinChip, a && styles.pinChipActive]}>
                        <Text style={[styles.pinChipText, a && styles.pinChipTextActive]}>{al}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.pinLabel}>Retning dyret gikk (valgfritt)</Text>
                <Text style={styles.pinHint}>
                  Kameraets retning ({selectedCamera.directionDegrees ?? 0}°) endres ikke — dette er
                  hvilken vei DYRET beveget seg, ikke hvor kameraet peker.
                </Text>
                <View style={styles.chipRow}>
                  <Pressable
                    onPress={() => setRegRetningKjent((p) => !p)}
                    style={[styles.pinChip, !regRetningKjent && styles.pinChipActive]}
                  >
                    <Text style={[styles.pinChipText, !regRetningKjent && styles.pinChipTextActive]}>
                      Ukjent retning
                    </Text>
                  </Pressable>
                </View>
                {regRetningKjent && (
                  <View style={{ marginTop: 16, alignItems: "center" }}>
                    <RetningVelger value={regRetning} onChange={setRegRetning} label="Dyrets retning" />
                  </View>
                )}

                <Text style={styles.pinLabel}>Kommentar (valgfritt)</Text>
                <TextInput
                  style={[styles.textInput, styles.textInputMultiline]}
                  multiline
                  placeholder="Notat om observasjonen"
                  placeholderTextColor="#4D6858"
                  value={regKommentar}
                  onChangeText={setRegKommentar}
                />

                <View style={styles.pinActions}>
                  <Pressable
                    onPress={lagreObservasjonFraKamera}
                    disabled={savingCameraAction}
                    style={[styles.pinPrimaryBtn, savingCameraAction && styles.disabled]}
                  >
                    <Ionicons name="paw-outline" size={16} color="#060E08" />
                    <Text style={styles.pinPrimaryText}>
                      {savingCameraAction ? "Lagrer..." : "Lagre observasjon"}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}

            {cameraView === "rediger" && (
              <>
                <FormHeader
                  title="Rediger kamera"
                  sub={selectedCamera.name}
                  onBack={() => setCameraView("info")}
                  onClose={() => setSelectedCamera(null)}
                />

                <Text style={styles.pinLabel}>Navn</Text>
                <TextInput
                  style={styles.textInput}
                  value={editNavn}
                  onChangeText={setEditNavn}
                  placeholder="Navn på kamera"
                  placeholderTextColor="#4D6858"
                />

                <View style={{ marginTop: 16, alignItems: "center" }}>
                  <RetningVelger value={editRetning} onChange={setEditRetning} label="Kameraretning" />
                </View>

                <Text style={styles.pinLabel}>Notater</Text>
                <TextInput
                  style={[styles.textInput, styles.textInputMultiline]}
                  multiline
                  value={editNotat}
                  onChangeText={setEditNotat}
                  placeholder="Notater om kameraet"
                  placeholderTextColor="#4D6858"
                />

                <View style={styles.pinActions}>
                  <Pressable
                    onPress={redigerKamera}
                    disabled={savingCameraAction}
                    style={[styles.pinPrimaryBtn, savingCameraAction && styles.disabled]}
                  >
                    <Ionicons name="checkmark" size={16} color="#060E08" />
                    <Text style={styles.pinPrimaryText}>
                      {savingCameraAction ? "Lagrer..." : "Lagre endringer"}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        )}

        {/* ── Ny-pin: handlingsmeny ── */}
        {selectedPin && pinAction === "menu" && (
          <ScrollView
            style={styles.pinPanel}
            contentContainerStyle={styles.pinPanelContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.pinHeader}>
              <View>
                <Text style={styles.pinTitle}>Nytt punkt</Text>
                <Text style={styles.pinSub}>
                  {selectedPin.latitude.toFixed(5)}, {selectedPin.longitude.toFixed(5)}
                </Text>
              </View>
              <Pressable onPress={closePinPanel} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#9CA3AF" />
              </Pressable>
            </View>

            <Pressable style={styles.pinMenuBtn} onPress={() => setPinAction("kamera")}>
              <View style={styles.pinMenuIconBadge}>
                <Ionicons name="camera-outline" size={18} color="#60A5FA" />
              </View>
              <Text style={styles.pinMenuText}>Sett ned viltkamera</Text>
              <Ionicons name="chevron-forward" size={16} color="#4D6858" />
            </Pressable>

            <Pressable style={styles.pinMenuBtn} onPress={() => setPinAction("dyr")}>
              <View style={styles.pinMenuIconBadge}>
                <Ionicons name="paw-outline" size={18} color="#2CC36B" />
              </View>
              <Text style={styles.pinMenuText}>Registrer dyr</Text>
              <Ionicons name="chevron-forward" size={16} color="#4D6858" />
            </Pressable>

            <Pressable style={styles.pinMenuBtn} onPress={() => setPinAction("spor")}>
              <View style={styles.pinMenuIconBadge}>
                <Ionicons name="footsteps-outline" size={18} color="#FCD34D" />
              </View>
              <Text style={styles.pinMenuText}>Registrer spor</Text>
              <Ionicons name="chevron-forward" size={16} color="#4D6858" />
            </Pressable>

            <Pressable style={[styles.pinMenuBtn, { marginBottom: 0 }]} onPress={() => setPinAction("annet")}>
              <View style={styles.pinMenuIconBadge}>
                <Ionicons name="pricetag-outline" size={18} color="#A78BFA" />
              </View>
              <Text style={styles.pinMenuText}>Annet</Text>
              <Ionicons name="chevron-forward" size={16} color="#4D6858" />
            </Pressable>
          </ScrollView>
        )}

        {/* ── Ny-pin: sett ned viltkamera ── */}
        {selectedPin && pinAction === "kamera" && (
          <ScrollView
            style={styles.pinPanel}
            contentContainerStyle={styles.pinPanelContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <FormHeader
              title="Sett ned viltkamera"
              sub={`${selectedPin.latitude.toFixed(5)}, ${selectedPin.longitude.toFixed(5)}`}
              onBack={() => setPinAction("menu")}
              onClose={closePinPanel}
            />

            <Text style={styles.pinLabel}>Navn (valgfritt)</Text>
            <TextInput
              style={styles.textInput}
              placeholder={`Viltkamera ${kameraer.length + 1}`}
              placeholderTextColor="#4D6858"
              value={kameraNavn}
              onChangeText={setKameraNavn}
            />

            <View style={{ marginTop: 16, alignItems: "center" }}>
              <RetningVelger value={kameraRetningNy} onChange={setKameraRetningNy} label="Kameraretning" />
            </View>

            <View style={styles.pinActions}>
              <Pressable
                onPress={lagreKameraFraMeny}
                disabled={savingPin}
                style={[styles.pinPrimaryBtn, savingPin && styles.disabled]}
              >
                <Ionicons name="camera" size={16} color="#060E08" />
                <Text style={styles.pinPrimaryText}>{savingPin ? "Lagrer..." : "Lagre kamera"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}

        {/* ── Ny-pin: registrer dyr ── */}
        {selectedPin && pinAction === "dyr" && (
          <ScrollView
            style={styles.pinPanel}
            contentContainerStyle={styles.pinPanelContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <FormHeader
              title="Registrer dyr"
              sub={`${selectedPin.latitude.toFixed(5)}, ${selectedPin.longitude.toFixed(5)}`}
              onBack={() => setPinAction("menu")}
              onClose={closePinPanel}
            />

            <Text style={styles.pinLabel}>Dyr</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {dyrRegistrerbar.map((dyr) => {
                  const a = valgtDyr === dyr;
                  return (
                    <Pressable key={dyr} onPress={() => setValgtDyr(dyr)}
                      style={[styles.pinChip, a && styles.pinChipActive]}>
                      <Text style={[styles.pinChipText, a && styles.pinChipTextActive]}>
                        {dyrEmoji(dyr)} {dyr}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <Text style={styles.pinLabel}>Antall</Text>
            <AntallStepper value={antallPin} onChange={setAntallPin} />

            <Text style={styles.pinLabel}>Retning dyret gikk</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {retningListe.map((r) => {
                  const a = retningPin === r.grader;
                  return (
                    <Pressable
                      key={r.label}
                      onPress={() => setRetningPin((p) => (p === r.grader ? null : r.grader))}
                      style={[styles.pinChipRetning, a && styles.pinChipRetningActive]}
                    >
                      <Text style={[styles.pinChipText, a && styles.pinChipTextActive]}>
                        {r.label}
                      </Text>
                    </Pressable>
                  );
                })}
                {retningPin != null && (
                  <Pressable
                    onPress={() => setRetningPin(null)}
                    style={styles.pinChipRetningClear}
                  >
                    <Ionicons name="close" size={13} color="#F87171" />
                  </Pressable>
                )}
              </View>
            </ScrollView>

            <View style={styles.pinActions}>
              <Pressable
                onPress={lagreDyrFraMeny}
                disabled={savingPin}
                style={[styles.pinPrimaryBtn, savingPin && styles.disabled]}
              >
                <Ionicons name="paw-outline" size={16} color="#060E08" />
                <Text style={styles.pinPrimaryText}>
                  {savingPin ? "Lagrer..." : "Lagre observasjon"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        )}

        {/* ── Ny-pin: registrer spor ── */}
        {selectedPin && pinAction === "spor" && (
          <ScrollView
            style={styles.pinPanel}
            contentContainerStyle={styles.pinPanelContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <FormHeader
              title="Registrer spor"
              sub={`${selectedPin.latitude.toFixed(5)}, ${selectedPin.longitude.toFixed(5)}`}
              onBack={() => setPinAction("menu")}
              onClose={closePinPanel}
            />

            <Text style={styles.pinLabel}>Dyr (valgfritt)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {dyrRegistrerbar.map((dyr) => {
                  const a = sporDyr === dyr;
                  return (
                    <Pressable key={dyr} onPress={() => setSporDyr((p) => (p === dyr ? null : dyr))}
                      style={[styles.pinChip, a && styles.pinChipActive]}>
                      <Text style={[styles.pinChipText, a && styles.pinChipTextActive]}>
                        {dyrEmoji(dyr)} {dyr}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <Text style={styles.pinLabel}>Sportype</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {sporTypeListe.map((st) => {
                  const a = sporTypeValgt === st;
                  return (
                    <Pressable key={st} onPress={() => setSporTypeValgt(st)}
                      style={[styles.pinChip, a && styles.pinChipActive]}>
                      <Text style={[styles.pinChipText, a && styles.pinChipTextActive]}>{st}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <Text style={styles.pinLabel}>Kommentar (valgfritt)</Text>
            <TextInput
              style={[styles.textInput, styles.textInputMultiline]}
              multiline
              placeholder="Beskriv sporet"
              placeholderTextColor="#4D6858"
              value={sporKommentar}
              onChangeText={setSporKommentar}
            />

            <View style={styles.pinActions}>
              <Pressable
                onPress={lagreSporFraMeny}
                disabled={savingPin}
                style={[styles.pinPrimaryBtn, savingPin && styles.disabled]}
              >
                <Ionicons name="paw-outline" size={16} color="#060E08" />
                <Text style={styles.pinPrimaryText}>{savingPin ? "Lagrer..." : "Lagre spor"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}

        {/* ── Ny-pin: annet ── */}
        {selectedPin && pinAction === "annet" && (
          <ScrollView
            style={styles.pinPanel}
            contentContainerStyle={styles.pinPanelContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <FormHeader
              title="Annet punkt"
              sub={`${selectedPin.latitude.toFixed(5)}, ${selectedPin.longitude.toFixed(5)}`}
              onBack={() => setPinAction("menu")}
              onClose={closePinPanel}
            />

            <Text style={styles.pinLabel}>Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {KART_PUNKT_TYPER.map((t) => {
                  const a = annetType === t;
                  return (
                    <Pressable key={t} onPress={() => setAnnetType(t)}
                      style={[styles.pinChip, a && styles.pinChipActive]}>
                      <Text style={[styles.pinChipText, a && styles.pinChipTextActive]}>{t}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <Text style={styles.pinLabel}>Navn (valgfritt)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="F.eks. Saltstein ved bekken"
              placeholderTextColor="#4D6858"
              value={annetNavn}
              onChangeText={setAnnetNavn}
            />

            <Text style={styles.pinLabel}>Kommentar (valgfritt)</Text>
            <TextInput
              style={[styles.textInput, styles.textInputMultiline]}
              multiline
              placeholder="Notat"
              placeholderTextColor="#4D6858"
              value={annetKommentar}
              onChangeText={setAnnetKommentar}
            />

            <View style={styles.pinActions}>
              <Pressable
                onPress={lagreAnnetFraMeny}
                disabled={savingPin}
                style={[styles.pinPrimaryBtn, savingPin && styles.disabled]}
              >
                <Ionicons name="pricetag-outline" size={16} color="#060E08" />
                <Text style={styles.pinPrimaryText}>{savingPin ? "Lagrer..." : "Lagre punkt"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}

        {/* ── Mobil: status i bottom sheet (§24/§25) — motorens svar
            (besteMotorSone/hotspotSone) er nå appens eneste "beste
            område"-kilde, se statusInnhold(). ── */}
        {!erDesktop && !selectedPin && !selectedCamera && !filterOpen && (
          <BottomSheet
            snap={sheetSnap}
            onSnapChange={setSheetSnap}
            collapsedHeight={68}
            mediumHeight={280}
            expandedHeight={Math.min(560, skjermHøyde * 0.72)}
            summary={statusInnhold(true)}
          >
            {statusInnhold(false, false)}
          </BottomSheet>
        )}

        {/* ── HuntPlan (Jaktplan) §3.1/§3.15 ── Ark OVER kartet, IKKE en
            navigasjon bort fra Kart — kartet er fortsatt synlig rundt/bak
            (ModalSheet sin scrim), samme mønster som appens øvrige
            ark-baserte skjemaer (jakt.tsx/logg.tsx/kamera). Lukkes ved å
            trykke utenfor, X-knappen i panelet, eller Android tilbake-knapp
            (RN <Modal> sin onRequestClose, uendret i ModalSheet). */}
        {huntPlanZone && (
          <ModalSheet visible={erJaktplanAktiv} onClose={lukkJaktplan} maxHeightPercent={86}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <HuntPlanPanel
                zone={huntPlanZone}
                plan={huntPlan}
                unavailableReason={huntPlanUnavailableReason}
                targetDateTimeMs={huntPlanTargetMs}
                onTargetTimeChange={setHuntPlanTargetMs}
                onClose={lukkJaktplan}
                userLocation={userLocation}
                onFocusRecommendedPost={
                  huntPlan
                    ? () =>
                        mapRef.current?.animateToRegion(
                          {
                            latitude: huntPlan.recommendedPosition.latitude,
                            longitude: huntPlan.recommendedPosition.longitude,
                            latitudeDelta: 0.05,
                            longitudeDelta: 0.05,
                          },
                          500
                        )
                    : undefined
                }
              />
            </ScrollView>
          </ModalSheet>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Stiler ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#060E08" },
  container:   { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#060E08" },

  // Premium-oppdraget: erstatter den gamle solide navBar-en. Samme
  // "flytende glass-sirkel"-oppskrift som controlColumn sin controlBtn
  // under (minTouchTarget, uiGlass-farger, samme skygge) — bevisst
  // gjenbrukt helt likt, ikke en ny stil, slik at tilbake-knappen leses som
  // samme familie som resten av kartets flytende kontroller.
  floatingBackBtn: {
    position: "absolute", top: 10, left: 14, zIndex: uiZ.navigation,
    width: minTouchTarget, height: minTouchTarget, borderRadius: uiRadius.md,
    backgroundColor: uiGlass.controlBg,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: uiGlass.controlBorder,
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },
  // §rød-tråd-fiks: brukte FØR uiColor.surface/uiColor.border — en SOLID,
  // opak overflate, mens ALT annet flytende kart-chrome (floatingBackBtn,
  // controlBtn, filterChip) bruker samme halvtransparente uiGlass-oppskrift.
  // Denne ene avvikende flaten var en reell, konkret årsak til at kartet så
  // sammensatt av to ulike stiler i stedet for ett sammenhengende språk.
  mapToggle: {
    flexDirection: "row", backgroundColor: uiGlass.controlBg,
    borderRadius: uiRadius.md, padding: 3,
    borderWidth: 1, borderColor: uiGlass.controlBorder,
  },
  // Toggle-pillen flyter nå fritt (samme rad som floatingBackBtn, speilvendt
  // til høyre) i stedet for å ligge innrammet i den gamle baren.
  mapToggleFloating: {
    position: "absolute", top: 10, right: 14, zIndex: uiZ.navigation,
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },
  toggleItem:       { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9 },
  toggleItemActive: { backgroundColor: uiColor.primary },
  toggleText:       { color: uiColor.textMuted, fontSize: 13, fontWeight: "700" },
  toggleTextActive: { color: uiColor.primaryText, fontWeight: "900" },

  // Artsfilter — alltid synlig rad rett under navBar (§22). Høyre kant
  // stopper FØR kontrollkolonnen (right: 128 = kolonnens bredde + luft) slik
  // at chips aldri kan gjengis bak lag-/spor-/posisjon-knappene (§7).
  filterBar: {
    position: "absolute", top: 64, left: 0, right: 128,
    zIndex: uiZ.mapControls,
  },
  filterBarContent: { paddingHorizontal: 14, gap: 8, paddingRight: 8 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: uiRadius.pill,
    backgroundColor: uiGlass.controlBg,
    borderWidth: 1, borderColor: uiColor.border,
  },
  filterChipActive:     { backgroundColor: uiColor.primary, borderColor: uiColor.primary },
  filterChipText:       { color: uiColor.textSecondary, fontSize: 13, fontWeight: "700" },
  filterChipTextActive: { color: uiColor.primaryText, fontWeight: "900" },

  // Konsolidert høyre kontrollkolonne (§8/§21) — kartlag, spor-registrering, min posisjon
  controlColumn: {
    position: "absolute", right: 14, top: 64,
    gap: 10, zIndex: uiZ.mapControls,
  },
  controlBtn: {
    width: minTouchTarget, height: minTouchTarget, borderRadius: uiRadius.md,
    backgroundColor: uiGlass.controlBg,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: uiGlass.controlBorder,
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },
  controlBtnActive:   { backgroundColor: uiColor.primary + uiAlpha.soft, borderColor: uiColor.primary },
  controlBtnDisabled: { opacity: 0.5 },
  compassNeedleNorth: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderBottomWidth: 15,
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderBottomColor: uiColor.primary,
  },
  compassNeedleSouth: {
    width: 0, height: 0, marginTop: -1,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 15,
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderTopColor: uiColor.textMuted,
  },

  // Kartlag-panel
  layersPanel: {
    position: "absolute", right: 14, top: 114,
    width: 240, padding: uiSpacing.lg,
    zIndex: uiZ.panel,
  },
  layersPanelHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: uiSpacing.sm,
  },
  layersPanelTitle: {
    color: uiColor.textPrimary, fontSize: 13, fontWeight: "900",
    textTransform: "uppercase", letterSpacing: 1,
  },
  layersGroupTitle: {
    color: uiColor.textFaint, fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 0.6,
    marginTop: uiSpacing.sm, marginBottom: 2,
  },

  // Motor-tidsvindu — kompakt 3-valgs segmentkontroll (samme visuelle
  // mønster som Topo/Satellitt-toggleItem over).
  tidsvinduRad: {
    flexDirection: "row", backgroundColor: uiColor.surface,
    borderRadius: uiRadius.md, padding: 3, gap: 2,
    borderWidth: 1, borderColor: uiColor.border,
    marginTop: uiSpacing.xs, marginBottom: uiSpacing.sm,
  },
  tidsvinduBtn: { flex: 1, paddingVertical: 6, borderRadius: 9, alignItems: "center" },
  tidsvinduBtnActive: { backgroundColor: uiColor.primary },
  tidsvinduTxt: { color: uiColor.textMuted, fontSize: 11, fontWeight: "700" },
  tidsvinduTxtActive: { color: uiColor.primaryText, fontWeight: "900" },

  // Desktop engine-panel — starter UNDER artsfilter-raden (top: 64 + rad-
  // høyde), aldri på samme høyde, for å unngå at panelet dekker filtrene.
  enginePanelDesktop: {
    position: "absolute", left: 14, top: 118,
    width: 300, padding: uiSpacing.xl,
    zIndex: uiZ.panel,
  },

  cameraPanel: {
    position: "absolute", left: 14, right: 14, bottom: 20,
    backgroundColor: "rgba(8,12,10,0.97)",
    borderRadius: 24, padding: 16,
    borderWidth: 1, borderColor: "#224A60",
    maxHeight: "82%",
  },
  cameraPanelContent: { paddingBottom: 8 },
  cameraPanelHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  cameraPanelLeft:    { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  cameraPanelTitle:   { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  cameraPanelCoord:   { color: "#6B8A76", fontSize: 12, marginTop: 2 },
  cameraPanelStats:   { flexDirection: "row", gap: 10, marginBottom: 12 },
  cameraStat: {
    flex: 1, backgroundColor: "#0E1A14", borderRadius: 12,
    padding: 10, alignItems: "center",
  },
  cameraStatLabel: { color: "#6B8A76", fontSize: 11, fontWeight: "700", marginBottom: 4 },
  cameraStatValue: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  cameraIconBadge: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: "rgba(96,165,250,0.12)",
    alignItems: "center", justifyContent: "center",
  },

  cameraActionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  cameraActionBtn: {
    flexBasis: "47%", flexGrow: 1,
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12, paddingHorizontal: 8,
    borderWidth: 1, borderColor: "rgba(96,165,250,0.25)", borderRadius: 14,
    backgroundColor: "rgba(96,165,250,0.08)",
  },
  cameraActionBtnText: { color: "#CFE7DB", fontSize: 13, fontWeight: "800", textAlign: "center" },
  cameraActionBtnDanger: {
    borderColor: "#3B1A1A", backgroundColor: "rgba(239,68,68,0.08)",
  },
  cameraActionBtnTextDanger: { color: "#F87171", fontSize: 13, fontWeight: "800", textAlign: "center" },

  cameraHistSection: {
    borderTopWidth: 1, borderTopColor: "#1A2B20",
    paddingTop: 14, marginTop: 4, marginBottom: 16,
  },
  cameraHistHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  cameraHistTitle:  { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  cameraHistBadge:  {
    backgroundColor: "rgba(44,195,107,0.12)",
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3,
    borderWidth: 1, borderColor: "rgba(44,195,107,0.20)",
  },
  cameraHistBadgeText: { color: "#2CC36B", fontSize: 12, fontWeight: "900" },
  cameraHistEmpty:     { color: "#3D5446", fontSize: 13, lineHeight: 20, fontStyle: "italic" },
  cameraHistRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: "#111C14",
  },
  cameraHistEmoji:  { fontSize: 18 },
  cameraHistBody:   { flex: 1 },
  cameraHistAnimal: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  cameraHistType:   { color: "#4D6858", fontWeight: "600" },
  cameraHistTime:   { color: "#3D5446", fontSize: 12, marginTop: 2 },

  pinPanel: {
    position: "absolute", left: 14, right: 14, bottom: 20,
    backgroundColor: "rgba(8,12,10,0.98)",
    borderRadius: 26, padding: 16,
    borderWidth: 1, borderColor: "#243620",
    maxHeight: "82%",
  },
  pinPanelContent: { paddingBottom: 8 },
  pinHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  pinHeaderLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  backStepBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "#111827", alignItems: "center", justifyContent: "center",
    marginRight: 10,
  },
  pinTitle:  { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  pinSub:    { color: "#6B8A76", fontSize: 12, marginTop: 3 },
  pinLabel: {
    color: "#6B8A76", fontSize: 11, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1,
    marginTop: 10, marginBottom: 8,
  },
  pinHint: { color: "#4D6858", fontSize: 12, lineHeight: 17, marginBottom: 8 },
  chipRow:  { flexDirection: "row", gap: 8, paddingRight: 16, flexWrap: "wrap" },
  pinChip: {
    backgroundColor: "#101E14", borderWidth: 1, borderColor: "#1F3027",
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10,
  },
  pinChipActive:    { backgroundColor: "#163222", borderColor: "#2CC36B" },
  pinChipRetning: {
    backgroundColor: "#0E1618", borderWidth: 1, borderColor: "#1A2B30",
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9, minWidth: 42, alignItems: "center",
  },
  pinChipRetningActive: { backgroundColor: "#0E2430", borderColor: "#22D3EE" },
  pinChipRetningClear:  {
    backgroundColor: "rgba(248,113,113,0.08)", borderWidth: 1, borderColor: "rgba(248,113,113,0.2)",
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9,
    alignItems: "center", justifyContent: "center",
  },
  pinChipText:          { color: "#C8D8D0", fontSize: 13, fontWeight: "700" },
  pinChipTextActive:    { color: "#A9F2BF" },
  pinActions:      { flexDirection: "row", gap: 10, marginTop: 16 },
  pinPrimaryBtn: {
    flex: 1, backgroundColor: "#2CC36B", borderRadius: 18,
    paddingVertical: 13, alignItems: "center",
    flexDirection: "row", justifyContent: "center", gap: 7,
  },
  pinPrimaryText:  { color: "#060E08", fontSize: 14, fontWeight: "900" },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "#111827", alignItems: "center", justifyContent: "center",
  },
  disabled: { opacity: 0.55 },

  stepperRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepperBtn: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: "#101E14", borderWidth: 1, borderColor: "#1F3027",
    alignItems: "center", justifyContent: "center",
  },
  stepperValue: { color: "#FFFFFF", fontSize: 17, fontWeight: "900", minWidth: 24, textAlign: "center" },

  textInput: {
    backgroundColor: "#101E14", borderWidth: 1, borderColor: "#1F3027",
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    color: "#FFFFFF", fontSize: 14,
  },
  textInputMultiline: { minHeight: 70, textAlignVertical: "top", marginTop: 4 },

  pinMenuBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#101E14", borderWidth: 1, borderColor: "#1F3027",
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 14,
    marginBottom: 10,
  },
  pinMenuIconBadge: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: "rgba(44,195,107,0.10)",
    alignItems: "center", justifyContent: "center",
  },
  pinMenuText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", flex: 1 },

  // Redesign-oppdraget §22/§23: pin-formede markører (beste-sone/obs/spor/
  // annet/kamera/party) kommer nå fra components/ui/Marker.tsx sin
  // MarkerBadge — ett ViltIQ-markørspråk i stedet for 8 separate,
  // hardkodede bubble/pil-trioer. Kun det som er spesifikt for KAMERA sin
  // sammensatte retningspil + badge, og hotspot-ringens touch-areal, er
  // igjen her — resten av markørstylingen bor i den delte komponenten.
  hotspotRingWrap: {
    width: minTouchTarget, height: minTouchTarget,
    alignItems: "center", justifyContent: "center",
  },
  // Hunting-zones-oppdraget §1/§4: "#{rank} · {score}"-merkelapp for ALLE
  // synlige hotspots (også #1, ikke bare sekundære) — se hotspotRingWrap-
  // bruken over. Liten, diskret plassert i hjørnet av selve ringen — skal
  // ALDRI konkurrere visuelt med heatmap-laget, kun bekrefte rangeringen.
  hotspotScoreBadge: {
    position: "absolute", top: -6, right: -8,
    minWidth: 30, height: 16, borderRadius: 8, paddingHorizontal: 4,
    backgroundColor: "rgba(8,14,10,0.9)",
    borderWidth: 1, borderColor: uiColor.levelHøy,
    alignItems: "center", justifyContent: "center",
  },
  hotspotScoreBadgeSecondary: {
    borderColor: uiColor.levelHøy + "99",
  },
  hotspotScoreText: { color: uiColor.textPrimary, fontSize: 9, fontWeight: "800" },
  // Kun rank 1 — liten grønn "ANBEFALT"-merkelapp under ringen, samme
  // ViltIQ-grønn (uiColor.primary) som resten av appens primærhandlinger,
  // ingen ny farge oppfunnet for dette formålet.
  hotspotAnbefaltWrap: {
    position: "absolute", top: minTouchTarget - 6, left: -26, right: -26,
    alignItems: "center",
  },
  hotspotAnbefaltText: {
    backgroundColor: uiColor.primary, color: uiColor.primaryText,
    fontSize: 8, fontWeight: "900", letterSpacing: 0.5,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    overflow: "hidden",
  },
  // Feltrapport (fysisk enhet, V1.3): kameramarkøren viste ALDRI noe ikon,
  // selv etter StableMarker sin to-forsøks timing-fiks — diagnosen endte på
  // selve STRUKTUREN, ikke timingen. `cameraPinWrap` hadde INGEN eksplisitt
  // bredde/høyde (i motsetning til f.eks. hotspotRingWrap/huntPlanTargetWrap,
  // som begge er eksplisitt `minTouchTarget`-store) — størrelsen måtte
  // utledes fra et flyt-barn (MarkerBadge) ved siden av et ABSOLUTT
  // posisjonert søsken (retningspilen, `top: -17`, altså UTENFOR egne
  // grenser) pluss en `zIndex` som tvinger iOS til å kompositere pilen som et
  // eget lag. react-native-maps sitt iOS-snapshot av egendefinert
  // markør-innhold har kjente problemer nettopp med denne kombinasjonen
  // (ustabil egen-størrelse + innhold som stikker utenfor + separat
  // kompositert lag) — løsningen er å fjerne alle tre risikofaktorene på
  // samme måte som de ALLEREDE velfungerende markørene i denne filen: en
  // eksplisitt, fast størrelse, og retningspilen som et VANLIG (ikke
  // absolutt, ikke zIndex) barn innenfor de samme grensene.
  cameraPinWrap: {
    width: minTouchTarget, height: minTouchTarget + 18,
    alignItems: "center", justifyContent: "flex-end",
  },
  cameraDirArrowWrap: {
    height: 18, alignItems: "center", justifyContent: "center",
  },

  // HuntPlan-oppdraget §3.16: distinkt "sikte"-markør for det anbefalte
  // punktet — bevisst ULIK sonens egen rangerings-ring (MarkerRing) og
  // ULIK candidate-pinnen (MarkerBadge), slik at "anbefalt STÅSTED" aldri
  // kan forveksles med "sonens senter" eller "et nytt punkt du registrerer".
  huntPlanTargetWrap: {
    width: minTouchTarget, height: minTouchTarget,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(8,14,10,0.55)", borderRadius: minTouchTarget / 2,
    borderWidth: 2, borderColor: uiColor.primary,
  },

  bottomRow:    { flexDirection: "row", alignItems: "center", gap: 8 },
  bottomMeta:   { ...uiType.caption, color: uiColor.textFaint, marginBottom: 10 },
  bottomLoadText: { ...uiType.body, color: uiColor.textMuted },
  bottomError:    { ...uiType.metadata, color: uiColor.danger },

  recentRow: {
    flexDirection: "row", alignItems: "center",
    gap: 8, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: uiColor.border,
  },
  recentEmoji:  { fontSize: 16 },
  recentAnimal: { ...uiType.bodyStrong, color: uiColor.textPrimary, flex: 1 },
  recentTime:   { ...uiType.caption, color: uiColor.textFaint },

  noDataText: { ...uiType.body, color: uiColor.textFaint },

  moreLinkRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 4, marginTop: 10,
  },
  moreLinkText: { ...uiType.metadata, color: uiColor.primary },

  // HuntPlan-oppdraget §3.1: primær CTA, samme visuelle vekt som andre
  // primary-fylte handlingsknapper i appen (§39: minTouchTarget-høyde).
  planKnapp: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: uiColor.primary, borderRadius: uiRadius.md,
    paddingVertical: 12, marginTop: uiSpacing.md, minHeight: minTouchTarget,
  },
  planKnappText: { fontSize: 14, fontWeight: "800", color: uiColor.primaryText },

  // V1.5 (§CTA "Analyser dette området"): flytende pille, bunnsentrert rett
  // over den kollapsede bottom sheet-en (collapsedHeight=68, se
  // <BottomSheet>) — samme "flytende instrument over kartet"-visuelle språk
  // som resten av kartkontrollene (glass.controlBg), men i primary-farge for
  // å skille den tydelig fra passive lagvalg: dette ER en handling.
  reanalyserWrap: {
    position: "absolute", left: 0, right: 0, bottom: 92,
    alignItems: "center", zIndex: uiZ.panel,
  },
  reanalyserKnapp: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: uiColor.primary, borderRadius: uiRadius.pill,
    paddingVertical: 10, paddingHorizontal: 18,
    minHeight: minTouchTarget,
    ...uiElevation.floating,
  },
  reanalyserKnappText: { fontSize: 13, fontWeight: "800", color: uiColor.primaryText },

  aktivLegend: {
    position: "absolute", left: 14, bottom: 130,
    backgroundColor: uiGlass.controlBg, borderRadius: uiRadius.md,
    borderWidth: 1, borderColor: uiGlass.controlBorder, padding: 12, gap: 7,
    zIndex: uiZ.mapOverlay,
    maxWidth: 240,
  },
  predLegendRad: { flexDirection: "row", alignItems: "center", gap: 8 },
  predLegendDot: { width: 10, height: 10, borderRadius: 5 },
  predLegendTxt: { color: "#C8D8D0", fontSize: 12, fontWeight: "700" },
});
