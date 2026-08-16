import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, { Circle, Marker, Polygon } from "../../components/MapView";
import BottomDock from "../../components/BottomDock";
import RetningVelger from "../../components/RetningVelger";
import Badge from "../../components/ui/Badge";
import ListRow from "../../components/ui/ListRow";
import ModalSheet from "../../components/ui/ModalSheet";
import Surface from "../../components/ui/Surface";

import { auth } from "../../src/config/firebase";
import {
  alpha,
  color as uiColor,
  radius as uiRadius,
  spacing as uiSpacing,
  typography as uiType,
} from "../../src/design/tokens";
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

// Samme grønn→gul→rød semantikk som før (høyere score = mer alarmerende),
// men nå bygget på designsystemets status-tokens i stedet for frittstående
// rgba-verdier — se tokens.ts sin note om at grønt er forbeholdt
// merkevare/suksess og IKKE varme-/konfidensindikatorer for seg selv; her er
// det bevisst danger/warning/success (samme akse som aktivitetsnivå bruker),
// ikke levelColor()/confidenceColor() (som tilhører en annen, inkompatibel
// skala i src/engine).
function hentHeatFarge(score: number) {
  if (score >= 10) return uiColor.danger + "47"; // ~28%
  if (score >= 6) return uiColor.warning + "3D"; // ~24%
  if (score >= 3) return uiColor.success + "33"; // ~20%
  return uiColor.success + "1F"; // ~12%
}

/** Aktivitetsnivå (lav/medium/høy) → statusfarge for Badge. */
function nivaFarge(nivå: CameraActivityLevel) {
  if (nivå === "high") return uiColor.danger;
  if (nivå === "medium") return uiColor.warning;
  return uiColor.success;
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

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.headerTop}>
            <Pressable style={styles.backChip} onPress={() => router.back()}>
              <Ionicons name="chevron-back" size={16} color={uiColor.textSecondary} />
              <Text style={styles.backChipText}>Tilbake</Text>
            </Pressable>
          </View>

          <View style={styles.header}>
            <Text style={styles.eyebrow}>ViltIQ Kamera</Text>
            <Text style={styles.title}>{kamera.name}</Text>
            <Text style={styles.subtitle}>Referansepunkt, retning og aktivitet rundt kameraet.</Text>
          </View>

          <Surface variant="elevated" style={styles.heroCard}>
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
                <Badge label={NIVÅ_LABEL[aktivitet.level]} color={nivaFarge(aktivitet.level)} />
                {lavKonfidens ? (
                  <Badge label="Lite datagrunnlag" color={uiColor.textSecondary} size="sm" />
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
          </Surface>

          <View style={styles.topActionsRow}>
            <Pressable style={styles.primaryButtonHalf} onPress={() => setCheckModal(true)}>
              <Text style={styles.primaryButtonText}>Registrer sjekk</Text>
            </Pressable>

            <Pressable style={styles.secondaryButtonHalf} onPress={åpneObsModal}>
              <Text style={styles.secondaryButtonText}>Registrer observasjon</Text>
            </Pressable>
          </View>

          <Surface style={styles.card}>
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
                  placeholderTextColor={uiColor.textMuted}
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
                  placeholderTextColor={uiColor.textMuted}
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
          </Surface>

          <Surface style={styles.card}>
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
          </Surface>

          <Surface style={styles.card}>
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
                fillColor={uiColor.info + "0F"}
                strokeColor={uiColor.info + "59"}
                strokeWidth={2}
              />

              <Polygon
                coordinates={buildSector(
                  { latitude: kamera.latitude, longitude: kamera.longitude },
                  120,
                  kamera.directionDegrees,
                  60
                )}
                fillColor={uiColor.info + "2E"}
                strokeColor={uiColor.info + "8C"}
                strokeWidth={1.5}
              />

              <Marker
                coordinate={{
                  latitude: kamera.latitude,
                  longitude: kamera.longitude,
                }}
                title={kamera.name}
                description={`${kamera.directionDegrees}° (${vindRetningLabel(kamera.directionDegrees)})`}
                pinColor={uiColor.primary}
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
                  pinColor={uiColor.info}
                />
              ))}
            </MapView>

            <Text style={styles.mapInfo}>
              Blå sektor viser kameraretning. Varmefelt viser hvor aktivitet samler seg.
            </Text>
          </Surface>

          <Surface style={styles.card}>
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

              <Badge label={NIVÅ_LABEL[aktivitet.level]} color={nivaFarge(aktivitet.level)} />
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

            <Text style={[styles.subSectionTitle, { marginTop: uiSpacing.sm }]}>Artsfordeling</Text>

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

            <Text style={[styles.subSectionTitle, { marginTop: uiSpacing.xl - 2 }]}>Aktivitet over tid</Text>

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

            <Text style={[styles.subSectionTitle, { marginTop: uiSpacing.xl - 2 }]}>Tidsmønster</Text>

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
          </Surface>

          <Surface style={styles.card}>
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

            <Text style={[styles.subSectionTitle, { marginTop: uiSpacing.xl - 2 }]}>Siste observasjoner</Text>

            {kameraObservasjoner.length > 0 ? (
              <View style={styles.obsListe}>
                {kameraObservasjoner.slice(0, 8).map((obs, index) => {
                  const canDelete = kanSletteObservasjon(obs);
                  const erSiste = index === kameraObservasjoner.slice(0, 8).length - 1;

                  return (
                    <ListRow
                      key={`${obs.id || obs.tid}-list-${index}`}
                      title={`${obs.dyr} · ${obs.type}`}
                      subtitle={obs.kommentar || undefined}
                      meta={formatDato(obs.tid)}
                      divider={!erSiste}
                      trailing={
                        <View style={styles.obsTrailing}>
                          <Badge label={`${obs.antall} dyr`} color={uiColor.primary} size="sm" />
                          {canDelete ? (
                            <Pressable
                              style={styles.deleteObsButton}
                              onPress={() => bekreftSlettObservasjon(obs)}
                              hitSlop={8}
                            >
                              <Ionicons name="trash-outline" size={15} color={uiColor.danger} />
                            </Pressable>
                          ) : null}
                        </View>
                      }
                    />
                  );
                })}
              </View>
            ) : (
              <Text style={styles.emptyInfo}>Ingen observasjoner å vise.</Text>
            )}
          </Surface>

          {andreObservasjonerINaerheten.length > 0 ? (
            <Surface style={styles.card}>
              <View style={styles.cardHeaderSimple}>
                <Text style={styles.cardTitle}>Andre observasjoner i nærheten</Text>
                <Text style={styles.cardCaption}>
                  Innen {AKTIVITET_RADIUS_METER} meter, men ikke registrert direkte på dette kameraet
                </Text>
              </View>

              <View style={styles.obsListe}>
                {andreObservasjonerINaerheten.slice(0, 5).map((obs, index) => {
                  const erSiste = index === andreObservasjonerINaerheten.slice(0, 5).length - 1;

                  return (
                    <ListRow
                      key={`${obs.id || obs.tid}-nearby-${index}`}
                      title={`${obs.dyr} · ${obs.type}`}
                      subtitle={formatDato(obs.tid)}
                      divider={!erSiste}
                      trailing={<Badge label={`${Math.round(obs.distance)} m`} color={uiColor.info} size="sm" />}
                    />
                  );
                })}
              </View>
            </Surface>
          ) : null}
        </ScrollView>

        <ModalSheet visible={checkModal} onClose={() => setCheckModal(false)}>
          <Text style={styles.modalTitle}>Registrer sjekk</Text>

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
            placeholderTextColor={uiColor.textMuted}
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
        </ModalSheet>

        <ModalSheet visible={obsModal} onClose={() => setObsModal(false)}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>Registrer observasjon</Text>

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
              placeholderTextColor={uiColor.textMuted}
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
              placeholderTextColor={uiColor.textMuted}
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
        </ModalSheet>

        <BottomDock />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: uiColor.background },
  screen: { flex: 1 },
  container: { padding: uiSpacing.lg, paddingBottom: 160 },

  headerTop: { marginTop: 6, marginBottom: uiSpacing.sm },
  backChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: uiColor.surface,
    borderRadius: uiRadius.pill,
    borderWidth: 1,
    borderColor: uiColor.border,
    paddingHorizontal: uiSpacing.md,
    paddingVertical: 9,
  },
  backChipText: { color: uiColor.textSecondary, fontSize: 13, fontWeight: "800" },

  header: { marginBottom: uiSpacing.lg },
  eyebrow: {
    ...uiType.eyebrow,
    color: uiColor.primary,
    marginBottom: uiSpacing.sm,
  },
  title: { ...uiType.pageTitle, color: uiColor.textPrimary, fontSize: 30, marginTop: 2 },
  subtitle: { color: uiColor.textSecondary, fontSize: 14, marginTop: 6, marginBottom: 4 },

  heroCard: {
    position: "relative",
    overflow: "hidden",
    borderRadius: uiRadius.xl,
    padding: uiSpacing.lg + 2,
    marginBottom: uiSpacing.md + 2,
  },
  heroGlow: {
    position: "absolute",
    right: -20,
    top: -20,
    width: 120,
    height: 120,
    borderRadius: uiRadius.pill,
    backgroundColor: uiColor.primary + "14",
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: uiSpacing.md,
  },
  heroLeft: { flex: 1 },
  heroLabel: {
    ...uiType.eyebrow,
    color: uiColor.primary,
    marginBottom: uiSpacing.sm,
  },
  heroTitle: { color: uiColor.textPrimary, fontSize: 24, fontWeight: "800" },
  heroText: { color: uiColor.textSecondary, fontSize: 14, lineHeight: 21, marginTop: uiSpacing.sm },
  heroBadgeCol: { alignItems: "flex-end", gap: uiSpacing.xs + 2 },
  heroStatsRow: { flexDirection: "row", gap: uiSpacing.sm + 2, marginTop: uiSpacing.lg },
  heroStatCard: {
    flex: 1,
    backgroundColor: uiColor.background,
    borderRadius: uiRadius.lg,
    borderWidth: 1,
    borderColor: uiColor.border,
    padding: uiSpacing.md,
  },
  heroStatValue: { ...uiType.numericScore, color: uiColor.textPrimary, fontSize: 18 },
  heroStatLabel: {
    color: uiColor.textSecondary,
    fontSize: 11,
    marginTop: uiSpacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  konfidensHint: { color: uiColor.textSecondary, fontSize: 12, marginTop: uiSpacing.sm, lineHeight: 17 },

  topActionsRow: { flexDirection: "row", gap: uiSpacing.sm + 2, marginBottom: uiSpacing.md + 2 },

  card: {
    padding: uiSpacing.lg,
    marginBottom: uiSpacing.md + 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: uiSpacing.sm,
  },
  cardHeaderSimple: { marginBottom: uiSpacing.sm + 2 },
  cardTitle: { ...uiType.sectionTitle, color: uiColor.textPrimary, fontSize: 17 },
  cardCaption: { color: uiColor.textSecondary, fontSize: 12, marginTop: uiSpacing.xs },

  editButton: {
    backgroundColor: uiColor.info + alpha.soft,
    borderWidth: 1,
    borderColor: uiColor.info + alpha.medium,
    borderRadius: uiRadius.pill,
    paddingHorizontal: uiSpacing.md,
    paddingVertical: uiSpacing.sm,
  },
  editButtonText: { color: uiColor.info, fontSize: 12, fontWeight: "800" },

  label: {
    color: uiColor.textSecondary,
    fontSize: 12,
    textTransform: "uppercase",
    marginTop: uiSpacing.md,
    marginBottom: uiSpacing.xs,
  },
  value: { color: uiColor.textPrimary, fontSize: 15, lineHeight: 22 },

  input: {
    backgroundColor: uiColor.background,
    borderWidth: 1,
    borderColor: uiColor.border,
    color: uiColor.textPrimary,
    borderRadius: uiRadius.md,
    paddingHorizontal: uiSpacing.lg - 2,
    paddingVertical: uiSpacing.md,
    fontSize: 15,
  },
  textArea: { minHeight: 100, textAlignVertical: "top" },

  retningVelgerWrap: { alignItems: "center", marginTop: uiSpacing.sm + 2, marginBottom: uiSpacing.xs },

  buttonRow: { flexDirection: "row", gap: uiSpacing.sm + 2, marginTop: uiSpacing.lg },
  choiceRow: { flexDirection: "row", gap: uiSpacing.sm + 2, marginTop: uiSpacing.sm },
  choice: {
    flex: 1,
    paddingVertical: uiSpacing.md,
    borderRadius: uiRadius.sm + 2,
    backgroundColor: uiColor.background,
    alignItems: "center",
    borderWidth: 1,
    borderColor: uiColor.border,
  },
  choiceActive: { backgroundColor: uiColor.surfaceHover, borderColor: uiColor.primary },
  choiceText: { color: uiColor.textPrimary, fontWeight: "800" },
  choiceTextActive: { color: uiColor.primarySoft },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: uiSpacing.sm, marginTop: uiSpacing.sm },
  chip: {
    paddingHorizontal: uiSpacing.md + 2,
    paddingVertical: 9,
    borderRadius: uiRadius.pill,
    backgroundColor: uiColor.background,
    borderWidth: 1,
    borderColor: uiColor.border,
  },
  chipActive: { backgroundColor: uiColor.surfaceHover, borderColor: uiColor.primary },
  chipText: { color: uiColor.textSecondary, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: uiColor.primarySoft, fontWeight: "800" },

  primaryButton: {
    backgroundColor: uiColor.primary,
    borderRadius: uiRadius.md,
    paddingVertical: uiSpacing.md + 2,
    alignItems: "center",
    marginBottom: uiSpacing.md + 2,
  },
  primaryButtonHalf: {
    flex: 1,
    backgroundColor: uiColor.primary,
    borderRadius: uiRadius.md,
    paddingVertical: uiSpacing.md + 2,
    alignItems: "center",
  },
  primaryButtonText: { color: uiColor.primaryText, fontSize: 15, fontWeight: "800" },
  secondaryButtonHalf: {
    flex: 1,
    backgroundColor: uiColor.surface,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColor.border,
    paddingVertical: uiSpacing.md + 2,
    alignItems: "center",
  },
  secondaryButtonText: { color: uiColor.textSecondary, fontSize: 15, fontWeight: "800" },

  deleteButton: {
    marginTop: uiSpacing.lg + 2,
    backgroundColor: uiColor.danger + "1F",
    borderWidth: 1,
    borderColor: uiColor.danger + "38",
    borderRadius: uiRadius.md,
    paddingVertical: uiSpacing.md + 2,
    alignItems: "center",
  },
  deleteButtonText: { color: uiColor.danger, fontSize: 15, fontWeight: "800" },

  statusGrid: { gap: uiSpacing.sm + 2 },
  statusMiniCard: {
    backgroundColor: uiColor.background,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColor.border,
    padding: uiSpacing.md,
    marginTop: uiSpacing.sm + 2,
  },
  statusMiniLabel: {
    color: uiColor.textSecondary,
    fontSize: 12,
    marginBottom: 5,
    textTransform: "uppercase",
  },
  statusMiniValue: { color: uiColor.textPrimary, fontSize: 14, fontWeight: "700" },

  map: { width: "100%", height: 260, borderRadius: uiRadius.lg, marginTop: uiSpacing.md },
  mapInfo: { color: uiColor.textSecondary, fontSize: 12, marginTop: uiSpacing.sm + 2, lineHeight: 18 },

  statsRow: { flexDirection: "row", gap: uiSpacing.sm + 2, marginBottom: uiSpacing.md + 2 },
  statCard: {
    flex: 1,
    backgroundColor: uiColor.background,
    borderRadius: uiRadius.lg,
    borderWidth: 1,
    borderColor: uiColor.border,
    padding: uiSpacing.md + 2,
  },
  statLabel: { color: uiColor.textSecondary, fontSize: 12, marginBottom: uiSpacing.xs + 2 },
  statValue: { ...uiType.numericScore, color: uiColor.textPrimary, fontSize: 20 },

  periodeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  periodeInfo: { flex: 1 },

  periodGrid: { flexDirection: "row", gap: uiSpacing.sm },
  periodCell: {
    flex: 1,
    backgroundColor: uiColor.background,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColor.border,
    padding: uiSpacing.sm + 2,
  },
  periodCellLabel: {
    color: uiColor.textSecondary,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: uiSpacing.xs,
  },
  periodCellValue: { color: uiColor.textPrimary, fontSize: 12, fontWeight: "700" },

  barRad: { marginBottom: uiSpacing.md },
  barLeft: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: uiSpacing.xs + 2,
  },
  barDyr: { color: uiColor.textPrimary, fontSize: 14, fontWeight: "700" },
  barMeta: { color: uiColor.textSecondary, fontSize: 12 },
  barTrack: {
    height: 8,
    backgroundColor: uiColor.background,
    borderRadius: 4,
    overflow: "hidden",
  },
  barFyllSoft: { height: "100%", borderRadius: 4, backgroundColor: uiColor.info },

  summaryBox: {
    marginTop: uiSpacing.xl - 2,
    backgroundColor: uiColor.primary + "0F",
    borderWidth: 1,
    borderColor: uiColor.primary + "29",
    borderRadius: uiRadius.lg,
    padding: uiSpacing.md + 2,
  },
  summaryTitle: {
    color: uiColor.primarySoft,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: uiSpacing.sm,
  },
  summaryText: { color: uiColor.textSecondary, fontSize: 14, lineHeight: 21 },

  highlightBox: { backgroundColor: uiColor.background, borderRadius: uiRadius.md, padding: uiSpacing.md + 2 },
  highlightTitle: {
    color: uiColor.primarySoft,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: uiSpacing.sm,
  },
  highlightText: { color: uiColor.textPrimary, fontSize: 16, fontWeight: "800" },
  highlightSmall: { color: uiColor.textSecondary, fontSize: 13, marginTop: uiSpacing.xs },
  highlightComment: { color: uiColor.textSecondary, fontSize: 13, marginTop: uiSpacing.sm },

  subSectionTitle: {
    color: uiColor.textPrimary,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: uiSpacing.sm,
  },
  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: uiSpacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: uiColor.border,
  },
  listKey: { color: uiColor.textPrimary, fontSize: 14, fontWeight: "700" },
  listValue: { color: uiColor.textSecondary, fontSize: 14 },

  obsListe: { marginTop: uiSpacing.xs },
  obsTrailing: { flexDirection: "row", alignItems: "center", gap: uiSpacing.sm },
  deleteObsButton: { padding: uiSpacing.xs },

  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: uiSpacing.xl + 4,
  },
  emptyTitle: { color: uiColor.textPrimary, fontSize: 24, fontWeight: "800" },
  emptyText: {
    color: uiColor.textSecondary,
    fontSize: 14,
    marginTop: uiSpacing.sm,
    textAlign: "center",
  },
  emptyInfo: { color: uiColor.textSecondary, fontSize: 14, marginTop: uiSpacing.sm },

  modalTitle: { ...uiType.sectionTitle, color: uiColor.textPrimary, fontSize: 20, marginBottom: uiSpacing.sm },
});
