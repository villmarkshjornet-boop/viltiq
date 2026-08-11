import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, {
  Circle,
  Marker,
  Polygon,
  PROVIDER_GOOGLE,
} from "@/components/MapView";
import type { LongPressEvent, MapViewHandle } from "@/components/MapView";

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
import {
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
import { getSettings } from "@/src/services/settings";
import type { Observasjon, SporType } from "@/src/types/observation";
import {
  dyrEmoji,
  hentRelativTid,
  hentTidsvekt,
} from "@/src/lib/aktivitet";
import {
  anonymiserPosisjon,
  buildSector,
  calcBearing,
  movePoint,
} from "@/src/lib/geo";
import {
  runEngine,
  runEcologicalEngine,
  resolveEnvironmentContext,
  type Species as EngineSpecies,
  type EnvironmentResolver,
} from "@/src/engine";

// ─── Typer ────────────────────────────────────────────────────────────────────

type HeatZone = {
  id: string;
  latitude: number;
  longitude: number;
  score: number;
  count: number;
  avgRetning: number | null;
};

type MapPin = { latitude: number; longitude: number };

type PrediksjonssoneVisning = {
  dyr: string;
  latitude: number;
  longitude: number;
  radius: number;
  farge: string;
  antall: number;
  /** Ferdig formatert visningstekst (nivå+confidence for motor-arter, prosent for arter uten motorprofil). */
  etikett: string;
};

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

const dyrListe    = ["Rådyr", "Elg", "Hjort", "Rev"];
const dyrFilter   = ["Alle", ...dyrListe];
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

function buildHeatZones(obs: Observasjon[]): HeatZone[] {
  const thresh = 0.003;
  const zones: HeatZone[] = [];

  for (const o of obs) {
    if (o.latitude == null || o.longitude == null) continue;
    const w = hentTidsvekt(o.tid);

    const addPoint = (lat: number, lng: number, weight: number) => {
      const ex = zones.find(
        (z) => Math.abs(z.latitude - lat) < thresh && Math.abs(z.longitude - lng) < thresh
      );
      if (ex) {
        const n = ex.count + 1;
        ex.latitude  = (ex.latitude  * ex.count + lat) / n;
        ex.longitude = (ex.longitude * ex.count + lng) / n;
        ex.count = n;
        ex.score += weight;
        if (o.retning != null) {
          ex.avgRetning = ex.avgRetning != null
            ? (ex.avgRetning * (n - 1) + o.retning) / n
            : o.retning;
        }
      } else {
        zones.push({
          id: o.id,
          latitude: lat, longitude: lng,
          score: weight, count: 1,
          avgRetning: o.retning ?? null,
        });
      }
    };

    addPoint(o.latitude, o.longitude, w);
    if (o.retning != null) {
      const pred = movePoint(o.latitude, o.longitude, o.retning, 250);
      addPoint(pred.latitude, pred.longitude, w * 0.6);
    }
  }

  return zones.sort((a, b) => b.score - a.score);
}

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

/**
 * Enkel 48t-vektet-sentrum-beregning — den ORIGINALE prediksjonslogikken,
 * beholdt uendret kun for arter ViltIQ Engine ikke (ennå) har en profil for
 * (i praksis: Rev). Hjort/Rådyr/Elg bruker motoren (src/engine), se
 * prediksjonsoner i komponenten under. Ikke slett denne uten samtidig å
 * legge til en motorprofil for artene som fortsatt bruker den.
 */
function beregnEnkelPrediksjonssone(
  dyr: string,
  observasjoner: Observasjon[],
  farge: string
): PrediksjonssoneVisning | null {
  const relevante = observasjoner.filter(
    (o) =>
      o.dyr === dyr &&
      o.latitude != null &&
      o.longitude != null &&
      (Date.now() - new Date(o.tid).getTime()) <= 48 * 3600000
  );
  if (relevante.length === 0) return null;
  let sumLat = 0, sumLon = 0, sumVekt = 0;
  for (const o of relevante) {
    const t = (Date.now() - new Date(o.tid).getTime()) / 3600000;
    const v = t <= 6 ? 5 : t <= 24 ? 4 : 3;
    sumLat  += (o.latitude  as number) * v;
    sumLon  += (o.longitude as number) * v;
    sumVekt += v;
  }
  const konfidens = Math.min(Math.round((sumVekt / (relevante.length * 5)) * 100), 95);
  return {
    dyr,
    latitude:  sumLat / sumVekt,
    longitude: sumLon / sumVekt,
    radius:    relevante.length >= 5 ? 600 : relevante.length >= 2 ? 400 : 250,
    farge,
    antall:    relevante.length,
    etikett:   `${konfidens}%`,
  };
}

function getZoneRadius(score: number): number {
  if (score >= 12) return 500;
  if (score >= 8)  return 350;
  if (score >= 4)  return 230;
  return 150;
}

function normaliserScore(score: number): string {
  return Math.min((score * 10) / 15, 10).toFixed(1);
}

function scoreEtikett(score: number): string {
  const n = Math.min((score * 10) / 15, 10);
  if (n >= 8.5) return "Utmerket";
  if (n >= 7.0) return "Bra";
  if (n >= 5.0) return "Greit";
  return "Lavt";
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
  const [sporpunktLaster, setSporpunktLaster] = useState(false);
  const [errorText,    setErrorText]    = useState("");
  const [mapMode,      setMapMode]      = useState<"terrain" | "satellite">("terrain");
  const [radiusKm,     setRadiusKm]     = useState<10 | 25 | 50>(50);
  const [userLocation, setUserLocation] = useState<UserPosition | null>(null);
  const [observasjoner, setObservasjoner] = useState<Observasjon[]>([]);
  const [kameraer,     setKameraer]     = useState<Viltkamera[]>([]);
  const [mapPoints,    setMapPoints]    = useState<MapPoint[]>([]);
  const [filterOpen,   filterOpenSet]   = useState(false);
  const [aktivtFilter,   setAktivtFilter]   = useState(params.filter || "Alle");
  const [visPrediksjon,  setVisPrediksjon]  = useState(false);
  const [visKameraer,    setVisKameraer]    = useState(true);
  const [visAktiveSoner, setVisAktiveSoner] = useState(false);
  const [visSporAnnet,   setVisSporAnnet]   = useState(true);
  const [visEiendomsgrenser, setVisEiendomsgrenser] = useState(false);
  const [medlsPosisjon,  setMedlsPosisjon]  = useState<MedlemPosisjon[]>([]);
  // Miljøoppslag (høyde/habitat/vær/snø/vind) til den økologiske prioren i
  // motoren — kun løst NÅR "Prediksjon" faktisk er slått på (nettverkskall,
  // ikke noe kartet trenger med mindre brukeren ber om det). Null = ikke
  // (ferdig) løst ennå; prediksjonsoner faller da tilbake til den rene
  // observasjonsmotoren under, uendret fra tidligere oppførsel.
  const [environmentResolver, setEnvironmentResolver] = useState<EnvironmentResolver | null>(null);

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

        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!aktiv) return;
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
      Alert.alert("Kamera lagret", "Viltkameraet er plassert på kartet.");
    } catch (e: any) {
      Alert.alert("Feil", e?.message || "Klarte ikke lagre kamera.");
    } finally {
      setSavingPin(false);
    }
  }

  async function lagreDyrFraMeny() {
    if (!selectedPin || savingPin) return;
    try {
      setSavingPin(true);
      await saveObservation({
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
      Alert.alert("Lagret", "Observasjonen er lagret.");
    } catch (e: any) {
      Alert.alert("Feil", e?.message || "Klarte ikke lagre observasjon.");
    } finally {
      setSavingPin(false);
    }
  }

  async function lagreSporFraMeny() {
    if (!selectedPin || savingPin) return;
    try {
      setSavingPin(true);
      await saveObservation({
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
      Alert.alert("Spor lagret", "Sporet er registrert på kartet.");
    } catch (e: any) {
      Alert.alert("Feil", e?.message || "Klarte ikke lagre spor.");
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
      Alert.alert("Lagret", "Punktet er lagret på kartet.");
    } catch (e: any) {
      Alert.alert("Feil", e?.message || "Klarte ikke lagre punktet.");
    } finally {
      setSavingPin(false);
    }
  }

  // ─── Handlinger på eksisterende kamera ─────────────────────────────────────

  async function lagreObservasjonFraKamera() {
    if (!selectedCamera || savingCameraAction) return;
    try {
      setSavingCameraAction(true);
      await saveObservation({
        dyr:      regDyr,
        type:     "Sett dyr",
        kommentar: regKommentar.trim() || "Registrert fra viltkamera",
        tid:      new Date().toISOString(),
        latitude:  null,
        longitude: null,
        retning:  null,
        antall:   regAntall,
        observationSource: "camera",
        cameraId: selectedCamera.id,
        kjonn:    regKjonn,
        alder:    regAlder,
      });
      setCameraView("info");
      Alert.alert("Lagret", "Observasjonen er registrert på kameraet.");
    } catch (e: any) {
      Alert.alert("Feil", e?.message || "Klarte ikke lagre observasjon.");
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
      Alert.alert("Lagret", "Kameraet er oppdatert.");
    } catch (e: any) {
      Alert.alert("Feil", e?.message || "Klarte ikke oppdatere kamera.");
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
      Alert.alert("Feil", e?.message || "Klarte ikke fjerne kamera.");
    }
  }

  function bekreftFjernKamera() {
    if (!selectedCamera) return;
    Alert.alert(
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

  async function lagreSporpunkt() {
    if (!userLocation || sporpunktLaster) return;
    try {
      setSporpunktLaster(true);
      const p = anonymiserPosisjon(userLocation.latitude, userLocation.longitude);
      await saveObservation({
        dyr:      valgtDyr,
        type:     "Spor",
        kommentar: "Sporpunkt fra kart",
        tid:      new Date().toISOString(),
        latitude:  p.latitude,
        longitude: p.longitude,
        retning:  null,
        observationSource: "track",
        sporType: "Fotspor",
      });
      Alert.alert("Sporpunkt lagret", `${dyrEmoji(valgtDyr)} ${valgtDyr} · Spor registrert her.`);
    } catch (e: any) {
      Alert.alert("Feil", e?.message || "Klarte ikke lagre sporpunkt.");
    } finally {
      setSporpunktLaster(false);
    }
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

  const heatZones = useMemo(() => buildHeatZones(obsMedGps), [obsMedGps]);

  const bestZone = heatZones[0] ?? null;

  const sektorBearing = useMemo(() => {
    if (!bestZone) return null;
    if (bestZone.avgRetning != null) return bestZone.avgRetning;
    if (userLocation) return calcBearing(bestZone, userLocation);
    return 0;
  }, [bestZone, userLocation]);

  const sektorCoords = useMemo(() => {
    if (!bestZone || sektorBearing === null) return null;
    return buildSector(
      { latitude: bestZone.latitude, longitude: bestZone.longitude },
      1400,
      sektorBearing
    );
  }, [bestZone, sektorBearing]);

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

  // Løs miljøkontekst (høyde/habitat/vær/snø/vind) for den økologiske
  // prioren KUN når "Prediksjon" er slått på og vi har en posisjon å ta
  // utgangspunkt i — dette er eksterne nettverkskall (Geonorge/NIBIO/
  // Open-Meteo/Overpass, se src/engine/environment), ikke noe kartet skal
  // gjøre uoppfordret. Feiler oppslaget (offline e.l.), forblir resolveren
  // null og prediksjonsoner faller tilbake til den rene, alltid-tilgjengelige
  // observasjonsmotoren under — kartet skal ALDRI blokkere eller krasje på
  // et mislykket miljøoppslag.
  useEffect(() => {
    if (!visPrediksjon || !userLocation) return;
    let aktiv = true;
    const analyseRadiusMeter = Math.min(radiusKm * 1000, 5000);

    resolveEnvironmentContext(userLocation, analyseRadiusMeter)
      .then((resolver) => { if (aktiv) setEnvironmentResolver(() => resolver); })
      .catch(() => { /* stille — kartet fungerer uten miljødata, se fallback under */ });

    return () => { aktiv = false; };
  }, [visPrediksjon, userLocation, radiusKm]);

  // Per-art prediksjonssoner. Hjort/Rådyr/Elg vurderes av ViltIQ Engine v1
  // (src/engine) — kartet sender kun inn observasjonene og viser resultatet,
  // det er ALDRI kart.tsx selv som regner ut score/confidence for disse
  // artene lenger. Motoren isolerer selv arten (§14 i motor-oppdraget), så
  // kartet trenger ikke filtrere observasjoner per art før kallet. Bruker
  // den økologiske motoren når miljødata er løst, ellers den rene
  // observasjonsmotoren (identisk med oppførselen før miljølaget fantes).
  const prediksjonsoner = useMemo(() => {
    if (!visPrediksjon) return [];
    const artsfarger: Record<string, string> = {
      Rådyr: "#A78BFA", Elg: "#38BDF8", Hjort: "#FCD34D", Rev: "#FB923C",
    };
    const motorArter: Partial<Record<string, EngineSpecies>> = { Hjort: "hjort", Rådyr: "radyr", Elg: "elg" };

    return dyrListe
      .map((dyr): PrediksjonssoneVisning | null => {
        const farge = artsfarger[dyr] ?? "#FFFFFF";
        const motorArt = motorArter[dyr];
        if (!motorArt) return beregnEnkelPrediksjonssone(dyr, observasjoner, farge);

        const resultat = (environmentResolver && userLocation)
          ? runEcologicalEngine(observasjoner, motorArt, {
              areaCenter: userLocation,
              areaRadiusMeters: Math.min(radiusKm * 1000, 5000),
              environment: environmentResolver,
            })
          : runEngine(observasjoner, motorArt);
        const sone = resultat.zones[0];
        if (!sone) return null;
        return {
          dyr,
          latitude:  sone.center.latitude,
          longitude: sone.center.longitude,
          radius:    sone.radiusMeters,
          farge,
          antall:    sone.observationCount,
          etikett:   `${sone.level} · ${sone.confidenceLevel} konfidens`,
        };
      })
      .filter((p): p is PrediksjonssoneVisning => p != null);
  }, [visPrediksjon, observasjoner, environmentResolver, userLocation, radiusKm]);

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
      mapRef.current.animateToRegion(
        { latitude: fLat, longitude: fLng, latitudeDelta: 0.10, longitudeDelta: 0.10 },
        600
      );
    } else {
      mapRef.current.animateToRegion(
        { latitude: userLocation.latitude, longitude: userLocation.longitude, latitudeDelta: 0.6, longitudeDelta: 0.6 },
        600
      );
    }
  }, [params.focusLat, params.focusLng, userLocation, mapReady]);

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
          >
            {/* Radius-sirkel */}
            <Circle
              center={userLocation}
              radius={radiusKm * 1000}
              strokeWidth={1.5}
              strokeColor="rgba(44,195,107,0.4)"
              fillColor="rgba(44,195,107,0.04)"
            />

            {/* Sektoroverlegg — beste sone */}
            {sektorCoords && (
              <Polygon
                coordinates={sektorCoords}
                fillColor="rgba(59,130,246,0.22)"
                strokeColor="rgba(59,130,246,0.55)"
                strokeWidth={1.5}
              />
            )}

            {/* Sektoroverlegg — valgt kameras retningsfelt */}
            {kameraSektorCoords && (
              <Polygon
                coordinates={kameraSektorCoords}
                fillColor="rgba(96,165,250,0.20)"
                strokeColor="rgba(96,165,250,0.55)"
                strokeWidth={1.5}
              />
            )}

            {/* Varmesoner */}
            {heatZones.map((z) => (
              <Circle
                key={`z-${z.id}`}
                center={{ latitude: z.latitude, longitude: z.longitude }}
                radius={getZoneRadius(z.score)}
                strokeWidth={1}
                strokeColor="rgba(250,168,50,0.5)"
                fillColor="rgba(250,168,50,0.16)"
              />
            ))}

            {/* Tidbaserte aktive soner */}
            {aktiveSoner.map((s) => (
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

            {/* Beste sone — elg-pin */}
            {bestZone && (
              <Marker
                coordinate={{ latitude: bestZone.latitude, longitude: bestZone.longitude }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
              >
                <View style={styles.moosePinWrap}>
                  <View style={styles.moosePinBubble}>
                    <Text style={styles.moosePinEmoji}>🦌</Text>
                  </View>
                  <View style={styles.moosePinArrow} />
                </View>
              </Marker>
            )}

            {/* Observasjonsmarkører — dyr sett (manuelt/kamera). Filtrerer
                bort observasjonen som "sådde" beste-sonen (bestZone.id er
                id-en til den første observasjonen buildHeatZones klynget
                inn i sonen), slik at den ikke også vises som en vanlig pin
                rett under den store elg-emoji-markøren. Sammenlignet
                tidligere kun breddegrad mot bestZone sin VEKTEDE
                GJENNOMSNITTSPOSISJON — som i praksis nesten aldri stemte
                eksakt, og ga en dobbel-pin de fleste steder. */}
            {dyrObsMedGps.filter((o) => !bestZone || o.id !== bestZone.id).map((o) => (
              <Marker
                key={o.id}
                coordinate={{ latitude: o.latitude as number, longitude: o.longitude as number }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
                title={`${o.dyr} · ${o.type}`}
                description={o.kommentar || undefined}
              >
                <View style={styles.obsPinWrap}>
                  <View style={[styles.obsPinBubble, o.dyr === "Rev" && styles.obsPinBubbleRev]}>
                    <Text style={styles.obsPinEmoji}>{dyrEmoji(o.dyr)}</Text>
                  </View>
                  <View style={[styles.obsPinArrow, o.dyr === "Rev" && styles.obsPinArrowRev]} />
                </View>
              </Marker>
            ))}

            {/* Sporregistreringer */}
            {visSporAnnet && sporObsMedGps.map((o) => (
              <Marker
                key={o.id}
                coordinate={{ latitude: o.latitude as number, longitude: o.longitude as number }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
                title={`Spor${o.sporType ? " · " + o.sporType : ""}`}
                description={o.kommentar || undefined}
              >
                <View style={styles.sporPinWrap}>
                  <View style={styles.sporPinBubble}>
                    <Ionicons name="paw-outline" size={14} color="#FFFFFF" />
                  </View>
                  <View style={styles.sporPinArrow} />
                </View>
              </Marker>
            ))}

            {/* "Annet"-kartpunkter */}
            {visSporAnnet && mapPoints.map((p) => (
              <Marker
                key={p.id}
                coordinate={{ latitude: p.latitude, longitude: p.longitude }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
                title={p.label || p.pointType}
                description={p.kommentar || undefined}
              >
                <View style={styles.annetPinWrap}>
                  <View style={styles.annetPinBubble}>
                    <Ionicons name="pricetag-outline" size={14} color="#FFFFFF" />
                  </View>
                  <View style={styles.annetPinArrow} />
                </View>
              </Marker>
            ))}

            {/* Kameramarkører */}
            {visKameraer && kameraer.map((k) => (
              <Marker
                key={k.id}
                coordinate={{ latitude: k.latitude, longitude: k.longitude }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
                onPress={() => {
                  setSelectedCamera(k);
                  setCameraView("info");
                  setSelectedPin(null);
                }}
              >
                <View style={styles.cameraPinWrap}>
                  <View style={styles.cameraDirArrowWrap} pointerEvents="none">
                    <Ionicons
                      name="navigate"
                      size={14}
                      color="#93C5FD"
                      style={{ transform: [{ rotate: `${k.directionDegrees}deg` }] }}
                    />
                  </View>
                  <View style={styles.cameraPinBubble}>
                    <Ionicons name="camera" size={16} color="#FFFFFF" />
                  </View>
                  <View style={styles.cameraPinArrow} />
                </View>
              </Marker>
            ))}

            {/* Prediksjonssoner per art */}
            {prediksjonsoner.map((p) => (
              <Circle
                key={`pred-${p.dyr}`}
                center={{ latitude: p.latitude, longitude: p.longitude }}
                radius={p.radius}
                strokeWidth={2}
                strokeColor={p.farge + "CC"}
                fillColor={p.farge + "22"}
              />
            ))}

            {/* Jaktlag-medlemmers live-posisjoner */}
            {medlsPosisjon.map((m) => (
              <Marker
                key={`medl-${m.uid}`}
                coordinate={{ latitude: m.latitude, longitude: m.longitude }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
                title={m.epost || "Jeger"}
              >
                <View style={styles.medlPinWrap}>
                  <View style={styles.medlPinBubble}>
                    <Text style={styles.medlPinInitial}>
                      {(m.epost?.[0] ?? "J").toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.medlPinArrow} />
                </View>
              </Marker>
            ))}

            {/* Valgt ny-pin */}
            {selectedPin && (
              <Marker coordinate={selectedPin} pinColor="#FACC15" />
            )}
          </MapView>
        ) : (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#2CC36B" />
          </View>
        )}

        {/* ── Navigasjonsbar ── */}
        <View style={styles.navBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
            <Text style={styles.backText}>Tilbake</Text>
          </Pressable>

          <Text style={styles.navTitle}>Dyrekart</Text>

          <View style={styles.mapToggle}>
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
        </View>

        {/* ── Venstre flytende knapper ── */}
        {!selectedPin && !selectedCamera && (
          <View style={styles.leftButtons}>
            {/* Filter */}
            <Pressable
              style={[styles.floatBtn, filterOpen && styles.floatBtnActive]}
              onPress={() => filterOpenSet((v) => !v)}
            >
              <Ionicons name="filter" size={20} color="#D1FAE5" />
            </Pressable>

            {/* Vis/skjul kameraer */}
            <Pressable
              style={[styles.floatBtn, visKameraer && styles.floatBtnActiveBlue]}
              onPress={() => setVisKameraer((v) => !v)}
            >
              <Ionicons name="camera" size={20} color={visKameraer ? "#60A5FA" : "#D1FAE5"} />
            </Pressable>

            {/* Sporpunkt — lagre spor ved GPS-posisjon */}
            <Pressable
              style={[styles.floatBtn, sporpunktLaster && { opacity: 0.5 }]}
              onPress={lagreSporpunkt}
              disabled={sporpunktLaster || !userLocation}
            >
              <Ionicons name="footsteps-outline" size={20} color="#D1FAE5" />
            </Pressable>

            {/* Vis/skjul spor- og "annet"-punkter */}
            <Pressable
              style={[styles.floatBtn, visSporAnnet && styles.floatBtnActiveYellow]}
              onPress={() => setVisSporAnnet((v) => !v)}
            >
              <Ionicons name="layers-outline" size={20} color={visSporAnnet ? "#FCD34D" : "#D1FAE5"} />
            </Pressable>

            {/* Vis/skjul eiendomsgrenser (Kartverket/Geonorge matrikkelkart — kun web) */}
            <Pressable
              style={[styles.floatBtn, visEiendomsgrenser && styles.floatBtnActiveOrange]}
              onPress={() => setVisEiendomsgrenser((v) => !v)}
            >
              <Ionicons name="map-outline" size={20} color={visEiendomsgrenser ? "#FB923C" : "#D1FAE5"} />
            </Pressable>

            {/* Prediksjon (48t) */}
            <Pressable
              style={[styles.floatBtn, visPrediksjon && styles.floatBtnActive]}
              onPress={() => setVisPrediksjon((v) => !v)}
            >
              <Ionicons name="analytics-outline" size={20} color={visPrediksjon ? "#A78BFA" : "#D1FAE5"} />
            </Pressable>

            {/* Tidbaserte aktive soner */}
            <Pressable
              style={[styles.floatBtn, visAktiveSoner && styles.floatBtnActiveCyan]}
              onPress={() => setVisAktiveSoner((v) => !v)}
            >
              <Ionicons name="time-outline" size={20} color={visAktiveSoner ? "#22D3EE" : "#D1FAE5"} />
            </Pressable>
          </View>
        )}

        {/* ── Prediksjon-legend ── */}
        {visPrediksjon && !selectedPin && !selectedCamera && prediksjonsoner.length > 0 && (
          <View style={styles.predLegend}>
            {prediksjonsoner.map((p) => (
              <View key={p.dyr} style={styles.predLegendRad}>
                <View style={[styles.predLegendDot, { backgroundColor: p.farge }]} />
                <Text style={styles.predLegendTxt}>{p.dyr} · {p.etikett} · {p.antall} obs</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Aktive soner legend ── */}
        {visAktiveSoner && !selectedPin && !selectedCamera && aktiveSoner.length > 0 && (
          <View style={[styles.predLegend, styles.aktivLegend]}>
            {aktiveSoner.map((s) => (
              <View key={s.id} style={styles.predLegendRad}>
                <View style={[styles.predLegendDot, {
                  backgroundColor: s.type === "nå" ? "#22D3EE" : "#A855F7",
                }]} />
                <Text style={styles.predLegendTxt}>
                  {dyrEmoji(s.dyr)} {s.dyr} · {s.tidLabel} · {s.antall} obs
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Høyre lokaliseringsknapp ── */}
        {!selectedPin && !selectedCamera && userLocation && (
          <Pressable
            style={styles.locateBtn}
            onPress={() =>
              mapRef.current?.animateToRegion(
                { latitude: userLocation.latitude, longitude: userLocation.longitude, latitudeDelta: 0.06, longitudeDelta: 0.06 },
                400
              )
            }
          >
            <Ionicons name="locate" size={22} color="#D1FAE5" />
          </Pressable>
        )}

        {/* ── Filterpanel ── */}
        {filterOpen && !selectedPin && !selectedCamera && (
          <View style={styles.filterPanel}>
            {dyrFilter.map((dyr) => {
              const active = aktivtFilter === dyr;
              return (
                <Pressable
                  key={dyr}
                  onPress={() => { setAktivtFilter(dyr); filterOpenSet(false); }}
                  style={[styles.filterItem, active && styles.filterItemActive]}
                >
                  <Text style={[styles.filterItemText, active && styles.filterItemTextActive]}>
                    {dyr !== "Alle" && dyrEmoji(dyr) + "  "}{dyr}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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
                    {dyrListe.map((dyr) => {
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
                {dyrListe.map((dyr) => {
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
                {dyrListe.map((dyr) => {
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

        {/* ── Bunnkort ── */}
        {!selectedPin && !selectedCamera && !filterOpen && (
          <View style={styles.bottomCard}>
            <View style={styles.dragHandle} />

            {loading ? (
              <View style={styles.bottomRow}>
                <ActivityIndicator size="small" color="#2CC36B" />
                <Text style={styles.bottomLoadText}>Laster...</Text>
              </View>
            ) : errorText ? (
              <Text style={styles.bottomError}>{errorText}</Text>
            ) : bestZone ? (
              <>
                <View style={styles.bottomTopRow}>
                  <Text style={styles.bottomTitle}>Beste område</Text>
                  <View style={styles.scoreBadge}>
                    <Text style={styles.scoreBadgeText}>
                      {normaliserScore(bestZone.score)} · {scoreEtikett(bestZone.score)}
                    </Text>
                  </View>
                </View>

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
                        name="navigate" size={12} color="#2CC36B"
                        style={{ transform: [{ rotate: `${obs.retning}deg` }] }}
                      />
                    )}
                  </View>
                ))}

                <Pressable style={styles.moreLinkRow} onPress={() =>
                  mapRef.current?.animateToRegion(
                    { latitude: bestZone.latitude, longitude: bestZone.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 },
                    500
                  )
                }>
                  <Text style={styles.moreLinkText}>Sentrer kart</Text>
                  <Ionicons name="chevron-forward" size={13} color="#2CC36B" />
                </Pressable>
              </>
            ) : (
              <Text style={styles.noDataText}>
                Ingen observasjoner innen {radiusKm} km.{"\n"}
                Langtrykk på kartet for å legge til punkt.
              </Text>
            )}
          </View>
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

  navBar: {
    position: "absolute", top: 0, left: 0, right: 0,
    backgroundColor: "rgba(12,20,16,0.96)",
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: "#1A2B20",
  },
  backBtn:  { flexDirection: "row", alignItems: "center", gap: 2, minWidth: 86 },
  backText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  navTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", flex: 1, textAlign: "center" },
  mapToggle: {
    flexDirection: "row", backgroundColor: "#111B15",
    borderRadius: 12, padding: 3,
  },
  toggleItem:       { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9 },
  toggleItemActive: { backgroundColor: "#FFFFFF" },
  toggleText:       { color: "#8EA0AA", fontSize: 13, fontWeight: "700" },
  toggleTextActive: { color: "#060E08", fontWeight: "900" },

  leftButtons: { position: "absolute", left: 14, top: "30%", gap: 10 },
  floatBtn: {
    width: 46, height: 46, borderRadius: 13,
    backgroundColor: "rgba(8,14,10,0.90)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#1E3028",
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },
  floatBtnActive:      { backgroundColor: "rgba(44,195,107,0.2)",  borderColor: "#2CC36B" },
  floatBtnActiveBlue:  { backgroundColor: "rgba(96,165,250,0.18)", borderColor: "#3B82F6" },
  floatBtnActiveCyan:  { backgroundColor: "rgba(34,211,238,0.18)", borderColor: "#22D3EE" },
  floatBtnActiveYellow: { backgroundColor: "rgba(252,211,77,0.18)", borderColor: "#FCD34D" },
  floatBtnActiveOrange: { backgroundColor: "rgba(251,146,60,0.18)", borderColor: "#FB923C" },
  locateBtn: {
    position: "absolute", right: 14, top: "38%",
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: "rgba(8,14,10,0.90)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#1E3028",
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },

  filterPanel: {
    position: "absolute", left: 68, top: "26%",
    backgroundColor: "rgba(8,14,10,0.98)",
    borderRadius: 16, padding: 6,
    borderWidth: 1, borderColor: "#1E3028",
    shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 12, elevation: 10,
    minWidth: 140,
  },
  filterItem:           { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10 },
  filterItemActive:     { backgroundColor: "#163222" },
  filterItemText:       { color: "#C8D8D0", fontSize: 14, fontWeight: "700" },
  filterItemTextActive: { color: "#A9F2BF" },

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

  moosePinWrap:   { alignItems: "center" },
  moosePinBubble: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: "#FACC15",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2.5, borderColor: "#B45309",
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 6, elevation: 6,
  },
  moosePinEmoji: { fontSize: 26 },
  moosePinArrow: {
    width: 0, height: 0,
    borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 12,
    borderStyle: "solid",
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderTopColor: "#B45309",
  },

  obsPinWrap:   { alignItems: "center" },
  obsPinBubble: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "#EAB308",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#A16207",
  },
  obsPinBubbleRev: { backgroundColor: "#FB923C", borderColor: "#C2410C" },
  obsPinEmoji: { fontSize: 15 },
  obsPinArrow: {
    width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 8,
    borderStyle: "solid",
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderTopColor: "#A16207",
  },
  obsPinArrowRev: { borderTopColor: "#C2410C" },

  sporPinWrap:   { alignItems: "center" },
  sporPinBubble: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "#78716C",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#44403C",
  },
  sporPinArrow: {
    width: 0, height: 0,
    borderLeftWidth: 4, borderRightWidth: 4, borderTopWidth: 7,
    borderStyle: "solid",
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderTopColor: "#44403C",
  },

  annetPinWrap:   { alignItems: "center" },
  annetPinBubble: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "#A78BFA",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#7C3AED",
  },
  annetPinArrow: {
    width: 0, height: 0,
    borderLeftWidth: 4, borderRightWidth: 4, borderTopWidth: 7,
    borderStyle: "solid",
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderTopColor: "#7C3AED",
  },

  cameraPinWrap:   { alignItems: "center" },
  cameraDirArrowWrap: {
    position: "absolute", top: -17, alignItems: "center", justifyContent: "center", zIndex: 1,
  },
  cameraPinBubble: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "#2563EB",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#1D4ED8",
  },
  cameraPinArrow: {
    width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 8,
    borderStyle: "solid",
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderTopColor: "#1D4ED8",
  },

  bottomCard: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: "#0C1610",
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderTopColor: "#1A2B20",
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30,
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 18,
    shadowOffset: { width: 0, height: -4 }, elevation: 14,
  },
  dragHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "#2A3D2C", alignSelf: "center", marginBottom: 12,
  },
  bottomRow:    { flexDirection: "row", alignItems: "center", gap: 8 },
  bottomTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  bottomTitle:  { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  bottomMeta:   { color: "#3D5446", fontSize: 12, marginBottom: 10 },
  bottomLoadText: { color: "#4D6858", fontSize: 14 },
  bottomError:    { color: "#F87171", fontSize: 13 },

  scoreBadge: {
    backgroundColor: "rgba(44,195,107,0.14)",
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: "rgba(44,195,107,0.25)",
  },
  scoreBadgeText: { color: "#2CC36B", fontSize: 12, fontWeight: "900" },

  recentRow: {
    flexDirection: "row", alignItems: "center",
    gap: 8, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: "#111C14",
  },
  recentEmoji:  { fontSize: 16 },
  recentAnimal: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", flex: 1 },
  recentTime:   { color: "#3D5446", fontSize: 12 },

  noDataText: { color: "#3D5446", fontSize: 13, lineHeight: 20 },

  moreLinkRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 4, marginTop: 10,
  },
  moreLinkText: { color: "#2CC36B", fontSize: 13, fontWeight: "700" },

  medlPinWrap:    { alignItems: "center" },
  medlPinBubble:  {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "#16A34A",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#15803D",
  },
  medlPinInitial: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  medlPinArrow:   {
    width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 8,
    borderStyle: "solid",
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderTopColor: "#15803D",
  },

  predLegend: {
    position: "absolute", bottom: 110, left: 12,
    backgroundColor: "rgba(6,14,8,0.88)", borderRadius: 14,
    borderWidth: 1, borderColor: "#1C2A22", padding: 12, gap: 7,
  },
  aktivLegend: { bottom: 210, borderColor: "#1A2A30" },
  predLegendRad: { flexDirection: "row", alignItems: "center", gap: 8 },
  predLegendDot: { width: 10, height: 10, borderRadius: 5 },
  predLegendTxt: { color: "#C8D8D0", fontSize: 12, fontWeight: "700" },
});
