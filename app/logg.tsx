import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomDock from "../components/BottomDock";
import ListRow from "../components/ui/ListRow";
import ModalSheet from "../components/ui/ModalSheet";
import Surface from "../components/ui/Surface";
import {
  alpha,
  color as uiColor,
  radius as uiRadius,
  spacing as uiSpacing,
  typography as uiType,
} from "../src/design/tokens";
import {
  deleteObservation,
  saveObservation,
  subscribeToMyObservations,
} from "../src/services/observations";
import type { Observasjon } from "../src/types/observation";
import { anonymiserPosisjon } from "../src/lib/geo";
import { AKTIV_REGISTRERING_TERSKEL_TIMER, dyrEmoji, erAktivRegistrering } from "../src/lib/aktivitet";
import { visAlert } from "../src/lib/confirmAlert";

type Fane = "aktive" | "historikk";

const dyrListe = ["Rådyr", "Elg", "Hjort", "Rev"] as const;
const typeListe = ["Sett dyr", "Spor", "Kamera"] as const;

const retningListe = [
  { label: "NV", grader: 315 },
  { label: "N",  grader: 0   },
  { label: "NØ", grader: 45  },
  { label: "V",  grader: 270 },
  { label: "Ø",  grader: 90  },
  { label: "SV", grader: 225 },
  { label: "S",  grader: 180 },
  { label: "SØ", grader: 135 },
];

const kompassGrid: (typeof retningListe[0] | null)[][] = [
  [retningListe[0], retningListe[1], retningListe[2]],
  [retningListe[3], null,            retningListe[4]],
  [retningListe[5], retningListe[6], retningListe[7]],
];

type StatusTone = "success" | "info" | "error";

export default function LoggScreen() {
  const [valgtDyr,  setValgtDyr]  = useState<string>("Rådyr");
  const [valgtType, setValgtType] = useState<string>("Sett dyr");
  const [kommentar, setKommentar] = useState("");

  const [melding,    setMelding]    = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("info");
  const [lagrer,     setLagrer]     = useState(false);

  // Retnings­modal (vises ved lagring)
  const [visModal,       setVisModal]       = useState(false);
  const [pendingRetning, setPendingRetning] = useState<number | null>(null);

  // Angre­funksjon etter lagring
  const [sisteId,  setSisteId]  = useState<string | null>(null);
  const [visAngre, setVisAngre] = useState(false);

  // Mine registreringer — delt i Aktive/Historikk (STEG 5 §2), IKKE to
  // separate datasett. Samme underliggende liste, kun ulikt filtrert med
  // den delte relevansmodellen (src/lib/aktivitet.ts). Eldre registreringer
  // slettes ALDRI automatisk — de flytter seg bare til Historikk-fanen når
  // de ikke lenger er "aktive", og er fortsatt fullt tilgjengelige for både
  // visning her og for motorens beregninger.
  const [mineObs,      setMineObs]      = useState<Observasjon[]>([]);
  const [visHistorikk, setVisHistorikk] = useState(false);
  const [fane,         setFane]         = useState<Fane>("aktive");

  // Abonner på egne observasjoner
  useEffect(() => {
    const unsub = subscribeToMyObservations(setMineObs);
    return unsub;
  }, []);

  const aktiveObs = useMemo(() => mineObs.filter((o) => erAktivRegistrering(o.tid)), [mineObs]);
  const historiskeObs = useMemo(() => mineObs.filter((o) => !erAktivRegistrering(o.tid)), [mineObs]);
  const visteObs = fane === "aktive" ? aktiveObs : historiskeObs;

  // Trinn 1: trykk Lagre → åpne retningsmodal
  function tryLagre() {
    if (lagrer) return;
    setPendingRetning(null);
    setVisModal(true);
  }

  // Trinn 2: retning bekreftet (eller hoppet over) → faktisk lagring
  async function bekreftLagring(retning: number | null) {
    setVisModal(false);
    if (lagrer) return;
    try {
      setLagrer(true);
      setStatusTone("info");
      setMelding("Lagrer observasjon...");
      setVisAngre(false);

      const tid = new Date().toISOString();
      let latitude:  number | null = null;
      let longitude: number | null = null;
      let harGps = false;

      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status === "granted") {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const p = anonymiserPosisjon(loc.coords.latitude, loc.coords.longitude);
          latitude  = p.latitude;
          longitude = p.longitude;
          harGps    = true;
        }
      } catch {}

      const { id: firestoreId, offline } = await saveObservation({
        dyr: valgtDyr, type: valgtType,
        kommentar: kommentar.trim(),
        tid, latitude, longitude, retning,
      });

      if (!offline) setSisteId(firestoreId);
      setVisAngre(!offline);
      setStatusTone(offline ? "info" : "success");
      setMelding(
        offline
          ? "Lagret lokalt — synkes når du får dekning."
          : harGps ? "Lagret med anonymisert GPS." : "Lagret uten GPS."
      );
      setKommentar("");
    } catch (err: any) {
      setStatusTone("error");
      setMelding(`Feil: ${String(err?.message || err)}`);
    } finally {
      setLagrer(false);
    }
  }

  async function angreLagring() {
    if (!sisteId) return;
    try {
      await deleteObservation(sisteId);
      setVisAngre(false);
      setSisteId(null);
      setMelding("Observasjonen er slettet.");
      setStatusTone("info");
    } catch (err: any) {
      visAlert("Feil", err?.message || "Klarte ikke slette observasjonen.");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Header ── */}
          <View style={styles.header}>
            <Text style={styles.eyebrow}>ViltIQ</Text>
            <Text style={styles.title}>Logg observasjon</Text>
            <Text style={styles.subtitle}>Registrer det du ser i felt.</Text>
          </View>

          {/* ── Oppsummering ── */}
          <Surface variant="elevated" style={styles.summaryCard}>
            <View style={styles.summaryLeft}>
              <Text style={styles.summaryEmoji}>{dyrEmoji(valgtDyr)}</Text>
              <View>
                <Text style={styles.summaryTitle}>{valgtDyr}</Text>
                <Text style={styles.summaryMeta}>{valgtType}</Text>
              </View>
            </View>
            <View style={styles.readyBadge}>
              <View style={styles.readyDot} />
              <Text style={styles.readyText}>Klar</Text>
            </View>
          </Surface>

          {/* ── Velg dyr ── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Dyr</Text>
            <View style={styles.chipGrid}>
              {dyrListe.map((dyr) => {
                const a = valgtDyr === dyr;
                return (
                  <Pressable key={dyr} onPress={() => setValgtDyr(dyr)}
                    style={[styles.chip, styles.chipHalf, a && styles.chipActive]}>
                    <Text style={[styles.chipText, a && styles.chipTextActive]}>
                      {dyrEmoji(dyr)}{"  "}{dyr}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ── Type observasjon ── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Type</Text>
            <View style={styles.chipGrid}>
              {typeListe.map((type) => {
                const a = valgtType === type;
                return (
                  <Pressable key={type} onPress={() => setValgtType(type)}
                    style={[styles.chip, styles.chipThird, a && styles.chipActive]}>
                    <Text style={[styles.chipText, a && styles.chipTextActive]}>
                      {type}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ── Kommentar ── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Kommentar</Text>
            <TextInput
              value={kommentar}
              onChangeText={setKommentar}
              placeholder="Eks: 2 elg gikk nordover mot åkeren..."
              placeholderTextColor={uiColor.textFaint}
              multiline
              maxLength={240}
              style={styles.input}
            />
            <Text style={styles.charCount}>{kommentar.length}/240</Text>
          </View>

          {/* ── GPS-info ── */}
          <View style={styles.infoStrip}>
            <Ionicons name="shield-checkmark-outline" size={15} color={uiColor.textMuted} />
            <Text style={styles.infoStripText}>GPS anonymiseres automatisk ±200m</Text>
          </View>

          {/* ── Status / Angre ── */}
          {!!melding && (
            <View style={[
              styles.statusBox,
              statusTone === "success" && styles.statusSuccess,
              statusTone === "error"   && styles.statusError,
              statusTone === "info"    && styles.statusInfo,
            ]}>
              <Text style={[
                styles.statusText,
                statusTone === "success" && styles.statusSuccessText,
                statusTone === "error"   && styles.statusErrorText,
                statusTone === "info"    && styles.statusInfoText,
              ]}>
                {melding}
              </Text>
              {visAngre && sisteId && (
                <Pressable onPress={angreLagring} style={styles.angreRow}>
                  <Ionicons name="trash-outline" size={14} color={uiColor.danger} />
                  <Text style={styles.angreText}>Angre — slett observasjonen</Text>
                </Pressable>
              )}
            </View>
          )}

          {/* ── Lagre-knapp ── */}
          <Pressable
            onPress={tryLagre}
            disabled={lagrer}
            style={({ pressed }) => [
              styles.saveBtn,
              pressed && { opacity: 0.88 },
              lagrer && styles.saveBtnDisabled,
            ]}
          >
            <Ionicons name="checkmark-circle" size={20} color={uiColor.primaryText} />
            <Text style={styles.saveBtnText}>
              {lagrer ? "Lagrer..." : "Lagre observasjon"}
            </Text>
          </Pressable>

          {/* ── Mine registreringer: Aktive | Historikk (STEG 5 §2) ── */}
          <Pressable
            style={styles.historikkHeader}
            onPress={() => setVisHistorikk((v) => !v)}
          >
            <View style={styles.historikkHeaderLeft}>
              <Ionicons name="time-outline" size={16} color={uiColor.primary} />
              <Text style={styles.historikkHeaderTxt}>Mine registreringer</Text>
              <View style={styles.historikkBadge}>
                <Text style={styles.historikkBadgeTxt}>{mineObs.length}</Text>
              </View>
            </View>
            <Ionicons
              name={visHistorikk ? "chevron-up" : "chevron-down"}
              size={16}
              color={uiColor.textFaint}
            />
          </Pressable>

          {visHistorikk && (
            <>
              {/* Fane-velger */}
              <View style={styles.faneRad}>
                <Pressable
                  style={[styles.faneBtn, fane === "aktive" && styles.faneBtnActive]}
                  onPress={() => setFane("aktive")}
                >
                  <Text style={[styles.faneBtnTxt, fane === "aktive" && styles.faneBtnTxtActive]}>
                    Aktive ({aktiveObs.length})
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.faneBtn, fane === "historikk" && styles.faneBtnActive]}
                  onPress={() => setFane("historikk")}
                >
                  <Text style={[styles.faneBtnTxt, fane === "historikk" && styles.faneBtnTxtActive]}>
                    Historikk ({historiskeObs.length})
                  </Text>
                </Pressable>
              </View>
              {fane === "aktive" && (
                <Text style={styles.faneForklaring}>
                  Registreringer fra de siste {AKTIV_REGISTRERING_TERSKEL_TIMER} timene — fortsatt praktisk relevante nå.
                </Text>
              )}

              {visteObs.length === 0 ? (
                <Surface style={styles.historikkTomKort}>
                  <Text style={styles.historikkTom}>
                    {fane === "aktive" ? "Ingen aktive registreringer nå." : "Ingen eldre registreringer ennå."}
                  </Text>
                </Surface>
              ) : (
                <Surface style={styles.historikkListe}>
                  {visteObs.map((obs, i) => {
                    const erSiste = obs.id === sisteId;
                    const msDiff  = Date.now() - new Date(obs.tid).getTime();
                    const minDiff = Math.round(msDiff / 60000);
                    const tidTxt  = minDiff < 60
                      ? `${minDiff} min siden`
                      : minDiff < 1440
                      ? `${Math.round(minDiff / 60)}t siden`
                      : new Date(obs.tid).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });

                    return (
                      <ListRow
                        key={obs.id}
                        emoji={dyrEmoji(obs.dyr)}
                        title={obs.dyr}
                        subtitle={obs.type}
                        meta={tidTxt}
                        highlighted={erSiste}
                        divider={i < visteObs.length - 1}
                        trailing={
                          <View style={styles.radTrailing}>
                            {obs.retning != null && (
                              <Ionicons
                                name="navigate"
                                size={13}
                                color={uiColor.primary}
                                style={{ transform: [{ rotate: `${obs.retning}deg` }] }}
                              />
                            )}
                            <Pressable
                              hitSlop={4}
                              onPress={() =>
                                visAlert(
                                  "Slett observasjon",
                                  `Slett ${obs.dyr} · ${obs.type}?`,
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
                                )
                              }
                              style={styles.historikkSlett}
                            >
                              <Ionicons name="trash-outline" size={14} color={uiColor.textMuted} />
                            </Pressable>
                          </View>
                        }
                      />
                    );
                  })}
                </Surface>
              )}
            </>
          )}

          {/* ── Hurtiglenker ── */}
          <View style={styles.linksRow}>
            <Link href="/kart" asChild>
              <Pressable style={styles.linkBtn}>
                <Ionicons name="map-outline" size={15} color={uiColor.primarySoft} />
                <Text style={styles.linkBtnText}>Dyrekart</Text>
              </Pressable>
            </Link>
            <Link href="/statistikk" asChild>
              <Pressable style={styles.linkBtn}>
                <Ionicons name="stats-chart-outline" size={15} color={uiColor.primarySoft} />
                <Text style={styles.linkBtnText}>Statistikk</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>

        <BottomDock />
      </View>

      {/* ── Retnings­modal ── */}
      <ModalSheet visible={visModal} onClose={() => bekreftLagring(null)}>
        <Text style={styles.modalTitle}>Hvilken retning gikk dyret?</Text>
        <Text style={styles.modalSub}>
          Valgfritt — hjelper med å beregne sannsynlig posisjon i kart
        </Text>

        {/* Kompassrose */}
        <View style={styles.compass}>
          {kompassGrid.map((rad, ri) => (
            <View key={ri} style={styles.compassRow}>
              {rad.map((dir, di) =>
                dir === null ? (
                  <View key={di} style={styles.compassCenter}>
                    <Ionicons
                      name="compass-outline" size={26}
                      color={pendingRetning != null ? uiColor.primary : uiColor.border}
                    />
                  </View>
                ) : (
                  <Pressable
                    key={di}
                    onPress={() =>
                      setPendingRetning((p) => (p === dir.grader ? null : dir.grader))
                    }
                    style={[
                      styles.compassBtn,
                      pendingRetning === dir.grader && styles.compassBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.compassBtnText,
                        pendingRetning === dir.grader && styles.compassBtnTextActive,
                      ]}
                    >
                      {dir.label}
                    </Text>
                  </Pressable>
                )
              )}
            </View>
          ))}
        </View>

        {pendingRetning != null && (
          <View style={styles.retningValgt}>
            <Ionicons name="navigate" size={13} color={uiColor.primary} />
            <Text style={styles.retningValgtText}>
              {retningListe.find((r) => r.grader === pendingRetning)?.label}{" "}
              ({pendingRetning}°) valgt
            </Text>
            <Pressable onPress={() => setPendingRetning(null)}>
              <Ionicons name="close-circle" size={17} color={uiColor.textFaint} />
            </Pressable>
          </View>
        )}

        <View style={styles.modalActions}>
          <Pressable onPress={() => bekreftLagring(null)} style={styles.skipBtn}>
            <Text style={styles.skipBtnText}>Hopp over</Text>
          </Pressable>
          <Pressable onPress={() => bekreftLagring(pendingRetning)} style={styles.confirmBtn}>
            <Ionicons name="checkmark" size={18} color={uiColor.primaryText} />
            <Text style={styles.confirmBtnText}>Lagre</Text>
          </Pressable>
        </View>
      </ModalSheet>
    </SafeAreaView>
  );
}

// ─── Stiler ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: uiColor.background },
  screen: { flex: 1 },
  container: {
    paddingHorizontal: uiSpacing.xl,
    paddingTop: uiSpacing.sm,
    paddingBottom: 160,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },

  // Header
  header:   { paddingVertical: uiSpacing.xxl - 6 },
  eyebrow:  { ...uiType.eyebrow, color: uiColor.primary, marginBottom: uiSpacing.sm + 2 },
  title:    { ...uiType.display, color: uiColor.textPrimary },
  subtitle: { ...uiType.body, color: uiColor.textMuted, marginTop: 6 },

  // Oppsummering
  summaryCard: {
    padding: uiSpacing.lg, marginBottom: uiSpacing.xxl,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  summaryLeft:  { flexDirection: "row", alignItems: "center", gap: uiSpacing.md + 2 },
  summaryEmoji: { fontSize: 38 },
  summaryTitle: { ...uiType.sectionTitle, color: uiColor.textPrimary },
  summaryMeta:  { ...uiType.metadata, color: uiColor.textMuted, marginTop: 3 },
  readyBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: uiColor.primary + alpha.soft,
    borderRadius: uiRadius.pill, borderWidth: 1, borderColor: uiColor.primary + alpha.medium,
    paddingHorizontal: uiSpacing.md + 2, paddingVertical: uiSpacing.sm,
  },
  readyDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: uiColor.primary,
  },
  readyText: { ...uiType.caption, color: uiColor.primary },

  // Sections
  section:      { marginBottom: uiSpacing.xxl - 4 },
  sectionLabel: { ...uiType.eyebrow, color: uiColor.textFaint, marginBottom: uiSpacing.md },

  // Chips — én visuell språk for både Dyr og Type (Redesign-oppdraget §5:
  // to helt ulike aktiv-farger — grønn og gull — for samme UI-mønster var
  // inkonsekvent og brøt regelen om at grønn er forbeholdt merkevare/handling).
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: uiSpacing.sm + 2 },
  chip: {
    backgroundColor: uiColor.surface, borderWidth: 1, borderColor: uiColor.border,
    borderRadius: uiRadius.md, paddingVertical: uiSpacing.lg, paddingHorizontal: uiSpacing.md,
    alignItems: "center",
  },
  chipHalf:  { flex: 1, minWidth: "45%" },
  chipThird: { flex: 1, minWidth: "28%" },
  chipActive:     { backgroundColor: uiColor.surfaceHover, borderColor: uiColor.primary },
  chipText:       { ...uiType.bodyStrong, color: uiColor.textSecondary },
  chipTextActive: { color: uiColor.primarySoft },

  // Input
  input: {
    backgroundColor: uiColor.surface,
    borderColor: uiColor.border, borderWidth: 1,
    borderRadius: uiRadius.lg, minHeight: 110,
    padding: uiSpacing.lg, color: uiColor.textPrimary,
    textAlignVertical: "top", fontSize: 15, lineHeight: 24,
  },
  charCount: { ...uiType.caption, color: uiColor.textFaint, marginTop: uiSpacing.sm, textAlign: "right" },

  // GPS-strip
  infoStrip: {
    flexDirection: "row", alignItems: "center", gap: uiSpacing.sm,
    backgroundColor: uiColor.surface,
    borderRadius: uiRadius.md, borderWidth: 1, borderColor: uiColor.border,
    paddingHorizontal: uiSpacing.md + 2, paddingVertical: uiSpacing.sm + 3, marginBottom: uiSpacing.xl,
  },
  infoStripText: { ...uiType.caption, color: uiColor.textMuted },

  // Status
  statusBox:         { borderRadius: uiRadius.md, padding: uiSpacing.md + 2, marginBottom: uiSpacing.lg, borderWidth: 1 },
  statusText:        { ...uiType.body },
  statusSuccess:     { backgroundColor: uiColor.success + alpha.soft, borderColor: uiColor.success + alpha.medium },
  statusSuccessText: { color: uiColor.success },
  statusError:       { backgroundColor: uiColor.danger + alpha.soft, borderColor: uiColor.danger + alpha.medium },
  statusErrorText:   { color: uiColor.danger },
  statusInfo:        { backgroundColor: uiColor.textSecondary + alpha.soft, borderColor: uiColor.textSecondary + alpha.medium },
  statusInfoText:    { color: uiColor.textSecondary },

  angreRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: uiSpacing.sm + 2, paddingTop: uiSpacing.sm + 2,
    borderTopWidth: 1, borderTopColor: uiColor.danger + alpha.soft,
  },
  angreText: { color: uiColor.danger, fontSize: 13, fontWeight: "700" },

  // Lagre-knapp
  saveBtn: {
    backgroundColor: uiColor.primary,
    borderRadius: uiRadius.xl - 4, paddingVertical: uiSpacing.lg + 2,
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: uiSpacing.sm + 2, marginBottom: uiSpacing.md + 2,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: uiColor.primaryText, fontSize: 16, fontWeight: "900", letterSpacing: 0.2 },

  // Historikk
  historikkHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: uiSpacing.md + 2, marginBottom: uiSpacing.xs,
    borderTopWidth: 1, borderTopColor: uiColor.border,
  },
  historikkHeaderLeft: { flexDirection: "row", alignItems: "center", gap: uiSpacing.sm + 2 },
  historikkHeaderTxt:  { ...uiType.bodyStrong, color: uiColor.textPrimary, fontSize: 15 },
  historikkBadge: {
    backgroundColor: uiColor.primary + alpha.soft,
    borderRadius: uiRadius.pill, paddingHorizontal: uiSpacing.sm, paddingVertical: 2,
    borderWidth: 1, borderColor: uiColor.primary + alpha.medium,
  },
  historikkBadgeTxt: { color: uiColor.primary, fontSize: 12, fontWeight: "900" },

  // Fane-velger (Aktive/Historikk)
  faneRad: {
    flexDirection: "row", gap: uiSpacing.sm, marginBottom: uiSpacing.sm + 2,
    backgroundColor: uiColor.surface, borderRadius: uiRadius.md,
    padding: 4, borderWidth: 1, borderColor: uiColor.border,
  },
  faneBtn: { flex: 1, borderRadius: uiRadius.sm - 1, paddingVertical: uiSpacing.sm + 1, alignItems: "center" },
  faneBtnActive: { backgroundColor: uiColor.surfaceHover },
  faneBtnTxt: { color: uiColor.textMuted, fontSize: 13, fontWeight: "700" },
  faneBtnTxtActive: { color: uiColor.primarySoft, fontWeight: "800" },
  faneForklaring: { ...uiType.caption, color: uiColor.textFaint, marginBottom: uiSpacing.sm + 2, lineHeight: 17 },

  historikkListe: {
    paddingHorizontal: uiSpacing.md + 2,
    marginBottom: uiSpacing.xl,
  },
  historikkTomKort: {
    padding: uiSpacing.lg, marginBottom: uiSpacing.xl, alignItems: "center",
  },
  historikkTom: { color: uiColor.textFaint, fontSize: 13, textAlign: "center" },
  radTrailing: { flexDirection: "row", alignItems: "center", gap: uiSpacing.sm },
  historikkSlett: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: uiColor.danger + alpha.soft,
    alignItems: "center", justifyContent: "center",
  },

  // Lenker
  linksRow: { flexDirection: "row", gap: uiSpacing.sm + 2 },
  linkBtn: {
    flex: 1, backgroundColor: uiColor.surface,
    borderRadius: uiRadius.lg, paddingVertical: uiSpacing.md + 3,
    alignItems: "center", flexDirection: "row",
    justifyContent: "center", gap: 7,
    borderWidth: 1, borderColor: uiColor.border,
  },
  linkBtnText: { color: uiColor.primarySoft, fontSize: 13, fontWeight: "800" },

  // Retningsmodal-innhold
  modalTitle: { color: uiColor.textPrimary, fontSize: 22, fontWeight: "900", marginBottom: 6 },
  modalSub:   { color: uiColor.textMuted, fontSize: 14, lineHeight: 20, marginBottom: uiSpacing.xxl - 2 },

  // Kompassrose
  compass:    { gap: uiSpacing.sm + 2, alignItems: "center", marginBottom: uiSpacing.md + 2 },
  compassRow: { flexDirection: "row", gap: uiSpacing.sm + 2 },
  compassBtn: {
    width: 68, height: 68, borderRadius: uiRadius.lg,
    backgroundColor: uiColor.surface, borderWidth: 1, borderColor: uiColor.border,
    alignItems: "center", justifyContent: "center",
  },
  compassBtnActive: {
    backgroundColor: uiColor.surfaceHover, borderColor: uiColor.primary,
  },
  compassBtnText:       { color: uiColor.textMuted, fontSize: 15, fontWeight: "900" },
  compassBtnTextActive: { color: uiColor.primary },
  compassCenter: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: uiColor.background, borderWidth: 1, borderColor: uiColor.border,
    alignItems: "center", justifyContent: "center",
  },

  retningValgt: {
    flexDirection: "row", alignItems: "center", gap: uiSpacing.sm, marginBottom: uiSpacing.lg,
    backgroundColor: uiColor.primary + alpha.soft,
    borderRadius: uiRadius.md, padding: uiSpacing.md,
    borderWidth: 1, borderColor: uiColor.primary + alpha.medium,
  },
  retningValgtText: { color: uiColor.primarySoft, fontSize: 14, fontWeight: "600", flex: 1 },

  // Modal-knapper
  modalActions: { flexDirection: "row", gap: uiSpacing.md, marginTop: uiSpacing.xs },
  skipBtn: {
    flex: 1, backgroundColor: uiColor.surface,
    borderRadius: uiRadius.md, paddingVertical: uiSpacing.lg + 1, alignItems: "center",
    borderWidth: 1, borderColor: uiColor.border,
  },
  skipBtnText: { color: uiColor.textMuted, fontSize: 15, fontWeight: "800" },
  confirmBtn: {
    flex: 1.6, backgroundColor: uiColor.primary,
    borderRadius: uiRadius.md, paddingVertical: uiSpacing.lg + 1,
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: uiSpacing.sm,
  },
  confirmBtnText: { color: uiColor.primaryText, fontSize: 15, fontWeight: "900" },
});
