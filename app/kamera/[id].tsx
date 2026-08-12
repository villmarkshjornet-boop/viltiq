import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import MapView, { Circle, Marker, Polygon } from "../../components/MapView";
import BottomDock from "../../components/BottomDock";
import RetningVelger from "../../components/RetningVelger";

import { auth } from "../../src/config/firebase";
import { hentTidsvekt } from "../../src/lib/aktivitet";
import {
  calculateCameraActivity,
  formaterPeriode,
  LAV_KONFIDENS_TERSKEL,
  type CameraActivityLevel,
} from "../../src/lib/cameraActivity";
import { buildSector, distanceMeters, vindRetningLabel } from "../../src/lib/geo";
import {
  genererKameraOppsummering,
  type KameraOppsummeringInput,
} from "../../src/lib/kameraOppsummering";
import {
  deactivateCamera,
  subscribeToCamera,
  updateCamera,
  type Viltkamera,
} from "../../src/services/cameras";
import {
  deleteObservation,
  saveObservation,
  subscribeToNearbyObservations,
  subscribeToObservationsByCamera,
} from "../../src/services/observations";
import type { Observasjon } from "../../src/types/observation";

type ObservasjonMedDistance = Observasjon & {
  distance: number;
};

type HeatSone = {
  latitude: number;
  longitude: number;
  score: number;
};

type Tidsvindu = "morgen" | "dag" | "kveld" | "natt";

const AKTIVITET_RADIUS_METER = 300;
const AKTIVITET_RADIUS_KM = AKTIVITET_RADIUS_METER / 1000;

// Under dette antallet observasjoner er et fordelt tidsmønster ikke
// pålitelig — vis "for lite data" i stedet for å fabrikere et mønster.
const TIDSMØNSTER_MIN_OBS = 5;

const OBS_DYR_LISTE = ["Rådyr", "Elg", "Hjort", "Rev", "Annet"];
const OBS_KJØNN = ["Ukjent", "Hannkjønn", "Hunkjønn"] as const;
const OBS_ALDER = ["Ukjent", "Kalv/kje", "Ungdyr", "Voksen"] as const;

const NIVÅ_LABEL: Record<CameraActivityLevel, string> = {
  low: "Lav",
  medium: "Medium",
  high: "Høy",
};

const TIDSVINDU_LABEL: Record<Tidsvindu, string> = {
  morgen: "Morgen (05–10)",
  dag: "Dag (10–17)",
  kveld: "Kveld (17–23)",
  natt: "Natt (23–05)",
};

function formatDato(verdi?: any) {
  if (!verdi) return "Ikke registrert";

  let dato: Date;

  if (typeof verdi === "string") {
    dato = new Date(verdi);
  } else if (typeof verdi?.toDate === "function") {
    // Firestore Timestamp (fra serverTimestamp()) — konverter til Date.
    dato = verdi.toDate();
  } else {
    return "Ikke registrert";
  }

  if (Number.isNaN(dato.getTime())) return "Ikke registrert";
  return dato.toLocaleString("no-NO");
}

/** Firestore Timestamp, ISO-streng eller udefinert → Date, evt. null. */
function timestampTilDato(verdi: any): Date | null {
  if (!verdi) return null;
  if (typeof verdi?.toDate === "function") return verdi.toDate();
  if (typeof verdi === "string") {
    const dato = new Date(verdi);
    return Number.isNaN(dato.getTime()) ? null : dato;
  }
  return null;
}

function normaliserKamera(kamera: Viltkamera): Viltkamera {
  return {
    ...kamera,
    lastCheckedAt: kamera.lastCheckedAt || "",
    batteryStatus: kamera.batteryStatus || "Ukjent",
    memoryCardStatus: kamera.memoryCardStatus || "Ukjent",
    baitStatus: kamera.baitStatus || "Ukjent",
    notes: kamera.notes || "",
  };
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

function hentAktivitetsBadgeStyle(nivå: CameraActivityLevel) {
  if (nivå === "high") {
    return {
      bg: styles.levelHighBg,
      text: styles.levelHighText,
    };
  }

  if (nivå === "medium") {
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

  const [kamera, setKamera] = useState<Viltkamera | null>(null);
  // Presist koblet via cameraId — driver all statistikk under.
  const [kameraObservasjoner, setKameraObservasjoner] = useState<Observasjon[]>([]);
  // Radius-basert nærhetsheuristikk — kun til kartpreview/heatmap og en
  // sekundær "andre observasjoner i nærheten"-seksjon.
  const [nearbyObservasjoner, setNearbyObservasjoner] = useState<Observasjon[]>([]);
  const [laster, setLaster] = useState(true);

  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState("");
  const [directionDegrees, setDirectionDegrees] = useState(0);
  const [notes, setNotes] = useState("");

  const [checkModal, setCheckModal] = useState(false);
  const [battery, setBattery] = useState("OK");
  const [memory, setMemory] = useState("OK");
  const [bait, setBait] = useState("Nei");
  const [checkNote, setCheckNote] = useState("");

  const [obsModal, setObsModal] = useState(false);
  const [obsDyr, setObsDyr] = useState(OBS_DYR_LISTE[0]);
  const [obsAntall, setObsAntall] = useState("1");
  const [obsKjønn, setObsKjønn] = useState<(typeof OBS_KJØNN)[number]>("Ukjent");
  const [obsAlder, setObsAlder] = useState<(typeof OBS_ALDER)[number]>("Ukjent");
  const [obsKommentar, setObsKommentar] = useState("");
  const [obsLagrer, setObsLagrer] = useState(false);

  const initialisertForId = useRef<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLaster(false);
      return;
    }

    let aktiv = true;
    let kameraObsUnsubscribe: undefined | (() => void);
    let nearbyObsUnsubscribe: undefined | (() => void);
    let obsAbonnementStartet = false;

    const kameraUnsubscribe = subscribeToCamera(
      id,
      (funnet) => {
        if (!aktiv) return;

        const normalisert = funnet ? normaliserKamera(funnet) : null;
        setKamera(normalisert);

        if (!normalisert) {
          setLaster(false);
          return;
        }

        if (!obsAbonnementStartet) {
          obsAbonnementStartet = true;

          kameraObsUnsubscribe = subscribeToObservationsByCamera(
            normalisert.id,
            normalisert.jaktlagId,
            (liste: Observasjon[]) => {
              if (!aktiv) return;
              setKameraObservasjoner(liste);
              setLaster(false);
            },
            (error: Error) => {
              console.log("Feil ved lasting av kameraobservasjoner:", error);
              if (!aktiv) return;
              setKameraObservasjoner([]);
              setLaster(false);
            }
          );

          nearbyObsUnsubscribe = subscribeToNearbyObservations(
            {
              center: {
                latitude: normalisert.latitude,
                longitude: normalisert.longitude,
              },
              radiusKm: AKTIVITET_RADIUS_KM,
            },
            (liste: Observasjon[]) => {
              if (!aktiv) return;
              setNearbyObservasjoner(liste);
            },
            (error: Error) => {
              console.log("Feil ved lasting av observasjoner rundt kamera:", error);
              if (!aktiv) return;
              setNearbyObservasjoner([]);
            }
          );
        }
      },
      (error) => {
        console.log("Feil ved lasting av kamera:", error);
        if (!aktiv) return;
        setKamera(null);
        setLaster(false);
      }
    );

    return () => {
      aktiv = false;
      kameraUnsubscribe();
      if (kameraObsUnsubscribe) kameraObsUnsubscribe();
      if (nearbyObsUnsubscribe) nearbyObsUnsubscribe();
    };
  }, [id]);

  // Fyll redigeringsfeltene kun første gang et gitt kamera lastes, slik at
  // sanntidsoppdateringer fra Firestore ikke overskriver tekst brukeren
  // holder på å skrive i redigeringsmodus.
  useEffect(() => {
    if (!kamera) return;
    if (initialisertForId.current === kamera.id) return;

    initialisertForId.current = kamera.id;
    setName(kamera.name || "");
    setDirectionDegrees(kamera.directionDegrees);
    setNotes(kamera.notes || "");
  }, [kamera]);

  const observasjonerINaerheten = useMemo<ObservasjonMedDistance[]>(() => {
    if (!kamera) return [];

    return nearbyObservasjoner
      .filter((obs) => obs.latitude != null && obs.longitude != null)
      .map((obs) => {
        const distance = distanceMeters(
          { latitude: kamera.latitude, longitude: kamera.longitude },
          { latitude: obs.latitude as number, longitude: obs.longitude as number }
        );

        return {
          ...obs,
          distance,
        };
      })
      .filter((obs) => obs.distance <= AKTIVITET_RADIUS_METER)
      .sort((a, b) => new Date(b.tid).getTime() - new Date(a.tid).getTime());
  }, [kamera, nearbyObservasjoner]);

  // Andre observasjoner i nærheten som ikke allerede er koblet direkte til
  // dette kameraet — unngår duplikater med hovedlisten under.
  const andreObservasjonerINaerheten = useMemo(() => {
    if (!kamera) return [];
    return observasjonerINaerheten.filter((obs) => obs.cameraId !== kamera.id);
  }, [observasjonerINaerheten, kamera]);

  const heatmapSoner = useMemo(() => {
    return byggHeatmap(observasjonerINaerheten);
  }, [observasjonerINaerheten]);

  const aktivitet = useMemo(() => {
    const installedAtDato = timestampTilDato(kamera?.installedAt) || new Date();
    const removedAtDato = kamera && !kamera.active ? timestampTilDato(kamera.removedAt) : null;

    return calculateCameraActivity({
      installedAt: installedAtDato,
      removedAt: removedAtDato,
      observations: kameraObservasjoner.map((obs) => ({
        tid: obs.tid,
        antall: obs.antall,
      })),
    });
  }, [kamera, kameraObservasjoner]);

  const lavKonfidens = aktivitet.confidence < LAV_KONFIDENS_TERSKEL;

  const artsfordeling = useMemo(() => {
    const teller: Record<string, number> = {};

    kameraObservasjoner.forEach((obs) => {
      teller[obs.dyr] = (teller[obs.dyr] || 0) + (obs.antall > 0 ? obs.antall : 1);
    });

    const total = Object.values(teller).reduce((sum, n) => sum + n, 0);

    return Object.entries(teller)
      .map(([dyr, antall]) => ({
        dyr,
        antall,
        prosent: total > 0 ? Math.round((antall / total) * 100) : 0,
      }))
      .sort((a, b) => b.antall - a.antall);
  }, [kameraObservasjoner]);

  const aktivitetOverTid = useMemo(() => {
    const nå = Date.now();
    const innenfor = (msVindu: number) =>
      kameraObservasjoner.filter((obs) => nå - new Date(obs.tid).getTime() <= msVindu);

    const oppsummer = (liste: Observasjon[]) => ({
      observasjoner: liste.length,
      dyr: liste.reduce((sum, obs) => sum + (obs.antall > 0 ? obs.antall : 1), 0),
    });

    return {
      sisteSjuDager: oppsummer(innenfor(7 * 24 * 60 * 60 * 1000)),
      sisteTrettiDager: oppsummer(innenfor(30 * 24 * 60 * 60 * 1000)),
      helePerioden: oppsummer(kameraObservasjoner),
    };
  }, [kameraObservasjoner]);

  // Enkel tidsfordeling (morgen/dag/kveld/natt) — samme grenser som
  // "tidsmønster" i app/statistikk.tsx. Kun beregnet når datagrunnlaget er
  // stort nok til at et mønster faktisk betyr noe.
  const tidsmønster = useMemo(() => {
    if (kameraObservasjoner.length < TIDSMØNSTER_MIN_OBS) return null;

    const m: Record<Tidsvindu, number> = { morgen: 0, dag: 0, kveld: 0, natt: 0 };

    kameraObservasjoner.forEach((obs) => {
      const t = new Date(obs.tid).getTime();
      if (Number.isNaN(t)) return;

      const h = new Date(obs.tid).getHours();
      if (h >= 5 && h < 10) m.morgen++;
      else if (h < 17) m.dag++;
      else if (h < 23) m.kveld++;
      else m.natt++;
    });

    return m;
  }, [kameraObservasjoner]);

  const peakTime = useMemo(() => {
    if (!tidsmønster) return null;

    const entries = Object.entries(tidsmønster) as [Tidsvindu, number][];
    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    if (total === 0) return null;

    const [toppVindu, toppVerdi] = entries.sort((a, b) => b[1] - a[1])[0];
    if (toppVerdi === 0) return null;

    return TIDSVINDU_LABEL[toppVindu].toLowerCase();
  }, [tidsmønster]);

  const oppsummeringTekst = useMemo(() => {
    const input: KameraOppsummeringInput = {
      activeDays: aktivitet.activeDays,
      observationEvents: aktivitet.observationEvents,
      totalAnimals: aktivitet.totalAnimals,
      dominantSpecies: artsfordeling[0]?.dyr ?? null,
      dominantSpeciesPercentage: artsfordeling[0]?.prosent ?? null,
      observationsPerWeek: aktivitet.observationsPerWeek,
      animalsPerWeek: aktivitet.animalsPerWeek,
      peakTime,
      activityLevel: aktivitet.level,
      confidence: aktivitet.confidence,
    };

    return genererKameraOppsummering(input);
  }, [aktivitet, artsfordeling, peakTime]);

  const sisteObservasjon = useMemo(() => {
    return kameraObservasjoner[0] || null;
  }, [kameraObservasjoner]);

  async function lagreEndringer() {
    if (!kamera) return;

    const trimmedName = name.trim();

    if (!trimmedName) {
      Alert.alert("Mangler navn", "Kamera må ha et navn.");
      return;
    }

    try {
      await updateCamera(kamera.id, {
        name: trimmedName,
        directionDegrees,
        notes: notes.trim(),
      });

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

      await updateCamera(kamera.id, {
        lastCheckedAt: new Date().toISOString(),
        batteryStatus: battery,
        memoryCardStatus: memory,
        baitStatus: bait,
        notes: sammensattNotat,
      });

      setNotes(sammensattNotat);
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
    setDirectionDegrees(kamera.directionDegrees);
    setNotes(kamera.notes || "");
    setEditMode(false);
  }

  function slettKamera() {
    if (!kamera) return;

    Alert.alert(
      "Fjerne viltkamera?",
      "Kameraet fjernes fra kartet, men tidligere observasjoner og statistikk beholdes.",
      [
        { text: "Avbryt", style: "cancel" },
        {
          text: "Fjern kamera",
          style: "destructive",
          onPress: async () => {
            try {
              await deactivateCamera(kamera.id);
              router.back();
            } catch (error) {
              console.log("Feil ved fjerning av kamera:", error);
              Alert.alert("Feil", "Kunne ikke fjerne kamera.");
            }
          },
        },
      ]
    );
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
              await deleteObservation(obs.id);
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

  function åpneObsModal() {
    setObsDyr(OBS_DYR_LISTE[0]);
    setObsAntall("1");
    setObsKjønn("Ukjent");
    setObsAlder("Ukjent");
    setObsKommentar("");
    setObsModal(true);
  }

  async function registrerObservasjon() {
    if (!kamera) return;

    const antallTall = parseInt(obsAntall, 10);
    const antall = Number.isFinite(antallTall) && antallTall > 0 ? antallTall : 1;

    try {
      setObsLagrer(true);

      await saveObservation({
        dyr: obsDyr,
        type: "Sett dyr",
        kommentar: obsKommentar.trim(),
        tid: new Date().toISOString(),
        latitude: kamera.latitude,
        longitude: kamera.longitude,
        retning: null,
        antall,
        observationSource: "camera",
        cameraId: kamera.id,
        kjonn: obsKjønn === "Ukjent" ? null : obsKjønn,
        alder: obsAlder === "Ukjent" ? null : obsAlder,
      });

      setObsModal(false);
      Alert.alert("Registrert", "Observasjonen er lagret på kameraet.");
    } catch (error) {
      console.log("Feil ved registrering av observasjon:", error);
      Alert.alert("Feil", "Kunne ikke lagre observasjonen.");
    } finally {
      setObsLagrer(false);
    }
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
          <Text style={styles.emptyText}>
            Kameraet finnes ikke lenger, eller du har ikke tilgang til det.
          </Text>

          <Pressable style={styles.primaryButton} onPress={() => router.back()}>
            <Text style={styles.primaryButtonText}>Tilbake</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const aktivitetsBadge = hentAktivitetsBadgeStyle(aktivitet.level);

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
                <Text style={styles.heroTitle}>{NIVÅ_LABEL[aktivitet.level]} aktivitet</Text>
                <Text style={styles.heroText}>
                  {aktivitet.observationEvents > 0
                    ? "Det er registrert observasjoner på kameraet. Følg med på mønster og tidspunkt."
                    : "Ingen observasjoner registrert på dette kameraet ennå."}
                </Text>
              </View>

              <View style={styles.heroBadgeCol}>
                <View style={[styles.heroBadge, aktivitetsBadge.bg]}>
                  <Text style={[styles.heroBadgeText, aktivitetsBadge.text]}>
                    {NIVÅ_LABEL[aktivitet.level]}
                  </Text>
                </View>
                {lavKonfidens ? (
                  <View style={styles.konfidensBadge}>
                    <Text style={styles.konfidensBadgeText}>Lite datagrunnlag</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.heroStatsRow}>
              <View style={styles.heroStatCard}>
                <Text style={styles.heroStatValue}>{aktivitet.observationEvents}</Text>
                <Text style={styles.heroStatLabel}>observasjoner</Text>
              </View>

              <View style={styles.heroStatCard}>
                <Text style={styles.heroStatValue}>{aktivitet.totalAnimals}</Text>
                <Text style={styles.heroStatLabel}>dyr totalt</Text>
              </View>

              <View style={styles.heroStatCard}>
                <Text style={styles.heroStatValue}>{artsfordeling[0]?.dyr || "-"}</Text>
                <Text style={styles.heroStatLabel}>toppdyr</Text>
              </View>
            </View>
          </View>

          <View style={styles.topActionsRow}>
            <Pressable style={styles.primaryButtonHalf} onPress={() => setCheckModal(true)}>
              <Text style={styles.primaryButtonText}>Registrer sjekk</Text>
            </Pressable>

            <Pressable style={styles.secondaryButtonHalf} onPress={åpneObsModal}>
              <Text style={styles.secondaryButtonText}>Registrer observasjon</Text>
            </Pressable>
          </View>

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
                <Text style={styles.value}>
                  {kamera.directionDegrees}° ({vindRetningLabel(kamera.directionDegrees)})
                </Text>

                <Text style={styles.label}>Notater</Text>
                <Text style={styles.value}>{kamera.notes || "Ingen notater ennå"}</Text>

                <Text style={styles.label}>Koordinater</Text>
                <Text style={styles.value}>
                  {kamera.latitude.toFixed(5)}, {kamera.longitude.toFixed(5)}
                </Text>

                <Text style={styles.label}>Status</Text>
                <Text style={styles.value}>
                  {kamera.active ? "Aktivt" : `Fjernet ${formatDato(kamera.removedAt)}`}
                </Text>

                <Text style={styles.label}>Installert</Text>
                <Text style={styles.value}>{formatDato(kamera.installedAt)}</Text>

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
                  placeholderTextColor="#5C7568"
                  style={styles.input}
                />

                <Text style={styles.label}>Retning</Text>
                <View style={styles.retningVelgerWrap}>
                  <RetningVelger
                    value={directionDegrees}
                    onChange={setDirectionDegrees}
                    label="Kameraretning"
                  />
                </View>

                <Text style={styles.label}>Notater</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="F.eks. trekk, åteplass, sti, høyde"
                  placeholderTextColor="#5C7568"
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

              <Polygon
                coordinates={buildSector(
                  { latitude: kamera.latitude, longitude: kamera.longitude },
                  120,
                  kamera.directionDegrees,
                  60
                )}
                fillColor="rgba(59,130,246,0.18)"
                strokeColor="rgba(59,130,246,0.55)"
                strokeWidth={1.5}
              />

              <Marker
                coordinate={{
                  latitude: kamera.latitude,
                  longitude: kamera.longitude,
                }}
                title={kamera.name}
                description={`${kamera.directionDegrees}° (${vindRetningLabel(kamera.directionDegrees)})`}
                pinColor="#2CC36B"
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
                  pinColor="#60A5FA"
                />
              ))}
            </MapView>

            <Text style={styles.mapInfo}>
              Blå sektor viser kameraretning. Varmefelt viser hvor aktivitet samler seg.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderSimple}>
              <Text style={styles.cardTitle}>Statistikk</Text>
              <Text style={styles.cardCaption}>
                Basert på observasjoner registrert direkte på dette kameraet
              </Text>
            </View>

            <View style={styles.periodeRow}>
              <View style={styles.periodeInfo}>
                <Text style={styles.label}>Periode aktivt</Text>
                <Text style={styles.value}>{formaterPeriode(aktivitet.activeDays)}</Text>
              </View>

              <View style={[styles.heroBadge, aktivitetsBadge.bg]}>
                <Text style={[styles.heroBadgeText, aktivitetsBadge.text]}>
                  {NIVÅ_LABEL[aktivitet.level]}
                </Text>
              </View>
            </View>

            {lavKonfidens ? (
              <Text style={styles.konfidensHint}>
                Foreløpig lite datagrunnlag — aktivitetsnivået er usikkert.
              </Text>
            ) : null}

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Observasjoner</Text>
                <Text style={styles.statValue}>{aktivitet.observationEvents}</Text>
              </View>

              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Dyr totalt</Text>
                <Text style={styles.statValue}>{aktivitet.totalAnimals}</Text>
              </View>

              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Obs. per uke</Text>
                <Text style={styles.statValue}>{aktivitet.observationsPerWeek}</Text>
              </View>
            </View>

            <Text style={[styles.subSectionTitle, { marginTop: 8 }]}>Artsfordeling</Text>

            {artsfordeling.length > 0 ? (
              artsfordeling.map((art) => (
                <View key={art.dyr} style={styles.listRow}>
                  <Text style={styles.listKey}>{art.dyr}</Text>
                  <Text style={styles.listValue}>
                    {art.antall} dyr · {art.prosent} %
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyInfo}>Ingen dyredata ennå.</Text>
            )}

            <Text style={[styles.subSectionTitle, { marginTop: 18 }]}>Aktivitet over tid</Text>

            <View style={styles.periodGrid}>
              <View style={styles.periodCell}>
                <Text style={styles.periodCellLabel}>Siste 7 dager</Text>
                <Text style={styles.periodCellValue}>
                  {aktivitetOverTid.sisteSjuDager.observasjoner} obs · {aktivitetOverTid.sisteSjuDager.dyr} dyr
                </Text>
              </View>

              <View style={styles.periodCell}>
                <Text style={styles.periodCellLabel}>Siste 30 dager</Text>
                <Text style={styles.periodCellValue}>
                  {aktivitetOverTid.sisteTrettiDager.observasjoner} obs · {aktivitetOverTid.sisteTrettiDager.dyr} dyr
                </Text>
              </View>

              <View style={styles.periodCell}>
                <Text style={styles.periodCellLabel}>Hele perioden</Text>
                <Text style={styles.periodCellValue}>
                  {aktivitetOverTid.helePerioden.observasjoner} obs · {aktivitetOverTid.helePerioden.dyr} dyr
                </Text>
              </View>
            </View>

            <Text style={[styles.subSectionTitle, { marginTop: 18 }]}>Tidsmønster</Text>

            {tidsmønster ? (
              (Object.keys(TIDSVINDU_LABEL) as Tidsvindu[]).map((key) => {
                const maks = Math.max(
                  tidsmønster.morgen,
                  tidsmønster.dag,
                  tidsmønster.kveld,
                  tidsmønster.natt,
                  1
                );
                const bredde = `${Math.round((tidsmønster[key] / maks) * 100)}%`;

                return (
                  <View key={key} style={styles.barRad}>
                    <View style={styles.barLeft}>
                      <Text style={styles.barDyr}>{TIDSVINDU_LABEL[key]}</Text>
                      <Text style={styles.barMeta}>{tidsmønster[key]} obs</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFyllSoft, { width: bredde as any }]} />
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={styles.emptyInfo}>For lite data ennå.</Text>
            )}

            <View style={styles.summaryBox}>
              <Text style={styles.summaryTitle}>Automatisk oppsummering</Text>
              <Text style={styles.summaryText}>{oppsummeringTekst}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Observasjoner på kamera</Text>

            {sisteObservasjon ? (
              <View style={styles.highlightBox}>
                <Text style={styles.highlightTitle}>Siste observasjon</Text>
                <Text style={styles.highlightText}>
                  {sisteObservasjon.dyr} · {sisteObservasjon.type}
                </Text>
                <Text style={styles.highlightSmall}>{formatDato(sisteObservasjon.tid)}</Text>
                <Text style={styles.highlightSmall}>
                  {sisteObservasjon.antall} dyr i denne observasjonen
                </Text>
                {!!sisteObservasjon.kommentar && (
                  <Text style={styles.highlightComment}>{sisteObservasjon.kommentar}</Text>
                )}
              </View>
            ) : (
              <Text style={styles.emptyInfo}>Ingen observasjoner registrert på dette kameraet ennå.</Text>
            )}

            <Text style={[styles.subSectionTitle, { marginTop: 18 }]}>Siste observasjoner</Text>

            {kameraObservasjoner.length > 0 ? (
              kameraObservasjoner.slice(0, 8).map((obs, index) => {
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
                        <Text style={styles.distanceBadgeText}>{obs.antall} dyr</Text>
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

          {andreObservasjonerINaerheten.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderSimple}>
                <Text style={styles.cardTitle}>Andre observasjoner i nærheten</Text>
                <Text style={styles.cardCaption}>
                  Innen {AKTIVITET_RADIUS_METER} meter, men ikke registrert direkte på dette kameraet
                </Text>
              </View>

              {andreObservasjonerINaerheten.slice(0, 5).map((obs, index) => (
                <View key={`${obs.id || obs.tid}-nearby-${index}`} style={styles.obsRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.obsTitle}>
                      {obs.dyr} · {obs.type}
                    </Text>
                    <Text style={styles.obsMeta}>{formatDato(obs.tid)}</Text>
                  </View>

                  <View style={styles.distanceBadge}>
                    <Text style={styles.distanceBadgeText}>{Math.round(obs.distance)} m</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
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

        <Modal visible={obsModal} transparent animationType="fade">
          <View style={styles.modal}>
            <View style={styles.modalCard}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.cardTitle}>Registrer observasjon</Text>

                <Text style={styles.label}>Dyr</Text>
                <View style={styles.chipRow}>
                  {OBS_DYR_LISTE.map((val) => (
                    <Pressable
                      key={val}
                      style={[styles.chip, obsDyr === val && styles.chipActive]}
                      onPress={() => setObsDyr(val)}
                    >
                      <Text style={[styles.chipText, obsDyr === val && styles.chipTextActive]}>
                        {val}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Antall</Text>
                <TextInput
                  value={obsAntall}
                  onChangeText={setObsAntall}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor="#5C7568"
                  style={styles.input}
                />

                <Text style={styles.label}>Kjønn</Text>
                <View style={styles.chipRow}>
                  {OBS_KJØNN.map((val) => (
                    <Pressable
                      key={val}
                      style={[styles.chip, obsKjønn === val && styles.chipActive]}
                      onPress={() => setObsKjønn(val)}
                    >
                      <Text style={[styles.chipText, obsKjønn === val && styles.chipTextActive]}>
                        {val}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Alder</Text>
                <View style={styles.chipRow}>
                  {OBS_ALDER.map((val) => (
                    <Pressable
                      key={val}
                      style={[styles.chip, obsAlder === val && styles.chipActive]}
                      onPress={() => setObsAlder(val)}
                    >
                      <Text style={[styles.chipText, obsAlder === val && styles.chipTextActive]}>
                        {val}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Kommentar</Text>
                <TextInput
                  placeholder="Valgfritt"
                  placeholderTextColor="#999"
                  style={styles.input}
                  value={obsKommentar}
                  onChangeText={setObsKommentar}
                />

                <View style={styles.buttonRow}>
                  <Pressable style={styles.secondaryButtonHalf} onPress={() => setObsModal(false)}>
                    <Text style={styles.secondaryButtonText}>Avbryt</Text>
                  </Pressable>

                  <Pressable
                    style={styles.primaryButtonHalf}
                    onPress={registrerObservasjon}
                    disabled={obsLagrer}
                  >
                    <Text style={styles.primaryButtonText}>
                      {obsLagrer ? "Lagrer..." : "Lagre"}
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
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
    color: "#A9F2BF",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.3,
    marginBottom: 8,
  },
  title: { color: "#FFFFFF", fontSize: 30, fontWeight: "800", marginTop: 2 },
  subtitle: { color: "#8EA0AA", fontSize: 14, marginTop: 6, marginBottom: 4 },

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
    color: "#A9F2BF",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    marginBottom: 8,
  },
  heroTitle: { color: "#FFFFFF", fontSize: 24, fontWeight: "800" },
  heroText: { color: "#C8D8D0", fontSize: 14, lineHeight: 21, marginTop: 8 },
  heroBadgeCol: { alignItems: "flex-end", gap: 6 },
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
  heroStatValue: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
  heroStatLabel: {
    color: "#8EA0AA",
    fontSize: 11,
    marginTop: 4,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  konfidensBadge: {
    backgroundColor: "rgba(148,163,184,0.14)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  konfidensBadgeText: { color: "#C8D8D0", fontSize: 10, fontWeight: "800" },
  konfidensHint: { color: "#8EA0AA", fontSize: 12, marginTop: 8, lineHeight: 17 },

  levelHighBg: { backgroundColor: "rgba(239,68,68,0.14)" },
  levelHighText: { color: "#FCA5A5" },
  levelMediumBg: { backgroundColor: "rgba(245,158,11,0.14)" },
  levelMediumText: { color: "#FDE68A" },
  levelLowBg: { backgroundColor: "rgba(34,197,94,0.14)" },
  levelLowText: { color: "#A9F2BF" },

  topActionsRow: { flexDirection: "row", gap: 10, marginBottom: 14 },

  card: {
    backgroundColor: "#0B1610",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#0B1610",
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
  cardTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  cardCaption: { color: "#7c8b95", fontSize: 12, marginTop: 4 },

  editButton: {
    backgroundColor: "#0B1B26",
    borderWidth: 1,
    borderColor: "#154759",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  editButtonText: { color: "#BFE9FA", fontSize: 12, fontWeight: "800" },

  label: {
    color: "#8EA0AA",
    fontSize: 12,
    textTransform: "uppercase",
    marginTop: 12,
    marginBottom: 4,
  },
  value: { color: "#FFFFFF", fontSize: 15, lineHeight: 22 },

  input: {
    backgroundColor: "#060E08",
    borderWidth: 1,
    borderColor: "#0B1610",
    color: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  textArea: { minHeight: 100, textAlignVertical: "top" },

  retningVelgerWrap: { alignItems: "center", marginTop: 10, marginBottom: 4 },

  buttonRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  choiceRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  choice: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#0B1610",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#192420",
  },
  choiceActive: { backgroundColor: "#163222", borderColor: "#2CC36B" },
  choiceText: { color: "#FFFFFF", fontWeight: "800" },
  choiceTextActive: { color: "#A9F2BF" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#0B1610",
    borderWidth: 1,
    borderColor: "#192420",
  },
  chipActive: { backgroundColor: "#12351f", borderColor: "#2CC36B" },
  chipText: { color: "#D7E6DC", fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#A9F2BF", fontWeight: "800" },

  primaryButton: {
    backgroundColor: "#2CC36B",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 14,
  },
  primaryButtonHalf: {
    flex: 1,
    backgroundColor: "#2CC36B",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: { color: "#04110a", fontSize: 15, fontWeight: "800" },
  secondaryButtonHalf: {
    flex: 1,
    backgroundColor: "#0B1610",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: { color: "#D7E6DC", fontSize: 15, fontWeight: "800" },

  deleteButton: {
    marginTop: 18,
    backgroundColor: "#3b0d0d",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  deleteButtonText: { color: "#FCA5A5", fontSize: 15, fontWeight: "800" },

  statusGrid: { gap: 10 },
  statusMiniCard: {
    backgroundColor: "#060E08",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#0B1610",
    padding: 12,
    marginTop: 10,
  },
  statusMiniLabel: {
    color: "#8EA0AA",
    fontSize: 12,
    marginBottom: 5,
    textTransform: "uppercase",
  },
  statusMiniValue: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },

  map: { width: "100%", height: 260, borderRadius: 16, marginTop: 12 },
  mapInfo: { color: "#8EA0AA", fontSize: 12, marginTop: 10, lineHeight: 18 },

  statsRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  statCard: {
    flex: 1,
    backgroundColor: "#060E08",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#0B1610",
    padding: 14,
  },
  statLabel: { color: "#8EA0AA", fontSize: 12, marginBottom: 6 },
  statValue: { color: "#FFFFFF", fontSize: 20, fontWeight: "800" },

  periodeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  periodeInfo: { flex: 1 },

  periodGrid: { flexDirection: "row", gap: 8 },
  periodCell: {
    flex: 1,
    backgroundColor: "#060E08",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#0B1610",
    padding: 10,
  },
  periodCellLabel: {
    color: "#8EA0AA",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  periodCellValue: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },

  barRad: { marginBottom: 12 },
  barLeft: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  barDyr: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  barMeta: { color: "#8EA0AA", fontSize: 12 },
  barTrack: {
    height: 8,
    backgroundColor: "#060E08",
    borderRadius: 4,
    overflow: "hidden",
  },
  barFyllSoft: { height: "100%", borderRadius: 4, backgroundColor: "#60A5FA" },

  summaryBox: {
    marginTop: 18,
    backgroundColor: "rgba(34,197,94,0.06)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.16)",
    borderRadius: 16,
    padding: 14,
  },
  summaryTitle: {
    color: "#A9F2BF",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  summaryText: { color: "#D7E6DC", fontSize: 14, lineHeight: 21 },

  highlightBox: { backgroundColor: "#060E08", borderRadius: 14, padding: 14 },
  highlightTitle: {
    color: "#A9F2BF",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  highlightText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  highlightSmall: { color: "#8EA0AA", fontSize: 13, marginTop: 4 },
  highlightComment: { color: "#C8D8D0", fontSize: 13, marginTop: 8 },

  subSectionTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 8,
  },
  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#0B1610",
  },
  listKey: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  listValue: { color: "#C8D8D0", fontSize: 14 },

  obsRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: "#060E08",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  obsTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  obsMeta: { color: "#8EA0AA", fontSize: 12, marginTop: 4 },
  obsComment: { color: "#C8D8D0", fontSize: 12, marginTop: 6 },
  obsActions: { alignItems: "flex-end", gap: 8 },
  distanceBadge: {
    backgroundColor: "#12351f",
    borderWidth: 1,
    borderColor: "#1f5134",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  distanceBadgeText: { color: "#A9F2BF", fontSize: 12, fontWeight: "800" },
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
  emptyTitle: { color: "#FFFFFF", fontSize: 24, fontWeight: "800" },
  emptyText: {
    color: "#8EA0AA",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  emptyInfo: { color: "#8EA0AA", fontSize: 14, marginTop: 8 },

  modal: {
    flex: 1,
    backgroundColor: "#000000aa",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#0B1610",
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#0B1610",
    maxHeight: "88%",
  },
});
