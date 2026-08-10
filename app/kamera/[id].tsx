import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { deleteDoc, doc } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Circle, Marker, Polygon } from "react-native-maps";
import BottomDock from "../../components/BottomDock";

import { auth, db } from "../../src/config/firebase";
import { login } from "../../src/services/auth";
import { subscribeToNearbyObservations } from "../../src/services/observations";
import type { Observasjon } from "../../src/types/observation";

type Viltkamera = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  direction: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt?: string;
  batteryStatus?: string;
  memoryCardStatus?: string;
  baitStatus?: string;
};

type ObservasjonMedDistance = Observasjon & {
  distance: number;
};

type HeatSone = {
  latitude: number;
  longitude: number;
  score: number;
};

const KAMERAER_KEY = "viltkameraer_v1";
const AKTIVITET_RADIUS_METER = 300;
const AKTIVITET_RADIUS_KM = AKTIVITET_RADIUS_METER / 1000;
const DIRECTIONS = ["N", "NØ", "Ø", "SØ", "S", "SV", "V", "NV"];

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function formatDato(verdi?: string) {
  if (!verdi) return "Ikke registrert";
  const dato = new Date(verdi);
  if (Number.isNaN(dato.getTime())) return "Ikke registrert";
  return dato.toLocaleString("no-NO");
}

function hentTidsvekt(tid: string) {
  const nå = Date.now();
  const observasjonTid = new Date(tid).getTime();

  if (!observasjonTid || Number.isNaN(observasjonTid)) return 1;

  const timerSiden = (nå - observasjonTid) / (1000 * 60 * 60);

  if (timerSiden <= 6) return 5;
  if (timerSiden <= 24) return 3;
  if (timerSiden <= 72) return 2;
  return 1;
}

function normaliserKamera(kamera: Viltkamera): Viltkamera {
  return {
    ...kamera,
    lastCheckedAt: kamera.lastCheckedAt || "",
    batteryStatus: kamera.batteryStatus || "Ukjent",
    memoryCardStatus: kamera.memoryCardStatus || "Ukjent",
    baitStatus: kamera.baitStatus || "Ukjent",
    direction: kamera.direction || "",
    notes: kamera.notes || "",
  };
}

function retningTilGrader(direction: string) {
  const map: Record<string, number> = {
    N: 0,
    NØ: 45,
    Ø: 90,
    SØ: 135,
    S: 180,
    SV: 225,
    V: 270,
    NV: 315,
  };

  return map[direction] ?? null;
}

function beregnSektorKoordinater(
  lat: number,
  lon: number,
  bearing: number,
  distance: number = 120,
  spread: number = 60
) {
  const points = [];
  const earthRadius = 6371000;
  const startAngle = bearing - spread / 2;
  const endAngle = bearing + spread / 2;

  points.push({ latitude: lat, longitude: lon });

  for (let angle = startAngle; angle <= endAngle; angle += 4) {
    const rad = (angle * Math.PI) / 180;

    const newLat =
      lat + (distance / earthRadius) * (180 / Math.PI) * Math.cos(rad);

    const newLon =
      lon +
      ((distance / earthRadius) * (180 / Math.PI) * Math.sin(rad)) /
        Math.cos((lat * Math.PI) / 180);

    points.push({
      latitude: newLat,
      longitude: newLon,
    });
  }

  points.push({ latitude: lat, longitude: lon });

  return points;
}

function byggHeatmap(data: ObservasjonMedDistance[]): HeatSone[] {
  const soner: HeatSone[] = [];
  const terskel = 0.0025;

  data.forEach((obs) => {
    if (obs.latitude == null || obs.longitude == null) return;

    const vekt = hentTidsvekt(obs.tid);

    const eksisterende = soner.find(
      (s) =>
        Math.abs(s.latitude - obs.latitude!) < terskel &&
        Math.abs(s.longitude - obs.longitude!) < terskel
    );

    if (eksisterende) {
      eksisterende.score += vekt;
    } else {
      soner.push({
        latitude: obs.latitude,
        longitude: obs.longitude,
        score: vekt,
      });
    }
  });

  return soner;
}

function hentHeatFarge(score: number) {
  if (score >= 10) return "rgba(220,38,38,0.28)";
  if (score >= 6) return "rgba(234,179,8,0.24)";
  if (score >= 3) return "rgba(34,197,94,0.20)";
  return "rgba(34,197,94,0.12)";
}

function hentAktivitetsBadgeStyle(nivå: string) {
  if (nivå === "Høy") {
    return {
      bg: styles.levelHighBg,
      text: styles.levelHighText,
    };
  }

  if (nivå === "Medium") {
    return {
      bg: styles.levelMediumBg,
      text: styles.levelMediumText,
    };
  }

  return {
    bg: styles.levelLowBg,
    text: styles.levelLowText,
  };
}

export default function KameraDetaljScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [kameraer, setKameraer] = useState<Viltkamera[]>([]);
  const [kamera, setKamera] = useState<Viltkamera | null>(null);
  const [observasjoner, setObservasjoner] = useState<Observasjon[]>([]);
  const [laster, setLaster] = useState(true);

  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState("");
  const [direction, setDirection] = useState("");
  const [notes, setNotes] = useState("");

  const [checkModal, setCheckModal] = useState(false);
  const [battery, setBattery] = useState("OK");
  const [memory, setMemory] = useState("OK");
  const [bait, setBait] = useState("Nei");
  const [checkNote, setCheckNote] = useState("");

  const hentKamera = useCallback(async () => {
    try {
      const kameraData = await AsyncStorage.getItem(KAMERAER_KEY);
      const råKameraListe: Viltkamera[] = kameraData ? JSON.parse(kameraData) : [];

      const kameraListe = Array.isArray(råKameraListe)
        ? råKameraListe.map(normaliserKamera)
        : [];

      setKameraer(kameraListe);

      const funnet = kameraListe.find((item) => item.id === id) || null;
      setKamera(funnet);

      if (funnet) {
        setName(funnet.name || "");
        setDirection(funnet.direction || "");
        setNotes(funnet.notes || "");
      }
    } catch (error) {
      console.log("Feil ved lasting av kamera:", error);
      setKamera(null);
      setKameraer([]);
    }
  }, [id]);

  useEffect(() => {
    let unsubscribe: undefined | (() => void);
    let aktiv = true;

    async function init() {
      try {
        setLaster(true);

        await login();
        await hentKamera();

        const kameraData = await AsyncStorage.getItem(KAMERAER_KEY);
        const råKameraListe: Viltkamera[] = kameraData ? JSON.parse(kameraData) : [];
        const kameraListe = Array.isArray(råKameraListe)
          ? råKameraListe.map(normaliserKamera)
          : [];
        const funnet = kameraListe.find((item) => item.id === id) || null;

        if (!aktiv) return;

        if (!funnet) {
          setLaster(false);
          return;
        }

        unsubscribe = subscribeToNearbyObservations(
          {
            center: {
              latitude: funnet.latitude,
              longitude: funnet.longitude,
            },
            radiusKm: AKTIVITET_RADIUS_KM,
          },
          (liste: Observasjon[]) => {
            if (!aktiv) return;
            setObservasjoner(
              [...liste].sort(
                (a, b) => new Date(b.tid).getTime() - new Date(a.tid).getTime()
              )
            );
            setLaster(false);
          },
          (error: Error) => {
            console.log("Feil ved lasting av observasjoner rundt kamera:", error);
            if (!aktiv) return;
            setObservasjoner([]);
            setLaster(false);
          }
        );
      } catch (error) {
        console.log("Feil ved init kamera:", error);
        if (!aktiv) return;
        setLaster(false);
      }
    }

    init();

    return () => {
      aktiv = false;
      if (unsubscribe) unsubscribe();
    };
  }, [hentKamera, id]);

  const observasjonerINaerheten = useMemo<ObservasjonMedDistance[]>(() => {
    if (!kamera) return [];

    return observasjoner
      .filter((obs) => obs.latitude != null && obs.longitude != null)
      .map((obs) => {
        const distance = haversineDistance(
          kamera.latitude,
          kamera.longitude,
          obs.latitude as number,
          obs.longitude as number
        );

        return {
          ...obs,
          distance,
        };
      })
      .filter((obs) => obs.distance <= AKTIVITET_RADIUS_METER)
      .sort((a, b) => new Date(b.tid).getTime() - new Date(a.tid).getTime());
  }, [kamera, observasjoner]);

  const aktivitetScore = useMemo(() => {
    return observasjonerINaerheten.reduce((sum, obs) => sum + hentTidsvekt(obs.tid), 0);
  }, [observasjonerINaerheten]);

  const aktivitetsNivaa = useMemo(() => {
    if (aktivitetScore >= 12) return "Høy";
    if (aktivitetScore >= 6) return "Medium";
    return "Lav";
  }, [aktivitetScore]);

  const sisteObservasjon = useMemo(() => {
    return observasjonerINaerheten[0] || null;
  }, [observasjonerINaerheten]);

  const dyreFordeling = useMemo(() => {
    const teller: Record<string, number> = {};

    observasjonerINaerheten.forEach((obs) => {
      teller[obs.dyr] = (teller[obs.dyr] || 0) + 1;
    });

    return Object.entries(teller).sort((a, b) => b[1] - a[1]);
  }, [observasjonerINaerheten]);

  const heatmapSoner = useMemo(() => {
    return byggHeatmap(observasjonerINaerheten);
  }, [observasjonerINaerheten]);

  const retningGrader = useMemo(() => {
    return retningTilGrader(kamera?.direction || "");
  }, [kamera?.direction]);

  async function lagreEndringer() {
    if (!kamera) return;

    const trimmedName = name.trim();

    if (!trimmedName) {
      Alert.alert("Mangler navn", "Kamera må ha et navn.");
      return;
    }

    try {
      const oppdatertKamera: Viltkamera = {
        ...kamera,
        name: trimmedName,
        direction: direction.trim(),
        notes: notes.trim(),
        updatedAt: new Date().toISOString(),
      };

      const oppdatertListe = kameraer.map((item) =>
        item.id === kamera.id ? oppdatertKamera : item
      );

      await AsyncStorage.setItem(KAMERAER_KEY, JSON.stringify(oppdatertListe));

      setKameraer(oppdatertListe);
      setKamera(oppdatertKamera);
      setEditMode(false);
    } catch (error) {
      console.log("Feil ved lagring:", error);
      Alert.alert("Feil", "Kunne ikke lagre endringer.");
    }
  }

  async function registrerSjekk() {
    if (!kamera) return;

    try {
      const ekstraNotat = checkNote.trim();
      const eksisterendeNotat = kamera.notes?.trim() || "";

      const sammensattNotat = ekstraNotat
        ? eksisterendeNotat
          ? `${eksisterendeNotat}\n\nSjekk: ${ekstraNotat}`
          : `Sjekk: ${ekstraNotat}`
        : kamera.notes || "";

      const oppdatert: Viltkamera = {
        ...kamera,
        lastCheckedAt: new Date().toISOString(),
        batteryStatus: battery,
        memoryCardStatus: memory,
        baitStatus: bait,
        notes: sammensattNotat,
        updatedAt: new Date().toISOString(),
      };

      const nyListe = kameraer.map((k) => (k.id === kamera.id ? oppdatert : k));

      await AsyncStorage.setItem(KAMERAER_KEY, JSON.stringify(nyListe));

      setKamera(oppdatert);
      setKameraer(nyListe);
      setNotes(oppdatert.notes || "");
      setCheckModal(false);
      setCheckNote("");

      Alert.alert("Lagret", "Sjekk registrert.");
    } catch (error) {
      console.log("Feil ved registrering av sjekk:", error);
      Alert.alert("Feil", "Kunne ikke lagre sjekk.");
    }
  }

  function avbrytRedigering() {
    if (!kamera) return;
    setName(kamera.name || "");
    setDirection(kamera.direction || "");
    setNotes(kamera.notes || "");
    setEditMode(false);
  }

  function slettKamera() {
    if (!kamera) return;

    Alert.alert("Slett kamera", `Vil du slette ${kamera.name}?`, [
      { text: "Avbryt", style: "cancel" },
      {
        text: "Slett",
        style: "destructive",
        onPress: async () => {
          try {
            const oppdatertListe = kameraer.filter((item) => item.id !== kamera.id);
            await AsyncStorage.setItem(KAMERAER_KEY, JSON.stringify(oppdatertListe));
            router.back();
          } catch (error) {
            console.log("Feil ved sletting:", error);
            Alert.alert("Feil", "Kunne ikke slette kamera.");
          }
        },
      },
    ]);
  }

  function kanSletteObservasjon(obs: Observasjon) {
    return !!auth.currentUser?.uid && obs.userId === auth.currentUser.uid;
  }

  function bekreftSlettObservasjon(obs: Observasjon) {
    if (!obs.id) {
      Alert.alert("Kan ikke slette", "Observasjonen mangler id.");
      return;
    }

    if (!kanSletteObservasjon(obs)) {
      Alert.alert("Ikke tillatt", "Du kan kun slette observasjoner du selv har registrert.");
      return;
    }

    Alert.alert(
      "Slett observasjon?",
      `${obs.dyr} · ${obs.type}\n${formatDato(obs.tid)}`,
      [
        { text: "Avbryt", style: "cancel" },
        {
          text: "Slett",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "observations", obs.id));
              Alert.alert("Slettet", "Observasjonen er slettet.");
            } catch (error) {
              console.log("Feil ved sletting av observasjon:", error);
              Alert.alert("Feil", "Kunne ikke slette observasjonen.");
            }
          },
        },
      ]
    );
  }

  if (laster) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Laster kamera...</Text>
          <Text style={styles.emptyText}>Henter kamera og aktivitet i nærheten.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!kamera) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Fant ikke kamera</Text>
          <Text style={styles.emptyText}>Kameraet finnes ikke lenger i lokal lagring.</Text>

          <Pressable style={styles.primaryButton} onPress={() => router.back()}>
            <Text style={styles.primaryButtonText}>Tilbake</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const aktivitetsBadge = hentAktivitetsBadgeStyle(aktivitetsNivaa);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.headerTop}>
            <Pressable style={styles.backChip} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={16} color="#D7E6DC" />
              <Text style={styles.backChipText}>Tilbake</Text>
            </Pressable>
          </View>

          <View style={styles.header}>
            <Text style={styles.eyebrow}>ViltIQ Kamera</Text>
            <Text style={styles.title}>{kamera.name}</Text>
            <Text style={styles.subtitle}>Referansepunkt, retning og aktivitet rundt kameraet.</Text>
          </View>

          <View style={styles.heroCard}>
            <View style={styles.heroGlow} />

            <View style={styles.heroTopRow}>
              <View style={styles.heroLeft}>
                <Text style={styles.heroLabel}>Situasjonen nå</Text>
                <Text style={styles.heroTitle}>{aktivitetsNivaa} aktivitet</Text>
                <Text style={styles.heroText}>
                  {observasjonerINaerheten.length > 0
                    ? "Det er registrert aktivitet rundt kameraet. Følg med på mønster og tidspunkt."
                    : "Ingen aktivitet registrert rundt kameraet ennå."}
                </Text>
              </View>

              <View style={[styles.heroBadge, aktivitetsBadge.bg]}>
                <Text style={[styles.heroBadgeText, aktivitetsBadge.text]}>{aktivitetsNivaa}</Text>
              </View>
            </View>

            <View style={styles.heroStatsRow}>
              <View style={styles.heroStatCard}>
                <Text style={styles.heroStatValue}>{aktivitetScore}</Text>
                <Text style={styles.heroStatLabel}>score</Text>
              </View>

              <View style={styles.heroStatCard}>
                <Text style={styles.heroStatValue}>{observasjonerINaerheten.length}</Text>
                <Text style={styles.heroStatLabel}>obs.</Text>
              </View>

              <View style={styles.heroStatCard}>
                <Text style={styles.heroStatValue}>{dyreFordeling[0]?.[0] || "-"}</Text>
                <Text style={styles.heroStatLabel}>toppdyr</Text>
              </View>
            </View>
          </View>

          <Pressable style={styles.primaryButton} onPress={() => setCheckModal(true)}>
            <Text style={styles.primaryButtonText}>Registrer sjekk</Text>
          </Pressable>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Kamerainfo</Text>

              {!editMode ? (
                <Pressable style={styles.editButton} onPress={() => setEditMode(true)}>
                  <Text style={styles.editButtonText}>Rediger</Text>
                </Pressable>
              ) : null}
            </View>

            {!editMode ? (
              <>
                <Text style={styles.label}>Navn</Text>
                <Text style={styles.value}>{kamera.name || "-"}</Text>

                <Text style={styles.label}>Retning</Text>
                <Text style={styles.value}>{kamera.direction || "Ikke satt"}</Text>

                <Text style={styles.label}>Notater</Text>
                <Text style={styles.value}>{kamera.notes || "Ingen notater ennå"}</Text>

                <Text style={styles.label}>Koordinater</Text>
                <Text style={styles.value}>
                  {kamera.latitude.toFixed(5)}, {kamera.longitude.toFixed(5)}
                </Text>

                <Text style={styles.label}>Opprettet</Text>
                <Text style={styles.value}>{formatDato(kamera.createdAt)}</Text>

                <Text style={styles.label}>Sist oppdatert</Text>
                <Text style={styles.value}>{formatDato(kamera.updatedAt)}</Text>

                <Pressable style={styles.deleteButton} onPress={slettKamera}>
                  <Text style={styles.deleteButtonText}>Slett kamera</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.label}>Navn</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Navn på kamera"
                  placeholderTextColor="#64748b"
                  style={styles.input}
                />

                <Text style={styles.label}>Retning</Text>
                <View style={styles.directionGrid}>
                  {DIRECTIONS.map((dir) => {
                    const active = direction === dir;
                    return (
                      <Pressable
                        key={dir}
                        style={[styles.directionButton, active && styles.directionButtonActive]}
                        onPress={() => setDirection(dir)}
                      >
                        <Text
                          style={[
                            styles.directionButtonText,
                            active && styles.directionButtonTextActive,
                          ]}
                        >
                          {dir}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.label}>Notater</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="F.eks. trekk, åteplass, sti, høyde"
                  placeholderTextColor="#64748b"
                  style={[styles.input, styles.textArea]}
                  multiline
                />

                <View style={styles.buttonRow}>
                  <Pressable style={styles.primaryButtonHalf} onPress={lagreEndringer}>
                    <Text style={styles.primaryButtonText}>Lagre</Text>
                  </Pressable>

                  <Pressable style={styles.secondaryButtonHalf} onPress={avbrytRedigering}>
                    <Text style={styles.secondaryButtonText}>Avbryt</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Driftsstatus</Text>

            <View style={styles.statusGrid}>
              <View style={styles.statusMiniCard}>
                <Text style={styles.statusMiniLabel}>Sist sjekket</Text>
                <Text style={styles.statusMiniValue}>{formatDato(kamera.lastCheckedAt)}</Text>
              </View>

              <View style={styles.statusMiniCard}>
                <Text style={styles.statusMiniLabel}>Batteri</Text>
                <Text style={styles.statusMiniValue}>{kamera.batteryStatus || "Ukjent"}</Text>
              </View>

              <View style={styles.statusMiniCard}>
                <Text style={styles.statusMiniLabel}>Minnekort</Text>
                <Text style={styles.statusMiniValue}>{kamera.memoryCardStatus || "Ukjent"}</Text>
              </View>

              <View style={styles.statusMiniCard}>
                <Text style={styles.statusMiniLabel}>Åte</Text>
                <Text style={styles.statusMiniValue}>{kamera.baitStatus || "Ukjent"}</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderSimple}>
              <Text style={styles.cardTitle}>Kartpreview</Text>
              <Text style={styles.cardCaption}>Retning og aktivitet rundt kamera</Text>
            </View>

            <MapView
              style={styles.map}
              initialRegion={{
                latitude: kamera.latitude,
                longitude: kamera.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
            >
              {heatmapSoner.map((zone, index) => (
                <Circle
                  key={`heat-${index}`}
                  center={{
                    latitude: zone.latitude,
                    longitude: zone.longitude,
                  }}
                  radius={80}
                  fillColor={hentHeatFarge(zone.score)}
                  strokeColor="transparent"
                />
              ))}

              <Circle
                center={{
                  latitude: kamera.latitude,
                  longitude: kamera.longitude,
                }}
                radius={AKTIVITET_RADIUS_METER}
                fillColor="rgba(56, 189, 248, 0.06)"
                strokeColor="rgba(56, 189, 248, 0.35)"
                strokeWidth={2}
              />

              {retningGrader !== null && (
                <Polygon
                  coordinates={beregnSektorKoordinater(
                    kamera.latitude,
                    kamera.longitude,
                    retningGrader
                  )}
                  fillColor="rgba(59,130,246,0.18)"
                  strokeColor="rgba(59,130,246,0.55)"
                  strokeWidth={1.5}
                />
              )}

              <Marker
                coordinate={{
                  latitude: kamera.latitude,
                  longitude: kamera.longitude,
                }}
                title={kamera.name}
                description={kamera.direction || "Viltkamera"}
                pinColor="#22c55e"
              />

              {observasjonerINaerheten.slice(0, 20).map((obs, index) => (
                <Marker
                  key={`${obs.id || obs.tid}-${index}`}
                  coordinate={{
                    latitude: obs.latitude as number,
                    longitude: obs.longitude as number,
                  }}
                  title={`${obs.dyr} · ${obs.type}`}
                  description={obs.kommentar || formatDato(obs.tid)}
                  pinColor="#60a5fa"
                />
              ))}
            </MapView>

            <Text style={styles.mapInfo}>
              Blå sektor viser kameraretning. Varmefelt viser hvor aktivitet samler seg.
            </Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Aktivitet</Text>
              <Text style={styles.statValue}>{aktivitetsNivaa}</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Score</Text>
              <Text style={styles.statValue}>{aktivitetScore}</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Observasjoner</Text>
              <Text style={styles.statValue}>{observasjonerINaerheten.length}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Aktivitet rundt kamera</Text>

            {sisteObservasjon ? (
              <View style={styles.highlightBox}>
                <Text style={styles.highlightTitle}>Siste observasjon</Text>
                <Text style={styles.highlightText}>
                  {sisteObservasjon.dyr} · {sisteObservasjon.type}
                </Text>
                <Text style={styles.highlightSmall}>{formatDato(sisteObservasjon.tid)}</Text>
                <Text style={styles.highlightSmall}>
                  Avstand: {Math.round(sisteObservasjon.distance)} meter
                </Text>
                {!!sisteObservasjon.kommentar && (
                  <Text style={styles.highlightComment}>{sisteObservasjon.kommentar}</Text>
                )}
              </View>
            ) : (
              <Text style={styles.emptyInfo}>
                Ingen observasjoner innen {AKTIVITET_RADIUS_METER} meter ennå.
              </Text>
            )}

            <Text style={[styles.subSectionTitle, { marginTop: 18 }]}>Dyr i nærheten</Text>

            {dyreFordeling.length > 0 ? (
              dyreFordeling.map(([dyr, count]) => (
                <View key={dyr} style={styles.listRow}>
                  <Text style={styles.listKey}>{dyr}</Text>
                  <Text style={styles.listValue}>{count} stk</Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyInfo}>Ingen dyredata ennå.</Text>
            )}

            <Text style={[styles.subSectionTitle, { marginTop: 18 }]}>Siste observasjoner</Text>

            {observasjonerINaerheten.length > 0 ? (
              observasjonerINaerheten.slice(0, 8).map((obs, index) => {
                const canDelete = kanSletteObservasjon(obs);

                return (
                  <View key={`${obs.id || obs.tid}-list-${index}`} style={styles.obsRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.obsTitle}>
                        {obs.dyr} · {obs.type}
                      </Text>
                      <Text style={styles.obsMeta}>{formatDato(obs.tid)}</Text>
                      {!!obs.kommentar && <Text style={styles.obsComment}>{obs.kommentar}</Text>}
                    </View>

                    <View style={styles.obsActions}>
                      <View style={styles.distanceBadge}>
                        <Text style={styles.distanceBadgeText}>{Math.round(obs.distance)} m</Text>
                      </View>

                      {canDelete ? (
                        <Pressable
                          style={styles.deleteObsButton}
                          onPress={() => bekreftSlettObservasjon(obs)}
                        >
                          <Ionicons name="trash-outline" size={15} color="#FCA5A5" />
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={styles.emptyInfo}>Ingen observasjoner å vise.</Text>
            )}
          </View>
        </ScrollView>

        <Modal visible={checkModal} transparent animationType="fade">
          <View style={styles.modal}>
            <View style={styles.modalCard}>
              <Text style={styles.cardTitle}>Registrer sjekk</Text>

              <Text style={styles.label}>Batteri</Text>
              <View style={styles.choiceRow}>
                {["OK", "Lavt"].map((val) => (
                  <Pressable
                    key={val}
                    style={[styles.choice, battery === val && styles.choiceActive]}
                    onPress={() => setBattery(val)}
                  >
                    <Text style={[styles.choiceText, battery === val && styles.choiceTextActive]}>
                      {val}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Minnekort</Text>
              <View style={styles.choiceRow}>
                {["OK", "Byttet"].map((val) => (
                  <Pressable
                    key={val}
                    style={[styles.choice, memory === val && styles.choiceActive]}
                    onPress={() => setMemory(val)}
                  >
                    <Text style={[styles.choiceText, memory === val && styles.choiceTextActive]}>
                      {val}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Åte</Text>
              <View style={styles.choiceRow}>
                {["Ja", "Nei"].map((val) => (
                  <Pressable
                    key={val}
                    style={[styles.choice, bait === val && styles.choiceActive]}
                    onPress={() => setBait(val)}
                  >
                    <Text style={[styles.choiceText, bait === val && styles.choiceTextActive]}>
                      {val}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                placeholder="Notat fra sjekk"
                placeholderTextColor="#999"
                style={styles.input}
                value={checkNote}
                onChangeText={setCheckNote}
              />

              <View style={styles.buttonRow}>
                <Pressable style={styles.secondaryButtonHalf} onPress={() => setCheckModal(false)}>
                  <Text style={styles.secondaryButtonText}>Avbryt</Text>
                </Pressable>

                <Pressable style={styles.primaryButtonHalf} onPress={registrerSjekk}>
                  <Text style={styles.primaryButtonText}>Lagre</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <BottomDock />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07100d" },
  screen: { flex: 1 },
  container: { padding: 16, paddingBottom: 160 },

  headerTop: { marginTop: 6, marginBottom: 8 },
  backChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#101816",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1e2c25",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  backChipText: { color: "#D7E6DC", fontSize: 13, fontWeight: "800" },

  header: { marginBottom: 16 },
  eyebrow: {
    color: "#6ee7b7",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.3,
    marginBottom: 8,
  },
  title: { color: "#ffffff", fontSize: 30, fontWeight: "800", marginTop: 2 },
  subtitle: { color: "#94a3b8", fontSize: 14, marginTop: 6, marginBottom: 4 },

  heroCard: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#0d1b16",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(110,231,183,0.15)",
    padding: 18,
    marginBottom: 14,
  },
  heroGlow: {
    position: "absolute",
    right: -20,
    top: -20,
    width: 120,
    height: 120,
    borderRadius: 999,
    backgroundColor: "rgba(44,195,107,0.08)",
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  heroLeft: { flex: 1 },
  heroLabel: {
    color: "#86efac",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  heroTitle: { color: "#ffffff", fontSize: 24, fontWeight: "800" },
  heroText: { color: "#cbd5e1", fontSize: 14, lineHeight: 21, marginTop: 8 },
  heroBadge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  heroBadgeText: { fontSize: 12, fontWeight: "800" },
  heroStatsRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  heroStatCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    padding: 12,
  },
  heroStatValue: { color: "#ffffff", fontSize: 18, fontWeight: "800" },
  heroStatLabel: {
    color: "#94a3b8",
    fontSize: 11,
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  levelHighBg: { backgroundColor: "rgba(239,68,68,0.14)" },
  levelHighText: { color: "#fca5a5" },
  levelMediumBg: { backgroundColor: "rgba(245,158,11,0.14)" },
  levelMediumText: { color: "#fde68a" },
  levelLowBg: { backgroundColor: "rgba(34,197,94,0.14)" },
  levelLowText: { color: "#86efac" },

  card: {
    backgroundColor: "#111827",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  cardHeaderSimple: { marginBottom: 10 },
  cardTitle: { color: "#ffffff", fontSize: 17, fontWeight: "800" },
  cardCaption: { color: "#7c8b95", fontSize: 12, marginTop: 4 },

  editButton: {
    backgroundColor: "#0f2b3a",
    borderWidth: 1,
    borderColor: "#164e63",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  editButtonText: { color: "#bae6fd", fontSize: 12, fontWeight: "800" },

  label: {
    color: "#94a3b8",
    fontSize: 12,
    textTransform: "uppercase",
    marginTop: 12,
    marginBottom: 4,
  },
  value: { color: "#ffffff", fontSize: 15, lineHeight: 22 },

  input: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#1f2937",
    color: "#ffffff",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  textArea: { minHeight: 100, textAlignVertical: "top" },

  directionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  directionButton: {
    minWidth: 54,
    backgroundColor: "#1f2937",
    borderWidth: 1,
    borderColor: "#374151",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  directionButtonActive: { backgroundColor: "#12351f", borderColor: "#22c55e" },
  directionButtonText: { color: "#e5e7eb", fontWeight: "800" },
  directionButtonTextActive: { color: "#86efac" },

  buttonRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  choiceRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  choice: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#1f2937",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#374151",
  },
  choiceActive: { backgroundColor: "#163222", borderColor: "#22c55e" },
  choiceText: { color: "#ffffff", fontWeight: "800" },
  choiceTextActive: { color: "#86efac" },

  primaryButton: {
    backgroundColor: "#22c55e",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 14,
  },
  primaryButtonHalf: {
    flex: 1,
    backgroundColor: "#22c55e",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: { color: "#04110a", fontSize: 15, fontWeight: "800" },
  secondaryButtonHalf: {
    flex: 1,
    backgroundColor: "#1f2937",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: { color: "#e5e7eb", fontSize: 15, fontWeight: "800" },

  deleteButton: {
    marginTop: 18,
    backgroundColor: "#3b0d0d",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  deleteButtonText: { color: "#fca5a5", fontSize: 15, fontWeight: "800" },

  statusGrid: { gap: 10 },
  statusMiniCard: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 12,
    marginTop: 10,
  },
  statusMiniLabel: {
    color: "#94a3b8",
    fontSize: 12,
    marginBottom: 5,
    textTransform: "uppercase",
  },
  statusMiniValue: { color: "#ffffff", fontSize: 14, fontWeight: "700" },

  map: { width: "100%", height: 260, borderRadius: 16, marginTop: 12 },
  mapInfo: { color: "#94a3b8", fontSize: 12, marginTop: 10, lineHeight: 18 },

  statsRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  statCard: {
    flex: 1,
    backgroundColor: "#111827",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#1f2937",
    padding: 14,
  },
  statLabel: { color: "#94a3b8", fontSize: 12, marginBottom: 6 },
  statValue: { color: "#ffffff", fontSize: 20, fontWeight: "800" },

  highlightBox: { backgroundColor: "#0f172a", borderRadius: 14, padding: 14 },
  highlightTitle: {
    color: "#86efac",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  highlightText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
  highlightSmall: { color: "#94a3b8", fontSize: 13, marginTop: 4 },
  highlightComment: { color: "#cbd5e1", fontSize: 13, marginTop: 8 },

  subSectionTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 8,
  },
  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  listKey: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  listValue: { color: "#cbd5e1", fontSize: 14 },

  obsRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: "#0f172a",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  obsTitle: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
  obsMeta: { color: "#94a3b8", fontSize: 12, marginTop: 4 },
  obsComment: { color: "#cbd5e1", fontSize: 12, marginTop: 6 },
  obsActions: { alignItems: "flex-end", gap: 8 },
  distanceBadge: {
    backgroundColor: "#12351f",
    borderWidth: 1,
    borderColor: "#1f5134",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  distanceBadgeText: { color: "#86efac", fontSize: 12, fontWeight: "800" },
  deleteObsButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },

  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyTitle: { color: "#ffffff", fontSize: 24, fontWeight: "800" },
  emptyText: {
    color: "#94a3b8",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  emptyInfo: { color: "#94a3b8", fontSize: 14, marginTop: 8 },

  modal: {
    flex: 1,
    backgroundColor: "#000000aa",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#111827",
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
});