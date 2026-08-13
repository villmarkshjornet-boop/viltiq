import { Ionicons } from "@expo/vector-icons";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomDock from "../components/BottomDock";
import Surface from "../components/ui/Surface";
import EngineStatusPanel from "../components/ui/EngineStatusPanel";
import { color as uiColor, spacing as uiSpacing } from "../src/design/tokens";
import { subscribeToVisibleCameras } from "../src/services/cameras";
import { getAktivtJaktlagId } from "../src/services/jaktlag";
import {
  getUserPosition,
  syncUserLocation,
  type UserPosition,
} from "../src/services/location";
import {
  deleteObservation,
  drainOfflineQueue,
  subscribeToNearbyObservations,
} from "../src/services/observations";
import { getSettings } from "../src/services/settings";
import { hentVær, type VærData } from "../src/services/weather";
import type { Observasjon } from "../src/types/observation";
import { dyrEmoji, erAktivRegistrering, hentRelativTid } from "../src/lib/aktivitet";
import { vindRetningLabel } from "../src/lib/geo";
import { måneFase } from "../src/lib/maane";
import { visAlert } from "../src/lib/confirmAlert";
import {
  runEngine,
  PRIORITERTE_ARTER,
  type PredictionZone,
  type Species,
} from "../src/engine";

const NORSK_ART: Record<Species, string> = { hjort: "Hjort", radyr: "Rådyr", elg: "Elg", annet: "Annet" };

// ─── Komponent ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const [observasjoner, setObservasjoner] = useState<Observasjon[]>([]);
  const [laster,        setLaster]        = useState(true);
  const [feiltekst,     setFeiltekst]     = useState("");
  const [radiusKm,      setRadiusKm]      = useState<10 | 25 | 50>(50);
  const [kameraCount,   setKameraCount]   = useState(0);
  const [vær,           setVær]           = useState<VærData | null>(null);
  const måne = useMemo(() => måneFase(new Date()), []);

  useFocusEffect(
    useCallback(() => {
      let unsub: (() => void) | undefined;
      let aktiv = true;
      (async () => {
        const jaktlagId = await getAktivtJaktlagId();
        if (!aktiv) return;
        unsub = subscribeToVisibleCameras(jaktlagId, (kameraer) => {
          if (aktiv) setKameraCount(kameraer.filter((k) => k.active).length);
        });
      })();
      return () => { aktiv = false; unsub?.(); };
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      let unsub: (() => void) | undefined;
      let aktiv = true;
      (async () => {
        try {
          setLaster(true);
          setFeiltekst("");
          const settings = await getSettings();
          if (!aktiv) return;
          setRadiusKm(settings.radiusKm);
          const pos: UserPosition | null = await getUserPosition();
          if (!aktiv) return;
          if (!pos) {
            setFeiltekst("Fant ikke posisjonen din.");
            setLaster(false);
            return;
          }
          await syncUserLocation({ latitude: pos.latitude, longitude: pos.longitude });
          if (!aktiv) return;
          drainOfflineQueue().catch(() => {});
          hentVær(pos.latitude, pos.longitude).then((v) => { if (aktiv) setVær(v); }).catch(() => {});
          unsub = subscribeToNearbyObservations(
            { center: pos, radiusKm: settings.radiusKm },
            (liste) => {
              if (!aktiv) return;
              setObservasjoner(
                [...liste].sort((a, b) => new Date(b.tid).getTime() - new Date(a.tid).getTime())
              );
              setLaster(false);
            },
            (err) => {
              if (!aktiv) return;
              console.log("Firestore feil:", err);
              setFeiltekst("Klarte ikke hente observasjoner.");
              setLaster(false);
            }
          );
        } catch (e) {
          if (!aktiv) return;
          console.log("init-feil:", e);
          setFeiltekst("Noe gikk galt ved oppstart.");
          setLaster(false);
        }
      })();
      return () => { aktiv = false; unsub?.(); };
    }, [])
  );

  async function slettObs(obs: Observasjon) {
    visAlert(
      "Slette registreringen?",
      `${obs.dyr} · ${obs.type} fjernes fra Hjem, Logg, kartet og ViltIQs analysegrunnlag.`,
      [
        { text: "Avbryt", style: "cancel" },
        {
          text: "Slett",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteObservation(obs.id);
            } catch (e: any) {
              visAlert("Feil", e?.message || "Klarte ikke slette observasjonen.");
            }
          },
        },
      ]
    );
  }

  // ─── Beregnede verdier ────────────────────────────────────────────────────

  // Beste område nå (§1): ViltIQ Engine — samme motor som Kart og Jakt,
  // ingen egen vurdering regnet ut her. Ren, synkron observasjonsmotor
  // (ikke den økologiske varianten) — Hjem skal aldri vente på nettverk.
  const besteAnbefaling = useMemo(() => {
    let beste: { species: Species; zone: PredictionZone } | null = null;
    for (const species of PRIORITERTE_ARTER) {
      const resultat = runEngine(observasjoner, species);
      const sone = resultat.zones[0];
      if (sone && (!beste || sone.score > beste.zone.score)) {
        beste = { species, zone: sone };
      }
    }
    return beste;
  }, [observasjoner]);

  // Nylig relevant aktivitet (§1): kun registreringer som fortsatt har
  // praktisk verdi — samme delte terskel som Logg sin Aktive-fane bruker
  // (src/lib/aktivitet.ts, erAktivRegistrering) — IKKE en permanent
  // historikkliste.
  const relevantAktivitet = useMemo(
    () => observasjoner.filter((o) => erAktivRegistrering(o.tid)).slice(0, 5),
    [observasjoner]
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Topptittel ── */}
          <View style={styles.topRow}>
            <View>
              <Text style={styles.eyebrow}>ViltIQ</Text>
              <Text style={styles.pageTitle}>Hjem</Text>
            </View>
            <View style={styles.topRowActions}>
              <Link href="/innstillinger" asChild>
                <Pressable style={styles.settingsBtn} hitSlop={8}>
                  <Ionicons name="settings-outline" size={19} color="#A9B8AE" />
                </Pressable>
              </Link>
              <Link href="/logg" asChild>
                <Pressable style={styles.logBtn}>
                  <Ionicons name="add" size={18} color="#04110A" />
                  <Text style={styles.logBtnText}>Logg</Text>
                </Pressable>
              </Link>
            </View>
          </View>

          {/* ── Kompakt statuslinje (§1) — sekundær, ikke et eget kort ── */}
          <Text style={styles.statusLinje}>
            {vær ? `${vær.temperatur}°` : "—°"}
            {vær ? ` · ${vær.vindHastighet} m/s ${vindRetningLabel(vær.vindRetning)}` : ""}
            {` · ${måne.navn.toLowerCase()}`}
          </Text>

          {/* ── Loading / Feil ── */}
          {laster ? (
            <View style={styles.loadCard}>
              <ActivityIndicator size="large" color="#2CC36B" />
              <Text style={styles.loadTitle}>Laster feltdata...</Text>
              <Text style={styles.loadText}>Henter observasjoner innen {radiusKm} km.</Text>
            </View>
          ) : feiltekst ? (
            <View style={styles.errorCard}>
              <Ionicons name="warning-outline" size={20} color="#F87171" />
              <View style={{ flex: 1 }}>
                <Text style={styles.errorTitle}>Kunne ikke laste data</Text>
                <Text style={styles.errorText}>{feiltekst}</Text>
              </View>
            </View>
          ) : (
            <>
              {/* ── Beste område nå — hovedinnholdet på Hjem (§1) ── */}
              <Surface variant="elevated" style={styles.besteCard}>
                <Text style={styles.besteEyebrow}>Beste område nå</Text>
                {besteAnbefaling ? (
                  <>
                    <EngineStatusPanel zone={besteAnbefaling.zone} />
                    <Link
                      href={{
                        pathname: "/kart",
                        params: {
                          focusLat: String(besteAnbefaling.zone.center.latitude),
                          focusLng: String(besteAnbefaling.zone.center.longitude),
                          filter:   NORSK_ART[besteAnbefaling.species],
                          heatmap:  "1",
                        },
                      }}
                      asChild
                    >
                      <Pressable style={styles.besteBtn}>
                        <Ionicons name="map-outline" size={15} color={uiColor.primaryText} />
                        <Text style={styles.besteBtnText}>Vis i kart</Text>
                      </Pressable>
                    </Link>
                  </>
                ) : (
                  <Text style={styles.noDataText}>
                    Ingen tydelig vurdering ennå — legg inn observasjoner i Logg for å bygge opp datagrunnlaget.
                  </Text>
                )}
              </Surface>

              {/* ── Nylig relevant aktivitet (§1) — IKKE en permanent historikkliste ── */}
              <View style={styles.recentHeader}>
                <Text style={styles.recentTitle}>Nylig relevant aktivitet</Text>
                <Text style={styles.recentCount}>{relevantAktivitet.length} vist</Text>
              </View>

              {relevantAktivitet.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="binoculars-outline" size={28} color="#2A3D30" />
                  <Text style={styles.emptyTitle}>Ingen ny aktivitet</Text>
                  <Text style={styles.emptyText}>
                    Ingenting registrert de siste 48 timene ennå.
                  </Text>
                </View>
              ) : (
                relevantAktivitet.map((obs) => (
                  <View key={obs.id} style={styles.obsCard}>
                    <View style={styles.obsIconWrap}>
                      <Text style={styles.obsIcon}>{dyrEmoji(obs.dyr)}</Text>
                    </View>
                    <View style={styles.obsBody}>
                      <View style={styles.obsTopRow}>
                        <Text style={styles.obsAnimal}>{obs.dyr}</Text>
                        <Text style={styles.obsTime}>{hentRelativTid(obs.tid)}</Text>
                      </View>
                      <Text style={styles.obsMeta}>{obs.type}</Text>
                    </View>
                    <Pressable
                      onPress={() => slettObs(obs)}
                      style={styles.obsDeleteBtn}
                      hitSlop={12}
                    >
                      <Ionicons name="trash-outline" size={16} color="#2E4236" />
                    </Pressable>
                  </View>
                ))
              )}

              {/* ── Viltkamera — kompakt, sekundær rad ── */}
              <View style={styles.kameraCard}>
                <View style={styles.kameraLeft}>
                  <Ionicons name="camera-outline" size={16} color="#60A5FA" />
                  <Text style={styles.kameraTitle}>{kameraCount} aktive viltkamera</Text>
                </View>
                <Link href="/kart" asChild>
                  <Pressable style={styles.kameraBtn}>
                    <Text style={styles.kameraBtnText}>Se i kart</Text>
                    <Ionicons name="chevron-forward" size={13} color="#60A5FA" />
                  </Pressable>
                </Link>
              </View>
            </>
          )}
        </ScrollView>

        <BottomDock />
      </View>
    </SafeAreaView>
  );
}

// ─── Stiler ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: uiColor.background },
  screen: { flex: 1 },
  scroll: { paddingTop: 16, paddingHorizontal: 18, paddingBottom: 160 },

  // Topp
  topRow: {
    flexDirection: "row", alignItems: "flex-end",
    justifyContent: "space-between", marginBottom: uiSpacing.md,
  },
  eyebrow: {
    color: uiColor.primary, fontSize: 11, fontWeight: "800",
    letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 6,
  },
  pageTitle: { color: uiColor.textPrimary, fontSize: 30, fontWeight: "900", letterSpacing: -0.4 },
  topRowActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  settingsBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: uiColor.surface, borderWidth: 1, borderColor: uiColor.border,
  },
  logBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: uiColor.primary, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  logBtnText: { color: uiColor.primaryText, fontSize: 14, fontWeight: "900" },

  // Kompakt statuslinje — sekundær tekst, ikke et kort (§1)
  statusLinje: {
    color: uiColor.textMuted, fontSize: 13, fontWeight: "600",
    marginBottom: uiSpacing.xl,
  },

  // Loading / Error
  loadCard: {
    backgroundColor: uiColor.surface, borderRadius: 22,
    padding: 32, alignItems: "center", marginBottom: 16,
    borderWidth: 1, borderColor: uiColor.border,
  },
  loadTitle: { color: uiColor.textPrimary, fontSize: 17, fontWeight: "800", marginTop: 16 },
  loadText:  { color: uiColor.textMuted, fontSize: 14, marginTop: 6, textAlign: "center" },
  errorCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: "#160D0D", borderWidth: 1, borderColor: "#3B1A1A",
    borderRadius: 18, padding: 18, marginBottom: 16,
  },
  errorTitle: { color: "#FCA5A5", fontSize: 15, fontWeight: "800" },
  errorText:  { color: "#A07070", fontSize: 13, marginTop: 4, lineHeight: 20 },

  // Beste område nå
  besteCard: { padding: uiSpacing.xl, marginBottom: uiSpacing.lg },
  besteEyebrow: {
    color: uiColor.textMuted, fontSize: 11, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.2, marginBottom: uiSpacing.md,
  },
  besteBtn: {
    backgroundColor: uiColor.primary, borderRadius: 14,
    paddingVertical: 13, flexDirection: "row", marginTop: uiSpacing.lg,
    alignItems: "center", justifyContent: "center", gap: 8,
  },
  besteBtnText: { color: uiColor.primaryText, fontSize: 14, fontWeight: "900" },
  noDataText:   { color: uiColor.textMuted, fontSize: 14, lineHeight: 20 },

  // Nylig relevant aktivitet
  recentHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 12,
  },
  recentTitle: { color: uiColor.textPrimary, fontSize: 17, fontWeight: "900" },
  recentCount: { color: uiColor.textFaint, fontSize: 13, fontWeight: "600" },
  emptyCard: {
    backgroundColor: uiColor.surface, borderWidth: 1, borderColor: uiColor.border,
    borderRadius: 20, padding: 28, alignItems: "center", marginBottom: 12,
  },
  emptyTitle: { color: uiColor.textMuted, fontSize: 15, fontWeight: "800", marginTop: 12 },
  emptyText:  { color: uiColor.textFaint, fontSize: 13, marginTop: 6, textAlign: "center", lineHeight: 20 },

  obsCard: {
    backgroundColor: uiColor.surface, borderWidth: 1, borderColor: uiColor.border,
    borderRadius: 18, padding: 14, marginBottom: 8,
    flexDirection: "row", alignItems: "center", gap: 12,
  },
  obsIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#152019", alignItems: "center", justifyContent: "center",
  },
  obsIcon:    { fontSize: 20 },
  obsBody:    { flex: 1 },
  obsTopRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  obsAnimal:  { color: uiColor.textPrimary, fontSize: 15, fontWeight: "800" },
  obsTime:    { color: uiColor.textFaint, fontSize: 12, fontWeight: "600" },
  obsMeta:    { color: uiColor.textMuted, fontSize: 13 },
  obsDeleteBtn: { paddingLeft: 4, paddingTop: 2 },

  // Viltkamera — kompakt sekundær rad
  kameraCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 4, paddingVertical: 12, marginTop: 8,
  },
  kameraLeft:  { flexDirection: "row", alignItems: "center", gap: 8 },
  kameraTitle: { color: uiColor.textMuted, fontSize: 13, fontWeight: "700" },
  kameraBtn:   { flexDirection: "row", alignItems: "center", gap: 4 },
  kameraBtnText: { color: "#60A5FA", fontSize: 13, fontWeight: "800" },
});
