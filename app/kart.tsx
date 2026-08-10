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
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, {
  Circle,
  LongPressEvent,
  Marker,
  Polygon,
  PROVIDER_GOOGLE,
} from "react-native-maps";

import {
  deleteCamera,
  saveCamera,
  subscribeToMyCameras,
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
} from "@/src/services/observations";
import { getSettings } from "@/src/services/settings";
import type { Observasjon } from "@/src/types/observation";
import {
  dyrEmoji,
  hentRelativTid,
  hentTidsvekt,
} from "@/src/lib/aktivitet";
import {
  anonymiserPosisjon,
  buildSector,
  calcBearing,
  distanceMeters,
  movePoint,
} from "@/src/lib/geo";

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

type AktivSone = {
  id: string;
  dyr: string;
  latitude: number;
  longitude: number;
  antall: number;
  tidLabel: string;
  type: "nå" | "snart";
};

// ─── Konstanter ───────────────────────────────────────────────────────────────

const dyrListe    = ["Rådyr", "Elg", "Hjort", "Rev"];
const typeListe   = ["Sett dyr", "Spor", "Kamera"];
const dyrFilter   = ["Alle", ...dyrListe];

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

// ─── Hovedkomponent ───────────────────────────────────────────────────────────

export default function KartScreen() {
  const params = useLocalSearchParams<{
    focusLat?: string;
    focusLng?: string;
    filter?:   string;
  }>();
  const router = useRouter();
  const mapRef = useRef<MapView | null>(null);

  const [loading,      setLoading]      = useState(true);
  const [savingPin,    setSavingPin]    = useState(false);
  const [sporpunktLaster, setSporpunktLaster] = useState(false);
  const [errorText,    setErrorText]    = useState("");
  const [mapMode,      setMapMode]      = useState<"terrain" | "satellite">("terrain");
  const [radiusKm,     setRadiusKm]     = useState<10 | 25 | 50>(50);
  const [userLocation, setUserLocation] = useState<UserPosition | null>(null);
  const [observasjoner, setObservasjoner] = useState<Observasjon[]>([]);
  const [kameraer,     setKameraer]     = useState<Viltkamera[]>([]);
  const [selectedPin,  setSelectedPin]  = useState<MapPin | null>(null);
  const [valgtDyr,     setValgtDyr]     = useState("Rådyr");
  const [valgtType,    setValgtType]    = useState("Sett dyr");
  const [retningPin,   setRetningPin]   = useState<number | null>(null);
  const [filterOpen,   setFilterOpen]   = useState(false);
  const [aktivtFilter,   setAktivtFilter]   = useState(params.filter || "Alle");
  const [selectedCamera, setSelectedCamera] = useState<Viltkamera | null>(null);
  const [visPrediksjon,  setVisPrediksjon]  = useState(false);
  const [visKameraer,    setVisKameraer]    = useState(true);
  const [visAktiveSoner, setVisAktiveSoner] = useState(false);
  const [medlsPosisjon,  setMedlsPosisjon]  = useState<MedlemPosisjon[]>([]);

  // ─── Initialisering ───────────────────────────────────────────────────────

  useEffect(() => {
    let unsubObs: (() => void) | null = null;
    let unsubCam: (() => void) | null = null;
    let unsubLoc: (() => void) | null = null;

    (async () => {
      try {
        setLoading(true);
        const settings = await getSettings();
        setRadiusKm(settings.radiusKm);

        // Kameralytter (Firestore)
        try {
          unsubCam = subscribeToMyCameras((items) => setKameraer(items));
        } catch { /* ikke innlogget ennå */ }

        // Jaktlag-medlemmers live-posisjoner
        const jaktlagId = await getAktivtJaktlagId();
        if (jaktlagId) {
          unsubLoc = subscribeToJaktlagLocations(jaktlagId, setMedlsPosisjon);
        }

        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") {
          setErrorText("Lokasjon ble ikke godkjent.");
          setLoading(false);
          return;
        }

        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const center = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setUserLocation(center);
        await syncUserLocation(center);

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
        setErrorText(e?.message || "Noe gikk galt.");
        setLoading(false);
      }
    })();

    return () => {
      if (unsubObs) unsubObs();
      if (unsubCam) unsubCam();
      if (unsubLoc) unsubLoc();
    };
  }, []);

  // ─── Kartevent ────────────────────────────────────────────────────────────

  function handleMapLongPress(e: LongPressEvent) {
    setSelectedPin(e.nativeEvent.coordinate);
    setRetningPin(null);
    setFilterOpen(false);
    setSelectedCamera(null);
  }

  // ─── Lagre observasjon fra pin ────────────────────────────────────────────

  async function lagreObservasjonFraPin() {
    if (!selectedPin || savingPin) return;
    try {
      setSavingPin(true);
      await saveObservation({
        dyr:      valgtDyr,
        type:     valgtType,
        kommentar: "Lagt inn fra kart",
        tid:      new Date().toISOString(),
        latitude:  selectedPin.latitude,
        longitude: selectedPin.longitude,
        retning:  retningPin,
      });
      setSelectedPin(null);
      setRetningPin(null);
      Alert.alert("Lagret", "Observasjonen er lagret.");
    } catch (e: any) {
      Alert.alert("Feil", e?.message || "Klarte ikke lagre observasjon.");
    } finally {
      setSavingPin(false);
    }
  }

  // ─── Lagre viltkamera fra pin ─────────────────────────────────────────────

  async function lagreKameraFraPin() {
    if (!selectedPin || savingPin) return;
    try {
      setSavingPin(true);
      await saveCamera({
        name:      `Viltkamera ${kameraer.length + 1}`,
        latitude:  selectedPin.latitude,
        longitude: selectedPin.longitude,
      });
      setSelectedPin(null);
      setRetningPin(null);
      Alert.alert("Lagret", `Viltkamera ${kameraer.length + 1} er plassert på kartet.`);
    } catch (e: any) {
      Alert.alert("Feil", e?.message || "Klarte ikke lagre kamera.");
    } finally {
      setSavingPin(false);
    }
  }

  // ─── Slett kamera ─────────────────────────────────────────────────────────

  async function slettKamera(id: string) {
    try {
      await deleteCamera(id);
      setSelectedCamera(null);
    } catch (e: any) {
      Alert.alert("Feil", e?.message || "Klarte ikke slette kamera.");
    }
  }

  // ─── Sporpunkt (rask spor-observasjon ved GPS-posisjon) ───────────────────

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

  const sisteObs = useMemo(() => filtrerteObs.slice(0, 3), [filtrerteObs]);

  const obs24tMedGps = useMemo(
    () => obsMedGps.filter((o) => (Date.now() - new Date(o.tid).getTime()) <= 86400000),
    [obsMedGps]
  );

  // Per-art prediksjonssoner (48t vektet sentrum)
  const prediksjonsoner = useMemo(() => {
    if (!visPrediksjon) return [];
    const artsfarger: Record<string, string> = {
      Rådyr: "#A78BFA", Elg: "#38BDF8", Hjort: "#FCD34D", Rev: "#FB923C",
    };
    return dyrListe.map((dyr) => {
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
        farge:     artsfarger[dyr] ?? "#FFFFFF",
        konfidens,
        antall:    relevante.length,
      };
    }).filter(Boolean) as Array<{
      dyr: string; latitude: number; longitude: number;
      radius: number; farge: string; konfidens: number; antall: number;
    }>;
  }, [visPrediksjon, observasjoner]);

  // Tidbaserte aktive soner (klokkeslett-mønster)
  const aktiveSoner = useMemo<AktivSone[]>(() => {
    if (!visAktiveSoner) return [];
    return buildAktiveSoner(observasjoner);
  }, [visAktiveSoner, observasjoner]);

  // ─── Fokuser kart ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapRef.current || !userLocation) return;
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
  }, [params.focusLat, params.focusLng, userLocation]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.container}>

        {/* ── Kart ── */}
        {userLocation ? (
          <MapView
            ref={(r) => { mapRef.current = r; }}
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
            onLongPress={handleMapLongPress}
            onPress={() => { setSelectedCamera(null); setFilterOpen(false); }}
          >
            {/* Radius-sirkel */}
            <Circle
              center={userLocation}
              radius={radiusKm * 1000}
              strokeWidth={1.5}
              strokeColor="rgba(44,195,107,0.4)"
              fillColor="rgba(44,195,107,0.04)"
            />

            {/* Sektoroverlegg */}
            {sektorCoords && (
              <Polygon
                coordinates={sektorCoords}
                fillColor="rgba(59,130,246,0.22)"
                strokeColor="rgba(59,130,246,0.55)"
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

            {/* Observasjonsmarkører */}
            {obsMedGps.filter((o) => !bestZone || o.latitude !== bestZone.latitude).map((o) => (
              <Marker
                key={o.id}
                coordinate={{ latitude: o.latitude as number, longitude: o.longitude as number }}
                title={`${o.dyr} · ${o.type}`}
                description={o.kommentar || undefined}
                pinColor={o.dyr === "Rev" ? "#FB923C" : "#FCD34D"}
              />
            ))}

            {/* Kameramarkører */}
            {visKameraer && kameraer.map((k) => (
              <Marker
                key={k.id}
                coordinate={{ latitude: k.latitude, longitude: k.longitude }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
                onPress={() => { setSelectedCamera(k); setSelectedPin(null); }}
              >
                <View style={styles.cameraPinWrap}>
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
              onPress={() => setFilterOpen((v) => !v)}
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
                <Text style={styles.predLegendTxt}>{p.dyr} · {p.konfidens}% · {p.antall} obs</Text>
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
                  onPress={() => { setAktivtFilter(dyr); setFilterOpen(false); }}
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

        {/* ── Kameradetaljpanel ── */}
        {selectedCamera && !selectedPin && (() => {
          const kameraHistorikk = observasjoner
            .filter((o) =>
              o.latitude != null &&
              o.longitude != null &&
              distanceMeters(selectedCamera, {
                latitude:  o.latitude  as number,
                longitude: o.longitude as number,
              }) <= 300
            )
            .slice(0, 5);

          return (
            <ScrollView
              style={styles.cameraPanel}
              contentContainerStyle={styles.cameraPanelContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
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
                  <Text style={styles.cameraHistTitle}>Observasjoner i nærheten</Text>
                  <View style={styles.cameraHistBadge}>
                    <Text style={styles.cameraHistBadgeText}>{kameraHistorikk.length}</Text>
                  </View>
                </View>

                {kameraHistorikk.length === 0 ? (
                  <Text style={styles.cameraHistEmpty}>
                    Ingen registrerte observasjoner innen 300 m av dette kameraet.
                  </Text>
                ) : (
                  kameraHistorikk.map((obs) => (
                    <View key={obs.id} style={styles.cameraHistRow}>
                      <Text style={styles.cameraHistEmoji}>
                        {obs.dyr === "Rev" ? "🦊" : "🦌"}
                      </Text>
                      <View style={styles.cameraHistBody}>
                        <Text style={styles.cameraHistAnimal}>
                          {obs.dyr}
                          <Text style={styles.cameraHistType}> · {obs.type}</Text>
                        </Text>
                        <Text style={styles.cameraHistTime}>{hentRelativTid(obs.tid)}</Text>
                      </View>
                      {obs.retning != null && (
                        <Ionicons
                          name="navigate"
                          size={13}
                          color="#2CC36B"
                          style={{ transform: [{ rotate: `${obs.retning}deg` }] }}
                        />
                      )}
                    </View>
                  ))
                )}
              </View>

              <View style={styles.cameraPanelActions}>
                <Pressable
                  onPress={() => router.push(`/kamera/${selectedCamera.id}`)}
                  style={styles.detailsCameraBtn}
                >
                  <Ionicons name="open-outline" size={15} color="#60A5FA" />
                  <Text style={styles.detailsCameraBtnText}>Detaljer</Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    Alert.alert(
                      "Slett kamera",
                      `Vil du slette ${selectedCamera.name}?`,
                      [
                        { text: "Avbryt", style: "cancel" },
                        {
                          text: "Slett",
                          style: "destructive",
                          onPress: () => slettKamera(selectedCamera.id),
                        },
                      ]
                    )
                  }
                  style={[styles.deleteCameraBtn, { flex: 1 }]}
                >
                  <Ionicons name="trash-outline" size={15} color="#F87171" />
                  <Text style={styles.deleteCameraBtnText}>Slett kamera</Text>
                </Pressable>
              </View>
            </ScrollView>
          );
        })()}

        {/* ── Ny-pin panel ── */}
        {selectedPin && (
          <View style={styles.pinPanel}>
            <View style={styles.pinHeader}>
              <View>
                <Text style={styles.pinTitle}>Nytt punkt</Text>
                <Text style={styles.pinSub}>
                  {selectedPin.latitude.toFixed(5)}, {selectedPin.longitude.toFixed(5)}
                </Text>
              </View>
              <Pressable onPress={() => { setSelectedPin(null); setRetningPin(null); }} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="#9CA3AF" />
              </Pressable>
            </View>

            {/* Dyr */}
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

            {/* Type */}
            <Text style={styles.pinLabel}>Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {typeListe.map((type) => {
                  const a = valgtType === type;
                  return (
                    <Pressable key={type} onPress={() => setValgtType(type)}
                      style={[styles.pinChipAlt, a && styles.pinChipAltActive]}>
                      <Text style={[styles.pinChipText, a && styles.pinChipAltTextActive]}>
                        {type}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            {/* Retning */}
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
                onPress={lagreObservasjonFraPin}
                disabled={savingPin}
                style={[styles.pinPrimaryBtn, savingPin && styles.disabled]}
              >
                <Ionicons name="paw-outline" size={16} color="#060E08" />
                <Text style={styles.pinPrimaryText}>
                  {savingPin ? "Lagrer..." : "Lagre observasjon"}
                </Text>
              </Pressable>
              <Pressable
                onPress={lagreKameraFraPin}
                disabled={savingPin}
                style={[styles.pinSecondaryBtn, savingPin && styles.disabled]}
              >
                <Ionicons name="camera-outline" size={16} color="#CFE7DB" />
                <Text style={styles.pinSecondaryText}>Kamera</Text>
              </Pressable>
            </View>
          </View>
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

  leftButtons: { position: "absolute", left: 14, top: "38%", gap: 10 },
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
  locateBtn: {
    position: "absolute", right: 14, top: "38%",
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: "rgba(8,14,10,0.90)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#1E3028",
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },

  filterPanel: {
    position: "absolute", left: 68, top: "30%",
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
  cameraPanelActions: { flexDirection: "row", gap: 10 },
  detailsCameraBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12,
    borderWidth: 1, borderColor: "rgba(96,165,250,0.25)", borderRadius: 14,
    backgroundColor: "rgba(96,165,250,0.08)",
  },
  detailsCameraBtnText: { color: "#60A5FA", fontSize: 14, fontWeight: "800" },
  deleteCameraBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12,
    borderWidth: 1, borderColor: "#3B1A1A", borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  deleteCameraBtnText: { color: "#F87171", fontSize: 14, fontWeight: "800" },

  cameraHistSection: {
    borderTopWidth: 1, borderTopColor: "#1A2B20",
    paddingTop: 14, marginTop: 4, marginBottom: 12,
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
  },
  pinHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  pinTitle:  { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  pinSub:    { color: "#6B8A76", fontSize: 12, marginTop: 3 },
  pinLabel: {
    color: "#6B8A76", fontSize: 11, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1,
    marginTop: 10, marginBottom: 8,
  },
  chipRow:  { flexDirection: "row", gap: 8, paddingRight: 16 },
  pinChip: {
    backgroundColor: "#101E14", borderWidth: 1, borderColor: "#1F3027",
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10,
  },
  pinChipActive:    { backgroundColor: "#163222", borderColor: "#2CC36B" },
  pinChipAlt: {
    backgroundColor: "#141210", borderWidth: 1, borderColor: "#2A2010",
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10,
  },
  pinChipAltActive:     { backgroundColor: "#33280D", borderColor: "#6B5520" },
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
  pinChipAltTextActive: { color: "#FDE68A" },
  pinActions:      { flexDirection: "row", gap: 10, marginTop: 16 },
  pinPrimaryBtn: {
    flex: 1.35, backgroundColor: "#2CC36B", borderRadius: 18,
    paddingVertical: 13, alignItems: "center",
    flexDirection: "row", justifyContent: "center", gap: 7,
  },
  pinPrimaryText:  { color: "#060E08", fontSize: 14, fontWeight: "900" },
  pinSecondaryBtn: {
    flex: 1, backgroundColor: "#0F1716", borderWidth: 1, borderColor: "#1E2C25",
    borderRadius: 18, paddingVertical: 13,
    alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 7,
  },
  pinSecondaryText: { color: "#CFE7DB", fontSize: 14, fontWeight: "900" },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: "#111827", alignItems: "center", justifyContent: "center",
  },
  disabled: { opacity: 0.55 },

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

  cameraPinWrap:   { alignItems: "center" },
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
