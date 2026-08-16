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
import Surface from "../components/ui/Surface";
import Badge from "../components/ui/Badge";
import ListRow from "../components/ui/ListRow";
import { getUserPosition, syncUserLocation } from "../src/services/location";
import { subscribeToNearbyObservations } from "../src/services/observations";
import { getSettings } from "../src/services/settings";
import { hentVær, jaktVindRad, type VærData } from "../src/services/weather";
import type { Observasjon } from "../src/types/observation";
import { dyrEmoji, hentNivå, hentTidsvekt, hentTimerSiden } from "../src/lib/aktivitet";
import { calcBearing, type LatLng } from "../src/lib/geo";
import { måneFase } from "../src/lib/maane";
import { værIkon, måneIkon } from "../src/design/weatherIcons";
import {
  color,
  spacing,
  radius,
  typography,
  alpha,
  levelColor,
  confidenceColor,
} from "../src/design/tokens";

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

// Prosent → samme nivånavn som motorens ActivityLevel, kun for fargeoppslag
// via levelColor() (§: aldri egen fargelogikk for aktivitetsnivå).
function aktivitetsNivåFraProsent(pst: number): "Svært høy" | "Høy" | "Moderat" | "Lav" {
  if (pst >= 85) return "Svært høy";
  if (pst >= 70) return "Høy";
  if (pst >= 40) return "Moderat";
  return "Lav";
}

// Prosent → samme nivånavn som motorens ConfidenceLevel, kun for fargeoppslag
// via confidenceColor().
function konfidensNivåFraProsent(pst: number): "høy" | "middels" | "lav" {
  if (pst >= 70) return "høy";
  if (pst >= 40) return "middels";
  return "lav";
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
  if (!sesonger) return { åpen: false, label: "Ukjent", farge: color.textMuted };

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
      return { åpen: true, label: `Åpen${tag} · ${dager}d igjen`, farge: color.success };
    }
    if (now < fra) {
      const dager = Math.ceil((fra - now) / 86400000);
      const tag   = s.merknad ? ` (${s.merknad})` : "";
      return { åpen: false, label: `Åpner om ${dager}d${tag}`, farge: color.warning };
    }
  }
  return { åpen: false, label: "Sesong avsluttet", farge: color.textMuted };
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

  const aktFarge   = levelColor(aktivitetsNivåFraProsent(aktNå));
  const konfidensPst = prediksjon ? parseInt(prediksjon.konfidensStr, 10) : 0;
  const konfidensFarge = confidenceColor(konfidensNivåFraProsent(konfidensPst));

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
            <Surface style={styles.loadCard}>
              <ActivityIndicator size="large" color={color.primary} />
              <Text style={styles.loadTitle}>Laster data...</Text>
            </Surface>
          ) : feiltekst ? (
            <View style={styles.errorCard}>
              <Ionicons name="warning-outline" size={20} color={color.danger} />
              <Text style={styles.errorText}>{feiltekst}</Text>
            </View>
          ) : (
            <>
              {/* ── Vær + Månefase + Vind — én overflate med interne kolonner
                  i stedet for tre separate små kort (§3: mindre kort-søppel). ── */}
              <Surface style={styles.miljøRad}>
                <View style={styles.miljøKol}>
                  <Ionicons name={måneIkon(måne)} size={20} color={color.textSecondary} />
                  <Text style={styles.miljøLabel}>Månefase</Text>
                  <Text style={styles.miljøVerdi}>{måne.navn}</Text>
                  <Text style={styles.miljøSub}>{måne.belysning}% belysning</Text>
                </View>

                <View style={[styles.miljøKol, styles.miljøKolDelt]}>
                  {vær ? (
                    <>
                      <Ionicons name={værIkon(vær.værkode)} size={20} color={color.textSecondary} />
                      <Text style={styles.miljøLabel}>Vær nå</Text>
                      <Text style={styles.miljøVerdi}>{vær.temperatur}°C</Text>
                      <Text style={styles.miljøSub}>{vær.beskrivelse}</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="thermometer-outline" size={20} color={color.textFaint} />
                      <Text style={styles.miljøLabel}>Vær</Text>
                      <Text style={styles.miljøSub}>Henter...</Text>
                    </>
                  )}
                </View>

                <View style={[styles.miljøKol, styles.miljøKolDelt]}>
                  <Ionicons name="navigate-outline" size={20} color={color.textSecondary} />
                  <Text style={styles.miljøLabel}>Vind</Text>
                  {vær ? (
                    <>
                      <Text style={styles.miljøVerdi}>{vær.vindLabel}</Text>
                      <Text style={styles.miljøSub}>{vær.vindHastighet} m/s</Text>
                    </>
                  ) : (
                    <Text style={styles.miljøSub}>—</Text>
                  )}
                </View>
              </Surface>

              {/* Jaktråd basert på vind */}
              {vær && (
                <View style={styles.vindRad}>
                  <Ionicons name="navigate-outline" size={15} color={color.primary} />
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
                <Surface variant="elevated" style={styles.predKort}>
                  {/* Aktivitetsmåler */}
                  <View style={styles.predAktRow}>
                    <Text style={styles.predAktLabel}>Aktivitetsnivå nå</Text>
                    <Text style={[styles.predAktVerdi, { color: aktFarge }]}>
                      {aktNå}%
                    </Text>
                  </View>
                  <View style={styles.predMåler}>
                    <View style={[styles.predMålerFyll, { width: `${aktNå}%` as DimensionValue, backgroundColor: aktFarge }]} />
                  </View>

                  <View style={styles.predGrid}>
                    <View style={styles.predCelle}>
                      <Text style={styles.predCelleLabel}>Neste toppunkt</Text>
                      <Text style={styles.predCelleVerdi}>{neste}</Text>
                    </View>
                    <View style={[styles.predCelle, styles.predCelleDelt]}>
                      <Text style={styles.predCelleLabel}>Sesong</Text>
                      <Text style={[styles.predCelleVerdi, { color: sesong.farge }]}>
                        {sesong.åpen ? "Åpen" : "Stengt"}
                      </Text>
                      <Text style={styles.predCelleSub}>{sesong.label}</Text>
                    </View>
                  </View>

                  {prediksjon ? (
                    <View style={styles.predSannsynlig}>
                      <Ionicons name="location" size={14} color={color.primary} />
                      <Text style={styles.predSannsynligTekst}>
                        Sannsynlig sone: <Text style={{ color: color.textPrimary, fontWeight: "800" }}>
                          {prediksjon.retningLabel}
                        </Text>
                        {" "}· {prediksjon.antallObs} obs · konfidens{" "}
                        <Text style={{ color: konfidensFarge, fontWeight: "800" }}>
                          {prediksjon.konfidensStr}
                        </Text>
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.predSannsynlig}>
                      <Ionicons name="information-circle-outline" size={14} color={color.textFaint} />
                      <Text style={[styles.predSannsynligTekst, { color: color.textFaint }]}>
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
                </Surface>
              </View>

              {/* ── Jaktsesong-oversikt ── */}
              <Surface style={styles.sesongerKort}>
                <Text style={styles.kortTittel}>Jaktsesonger</Text>
                {dyrListe.map((dyr, i) => {
                  const s = sesongsStatus(dyr, new Date());
                  return (
                    <ListRow
                      key={dyr}
                      emoji={dyrEmoji(dyr)}
                      title={dyr}
                      divider={i < dyrListe.length - 1}
                      trailing={<Badge label={s.label} color={s.farge} size="sm" />}
                    />
                  );
                })}
              </Surface>

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
                  <Surface key={s.label} style={styles.statKort}>
                    <Text style={styles.statLabel}>{s.label}</Text>
                    <Text style={[
                      styles.statVerdi,
                      s.verdi === "Økende" ? styles.trendOpp :
                      s.verdi === "Synkende" ? styles.trendNed : undefined,
                    ]}>{s.verdi}</Text>
                  </Surface>
                ))}
              </View>

              {/* ── Fordeling — art / tidspunkt / type samlet i én overflate
                  med interne skillelinjer i stedet for tre separate kort
                  (§3: mindre kort-søppel — dette er tre snitt av samme
                  observasjonssett, ikke tre urelaterte tema). ── */}
              <Surface style={styles.kortCard}>
                <Text style={styles.kortTittel}>Fordeling</Text>

                <Text style={styles.underTittel}>Etter art</Text>
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

                <View style={styles.seksjonDeler} />

                <Text style={styles.underTittel}>Etter tidspunkt</Text>
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

                <View style={styles.seksjonDeler} />

                <Text style={styles.underTittel}>Etter type</Text>
                {typeStatistikk.map((item, i) => (
                  <View key={item.type} style={[styles.typeRad, i === typeStatistikk.length - 1 && styles.typeRadSiste]}>
                    <Text style={styles.typeTekst}>{item.type}</Text>
                    <Text style={styles.typeAntall}>{item.antall}</Text>
                  </View>
                ))}
              </Surface>

              {/* ── Hotspots ── */}
              <Surface style={styles.kortCard}>
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
              </Surface>

              {/* ── Lenker ── */}
              <View style={styles.lenkRad}>
                <Link href="/kart" asChild>
                  <Pressable style={styles.lenkKnapp}>
                    <Ionicons name="map-outline" size={15} color={color.primarySoft} />
                    <Text style={styles.lenkTekst}>Kart</Text>
                  </Pressable>
                </Link>
                <Link href="/logg" asChild>
                  <Pressable style={styles.lenkKnapp}>
                    <Ionicons name="add-circle-outline" size={15} color={color.primarySoft} />
                    <Text style={styles.lenkTekst}>Logg obs</Text>
                  </Pressable>
                </Link>
                <Link href="/jakt" asChild>
                  <Pressable style={styles.lenkKnappJakt}>
                    <Ionicons name="trophy-outline" size={15} color={color.warning} />
                    <Text style={styles.lenkTekstJakt}>Jakt</Text>
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
  safe:   { flex: 1, backgroundColor: color.background },
  screen: { flex: 1 },
  container: { paddingHorizontal: spacing.xl - 2, paddingTop: spacing.sm, paddingBottom: 160 },

  header:   { paddingVertical: spacing.xl },
  eyebrow:  { ...typography.eyebrow, color: color.primary, letterSpacing: 2.5, marginBottom: spacing.sm + 2 },
  title:    { fontSize: 34, fontWeight: "900", letterSpacing: -0.5, color: color.textPrimary },
  subtitle: { color: color.textMuted, fontSize: 14, marginTop: spacing.xs + 2 },

  loadCard: { padding: spacing.xxl + 4, alignItems: "center" },
  loadTitle: { color: color.textPrimary, fontSize: 16, fontWeight: "800", marginTop: spacing.md + 2 },
  errorCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm + 2,
    backgroundColor: color.danger + alpha.soft,
    borderWidth: 1, borderColor: color.danger + alpha.medium,
    borderRadius: radius.lg, padding: spacing.lg + 2,
  },
  errorText: { color: color.danger, fontSize: 14, flex: 1 },

  // Vær + Månefase + Vind — samlet i én Surface (§3)
  miljøRad: { flexDirection: "row", marginBottom: spacing.md + 2, padding: spacing.md + 2 },
  miljøKol: { flex: 1, alignItems: "center", paddingHorizontal: spacing.xs },
  miljøKolDelt: { borderLeftWidth: 1, borderLeftColor: color.border },
  miljøLabel: { color: color.textFaint, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginTop: spacing.sm, marginBottom: spacing.xs },
  miljøVerdi: { color: color.textPrimary, fontSize: 14, fontWeight: "900", textAlign: "center" },
  miljøSub:   { color: color.textFaint, fontSize: 11, marginTop: 2, textAlign: "center" },

  vindRad: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: color.primary + alpha.soft,
    borderRadius: radius.md - 2, borderWidth: 1, borderColor: color.primary + alpha.medium,
    paddingHorizontal: spacing.md + 2, paddingVertical: spacing.sm + 3, marginBottom: spacing.xl,
  },
  vindRadText: { color: color.primarySoft, fontSize: 13, fontWeight: "600", flex: 1 },

  // Prediksjon
  predSection: { marginBottom: spacing.xl },
  sectionTitle: { ...typography.sectionTitle, color: color.textPrimary, fontSize: 18, marginBottom: spacing.xs },
  sectionSub:   { color: color.textFaint, fontSize: 13, marginBottom: spacing.md + 2 },
  dyrFaneRad:   { gap: spacing.sm, paddingRight: spacing.xs, marginBottom: spacing.md + 2 },
  dyrFane: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill, backgroundColor: color.surface,
    borderWidth: 1, borderColor: color.border,
  },
  dyrFaneActive:       { backgroundColor: color.surfaceHover, borderColor: color.primary },
  dyrFaneTekst:        { color: color.textMuted, fontSize: 13, fontWeight: "700" },
  dyrFaneTekstActive:  { color: color.primarySoft, fontWeight: "800" },

  predKort: { padding: spacing.lg + 2 },
  predAktRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  predAktLabel: { color: color.textMuted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  predAktVerdi: { fontSize: 22, fontWeight: "900" },
  predMåler: { height: 8, backgroundColor: color.background, borderRadius: 4, overflow: "hidden", marginBottom: spacing.lg },
  predMålerFyll: { height: "100%", borderRadius: 4 },

  // To underceller delt av én skillelinje i stedet for to egne bordered kort
  predGrid: { flexDirection: "row", marginBottom: spacing.md + 2, backgroundColor: color.background, borderRadius: radius.md, borderWidth: 1, borderColor: color.border },
  predCelle: { flex: 1, padding: spacing.md },
  predCelleDelt: { borderLeftWidth: 1, borderLeftColor: color.border },
  predCelleLabel: { color: color.textFaint, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: spacing.xs + 2 },
  predCelleVerdi: { color: color.textPrimary, fontSize: 13, fontWeight: "800" },
  predCelleSub:   { color: color.textFaint, fontSize: 11, marginTop: 3 },

  predSannsynlig: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.sm - 1,
    backgroundColor: color.primary + alpha.soft,
    borderRadius: radius.md - 2, padding: spacing.md,
    marginBottom: spacing.lg, borderWidth: 1, borderColor: color.primary + alpha.medium,
  },
  predSannsynligTekst: { color: color.primarySoft, fontSize: 13, lineHeight: 20, flex: 1 },

  // 24t aktivitetsgraf
  aktivGraf: {
    flexDirection: "row", alignItems: "flex-end",
    height: 44, gap: 2, marginBottom: spacing.xs,
  },
  aktivSøyleWrap: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: 44 },
  aktivSøyle: { width: "80%", backgroundColor: color.borderStrong, borderRadius: 2, minHeight: 2 },
  aktivSøyleNå: { backgroundColor: color.primary },
  aktivGrafLabels: { flexDirection: "row", justifyContent: "space-between" },
  aktivGrafLabel:  { color: color.textFaint, fontSize: 10 },

  // Jaktsesong
  sesongerKort: { padding: spacing.lg + 2, marginBottom: spacing.lg },

  // Segment / Periode
  segmentWrap: {
    flexDirection: "row", backgroundColor: color.surface,
    borderRadius: radius.md + 2, borderWidth: 1, borderColor: color.border,
    padding: spacing.xs, marginBottom: spacing.md + 2,
  },
  segBtn:         { flex: 1, paddingVertical: spacing.sm + 3, borderRadius: radius.md - 2, alignItems: "center" },
  segBtnActive:   { backgroundColor: color.surfaceHover, borderWidth: 1, borderColor: color.primary },
  segTekst:       { color: color.textMuted, fontSize: 14, fontWeight: "700" },
  segTekstActive: { color: color.primarySoft, fontWeight: "800" },

  // Stats
  statsRad: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md + 2 },
  statKort: { flex: 1, padding: spacing.md + 2, alignItems: "center" },
  statLabel:  { color: color.textFaint, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: spacing.sm },
  statVerdi:  { color: color.textPrimary, fontSize: 20, fontWeight: "900", textAlign: "center" },
  trendOpp:   { color: color.success },
  trendNed:   { color: color.danger },

  // Kort-kort
  kortCard: { padding: spacing.lg + 2, marginBottom: spacing.md },
  kortTittel: { color: color.textPrimary, fontSize: 16, fontWeight: "900", marginBottom: spacing.md + 2 },
  underTittel: {
    color: color.textFaint, fontSize: 11, fontWeight: "800", textTransform: "uppercase",
    letterSpacing: 0.8, marginBottom: spacing.md,
  },
  seksjonDeler: { height: 1, backgroundColor: color.border, marginVertical: spacing.md + 2 },
  barRad: { marginBottom: spacing.md + 2 },
  barLeft: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xs + 2 },
  barDyr:  { color: color.textPrimary, fontSize: 14, fontWeight: "700" },
  barMeta: { color: color.textFaint, fontSize: 12 },
  barTrack: { height: 8, backgroundColor: color.background, borderRadius: 4, overflow: "hidden" },
  barFyll:  { height: "100%", borderRadius: 4, backgroundColor: color.primary },
  barFyllSoft: { height: "100%", borderRadius: 4, backgroundColor: color.info },

  hotspotRad: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  hotspotRang: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: color.primary + alpha.soft, borderWidth: 1, borderColor: color.primary + alpha.medium,
    alignItems: "center", justifyContent: "center",
  },
  hotspotRangTekst: { color: color.primarySoft, fontSize: 12, fontWeight: "900" },
  hotspotLabel:     { color: color.textPrimary, fontSize: 13, fontWeight: "700" },
  hotspotMeta:      { color: color.textFaint, fontSize: 12, marginTop: 3 },

  typeRad: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: spacing.sm + 3, borderBottomWidth: 1, borderBottomColor: color.border,
  },
  typeRadSiste: { borderBottomWidth: 0 },
  typeTekst:   { color: color.textPrimary, fontSize: 14, fontWeight: "700" },
  typeAntall:  { color: color.textMuted, fontSize: 14, fontWeight: "700" },
  tomTekst:    { color: color.textFaint, fontSize: 13 },

  lenkRad:  { flexDirection: "row", gap: spacing.sm },
  lenkKnapp: {
    flex: 1, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border,
    borderRadius: radius.md, paddingVertical: spacing.md + 2,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm - 1,
  },
  lenkKnappAlt: { borderColor: color.warning + alpha.medium, backgroundColor: color.warning + alpha.soft },
  lenkTekst:    { color: color.primarySoft, fontSize: 13, fontWeight: "800" },
  // Egne, allerede sammenslåtte stiler (ikke array-stil) for lenken som går
  // til Link asChild — en array-verdi på style-propen til Link sitt direkte
  // barn utløste en react-native-web-krasj ("Failed to set an indexed
  // property [0] on 'CSSStyleDeclaration'") ved første mount på web.
  lenkKnappJakt: {
    flex: 1, backgroundColor: color.warning + alpha.soft, borderWidth: 1, borderColor: color.warning + alpha.medium,
    borderRadius: radius.md, paddingVertical: spacing.md + 2,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm - 1,
  },
  lenkTekstJakt: { color: color.warning, fontSize: 13, fontWeight: "800" },
});
