import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomDock from "../components/BottomDock";
import Surface from "../components/ui/Surface";
import { color as uiColor } from "../src/design/tokens";
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
                    style={[styles.chip, a && styles.chipActive]}>
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
                    style={[styles.chipAlt, a && styles.chipAltActive]}>
                    <Text style={[styles.chipText, a && styles.chipAltTextActive]}>
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
            <Ionicons name="shield-checkmark-outline" size={15} color={uiColor.primary} />
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

              <View style={styles.historikkListe}>
              {visteObs.length === 0 ? (
                <Text style={styles.historikkTom}>
                  {fane === "aktive" ? "Ingen aktive registreringer nå." : "Ingen eldre registreringer ennå."}
                </Text>
              ) : (
                visteObs.map((obs) => {
                  const erSiste = obs.id === sisteId;
                  const msDiff  = Date.now() - new Date(obs.tid).getTime();
                  const minDiff = Math.round(msDiff / 60000);
                  const tidTxt  = minDiff < 60
                    ? `${minDiff} min siden`
                    : minDiff < 1440
                    ? `${Math.round(minDiff / 60)}t siden`
                    : new Date(obs.tid).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });

                  return (
                    <View key={obs.id} style={[styles.historikkRad, erSiste && styles.historikkRadSiste]}>
                      <Text style={styles.historikkEmoji}>{dyrEmoji(obs.dyr)}</Text>
                      <View style={styles.historikkBody}>
                        <Text style={styles.historikkDyr}>
                          {obs.dyr}
                          <Text style={styles.historikkType}> · {obs.type}</Text>
                        </Text>
                        <Text style={styles.historikkTid}>{tidTxt}</Text>
                      </View>
                      {obs.retning != null && (
                        <Ionicons
                          name="navigate"
                          size={13}
                          color={uiColor.primary}
                          style={{ transform: [{ rotate: `${obs.retning}deg` }] }}
                        />
                      )}
                      <Pressable
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
                  );
                })
              )}
              </View>
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
      <Modal
        visible={visModal}
        transparent
        animationType="slide"
        onRequestClose={() => bekreftLagring(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => bekreftLagring(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>

            <View style={styles.modalHandle} />

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
                          color={pendingRetning != null ? uiColor.primary : "#2A3D30"}
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

          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Stiler ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: uiColor.background },
  screen: { flex: 1 },
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 160,
  },

  // Header
  header:   { paddingVertical: 22 },
  eyebrow: {
    color: uiColor.primary, fontSize: 11, fontWeight: "800",
    letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 10,
  },
  title:    { color: uiColor.textPrimary, fontSize: 34, fontWeight: "900", letterSpacing: -0.5 },
  subtitle: { color: uiColor.textMuted, fontSize: 14, marginTop: 6 },

  // Oppsummering
  summaryCard: {
    padding: 16, marginBottom: 28,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  summaryLeft:  { flexDirection: "row", alignItems: "center", gap: 14 },
  summaryEmoji: { fontSize: 38 },
  summaryTitle: { color: uiColor.textPrimary, fontSize: 18, fontWeight: "800" },
  summaryMeta:  { color: uiColor.textMuted, fontSize: 13, marginTop: 3 },
  readyBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(44,195,107,0.10)",
    borderRadius: 999, borderWidth: 1, borderColor: "rgba(44,195,107,0.22)",
    paddingHorizontal: 14, paddingVertical: 8,
  },
  readyDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: uiColor.primary,
  },
  readyText: { color: uiColor.primary, fontSize: 12, fontWeight: "900", letterSpacing: 0.5 },

  // Sections
  section:      { marginBottom: 24 },
  sectionLabel: {
    color: uiColor.textFaint, fontSize: 11, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.8, marginBottom: 12,
  },

  // Chips — dyr
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: {
    flex: 1, minWidth: "45%",
    backgroundColor: "#0A1510", borderWidth: 1, borderColor: "#192420",
    borderRadius: 14, paddingVertical: 16, paddingHorizontal: 12,
    alignItems: "center",
  },
  chipActive:     { backgroundColor: "#112A1A", borderColor: uiColor.primary },
  chipText:       { color: "#7A9A88", fontSize: 14, fontWeight: "700" },
  chipTextActive: { color: uiColor.primarySoft, fontWeight: "800" },

  // Chips — type
  chipAlt: {
    flex: 1, minWidth: "28%",
    backgroundColor: "#0E0F0C", borderWidth: 1, borderColor: "#222018",
    borderRadius: 14, paddingVertical: 16, alignItems: "center",
  },
  chipAltActive:     { backgroundColor: "#1E1A07", borderColor: "#7A5C10" },
  chipAltTextActive: { color: "#FDE68A", fontWeight: "800" },

  // Input
  input: {
    backgroundColor: "#090F0C",
    borderColor: "#172218", borderWidth: 1,
    borderRadius: 16, minHeight: 110,
    padding: 16, color: uiColor.textPrimary,
    textAlignVertical: "top", fontSize: 15, lineHeight: 24,
  },
  charCount: { color: "#2E4236", fontSize: 12, marginTop: 8, textAlign: "right" },

  // GPS-strip
  infoStrip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(44,195,107,0.05)",
    borderRadius: 12, borderWidth: 1, borderColor: "rgba(44,195,107,0.10)",
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 20,
  },
  infoStripText: { color: "#4D7A60", fontSize: 13, fontWeight: "600" },

  // Status
  statusBox:         { borderRadius: 16, padding: 14, marginBottom: 16, borderWidth: 1 },
  statusText:        { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  statusSuccess:     { backgroundColor: "rgba(34,197,94,0.08)",   borderColor: "rgba(34,197,94,0.16)"   },
  statusSuccessText: { color: "#86EFAC" },
  statusError:       { backgroundColor: "rgba(239,68,68,0.08)",   borderColor: "rgba(239,68,68,0.16)"   },
  statusErrorText:   { color: "#FCA5A5" },
  statusInfo:        { backgroundColor: "rgba(148,163,184,0.07)", borderColor: "rgba(148,163,184,0.14)" },
  statusInfoText:    { color: "#CBD5E1" },

  angreRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: "rgba(239,68,68,0.12)",
  },
  angreText: { color: uiColor.danger, fontSize: 13, fontWeight: "700" },

  // Lagre-knapp
  saveBtn: {
    backgroundColor: uiColor.primary,
    borderRadius: 18, paddingVertical: 18,
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 10, marginBottom: 14,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: uiColor.primaryText, fontSize: 16, fontWeight: "900", letterSpacing: 0.2 },

  // Historikk
  historikkHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, marginBottom: 4,
    borderTopWidth: 1, borderTopColor: "#111C14",
  },
  historikkHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  historikkHeaderTxt:  { color: uiColor.textPrimary, fontSize: 15, fontWeight: "800" },
  historikkBadge: {
    backgroundColor: "rgba(44,195,107,0.12)",
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 1, borderColor: "rgba(44,195,107,0.2)",
  },
  historikkBadgeTxt: { color: uiColor.primary, fontSize: 12, fontWeight: "900" },

  // Fane-velger (Aktive/Historikk)
  faneRad: {
    flexDirection: "row", gap: 8, marginBottom: 10,
    backgroundColor: "#090F0C", borderRadius: 12, padding: 4,
    borderWidth: 1, borderColor: "#172218",
  },
  faneBtn: { flex: 1, borderRadius: 9, paddingVertical: 9, alignItems: "center" },
  faneBtnActive: { backgroundColor: "#122E1C" },
  faneBtnTxt: { color: "#5A7A68", fontSize: 13, fontWeight: "700" },
  faneBtnTxtActive: { color: uiColor.primarySoft, fontWeight: "800" },
  faneForklaring: { color: uiColor.textFaint, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  historikkListe: {
    backgroundColor: "#090F0C", borderRadius: 18,
    borderWidth: 1, borderColor: "#172218",
    marginBottom: 20, overflow: "hidden",
  },
  historikkRad: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "#111C14",
  },
  historikkRadSiste: { backgroundColor: "rgba(44,195,107,0.06)" },
  historikkEmoji:    { fontSize: 20 },
  historikkBody:     { flex: 1 },
  historikkDyr:      { color: uiColor.textPrimary, fontSize: 14, fontWeight: "700" },
  historikkType:     { color: uiColor.textFaint, fontWeight: "600" },
  historikkTid:      { color: uiColor.textFaint, fontSize: 12, marginTop: 2 },
  historikkSlett: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(248,113,113,0.07)",
    alignItems: "center", justifyContent: "center",
  },
  historikkTom: { color: uiColor.textFaint, fontSize: 13, padding: 16, textAlign: "center" },

  // Lenker
  linksRow: { flexDirection: "row", gap: 10 },
  linkBtn: {
    flex: 1, backgroundColor: "#09120D",
    borderRadius: 16, paddingVertical: 15,
    alignItems: "center", flexDirection: "row",
    justifyContent: "center", gap: 7,
    borderWidth: 1, borderColor: "#182218",
  },
  linkBtnText: { color: "#7AB890", fontSize: 13, fontWeight: "800" },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#0C1610",
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    paddingHorizontal: 24, paddingBottom: 48, paddingTop: 14,
    borderWidth: 1, borderBottomWidth: 0, borderColor: "#1E3226",
  },
  modalHandle: {
    width: 44, height: 5, borderRadius: 3,
    backgroundColor: "#243B2C", alignSelf: "center", marginBottom: 22,
  },
  modalTitle: { color: uiColor.textPrimary, fontSize: 22, fontWeight: "900", marginBottom: 6 },
  modalSub:   { color: uiColor.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 26 },

  // Kompassrose
  compass:    { gap: 10, alignItems: "center", marginBottom: 14 },
  compassRow: { flexDirection: "row", gap: 10 },
  compassBtn: {
    width: 68, height: 68, borderRadius: 18,
    backgroundColor: "#0E1A12", borderWidth: 1, borderColor: "#1E3226",
    alignItems: "center", justifyContent: "center",
  },
  compassBtnActive: {
    backgroundColor: "#122E1C", borderColor: uiColor.primary,
    shadowColor: uiColor.primary, shadowOpacity: 0.22, shadowRadius: 10, elevation: 5,
  },
  compassBtnText:       { color: "#5A7A68", fontSize: 15, fontWeight: "900" },
  compassBtnTextActive: { color: uiColor.primary },
  compassCenter: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: "#091210", borderWidth: 1, borderColor: "#1A2B20",
    alignItems: "center", justifyContent: "center",
  },

  retningValgt: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16,
    backgroundColor: "rgba(44,195,107,0.07)",
    borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "rgba(44,195,107,0.15)",
  },
  retningValgtText: { color: uiColor.primarySoft, fontSize: 14, fontWeight: "600", flex: 1 },

  // Modal-knapper
  modalActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  skipBtn: {
    flex: 1, backgroundColor: "#0E1A12",
    borderRadius: 16, paddingVertical: 17, alignItems: "center",
    borderWidth: 1, borderColor: "#1E3226",
  },
  skipBtnText: { color: "#6B8A76", fontSize: 15, fontWeight: "800" },
  confirmBtn: {
    flex: 1.6, backgroundColor: uiColor.primary,
    borderRadius: 16, paddingVertical: 17,
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8,
  },
  confirmBtnText: { color: uiColor.primaryText, fontSize: 15, fontWeight: "900" },
});
