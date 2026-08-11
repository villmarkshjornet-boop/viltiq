import { Ionicons } from "@expo/vector-icons";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import type { DimensionValue } from "react-native";
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
import { getUserPosition, syncUserLocation } from "../src/services/location";
import { subscribeToNearbyObservations } from "../src/services/observations";
import { getSettings } from "../src/services/settings";
import { hentVær, jaktVindRad, type VærData } from "../src/services/weather";
import type { Observasjon } from "../src/types/observation";
import { dyrEmoji, hentNivå, hentTidsvekt, hentTimerSiden } from "../src/lib/aktivitet";
import { calcBearing, type LatLng } from "../src/lib/geo";
import { måneFase } from "../src/lib/maane";

// ─── Konstanter ───────────────────────────────────────────────────────────────

type Periode = "24t" | "7d" | "30d";

const dyrListe  = ["Rådyr", "Elg", "Hjort", "Rev"];
const typeListe = ["Sett dyr", "Spor", "Kamera"];
const perioder: Periode[] = ["24t", "7d", "30d"];

// Aktivitetsprofil per time 0–23 (0 = lav, 1 = topp)
const AKTIVITETS_PROFIL: Record<string, number[]> = {
  Rådyr: [0.1,0.1,0.1,0.1,0.3, 0.9,1.0,0.9,0.6,0.3, 0.2,0.2,0.2,0.2,0.2, 0.3,0.6,0.9,1.0,0.9, 0.6,0.3,0.2,0.1],
  Elg:   [0.2,0.2,0.2,0.3,0.7, 1.0,1.0,0.9,0.7,0.4, 0.2,0.2,0.2,0.2,0.3, 0.5,0.8,1.0,1.0,0.8, 0.5,0.4,0.3,0.2],
  Hjort: [0.2,0.1,0.1,0.2,0.5, 0.9,1.0,0.9,0.6,0.3, 0.2,0.2,0.2,0.2,0.3, 0.5,0.8,1.0,1.0,0.7, 0.4,0.3,0.2,0.2],
  Rev:   [0.9,0.8,0.7,0.5,0.3, 0.2,0.1,0.1,0.1,0.1, 0.1,0.1,0.1,0.2,0.2, 0.3,0.4,0.5,0.6,0.8, 0.9,1.0,1.0,0.9],
};

// Norske jaktsesonger (typiske datoer — varierer per fylke)
const SESONGER: Record<string, Array<{ fraM: number; fraD: number; tilM: number; tilD: number; merknad?: string }>> = {
  Rådyr:  [
    { fraM: 8,  fraD: 10, tilM: 9,  tilD: 23, merknad: "Bukk" },
    { fraM: 10, fraD: 1,  tilM: 1,  tilD: 31, merknad: "Geit/kje" },
  ],
  Elg:    [{ fraM: 10, fraD: 1,  tilM: 11, tilD: 30 }],
  Hjort:  [{ fraM: 9,  fraD: 1,  tilM: 2,  tilD: 15 }],
  Rev:    [{ fraM: 10, fraD: 1,  tilM: 3,  tilD: 15 }],
};

// ─── Hjelpefunksjoner ─────────────────────────────────────────────────────────

function prosentBredde(value: number, max: number): DimensionValue {
  if (max <= 0 || value <= 0) return "0%";
  return `${Math.min(Math.round((value / max) * 100), 100)}%` as DimensionValue;
}

// Aktivitetsnivå nå for gitt art
function aktivitetNå(dyr: string): number {
  const time   = new Date().getHours();
  const profil = AKTIVITETS_PROFIL[dyr];
  return profil ? Math.round((profil[time] ?? 0.5) * 100) : 50;
}

// Neste toppunkt (>= 80 % aktivitet)
function nesteToppunkt(dyr: string): string {
  const nå     = new Date().getHours();
  const profil = AKTIVITETS_PROFIL[dyr] ?? [];
  for (let i = 1; i <= 24; i++) {
    const t = (nå + i) % 24;
    if ((profil[t] ?? 0) >= 0.8) {
      const slutt = (t + 2) % 24;
      return `${String(t).padStart(2, "0")}:00 – ${String(slutt).padStart(2, "0")}:00`;
    }
  }
  return "Ingen klart toppunkt i dag";
}

// Jaktsesong-status
function sesongsStatus(dyr: string, dato: Date): { åpen: boolean; label: string; farge: string } {
  const sesonger = SESONGER[dyr];
  if (!sesonger) return { åpen: false, label: "Ukjent", farge: "#4D6858" };

  const år   = dato.getFullYear();
  const now  = dato.getTime();

  for (const s of sesonger) {
    const fraÅr = år;
    const tilÅr = s.tilM < s.fraM ? år + 1 : år;
    const fra   = new Date(fraÅr, s.fraM - 1, s.fraD).getTime();
    const til   = new Date(tilÅr, s.tilM - 1, s.tilD, 23, 59).getTime();

    if (now >= fra && now <= til) {
      const dager = Math.ceil((til - now) / 86400000);
      const tag   = s.merknad ? ` (${s.merknad})` : "";
      return { åpen: true, label: `Åpen${tag} · ${dager}d igjen`, farge: "#2CC36B" };
    }
    if (now < fra) {
      const dager = Math.ceil((fra - now) / 86400000);
      const tag   = s.merknad ? ` (${s.merknad})` : "";
      return { åpen: false, label: `Åpner om ${dager}d${tag}`, farge: "#EAB308" };
    }
  }
  return { åpen: false, label: "Sesong avsluttet", farge: "#4D6858" };
}

// Prediker sannsynlig posisjonssone fra observasjoner, sett fra brukerens ståsted
function predikterSone(
  obs: Observasjon[],
  dyr: string,
  brukerPos: LatLng | null
): { retningLabel: string; konfidensStr: string; antallObs: number } | null {
  const relevante = obs
    .filter((o) => o.dyr === dyr && o.latitude != null && o.longitude != null)
    .filter((o) => hentTimerSiden(o.tid) <= 48)
    .sort((a, b) => new Date(b.tid).getTime() - new Date(a.tid).getTime());

  if (relevante.length === 0) return null;

  // Beregn vektet sentrum
  let sumLat = 0, sumLon = 0, sumVekt = 0;
  for (const o of relevante) {
    const v = hentTidsvekt(o.tid);
    sumLat  += (o.latitude  as number) * v;
    sumLon  += (o.longitude as number) * v;
    sumVekt += v;
  }
  const senterLat = sumLat / sumVekt;
  const senterLon = sumLon / sumVekt;

  // Beregn retning fra brukerens faktiske posisjon til sentrum av observasjonene
  const dirs = ["Nord", "Nordøst", "Øst", "Sørøst", "Sør", "Sørvest", "Vest", "Nordvest"];
  let retningLabel = "Ukjent";
  if (brukerPos) {
    const bearing = calcBearing(brukerPos, { latitude: senterLat, longitude: senterLon });
    const idx = Math.round(bearing / 45) % 8;
    retningLabel = dirs[idx] ?? "Ukjent";
  }

  // Konfidens basert på antall obs og ferskhet
  const konfidens    = Math.min(Math.round((sumVekt / (relevante.length * 5)) * 100), 95);
  const konfidensStr = `${konfidens}%`;

  return { retningLabel, konfidensStr, antallObs: relevante.length };
}

// ─── Komponent ────────────────────────────────────────────────────────────────

export default function StatistikkScreen() {
  const [observasjoner, setObservasjoner] = useState<Observasjon[]>([]);
  const [valgtPeriode,  setValgtPeriode]  = useState<Periode>("7d");
  const [valgtDyr,      setValgtDyr]      = useState("Elg");
  const [laster,        setLaster]        = useState(true);
  const [feiltekst,     setFeiltekst]     = useState("");
  const [radiusKm,      setRadiusKm]      = useState<10 | 25 | 50>(50);
  const [vær,           setVær]           = useState<VærData | null>(null);
  const [brukerPos,     setBrukerPos]     = useState<LatLng | null>(null);

  const måne = useMemo(() => måneFase(new Date()), []);

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

          const pos = await getUserPosition();
          if (!aktiv) return;
          if (!pos) { setFeiltekst("Fant ikke posisjon."); setLaster(false); return; }
          setBrukerPos({ latitude: pos.latitude, longitude: pos.longitude });

          await syncUserLocation({ latitude: pos.latitude, longitude: pos.longitude });

          // Last vær i bakgrunnen
          hentVær(pos.latitude, pos.longitude)
            .then((v) => { if (aktiv) setVær(v); })
            .catch(() => {});

          unsub = subscribeToNearbyObservations(
            { center: pos, radiusKm: settings.radiusKm },
            (liste) => {
              if (!aktiv) return;
              setObservasjoner([...liste].sort(
                (a, b) => new Date(b.tid).getTime() - new Date(a.tid).getTime()
              ));
              setLaster(false);
            },
            () => {
              if (!aktiv) return;
              setFeiltekst("Klarte ikke hente statistikk.");
              setLaster(false);
            }
          );
        } catch (e) {
          console.log("init-feil:", e);
          if (!aktiv) return;
          setFeiltekst("Noe gikk galt ved oppstart.");
          setLaster(false);
        }
      })();

      return () => { aktiv = false; unsub?.(); };
    }, [])
  );

  // ─── Beregnede verdier ────────────────────────────────────────────────────

  const periodeTimer = valgtPeriode === "24t" ? 24 : valgtPeriode === "7d" ? 168 : 720;

  const filtrert = useMemo(
    () => observasjoner.filter((o) => hentTimerSiden(o.tid) <= periodeTimer),
    [observasjoner, periodeTimer]
  );
  const forrige = useMemo(
    () => observasjoner.filter((o) => {
      const t = hentTimerSiden(o.tid);
      return t > periodeTimer && t <= periodeTimer * 2;
    }),
    [observasjoner, periodeTimer]
  );

  const trend = filtrert.length > forrige.length ? "Økende" :
                filtrert.length < forrige.length ? "Synkende" : "Stabil";

  const dyrStatistikk = useMemo(() =>
    dyrListe.map((dyr) => {
      const obs   = filtrert.filter((o) => o.dyr === dyr);
      const score = obs.reduce((s, o) => s + hentTidsvekt(o.tid), 0);
      const pst   = filtrert.length > 0 ? Math.round((obs.length / filtrert.length) * 100) : 0;
      return { dyr, antall: obs.length, score, pst, nivå: hentNivå(score) };
    }).sort((a, b) => b.antall - a.antall),
    [filtrert]
  );

  const typeStatistikk = useMemo(() =>
    typeListe.map((type) => ({
      type,
      antall: filtrert.filter((o) => o.type === type).length,
    })).sort((a, b) => b.antall - a.antall),
    [filtrert]
  );

  const tidsmønster = useMemo(() => {
    const m = { morgen: 0, dag: 0, kveld: 0, natt: 0 };
    for (const o of filtrert) {
      const h = new Date(o.tid).getHours();
      if (h >= 5 && h < 10)  m.morgen++;
      else if (h < 17)        m.dag++;
      else if (h < 23)        m.kveld++;
      else                    m.natt++;
    }
    return m;
  }, [filtrert]);

  const hotspots = useMemo(() => {
    const map: Record<string, { count: number; score: number; label: string; lastTid: string }> = {};
    for (const o of filtrert) {
      if (o.latitude == null || o.longitude == null) continue;
      const key = `${o.latitude.toFixed(3)}_${o.longitude.toFixed(3)}`;
      if (!map[key]) map[key] = { count: 0, score: 0, label: `${o.latitude.toFixed(3)}, ${o.longitude.toFixed(3)}`, lastTid: o.tid };
      map[key].count++;
      map[key].score += hentTidsvekt(o.tid);
      if (new Date(o.tid) > new Date(map[key].lastTid)) map[key].lastTid = o.tid;
    }
    return Object.values(map).sort((a, b) => b.score - a.score).slice(0, 3);
  }, [filtrert]);

  const prediksjon = useMemo(
    () => predikterSone(observasjoner, valgtDyr, brukerPos),
    [observasjoner, valgtDyr, brukerPos]
  );
  const aktNå      = useMemo(() => aktivitetNå(valgtDyr), [valgtDyr]);
  const neste      = useMemo(() => nesteToppunkt(valgtDyr), [valgtDyr]);
  const sesong     = useMemo(() => sesongsStatus(valgtDyr, new Date()), [valgtDyr]);

  const maksDyr = Math.max(...dyrStatistikk.map((i) => i.antall), 1);
  const maksTid = Math.max(...Object.values(tidsmønster), 1);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

          {/* ── Header ── */}
          <View style={styles.header}>
            <Text style={styles.eyebrow}>ViltIQ</Text>
            <Text style={styles.title}>Statistikk</Text>
            <Text style={styles.subtitle}>
              Analyse og prediksjon innen {radiusKm} km
            </Text>
          </View>

          {laster ? (
            <View style={styles.loadCard}>
              <ActivityIndicator size="large" color="#2CC36B" />
              <Text style={styles.loadTitle}>Laster data...</Text>
            </View>
          ) : feiltekst ? (
            <View style={styles.errorCard}>
              <Ionicons name="warning-outline" size={20} color="#F87171" />
              <Text style={styles.errorText}>{feiltekst}</Text>
            </View>
          ) : (
            <>
              {/* ── Vær + Månefase ── */}
              <View style={styles.miljøRad}>
                {/* Månefase */}
                <View style={styles.miljøKort}>
                  <Text style={styles.miljøEmoji}>{måne.emoji}</Text>
                  <Text style={styles.miljøLabel}>Månefase</Text>
                  <Text style={styles.miljøVerdi}>{måne.navn}</Text>
                  <Text style={styles.miljøSub}>{måne.belysning}% belysning</Text>
                </View>

                {/* Vær */}
                {vær ? (
                  <View style={[styles.miljøKort, styles.miljøKortMid]}>
                    <Text style={styles.miljøEmoji}>{vær.emoji}</Text>
                    <Text style={styles.miljøLabel}>Vær nå</Text>
                    <Text style={styles.miljøVerdi}>{vær.temperatur}°C</Text>
                    <Text style={styles.miljøSub}>{vær.beskrivelse}</Text>
                  </View>
                ) : (
                  <View style={[styles.miljøKort, styles.miljøKortMid]}>
                    <Text style={styles.miljøEmoji}>🌡</Text>
                    <Text style={styles.miljøLabel}>Vær</Text>
                    <Text style={styles.miljøSub}>Henter...</Text>
                  </View>
                )}

                {/* Vind */}
                {vær ? (
                  <View style={styles.miljøKort}>
                    <Text style={styles.miljøEmoji}>🌬</Text>
                    <Text style={styles.miljøLabel}>Vind</Text>
                    <Text style={styles.miljøVerdi}>{vær.vindLabel}</Text>
                    <Text style={styles.miljøSub}>{vær.vindHastighet} m/s</Text>
                  </View>
                ) : (
                  <View style={styles.miljøKort}>
                    <Text style={styles.miljøEmoji}>🌬</Text>
                    <Text style={styles.miljøLabel}>Vind</Text>
                    <Text style={styles.miljøSub}>—</Text>
                  </View>
                )}
              </View>

              {/* Jaktråd basert på vind */}
              {vær && (
                <View style={styles.vindRad}>
                  <Ionicons name="navigate-outline" size={15} color="#2CC36B" />
                  <Text style={styles.vindRadText}>{jaktVindRad(vær.vindRetning)}</Text>
                </View>
              )}

              {/* ── Prediksjon — artsfaner ── */}
              <View style={styles.predSection}>
                <Text style={styles.sectionTitle}>Prediksjon</Text>
                <Text style={styles.sectionSub}>Basert på adferd og observasjoner siste 48t</Text>

                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.dyrFaneRad}>
                  {dyrListe.map((dyr) => {
                    const a = valgtDyr === dyr;
                    return (
                      <Pressable key={dyr} onPress={() => setValgtDyr(dyr)}
                        style={[styles.dyrFane, a && styles.dyrFaneActive]}>
                        <Text style={[styles.dyrFaneTekst, a && styles.dyrFaneTekstActive]}>
                          {dyrEmoji(dyr)} {dyr}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {/* Prediksjonskort */}
                <View style={styles.predKort}>
                  {/* Aktivitetsmåler */}
                  <View style={styles.predAktRow}>
                    <Text style={styles.predAktLabel}>Aktivitetsnivå nå</Text>
                    <Text style={[
                      styles.predAktVerdi,
                      { color: aktNå >= 70 ? "#2CC36B" : aktNå >= 40 ? "#EAB308" : "#6B8A76" }
                    ]}>
                      {aktNå}%
                    </Text>
                  </View>
                  <View style={styles.predMåler}>
                    <View style={[styles.predMålerFyll, {
                      width: `${aktNå}%` as DimensionValue,
                      backgroundColor: aktNå >= 70 ? "#2CC36B" : aktNå >= 40 ? "#EAB308" : "#4D6858",
                    }]} />
                  </View>

                  <View style={styles.predGrid}>
                    <View style={styles.predCelle}>
                      <Text style={styles.predCelleLabel}>Neste toppunkt</Text>
                      <Text style={styles.predCelleVerdi}>{neste}</Text>
                    </View>
                    <View style={[styles.predCelle, styles.predCelleMid]}>
                      <Text style={styles.predCelleLabel}>Sesong</Text>
                      <Text style={[styles.predCelleVerdi, { color: sesong.farge }]}>
                        {sesong.åpen ? "Åpen" : "Stengt"}
                      </Text>
                      <Text style={styles.predCelleSub}>{sesong.label}</Text>
                    </View>
                  </View>

                  {prediksjon ? (
                    <View style={styles.predSannsynlig}>
                      <Ionicons name="location" size={14} color="#2CC36B" />
                      <Text style={styles.predSannsynligTekst}>
                        Sannsynlig sone: <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>
                          {prediksjon.retningLabel}
                        </Text>
                        {" "}· {prediksjon.antallObs} obs · konfidens {prediksjon.konfidensStr}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.predSannsynlig}>
                      <Ionicons name="information-circle-outline" size={14} color="#3D5446" />
                      <Text style={[styles.predSannsynligTekst, { color: "#3D5446" }]}>
                        Ingen observasjoner av {valgtDyr} siste 48t
                      </Text>
                    </View>
                  )}

                  {/* 24-timers aktivitetsgraf */}
                  <View style={styles.aktivGraf}>
                    {Array.from({ length: 24 }, (_, i) => {
                      const score = AKTIVITETS_PROFIL[valgtDyr]?.[i] ?? 0;
                      const nåTime = new Date().getHours();
                      const erNå = i === nåTime;
                      return (
                        <View key={i} style={styles.aktivSøyleWrap}>
                          <View style={[
                            styles.aktivSøyle,
                            { height: Math.round(score * 40) },
                            erNå && styles.aktivSøyleNå,
                          ]} />
                        </View>
                      );
                    })}
                  </View>
                  <View style={styles.aktivGrafLabels}>
                    <Text style={styles.aktivGrafLabel}>00</Text>
                    <Text style={styles.aktivGrafLabel}>06</Text>
                    <Text style={styles.aktivGrafLabel}>12</Text>
                    <Text style={styles.aktivGrafLabel}>18</Text>
                    <Text style={styles.aktivGrafLabel}>24</Text>
                  </View>
                </View>
              </View>

              {/* ── Jaktsesong-oversikt ── */}
              <View style={styles.sesongerKort}>
                <Text style={styles.sectionTitle}>Jaktsesonger</Text>
                {dyrListe.map((dyr) => {
                  const s = sesongsStatus(dyr, new Date());
                  return (
                    <View key={dyr} style={styles.sesongsRad}>
                      <Text style={styles.sesongsEmoji}>{dyrEmoji(dyr)}</Text>
                      <Text style={styles.sesongsNavn}>{dyr}</Text>
                      <View style={[styles.sesongsTag, { backgroundColor: s.farge + "20" }]}>
                        <View style={[styles.sesongsTagDot, { backgroundColor: s.farge }]} />
                        <Text style={[styles.sesongsTagTekst, { color: s.farge }]}>{s.label}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* ── Periode-velger ── */}
              <View style={styles.segmentWrap}>
                {perioder.map((p) => {
                  const a = valgtPeriode === p;
                  return (
                    <Pressable key={p} onPress={() => setValgtPeriode(p)}
                      style={[styles.segBtn, a && styles.segBtnActive]}>
                      <Text style={[styles.segTekst, a && styles.segTekstActive]}>{p}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* ── Stats-tal ── */}
              <View style={styles.statsRad}>
                {[
                  { label: "Totalt", verdi: String(observasjoner.length) },
                  { label: "I periode", verdi: String(filtrert.length) },
                  { label: "Trend", verdi: trend },
                ].map((s) => (
                  <View key={s.label} style={styles.statKort}>
                    <Text style={styles.statLabel}>{s.label}</Text>
                    <Text style={[
                      styles.statVerdi,
                      s.verdi === "Økende" ? styles.trendOpp :
                      s.verdi === "Synkende" ? styles.trendNed : undefined,
                    ]}>{s.verdi}</Text>
                  </View>
                ))}
              </View>

              {/* ── Dyrefordeling ── */}
              <View style={styles.kortCard}>
                <Text style={styles.kortTittel}>Dyrefordeling</Text>
                {dyrStatistikk.map((item) => (
                  <View key={item.dyr} style={styles.barRad}>
                    <View style={styles.barLeft}>
                      <Text style={styles.barDyr}>{item.dyr}</Text>
                      <Text style={styles.barMeta}>{item.antall} obs · {item.pst}%</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFyll, { width: prosentBredde(item.antall, maksDyr) }]} />
                    </View>
                  </View>
                ))}
              </View>

              {/* ── Tidsmønster ── */}
              <View style={styles.kortCard}>
                <Text style={styles.kortTittel}>Tidsmønster</Text>
                {([["morgen","Morgen (05–10)"],["dag","Dag (10–17)"],["kveld","Kveld (17–23)"],["natt","Natt (23–05)"]] as const).map(([key, label]) => (
                  <View key={key} style={styles.barRad}>
                    <View style={styles.barLeft}>
                      <Text style={styles.barDyr}>{label}</Text>
                      <Text style={styles.barMeta}>{tidsmønster[key as keyof typeof tidsmønster]} obs</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFyllSoft, { width: prosentBredde(tidsmønster[key as keyof typeof tidsmønster], maksTid) }]} />
                    </View>
                  </View>
                ))}
              </View>

              {/* ── Hotspots ── */}
              <View style={styles.kortCard}>
                <Text style={styles.kortTittel}>Sterkeste hotspots</Text>
                {hotspots.length === 0 ? (
                  <Text style={styles.tomTekst}>Ingen hotspots ennå.</Text>
                ) : hotspots.map((spot, i) => (
                  <View key={spot.label} style={styles.hotspotRad}>
                    <View style={styles.hotspotRang}>
                      <Text style={styles.hotspotRangTekst}>#{i + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hotspotLabel}>{spot.label}</Text>
                      <Text style={styles.hotspotMeta}>{spot.count} obs · score {spot.score}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* ── Observasjonstyper ── */}
              <View style={styles.kortCard}>
                <Text style={styles.kortTittel}>Observasjonstyper</Text>
                {typeStatistikk.map((item) => (
                  <View key={item.type} style={styles.typeRad}>
                    <Text style={styles.typeTekst}>{item.type}</Text>
                    <Text style={styles.typeAntall}>{item.antall}</Text>
                  </View>
                ))}
              </View>

              {/* ── Lenker ── */}
              <View style={styles.lenkRad}>
                <Link href="/kart" asChild>
                  <Pressable style={styles.lenkKnapp}>
                    <Ionicons name="map-outline" size={15} color="#A9F2BF" />
                    <Text style={styles.lenkTekst}>Kart</Text>
                  </Pressable>
                </Link>
                <Link href="/logg" asChild>
                  <Pressable style={styles.lenkKnapp}>
                    <Ionicons name="add-circle-outline" size={15} color="#A9F2BF" />
                    <Text style={styles.lenkTekst}>Logg obs</Text>
                  </Pressable>
                </Link>
                <Link href="/felling" asChild>
                  <Pressable style={[styles.lenkKnapp, styles.lenkKnappAlt]}>
                    <Ionicons name="trophy-outline" size={15} color="#FDE68A" />
                    <Text style={[styles.lenkTekst, { color: "#FDE68A" }]}>Felling</Text>
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
  safe:   { flex: 1, backgroundColor: "#060E08" },
  screen: { flex: 1 },
  container: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 160 },

  header:   { paddingVertical: 20 },
  eyebrow:  { color: "#2CC36B", fontSize: 11, fontWeight: "800", letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 10 },
  title:    { color: "#FFFFFF", fontSize: 34, fontWeight: "900", letterSpacing: -0.5 },
  subtitle: { color: "#4D6858", fontSize: 14, marginTop: 6 },

  loadCard: { backgroundColor: "#0B1610", borderRadius: 22, borderWidth: 1, borderColor: "#192420", padding: 32, alignItems: "center" },
  loadTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "800", marginTop: 14 },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#160D0D", borderWidth: 1, borderColor: "#3B1A1A", borderRadius: 18, padding: 18 },
  errorText: { color: "#FCA5A5", fontSize: 14, flex: 1 },

  // Vær + Månefase
  miljøRad: { flexDirection: "row", gap: 8, marginBottom: 10 },
  miljøKort: {
    flex: 1, backgroundColor: "#0B1610", borderRadius: 18,
    borderWidth: 1, borderColor: "#192420",
    padding: 14, alignItems: "center",
  },
  miljøKortMid: { borderColor: "#1C2A20" },
  miljøEmoji: { fontSize: 22, marginBottom: 6 },
  miljøLabel: { color: "#3D5446", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  miljøVerdi: { color: "#FFFFFF", fontSize: 14, fontWeight: "900", textAlign: "center" },
  miljøSub:   { color: "#3D5446", fontSize: 11, marginTop: 2, textAlign: "center" },

  vindRad: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(44,195,107,0.06)",
    borderRadius: 12, borderWidth: 1, borderColor: "rgba(44,195,107,0.12)",
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 20,
  },
  vindRadText: { color: "#7AB890", fontSize: 13, fontWeight: "600", flex: 1 },

  // Prediksjon
  predSection: { marginBottom: 20 },
  sectionTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginBottom: 4 },
  sectionSub:   { color: "#3D5446", fontSize: 13, marginBottom: 14 },
  dyrFaneRad:   { gap: 8, paddingRight: 4, marginBottom: 14 },
  dyrFane: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 999, backgroundColor: "#0B1610",
    borderWidth: 1, borderColor: "#192420",
  },
  dyrFaneActive:       { backgroundColor: "#122C1C", borderColor: "#2CC36B" },
  dyrFaneTekst:        { color: "#6B8A76", fontSize: 13, fontWeight: "700" },
  dyrFaneTekstActive:  { color: "#A9F2BF", fontWeight: "800" },

  predKort: {
    backgroundColor: "#0B1A11", borderRadius: 22,
    borderWidth: 1, borderColor: "#1B3020",
    padding: 18,
  },
  predAktRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  predAktLabel: { color: "#4D6858", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  predAktVerdi: { fontSize: 22, fontWeight: "900" },
  predMåler: { height: 8, backgroundColor: "#0E1A10", borderRadius: 4, overflow: "hidden", marginBottom: 16 },
  predMålerFyll: { height: "100%", borderRadius: 4 },

  predGrid: { flexDirection: "row", gap: 10, marginBottom: 14 },
  predCelle: { flex: 1, backgroundColor: "#0E1510", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#1A2B1A" },
  predCelleMid: { borderColor: "#1A2B20" },
  predCelleLabel: { color: "#3D5446", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
  predCelleVerdi: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  predCelleSub:   { color: "#2E4236", fontSize: 11, marginTop: 3 },

  predSannsynlig: {
    flexDirection: "row", alignItems: "flex-start", gap: 7,
    backgroundColor: "rgba(44,195,107,0.06)",
    borderRadius: 12, padding: 12, marginBottom: 16,
    borderWidth: 1, borderColor: "rgba(44,195,107,0.12)",
  },
  predSannsynligTekst: { color: "#7AB890", fontSize: 13, lineHeight: 20, flex: 1 },

  // 24t aktivitetsgraf
  aktivGraf: {
    flexDirection: "row", alignItems: "flex-end",
    height: 44, gap: 2, marginBottom: 4,
  },
  aktivSøyleWrap: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: 44 },
  aktivSøyle: { width: "80%", backgroundColor: "#1E3A22", borderRadius: 2, minHeight: 2 },
  aktivSøyleNå: { backgroundColor: "#2CC36B" },
  aktivGrafLabels: { flexDirection: "row", justifyContent: "space-between" },
  aktivGrafLabel:  { color: "#2E4236", fontSize: 10 },

  // Jaktsesong
  sesongerKort: {
    backgroundColor: "#0B1610", borderRadius: 22,
    borderWidth: 1, borderColor: "#192420",
    padding: 18, marginBottom: 16,
  },
  sesongsRad: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#111C14",
  },
  sesongsEmoji: { fontSize: 20 },
  sesongsNavn:  { color: "#FFFFFF", fontSize: 14, fontWeight: "700", flex: 1 },
  sesongsTag: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  sesongsTagDot:  { width: 6, height: 6, borderRadius: 3 },
  sesongsTagTekst: { fontSize: 11, fontWeight: "800" },

  // Segment / Periode
  segmentWrap: {
    flexDirection: "row", backgroundColor: "#0A1410",
    borderRadius: 16, borderWidth: 1, borderColor: "#192420",
    padding: 4, marginBottom: 14,
  },
  segBtn:         { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: "center" },
  segBtnActive:   { backgroundColor: "#122C1C" },
  segTekst:       { color: "#4D6858", fontSize: 14, fontWeight: "700" },
  segTekstActive: { color: "#A9F2BF", fontWeight: "800" },

  // Stats
  statsRad: { flexDirection: "row", gap: 8, marginBottom: 14 },
  statKort: {
    flex: 1, backgroundColor: "#0B1610", borderWidth: 1, borderColor: "#192420",
    borderRadius: 18, padding: 14, alignItems: "center",
  },
  statLabel:  { color: "#3D5446", fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  statVerdi:  { color: "#FFFFFF", fontSize: 20, fontWeight: "900", textAlign: "center" },
  trendOpp:   { color: "#4ADE80" },
  trendNed:   { color: "#F87171" },

  // Kort-kort
  kortCard: {
    backgroundColor: "#0B1610", borderWidth: 1, borderColor: "#192420",
    borderRadius: 22, padding: 18, marginBottom: 12,
  },
  kortTittel: { color: "#FFFFFF", fontSize: 16, fontWeight: "900", marginBottom: 16 },
  barRad: { marginBottom: 14 },
  barLeft: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  barDyr:  { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  barMeta: { color: "#3D5446", fontSize: 12 },
  barTrack: { height: 8, backgroundColor: "#0E1A10", borderRadius: 4, overflow: "hidden" },
  barFyll:  { height: "100%", borderRadius: 4, backgroundColor: "#2CC36B" },
  barFyllSoft: { height: "100%", borderRadius: 4, backgroundColor: "#60A5FA" },

  hotspotRad: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  hotspotRang: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#122C1C", borderWidth: 1, borderColor: "#1E4230",
    alignItems: "center", justifyContent: "center",
  },
  hotspotRangTekst: { color: "#A9F2BF", fontSize: 12, fontWeight: "900" },
  hotspotLabel:     { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  hotspotMeta:      { color: "#3D5446", fontSize: 12, marginTop: 3 },

  typeRad: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#111C14",
  },
  typeTekst:   { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  typeAntall:  { color: "#4D6858", fontSize: 14, fontWeight: "700" },
  tomTekst:    { color: "#3D5446", fontSize: 13 },

  lenkRad:  { flexDirection: "row", gap: 8 },
  lenkKnapp: {
    flex: 1, backgroundColor: "#0B1610", borderWidth: 1, borderColor: "#192420",
    borderRadius: 16, paddingVertical: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
  },
  lenkKnappAlt: { borderColor: "#2A2010", backgroundColor: "#100F09" },
  lenkTekst:    { color: "#A9F2BF", fontSize: 13, fontWeight: "800" },
});
