import { Ionicons } from "@expo/vector-icons";
import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
import BottomDock from "../components/BottomDock";
import Surface from "../components/ui/Surface";
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
import {
  dyrEmoji,
  hentNivå,
  hentRelativTid,
  hentTidsvekt,
  hentTimerSiden,
  nivåFarge,
} from "../src/lib/aktivitet";
import { movePoint, vindRetningLabel } from "../src/lib/geo";
import { måneFase } from "../src/lib/maane";

// ─── Sesong ───────────────────────────────────────────────────────────────────

const SESONGER: Record<string, Array<{ fraM: number; fraD: number; tilM: number; tilD: number }>> = {
  Rådyr:  [{ fraM: 8,  fraD: 10, tilM: 9,  tilD: 23 }, { fraM: 10, fraD: 1, tilM: 1, tilD: 31 }],
  Elg:    [{ fraM: 10, fraD: 1,  tilM: 11, tilD: 30 }],
  Hjort:  [{ fraM: 9,  fraD: 1,  tilM: 2,  tilD: 15 }],
  Rev:    [{ fraM: 10, fraD: 1,  tilM: 3,  tilD: 15 }],
};

function åpneSesonger(dato: Date): string[] {
  const år  = dato.getFullYear();
  const now = dato.getTime();
  return Object.entries(SESONGER).flatMap(([dyr, sesonger]) =>
    sesonger.some((s) => {
      const tilÅr = s.tilM < s.fraM ? år + 1 : år;
      const fra   = new Date(år, s.fraM - 1, s.fraD).getTime();
      const til   = new Date(tilÅr, s.tilM - 1, s.tilD, 23, 59).getTime();
      return now >= fra && now <= til;
    }) ? [dyr] : []
  );
}

const dyrListe   = ["Alle", "Rådyr", "Elg", "Hjort", "Rev"];
const dyrGruppe  = ["Rådyr", "Elg", "Hjort", "Rev"] as const;

// ─── Hjelpefunksjoner ─────────────────────────────────────────────────────────

type Sone = { latitude: number; longitude: number; score: number; count: number };

function leggTilSone(soner: Sone[], lat: number, lng: number, vekt: number, terskel = 0.003) {
  const ex = soner.find(
    (s) => Math.abs(s.latitude - lat) < terskel && Math.abs(s.longitude - lng) < terskel
  );
  if (ex) {
    const n = ex.count + 1;
    ex.latitude  = (ex.latitude  * ex.count + lat) / n;
    ex.longitude = (ex.longitude * ex.count + lng) / n;
    ex.count  = n;
    ex.score += vekt;
  } else {
    soner.push({ latitude: lat, longitude: lng, count: 1, score: vekt });
  }
}

function byggVarmesoner(data: Observasjon[]): Sone[] {
  const soner: Sone[] = [];
  for (const obs of data) {
    if (obs.latitude == null || obs.longitude == null) continue;
    const vekt = hentTidsvekt(obs.tid);
    leggTilSone(soner, obs.latitude, obs.longitude, vekt);
    if (obs.retning != null) {
      const pred = movePoint(obs.latitude, obs.longitude, obs.retning, 250);
      leggTilSone(soner, pred.latitude, pred.longitude, vekt * 0.6);
    }
  }
  return soner.sort((a, b) => b.score - a.score);
}

// ─── Komponent ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const [observasjoner, setObservasjoner] = useState<Observasjon[]>([]);
  const [aktivtFilter,  setAktivtFilter]  = useState("Alle");
  const [laster,        setLaster]        = useState(true);
  const [feiltekst,     setFeiltekst]     = useState("");
  const [radiusKm,      setRadiusKm]      = useState<10 | 25 | 50>(50);
  const [kameraCount,   setKameraCount]   = useState(0);
  const [vær,           setVær]           = useState<VærData | null>(null);
  const måne = useMemo(() => måneFase(new Date()), []);
  const åpne = useMemo(() => åpneSesonger(new Date()), []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const jaktlagId = await getAktivtJaktlagId();
      unsub = subscribeToVisibleCameras(jaktlagId, (kameraer) => {
        setKameraCount(kameraer.filter((k) => k.active).length);
      });
    })();
    return () => unsub?.();
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        setLaster(true);
        setFeiltekst("");
        const settings = await getSettings();
        setRadiusKm(settings.radiusKm);
        const pos: UserPosition | null = await getUserPosition();
        if (!pos) {
          setFeiltekst("Fant ikke posisjonen din.");
          setLaster(false);
          return;
        }
        await syncUserLocation({ latitude: pos.latitude, longitude: pos.longitude });
        drainOfflineQueue().catch(() => {});
        hentVær(pos.latitude, pos.longitude).then((v) => setVær(v)).catch(() => {});
        unsub = subscribeToNearbyObservations(
          { center: pos, radiusKm: settings.radiusKm },
          (liste) => {
            setObservasjoner(
              [...liste].sort((a, b) => new Date(b.tid).getTime() - new Date(a.tid).getTime())
            );
            setLaster(false);
          },
          (err) => {
            console.log("Firestore feil:", err);
            setFeiltekst("Klarte ikke hente observasjoner.");
            setLaster(false);
          }
        );
      } catch (e) {
        console.log("init-feil:", e);
        setFeiltekst("Noe gikk galt ved oppstart.");
        setLaster(false);
      }
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  async function slettObs(obs: Observasjon) {
    Alert.alert(
      "Slett observasjon",
      `Slett ${obs.dyr} — ${obs.type}?`,
      [
        { text: "Avbryt", style: "cancel" },
        {
          text: "Slett",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteObservation(obs.id);
              setObservasjoner((prev) => prev.filter((o) => o.id !== obs.id));
            } catch (e: any) {
              Alert.alert("Feil", e?.message || "Klarte ikke slette observasjonen.");
            }
          },
        },
      ]
    );
  }

  // ─── Beregnede verdier ────────────────────────────────────────────────────

  const filtrerteObs = useMemo(() => {
    if (aktivtFilter === "Alle") return observasjoner;
    return observasjoner.filter((o) => o.dyr === aktivtFilter);
  }, [observasjoner, aktivtFilter]);

  const siste24t  = useMemo(
    () => filtrerteObs.filter((o) => hentTimerSiden(o.tid) <= 24),
    [filtrerteObs]
  );
  const forrige24t = useMemo(
    () => filtrerteObs.filter((o) => { const t = hentTimerSiden(o.tid); return t > 24 && t <= 48; }),
    [filtrerteObs]
  );

  const trend = useMemo(() => {
    if (siste24t.length > forrige24t.length) return "Økende";
    if (siste24t.length < forrige24t.length) return "Synkende";
    return "Stabil";
  }, [siste24t, forrige24t]);

  const aktivitetData = useMemo(() => {
    const score = filtrerteObs.reduce((s, o) => s + hentTidsvekt(o.tid), 0);
    const nivå  = hentNivå(score);
    const beskrivelseMap: Record<string, string> = {
      Høy:    "Høy aktivitet registrert. Gode tegn på bevegelse i området ditt.",
      Medium: "Jevn aktivitet. Start med sterkeste område og følg bevegelsene.",
      Lav:    "Lav aktivitet akkurat nå. Bygg opp datagrunnlaget med flere observasjoner.",
    };
    return { score, nivå, beskrivelse: beskrivelseMap[nivå] };
  }, [filtrerteObs]);

  const mostActiveDyr = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of siste24t) counts[o.dyr] = (counts[o.dyr] || 0) + 1;
    let max = 0, best = "Ingen";
    for (const [dyr, cnt] of Object.entries(counts)) {
      if (cnt > max) { max = cnt; best = dyr; }
    }
    return best;
  }, [siste24t]);

  const besteOmråde = useMemo(() => {
    const medGps = filtrerteObs.filter((o) => o.latitude != null && o.longitude != null);
    if (!medGps.length) return null;
    const soner = byggVarmesoner(medGps);
    if (!soner.length) return null;
    return { ...soner[0], aktivitet: hentNivå(soner[0].score) };
  }, [filtrerteObs]);

  const dyrAktivitet = useMemo(
    () =>
      dyrGruppe.map((dyr) => {
        const obs   = observasjoner.filter((o) => o.dyr === dyr);
        const score = obs.reduce((s, o) => s + hentTidsvekt(o.tid), 0);
        return { dyr, nivå: hentNivå(score) };
      }),
    [observasjoner]
  );

  const sisteObs = useMemo(() => filtrerteObs.slice(0, 6), [filtrerteObs]);

  const heroColor =
    aktivitetData.nivå === "Høy"    ? "#F97316" :
    aktivitetData.nivå === "Medium" ? "#EAB308" : "#2CC36B";

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
              <Text style={styles.pageTitle}>Oversikt</Text>
            </View>
            <Link href="/logg" asChild>
              <Pressable style={styles.logBtn}>
                <Ionicons name="add" size={18} color="#04110A" />
                <Text style={styles.logBtnText}>Logg</Text>
              </Pressable>
            </Link>
          </View>

          {/* ── Filter-chips ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
            style={styles.filterWrap}
          >
            {dyrListe.map((dyr) => {
              const active = aktivtFilter === dyr;
              return (
                <Pressable
                  key={dyr}
                  onPress={() => setAktivtFilter(dyr)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {dyr !== "Alle" ? dyrEmoji(dyr) + "  " : ""}{dyr}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* ── Miljø: Vær + Måne + Sesonger — ÉN gruppert overflate i stedet for tre separate kort (§15) ── */}
          <Surface style={styles.miljøRad}>
            <View style={styles.miljøKort}>
              <Text style={styles.miljøEmoji}>{vær?.emoji ?? "🌡"}</Text>
              <Text style={styles.miljøVerdi}>{vær ? `${vær.temperatur}°` : "—"}</Text>
              <Text style={styles.miljøSub}>{vær ? `${vær.vindHastighet} m/s ${vindRetningLabel(vær.vindRetning)}` : "Henter vær..."}</Text>
            </View>
            <View style={styles.miljøDivider} />
            <View style={styles.miljøKort}>
              <Text style={styles.miljøEmoji}>{måne.emoji}</Text>
              <Text style={styles.miljøVerdi}>{måne.belysning}%</Text>
              <Text style={styles.miljøSub}>{måne.navn}</Text>
            </View>
            <View style={styles.miljøDivider} />
            <View style={styles.miljøKort}>
              <Text style={styles.miljøEmoji}>🏹</Text>
              <Text style={styles.miljøVerdi}>{åpne.length}</Text>
              <Text style={styles.miljøSub} numberOfLines={1}>
                {åpne.length === 0 ? "Ingen åpne" : åpne.join(", ")}
              </Text>
            </View>
          </Surface>

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
              {/* ── Hero: Dagens aktivitet — nivå, nøkkeltall og forklaring i ÉTT kort (§4/§15) ── */}
              <View style={styles.heroCard}>
                <View style={[styles.heroAccent, { backgroundColor: heroColor + "22" }]} />
                <View style={[styles.heroAccentDot, { backgroundColor: heroColor }]} />
                <View style={styles.heroContent}>
                  <Text style={styles.heroEyebrow}>Dagens aktivitet</Text>
                  <Text style={[styles.heroValue, { color: heroColor }]}>
                    {aktivitetData.nivå}
                  </Text>
                  <Text style={styles.heroDesc}>{aktivitetData.beskrivelse}</Text>

                  <View style={styles.heroStatsRow}>
                    <View style={styles.heroStat}>
                      <Text style={styles.statLabel}>Siste 24t</Text>
                      <Text style={styles.statValue}>{siste24t.length} obs</Text>
                    </View>
                    <View style={styles.heroStatDivider} />
                    <View style={styles.heroStat}>
                      <Text style={styles.statLabel}>Mest aktiv</Text>
                      <Text style={[styles.statValue, styles.statValueSm]}>{mostActiveDyr}</Text>
                    </View>
                    <View style={styles.heroStatDivider} />
                    <View style={styles.heroStat}>
                      <Text style={styles.statLabel}>Trend</Text>
                      <Text style={[
                        styles.statValue, styles.statValueSm,
                        trend === "Økende"   ? styles.trendUp   :
                        trend === "Synkende" ? styles.trendDown : styles.trendNeutral,
                      ]}>
                        {trend === "Økende" ? "↑ " : trend === "Synkende" ? "↓ " : ""}{trend}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* ── Beste område nå ── */}
              <View style={styles.besteCard}>
                <View style={styles.besteHeader}>
                  <Text style={styles.besteTitle}>Beste område nå</Text>
                  {besteOmråde && (
                    <View style={[styles.besteBadge, { backgroundColor: nivåFarge(besteOmråde.aktivitet) + "20" }]}>
                      <Text style={[styles.besteBadgeText, { color: nivåFarge(besteOmråde.aktivitet) }]}>
                        {besteOmråde.aktivitet}
                      </Text>
                    </View>
                  )}
                </View>

                {besteOmråde ? (
                  <>
                    <View style={styles.besteMeta}>
                      <Text style={styles.besteEmoji}>🦌</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.besteAkt}>{besteOmråde.aktivitet} aktivitet</Text>
                        <Text style={styles.besteInfo}>
                          Score {besteOmråde.score} · {besteOmråde.count} observasjoner
                        </Text>
                      </View>
                    </View>
                    <Link
                      href={{
                        pathname: "/kart",
                        params: {
                          focusLat: String(besteOmråde.latitude),
                          focusLng: String(besteOmråde.longitude),
                          filter:   aktivtFilter,
                        },
                      }}
                      asChild
                    >
                      <Pressable style={styles.besteBtn}>
                        <Ionicons name="map-outline" size={15} color="#04110A" />
                        <Text style={styles.besteBtnText}>Vis i kart</Text>
                      </Pressable>
                    </Link>
                  </>
                ) : (
                  <Text style={styles.noDataText}>
                    Ingen observasjoner i nærheten ennå.
                  </Text>
                )}
              </View>

              {/* ── Viltkamera ── */}
              <View style={styles.kameraCard}>
                <View style={styles.kameraLeft}>
                  <View style={styles.kameraIconWrap}>
                    <Ionicons name="camera" size={18} color="#60A5FA" />
                  </View>
                  <View>
                    <Text style={styles.kameraTitle}>Viltkamera</Text>
                    <Text style={styles.kameraCount}>{kameraCount} aktive</Text>
                  </View>
                </View>
                <Link href="/kart" asChild>
                  <Pressable style={styles.kameraBtn}>
                    <Text style={styles.kameraBtnText}>Se i kart</Text>
                    <Ionicons name="chevron-forward" size={14} color="#60A5FA" />
                  </Pressable>
                </Link>
              </View>

              {/* ── Dyrespesifikk aktivitet ── */}
              <View style={styles.gridCard}>
                <Text style={styles.gridTitle}>Dyrespesifikk aktivitet</Text>
                <View style={styles.grid}>
                  {dyrAktivitet.map((item) => (
                    <View key={item.dyr} style={styles.gridCell}>
                      <View style={styles.gridLeft}>
                        <Text style={styles.gridEmoji}>{dyrEmoji(item.dyr)}</Text>
                        <Text style={styles.gridDyr}>{item.dyr}</Text>
                      </View>
                      <View style={[styles.gridBadge, { backgroundColor: nivåFarge(item.nivå) + "1A" }]}>
                        <Text style={[styles.gridBadgeText, { color: nivåFarge(item.nivå) }]}>
                          {item.nivå}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>

              {/* ── Handlingsknapper ── */}
              <View style={styles.actionsRow}>
                <Link href="/logg" asChild>
                  <Pressable style={styles.primaryBtn}>
                    <Ionicons name="add-circle-outline" size={18} color="#04110A" />
                    <Text style={styles.primaryBtnText}>Logg observasjon</Text>
                  </Pressable>
                </Link>
                <Link href="/kart" asChild>
                  <Pressable style={styles.secondaryBtn}>
                    <Ionicons name="map-outline" size={18} color="#A9F2BF" />
                    <Text style={styles.secondaryBtnText}>Dyrekart</Text>
                  </Pressable>
                </Link>
              </View>

              {/* ── Siste observasjoner ── */}
              <View style={styles.recentHeader}>
                <Text style={styles.recentTitle}>Siste observasjoner</Text>
                <Text style={styles.recentCount}>{sisteObs.length} vist</Text>
              </View>

              {sisteObs.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="binoculars-outline" size={28} color="#2A3D30" />
                  <Text style={styles.emptyTitle}>Ingen observasjoner</Text>
                  <Text style={styles.emptyText}>
                    Legg inn observasjoner fra Logg-skjermen.
                  </Text>
                </View>
              ) : (
                sisteObs.map((obs) => (
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
                      {!!obs.kommentar && (
                        <Text style={styles.obsComment} numberOfLines={2}>
                          {obs.kommentar}
                        </Text>
                      )}
                      {obs.retning != null && (
                        <View style={styles.obsRetningRow}>
                          <Ionicons
                            name="navigate"
                            size={11}
                            color="#2CC36B"
                            style={{ transform: [{ rotate: `${obs.retning}deg` }] }}
                          />
                          <Text style={styles.obsRetningText}>{obs.retning}°</Text>
                        </View>
                      )}
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
  safe:   { flex: 1, backgroundColor: "#060E08" },
  screen: { flex: 1 },
  scroll: { paddingTop: 16, paddingHorizontal: 18, paddingBottom: 160 },

  // Topp
  topRow: {
    flexDirection: "row", alignItems: "flex-end",
    justifyContent: "space-between", marginBottom: 20,
  },
  eyebrow: {
    color: "#2CC36B", fontSize: 11, fontWeight: "800",
    letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 6,
  },
  pageTitle: { color: "#FFFFFF", fontSize: 30, fontWeight: "900", letterSpacing: -0.4 },
  logBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#2CC36B", borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  logBtnText: { color: "#04110A", fontSize: 14, fontWeight: "900" },

  // Filter
  filterWrap: { marginBottom: 20 },
  filterRow:  { gap: 8, paddingRight: 4 },
  chip: {
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 999, backgroundColor: "#0C1610",
    borderWidth: 1, borderColor: "#192420",
  },
  chipActive:     { backgroundColor: "#2CC36B", borderColor: "#2CC36B" },
  chipText:       { color: "#6B8A76", fontSize: 13, fontWeight: "700" },
  chipTextActive: { color: "#04110A", fontWeight: "900" },

  // Loading / Error
  loadCard: {
    backgroundColor: "#0C1610", borderRadius: 22,
    padding: 32, alignItems: "center", marginBottom: 16,
    borderWidth: 1, borderColor: "#192420",
  },
  loadTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "800", marginTop: 16 },
  loadText:  { color: "#4D6858", fontSize: 14, marginTop: 6, textAlign: "center" },
  errorCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: "#160D0D", borderWidth: 1, borderColor: "#3B1A1A",
    borderRadius: 18, padding: 18, marginBottom: 16,
  },
  errorTitle: { color: "#FCA5A5", fontSize: 15, fontWeight: "800" },
  errorText:  { color: "#A07070", fontSize: 13, marginTop: 4, lineHeight: 20 },

  // Hero
  heroCard: {
    backgroundColor: "#0B1610", borderRadius: 22,
    borderWidth: 1, borderColor: "#192420",
    overflow: "hidden", marginBottom: 12, minHeight: 140,
    position: "relative",
  },
  heroAccent: {
    position: "absolute", right: -40, top: -40,
    width: 180, height: 180, borderRadius: 90,
  },
  heroAccentDot: {
    position: "absolute", right: 22, top: 22,
    width: 8, height: 8, borderRadius: 4,
  },
  heroContent:  { padding: 22 },
  heroEyebrow: {
    color: "#3D5C4A", fontSize: 11, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10,
  },
  heroValue: { fontSize: 44, fontWeight: "900", letterSpacing: -1, lineHeight: 48 },
  heroDesc:  { color: "#7A9A88", fontSize: 14, lineHeight: 21, marginTop: 10 },

  // Stats — nå EN rad inni hero-kortet, ikke egne kort (§15)
  heroStatsRow: {
    flexDirection: "row", alignItems: "center",
    marginTop: 18, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: "#152019",
  },
  heroStat: { flex: 1, alignItems: "center" },
  heroStatDivider: { width: 1, height: 30, backgroundColor: "#152019" },
  statLabel:    { color: "#3D5446", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, textAlign: "center" },
  statValue:    { color: "#FFFFFF", fontSize: 17, fontWeight: "900", textAlign: "center" },
  statValueSm:  { fontSize: 15 },
  trendUp:      { color: "#4ADE80" },
  trendDown:    { color: "#F87171" },
  trendNeutral: { color: "#6B8A76" },

  // Beste område
  besteCard: {
    backgroundColor: "#0B1A11", borderWidth: 1, borderColor: "#1B3020",
    borderRadius: 22, padding: 18, marginBottom: 12,
  },
  besteHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 16,
  },
  besteTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  besteBadge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  besteBadgeText: { fontSize: 12, fontWeight: "900" },
  besteMeta: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  besteEmoji: { fontSize: 34 },
  besteAkt:   { color: "#4ADE80", fontSize: 15, fontWeight: "800" },
  besteInfo:  { color: "#4D6858", fontSize: 13, marginTop: 3 },
  besteBtn: {
    backgroundColor: "#2CC36B", borderRadius: 14,
    paddingVertical: 13, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 8,
  },
  besteBtnText: { color: "#04110A", fontSize: 14, fontWeight: "900" },
  noDataText:   { color: "#3D5446", fontSize: 14 },

  // Viltkamera
  kameraCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#0B1318", borderWidth: 1, borderColor: "#182430",
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12,
  },
  kameraLeft:    { flexDirection: "row", alignItems: "center", gap: 12 },
  kameraIconWrap: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: "rgba(96,165,250,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  kameraTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  kameraCount: { color: "#4D6878", fontSize: 13, marginTop: 2 },
  kameraBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(96,165,250,0.10)",
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: "rgba(96,165,250,0.18)",
  },
  kameraBtnText: { color: "#60A5FA", fontSize: 13, fontWeight: "800" },

  // Dyrespesifikk grid
  gridCard: {
    backgroundColor: "#0B1610", borderWidth: 1, borderColor: "#192420",
    borderRadius: 22, padding: 18, marginBottom: 14,
  },
  gridTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "900", marginBottom: 14 },
  grid:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gridCell: {
    width: "48%", backgroundColor: "#0F1A12",
    borderRadius: 16, padding: 13,
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1, borderColor: "#1C2E20",
  },
  gridLeft:      { flexDirection: "row", alignItems: "center", gap: 9 },
  gridEmoji:     { fontSize: 20 },
  gridDyr:       { color: "#C8D8D0", fontSize: 13, fontWeight: "700" },
  gridBadge:     { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  gridBadgeText: { fontSize: 11, fontWeight: "900" },

  // Handlingsknapper
  actionsRow: { flexDirection: "row", gap: 10, marginBottom: 24 },
  primaryBtn: {
    flex: 1, backgroundColor: "#2CC36B",
    borderRadius: 16, paddingVertical: 16,
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8,
  },
  primaryBtnText: { color: "#04110A", fontSize: 14, fontWeight: "900" },
  secondaryBtn: {
    flex: 1, backgroundColor: "#0C1610",
    borderRadius: 16, paddingVertical: 16,
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8,
    borderWidth: 1, borderColor: "#192420",
  },
  secondaryBtnText: { color: "#A9F2BF", fontSize: 14, fontWeight: "800" },

  // Siste observasjoner
  recentHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 12,
  },
  recentTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  recentCount: { color: "#3D5446", fontSize: 13, fontWeight: "600" },
  emptyCard: {
    backgroundColor: "#0B1610", borderWidth: 1, borderColor: "#192420",
    borderRadius: 20, padding: 28, alignItems: "center",
  },
  emptyTitle: { color: "#4D6858", fontSize: 15, fontWeight: "800", marginTop: 12 },
  emptyText:  { color: "#2E4236", fontSize: 13, marginTop: 6, textAlign: "center", lineHeight: 20 },

  obsCard: {
    backgroundColor: "#0B1610", borderWidth: 1, borderColor: "#192420",
    borderRadius: 18, padding: 14, marginBottom: 8,
    flexDirection: "row", alignItems: "flex-start", gap: 12,
  },
  obsIconWrap: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#152019", alignItems: "center", justifyContent: "center",
  },
  obsIcon:    { fontSize: 20 },
  obsBody:    { flex: 1 },
  obsTopRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  obsAnimal:  { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  obsTime:    { color: "#2E4236", fontSize: 12, fontWeight: "600" },
  obsMeta:    { color: "#4D6858", fontSize: 13 },
  obsComment: { color: "#8EA0AA", fontSize: 13, lineHeight: 19, marginTop: 5 },
  obsRetningRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 },
  obsRetningText: { color: "#2CC36B", fontSize: 12, fontWeight: "700" },
  obsDeleteBtn: {
    paddingLeft: 4, paddingTop: 2, alignSelf: "flex-start",
  },

  // Miljø-rad
  miljøRad:    { flexDirection: "row", alignItems: "center", padding: 14, marginBottom: 16 },
  miljøKort:   { flex: 1, alignItems: "center" },
  miljøDivider: { width: 1, height: 34, backgroundColor: "#192420" },
  miljøEmoji:  { fontSize: 20, marginBottom: 4 },
  miljøVerdi:  { color: "#FFFFFF", fontSize: 15, fontWeight: "900", textAlign: "center" },
  miljøSub:    { color: "#3D5446", fontSize: 10, marginTop: 2, textAlign: "center", fontWeight: "700" },
});
