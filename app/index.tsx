import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import BottomDock from "../components/BottomDock";
import Surface from "../components/ui/Surface";
import Avatar from "../components/ui/Avatar";
import StatCard from "../components/ui/StatCard";
import { color as uiColor, spacing as uiSpacing, radius as uiRadius, typography as uiType, heat as uiHeat, levelColor } from "../src/design/tokens";
import { auth } from "../src/config/firebase";
import { getAktivtJaktlagId, hentJaktlag, subscribeMedlemmer, type Jaktlag, type Medlem } from "../src/services/jaktlag";
import {
  getUserPosition,
  syncUserLocation,
  subscribeToJaktlagLocations,
  type UserPosition,
  type MedlemPosisjon,
} from "../src/services/location";
import { subscribeToNearbyObservations, drainOfflineQueue } from "../src/services/observations";
import { getSettings, saveSettings, DEFAULT_SETTINGS, type AppSettings } from "../src/services/settings";
import { hentVær, type VærData } from "../src/services/weather";
import { subscribeToMinProfil, type MinProfil } from "../src/services/profile";
import { fetchElevationMeters } from "../src/engine/environment/elevation";
import type { Observasjon } from "../src/types/observation";
import { utledNavnFraEpost } from "../src/lib/navn";
import { calcBearing, distanceMeters, vindRetningLabel } from "../src/lib/geo";
import { hentRelativTid } from "../src/lib/aktivitet";
import { useUlesteMeldinger } from "../src/hooks/useUlesteMeldinger";
import {
  runEngine,
  runEcologicalEngine,
  resolveEnvironmentContext,
  PRIORITERTE_ARTER,
  type EnvironmentResolver,
  type EngineResult,
  type HeatmapPoint,
  type PredictionZone,
  type Species,
} from "../src/engine";
import { getCachedIntelligenceResult, setCachedIntelligenceResult } from "../src/engine/resultCache";
import { MIN_ANALYSIS_RADIUS_METERS } from "../src/lib/analysisAnchor";
import { breadcrumb } from "../src/lib/debugBreadcrumb";

/**
 * Hjem har ingen kart-viewport å avlede en analyseradius fra (V1.3s
 * deriveViewportRadiusMeters() er for Kart) — gjenbruker i stedet motorens
 * egen etablerte NEDRE grense (samme tall Kart aldri går under selv ved
 * ekstremt nært zoom) som et fast, fornuftig "området rundt deg nå"-omfang,
 * fremfor å finne på et nytt tall.
 */
const HJEM_ANALYSE_RADIUS_METER = MIN_ANALYSIS_RADIUS_METERS;

const NORSK_ART: Record<Species, string> = { hjort: "Hjort", radyr: "Rådyr", elg: "Elg", annet: "Annet" };
/**
 * Art-karusell-oppdraget: hero-kortet er nå en SWIPEBAR karusell mellom disse
 * tre artene (Hjort ↔ Rådyr ↔ Elg, wrap-around) — IKKE lenger ett statisk
 * bilde etter motorens automatisk beste art. "annet"/Rev har ingen egen
 * hero/profil og er derfor bevisst utelatt fra karusellen.
 */
const SPECIES_ORDER: readonly Species[] = ["hjort", "radyr", "elg"];
/** Minimum horisontal drakraft (px) før et swipe telles som et art-bytte, ikke en tilfeldig touch/skrolljitter. */
const SWIPE_TERSKEL_PX = 40;
/** Statisk bilde per art — følger nå `selectedSpecies` (karusellens gjeldende art), ikke lenger motorens automatisk beste. "annet" har ingen egen artsprofil ennå (jf. EngineStatusPanel sin erEksperimentellArt), så den faller tilbake til hjort-bildet. */
const HERO_BILDE_ASPECT = 1748 / 900;
const HERO_KORT_HØYDE = 260;
const HERO_BILDE_BREDDE = Math.round(HERO_KORT_HØYDE * HERO_BILDE_ASPECT);
const HERO_BILDE: Record<Species, ImageSourcePropType> = {
  hjort: require("../assets/hero/hjort.png"),
  radyr: require("../assets/hero/radyr.png"),
  elg: require("../assets/hero/elg.png"),
  annet: require("../assets/hero/hjort.png"),
};
const RETNING_NAVN: Record<string, string> = { N: "Nord", NØ: "Nordøst", Ø: "Øst", SØ: "Sørøst", S: "Sør", SV: "Sørvest", V: "Vest", NV: "Nordvest" };
const PRESENCE_TERSKEL_MS = 30 * 60 * 1000;

/**
 * Redesign-oppdraget §12/§13: hero-kortet skal ha en SVAK glød bak seg som
 * antyder aktivitetsnivå — varm ved høy aktivitet, rolig/kjølig ved lav —
 * ALDRI et heldekket farget kort. "Moderat" holdes bevisst dempet (samme
 * som "Lav") — kun Høy/Svært høy får den varme tonen.
 */
function heroGlow(level: string): readonly [string, string] {
  if (level === "Svært høy") return uiHeat.glowSevere;
  if (level === "Høy") return uiHeat.glowHigh;
  return uiHeat.glowLow;
}

function hilsen(): string {
  const t = new Date().getHours();
  if (t < 10) return "God morgen";
  if (t < 17) return "God dag";
  return "God kveld";
}

function avstandLabel(meter: number): string {
  if (meter < 1000) return `ca. ${Math.round(meter / 10) * 10} m`;
  return `ca. ${(meter / 1000).toFixed(1).replace(".", ",")} km`;
}

// ─── Komponent ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const router = useRouter();
  const [observasjoner, setObservasjoner] = useState<Observasjon[]>([]);
  const [laster,        setLaster]        = useState(true);
  const [feiltekst,     setFeiltekst]     = useState("");
  const [userPos,       setUserPos]       = useState<UserPosition | null>(null);
  const [vær,           setVær]           = useState<VærData | null>(null);
  const [høydeMeter,    setHøydeMeter]    = useState<number | null>(null);
  const [profil,        setProfil]        = useState<MinProfil | null>(null);
  const [jaktlag,       setJaktlag]       = useState<Jaktlag | null>(null);
  const [medlemmer,     setMedlemmer]     = useState<Medlem[]>([]);
  const [posisjoner,    setPosisjoner]    = useState<MedlemPosisjon[]>([]);
  const [environmentResolver, setEnvironmentResolver] = useState<EnvironmentResolver | null>(null);
  const [miljoFeil,     setMiljoFeil]     = useState(false);
  // Art-karusell (§1-§5 i oppdraget): hvilken art hero-kortet/mini-kartet
  // viser nå. Delt med Kart sitt artsfilter via settings.ts (§3) — lastes fra
  // lagrede innstillinger under, IKKE alltid "hjort" ved friskt oppstart.
  const [selectedSpecies, setSelectedSpecies] = useState<Species>(DEFAULT_SETTINGS.selectedSpecies);
  const [appSettings,   setAppSettings]    = useState<AppSettings | null>(null);
  const selectedSpeciesRef = useRef(selectedSpecies);
  selectedSpeciesRef.current = selectedSpecies;
  const uleste = useUlesteMeldinger();

  // Endrer gjeldende art (fra swipe ELLER tapp på prikk-indikatoren) og
  // skriver den STRAKS tilbake til den delte settings.ts-lagringen — samme
  // objekt Kart sitt artsfilter leser/skriver (§3/§4). Funksjonell
  // setSettingsState-oppdatering sikrer at vi aldri overskriver andre,
  // allerede lagrede felt (radiusKm/notificationsEnabled) med en gammel kopi.
  const selectSpecies = useCallback((next: Species) => {
    setSelectedSpecies(next);
    setAppSettings((prev) => {
      const merged: AppSettings = { ...(prev ?? DEFAULT_SETTINGS), selectedSpecies: next };
      saveSettings(merged).catch(() => {});
      return merged;
    });
  }, []);

  const cycleSpecies = useCallback(
    (retning: 1 | -1) => {
      const idx = SPECIES_ORDER.indexOf(selectedSpeciesRef.current);
      const neste = SPECIES_ORDER[(idx + retning + SPECIES_ORDER.length) % SPECIES_ORDER.length];
      selectSpecies(neste);
    },
    [selectSpecies]
  );

  // react-native-gesture-handler sin Gesture.Pan() — begrenset til hovedsakelig
  // HORISONTAL bevegelse (§8) slik at et vertikalt drag på hero-kortet
  // fortsatt ruller siden normalt i stedet for å bli tolket som et art-bytte.
  // .onEnd kjører som en "worklet" (reanimated sin babel-plugin, allerede i
  // bruk via BottomSheet.tsx) — runOnJS kreves for å nå selectSpecies (vanlig
  // JS-funksjon, ikke UI-tråd-trygg).
  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-14, 14])
        .failOffsetY([-16, 16])
        .onEnd((e) => {
          if (e.translationX <= -SWIPE_TERSKEL_PX) {
            runOnJS(cycleSpecies)(1);
          } else if (e.translationX >= SWIPE_TERSKEL_PX) {
            runOnJS(cycleSpecies)(-1);
          }
        }),
    [cycleSpecies]
  );

  useFocusEffect(
    useCallback(() => {
      const unsub = subscribeToMinProfil(setProfil);
      return unsub;
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      let unsubMedlemmer: (() => void) | undefined;
      let unsubPosisjoner: (() => void) | undefined;
      let aktiv = true;
      (async () => {
        const jaktlagId = await getAktivtJaktlagId();
        if (!aktiv) return;
        if (!jaktlagId) { setJaktlag(null); setMedlemmer([]); setPosisjoner([]); return; }
        const jl = await hentJaktlag(jaktlagId);
        if (!aktiv) return;
        setJaktlag(jl);
        unsubMedlemmer = subscribeMedlemmer(jaktlagId, (m) => { if (aktiv) setMedlemmer(m); });
        unsubPosisjoner = subscribeToJaktlagLocations(jaktlagId, (p) => { if (aktiv) setPosisjoner(p); });
      })();
      return () => { aktiv = false; unsubMedlemmer?.(); unsubPosisjoner?.(); };
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      let unsub: (() => void) | undefined;
      let aktiv = true;
      (async () => {
        try {
          breadcrumb("focus_effect_start");
          setLaster(true);
          setFeiltekst("");
          const settings = await getSettings();
          if (!aktiv) return;
          breadcrumb("got_settings");
          // §3: leses på nytt ved HVERT fokus (inkl. tilbake fra Kart) — dette er
          // den etablerte, enkle synkroniseringen mellom Hjem sin karusell og
          // Kart sitt artsfilter (ingen reaktivt abonnement finnes i settings.ts).
          setAppSettings(settings);
          setSelectedSpecies(settings.selectedSpecies);
          const pos: UserPosition | null = await getUserPosition();
          if (!aktiv) return;
          if (!pos) {
            breadcrumb("no_position");
            setFeiltekst("Fant ikke posisjonen din.");
            setLaster(false);
            return;
          }
          breadcrumb("got_position", { lat: pos.latitude, lng: pos.longitude });
          setUserPos(pos);
          await syncUserLocation({ latitude: pos.latitude, longitude: pos.longitude });
          if (!aktiv) return;
          breadcrumb("synced_location");
          drainOfflineQueue().catch(() => {});
          hentVær(pos.latitude, pos.longitude).then((v) => { if (aktiv) setVær(v); }).catch(() => {});
          fetchElevationMeters(pos).then((h) => { if (aktiv) setHøydeMeter(h); }).catch(() => {});
          unsub = subscribeToNearbyObservations(
            { center: pos, radiusKm: settings.radiusKm },
            (liste) => {
              if (!aktiv) return;
              setObservasjoner(liste);
              setLaster(false);
            },
            (err) => {
              if (!aktiv) return;
              console.log("Firestore feil:", err);
              setFeiltekst("Klarte ikke hente observasjoner.");
              setLaster(false);
            }
          );
          breadcrumb("subscribed_observations");
        } catch (e) {
          if (!aktiv) return;
          breadcrumb("init_error", { message: String(e) });
          console.log("init-feil:", e);
          setFeiltekst("Noe gikk galt ved oppstart.");
          setLaster(false);
        }
      })();
      return () => { aktiv = false; unsub?.(); };
    }, [])
  );

  // ─── Miljøoppslag for cold-start (§1–§4: Hjem skal IKKE kreve observasjoner
  // for å produsere en anbefaling) ────────────────────────────────────────
  // Samme mønster som kart.tsx: resolveEnvironmentContext() gjør de faktiske
  // nettverkskallene (habitat/høyde/vann/vei/vær) ASYNKRONT, mens selve
  // motorkjøringen (runEcologicalEngine) forblir synkron/deterministisk.
  // Blokkerer ALDRI første rendering av Hjem (§27/eksisterende "aldri vent på
  // nettverk"-prinsipp) — inntil dette er ferdig faller besteAnbefaling
  // tilbake til den rene observasjonsmotoren, nøyaktig som kart.tsx sin egen
  // progressive opptrapping (environmentResolver ? runEcologicalEngine : runEngine).
  useEffect(() => {
    if (userPos) breadcrumb("minimap_render_gate_open");
  }, [userPos]);

  useEffect(() => {
    if (!userPos) return;
    let aktiv = true;
    setMiljoFeil(false);
    resolveEnvironmentContext(userPos, HJEM_ANALYSE_RADIUS_METER)
      .then((resolver) => { if (aktiv) { breadcrumb("environment_resolver_ready"); setEnvironmentResolver(() => resolver); } })
      .catch(() => { if (aktiv) setMiljoFeil(true); });
    return () => { aktiv = false; };
  }, [userPos]);

  // ─── Beregnede verdier ────────────────────────────────────────────────────

  // Ett motorresultat PER ART, cache-først (samme canonical resultat Kart
  // skriver til src/engine/resultCache.ts) — og når intet ferskt er cachet,
  // kjører Hjem NÅ selv den fulle økologiske motoren (miljøbasert cold-start)
  // i stedet for å falle tilbake til den observasjons-blinde runEngine().
  // runEngine() er fortsatt second-tier fallback for det korte vinduet mens
  // environmentResolver ennå ikke er klar, eller hvis miljøoppslaget feilet.
  const alleResultater = useMemo(() => {
    const out: Partial<Record<Species, { result: EngineResult; fraCache: boolean; ecological: boolean }>> = {};
    for (const species of PRIORITERTE_ARTER) {
      const cached = getCachedIntelligenceResult(species);
      // Et cachet resultat brukes KUN som autoritativt hvis det er økologisk
      // (miljøbasert), eller hvis Hjem selv fortsatt mangler en klar
      // environmentResolver — en tidligere skrevet SVAK, rent
      // observasjonsbasert cache-oppføring skal aldri "forgifte" caches og
      // hindre en senere, bedre økologisk beregning fra å faktisk kjøre (se
      // §3-funnet: dette var den reelle root cause bak tom cold-start-visning).
      if (cached && (cached.ecological || !environmentResolver)) {
        out[species] = { result: cached.result, fraCache: true, ecological: cached.ecological };
        continue;
      }
      const ecological = !!(environmentResolver && userPos);
      const result = ecological
        ? runEcologicalEngine(observasjoner, species, {
            areaCenter: userPos!,
            areaRadiusMeters: HJEM_ANALYSE_RADIUS_METER,
            environment: environmentResolver!,
          })
        : runEngine(observasjoner, species);
      out[species] = { result, fraCache: false, ecological };
    }
    return out;
  }, [observasjoner, environmentResolver, userPos]);

  // Skriv ferske (ikke cache-hentede) resultater tilbake til DEN SAMME delte
  // cachen Kart bruker — sikrer at Kart/Jakt gjenbruker Hjem sin allerede
  // beregnede cold-start-vurdering i stedet for å regne den helt på nytt
  // (§11: Home og Map skal aldri kunne vise to ulike "beste område").
  useEffect(() => {
    for (const species of PRIORITERTE_ARTER) {
      const entry = alleResultater[species];
      if (entry && !entry.fraCache) {
        setCachedIntelligenceResult(species, entry.result, entry.ecological);
      }
    }
  }, [alleResultater]);

  // Karusellens gjeldende visning — FØLGER `selectedSpecies` (bruker-styrt
  // via swipe/prikk-tapp), IKKE lenger et automatisk "plukk høyest score på
  // tvers av alle arter"-valg. alleResultater over har allerede (eagerly,
  // hver render) beregnet et fullt EngineResult for ALLE TRE arter — å bytte
  // art her er derfor bare en indeksering, ingen ny motorkjøring (§2/§7).
  const gjeldendeAnbefaling = useMemo(() => {
    const entry = alleResultater[selectedSpecies];
    const sone = entry?.result.zones[0];
    if (!entry || !sone) return null;
    return { species: selectedSpecies, zone: sone, heatmapPoints: entry.result.heatmapPoints, ecological: entry.ecological };
  }, [alleResultater, selectedSpecies]);

  // Valgfri "beste"-indikator (§5, nice-to-have): hvilken art scorer HØYEST
  // akkurat nå, uavhengig av hva brukeren har valgt å se på — vises som en
  // liten stjerne ved prikk-indikatoren, IKKE som et automatisk bytte.
  const besteArt = useMemo(() => {
    let beste: { species: Species; score: number } | null = null;
    for (const species of PRIORITERTE_ARTER) {
      const sone = alleResultater[species]?.result.zones[0];
      if (sone && (!beste || sone.score > beste.score)) {
        beste = { species, score: sone.score };
      }
    }
    return beste?.species ?? null;
  }, [alleResultater]);

  const retningTilSone = useMemo(() => {
    if (!userPos || !gjeldendeAnbefaling) return null;
    const bearing = calcBearing(userPos, gjeldendeAnbefaling.zone.center);
    const avstand = distanceMeters(userPos, gjeldendeAnbefaling.zone.center);
    return { navn: RETNING_NAVN[vindRetningLabel(bearing)], avstand };
  }, [userPos, gjeldendeAnbefaling]);

  const egenUid = auth.currentUser?.uid;
  const erLeder = !!jaktlag && jaktlag.lederUid === egenUid;

  const aktiveITerrenget = useMemo(
    () =>
      posisjoner.filter((p) => {
        const ms = p.updatedAt?.toMillis?.();
        return typeof ms === "number" && Date.now() - ms <= PRESENCE_TERSKEL_MS;
      }).length,
    [posisjoner]
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Topprad: merkevare + chat/varsel-ikoner ── */}
          <View style={styles.brandRow}>
            <View style={styles.brandWordmark}>
              <Text style={styles.brandVilt}>Vilt</Text>
              <Text style={styles.brandIQ}>IQ</Text>
            </View>
            <View style={styles.brandActions}>
              <Pressable testID="varsler-knapp" style={styles.iconBtn} hitSlop={8} onPress={() => router.push("/varsler")}>
                <Ionicons name="notifications-outline" size={19} color={uiColor.textSecondary} />
                {uleste > 0 && <View style={styles.iconBadge}><Text style={styles.iconBadgeText}>{uleste > 9 ? "9+" : uleste}</Text></View>}
              </Pressable>
              <Pressable testID="chat-knapp" style={styles.iconBtn} hitSlop={8} onPress={() => router.push("/chat")}>
                <Ionicons name="chatbubble-ellipses-outline" size={19} color={uiColor.textSecondary} />
                {uleste > 0 && <View style={styles.iconBadge}><Text style={styles.iconBadgeText}>{uleste > 9 ? "9+" : uleste}</Text></View>}
              </Pressable>
            </View>
          </View>

          {/* ── Hilsen + jaktlag-badge ── */}
          <View style={styles.greetRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greetTitle}>{hilsen()}{profil ? `, ${profil.displayName.split(" ")[0]}!` : "!"}</Text>
              <Text style={styles.greetSubtitle}>
                {NORSK_ART[selectedSpecies]}
                {" · "}
                {new Date().toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })}
              </Text>
            </View>
            {jaktlag && (
              <View style={styles.jaktlagPill}>
                <Text style={styles.jaktlagPillNavn} numberOfLines={1}>{jaktlag.navn}</Text>
                <Text style={styles.jaktlagPillRolle}>{erLeder ? "Leder" : "Medlem"}</Text>
              </View>
            )}
          </View>

          {/* ── Loading / Feil ── */}
          {laster ? (
            <View style={styles.loadCard}>
              <ActivityIndicator size="large" color="#2CC36B" />
              <Text style={styles.loadTitle}>Laster feltdata...</Text>
            </View>
          ) : feiltekst ? (
            <View style={styles.errorCard}>
              <Ionicons name="warning-outline" size={20} color={uiColor.danger} />
              <View style={{ flex: 1 }}>
                <Text style={styles.errorTitle}>Kunne ikke laste data</Text>
                <Text style={styles.errorText}>{feiltekst}</Text>
              </View>
            </View>
          ) : (
            <>
              {/* ── Beste område nå — hero-KARUSELL: swipe/tapp bytter art, samme
                  layout, ekte motorresultat per art (§1/§2/§8) ── */}
              <GestureDetector gesture={swipeGesture}>
                <View style={styles.besteGlowWrap}>
                  {gjeldendeAnbefaling && (
                    <LinearGradient
                      colors={heroGlow(gjeldendeAnbefaling.zone.level)}
                      style={StyleSheet.absoluteFillObject}
                      pointerEvents="none"
                    />
                  )}
                  <View style={styles.besteCard}>
                    <Image
                      source={HERO_BILDE[selectedSpecies]}
                      style={styles.besteBilde}
                    />
                    <LinearGradient
                      colors={["rgba(4,10,6,0.94)", "rgba(4,10,6,0.62)", "rgba(4,10,6,0.05)"]}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={StyleSheet.absoluteFillObject}
                      pointerEvents="none"
                    />

                    <View style={styles.besteOverlay}>
                      <Text style={styles.besteEyebrow}>Beste område nå</Text>

                      {gjeldendeAnbefaling ? (
                        <>
                          <Text style={[styles.besteNivaa, { color: levelColor(gjeldendeAnbefaling.zone.level) }]}>
                            {gjeldendeAnbefaling.zone.level} sannsynlighet
                          </Text>
                          <Text style={styles.besteScorePill}>{Math.round(gjeldendeAnbefaling.zone.score)}/100</Text>
                          {retningTilSone && (
                            <Text style={styles.besteRetning}>
                              {retningTilSone.navn} for deg · {avstandLabel(retningTilSone.avstand)}
                            </Text>
                          )}
                          <Text style={styles.besteSummary} numberOfLines={3}>
                            {gjeldendeAnbefaling.zone.recommendation?.summary || gjeldendeAnbefaling.zone.explanation}
                          </Text>
                          {gjeldendeAnbefaling.zone.predictionMode === "environment_only" && (
                            <Text style={styles.besteColdStart}>Cold start · miljøbasert</Text>
                          )}
                        </>
                      ) : miljoFeil ? (
                        <Text style={styles.noDataText}>
                          Fikk ikke hentet miljødata for området ditt akkurat nå — sjekk nettforbindelsen. Legg gjerne inn en observasjon i Logg i mellomtiden.
                        </Text>
                      ) : !environmentResolver ? (
                        <View style={styles.besteLasterRad}>
                          <ActivityIndicator size="small" color="#FFFFFF" />
                          <Text style={styles.besteLasterText}>Analyserer {NORSK_ART[selectedSpecies].toLowerCase()}...</Text>
                        </View>
                      ) : (
                        <Text style={styles.noDataText}>
                          Ingen tydelig vurdering for {NORSK_ART[selectedSpecies].toLowerCase()} i dette området ennå.
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* ── Art-indikator: prikk + navn per art, tappbar for direkte hopp (§5) ── */}
                  <View style={styles.artDotsRad}>
                    {SPECIES_ORDER.map((art) => {
                      const aktiv = art === selectedSpecies;
                      return (
                        <Pressable
                          key={art}
                          testID={`art-dott-${art}`}
                          onPress={() => selectSpecies(art)}
                          hitSlop={8}
                          style={styles.artDott}
                        >
                          <View style={[styles.artPrikk, aktiv && styles.artPrikkAktiv]} />
                          <Text style={[styles.artDottTekst, aktiv && styles.artDottTekstAktiv]}>
                            {NORSK_ART[art]}{besteArt === art && !aktiv ? " ★" : ""}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </GestureDetector>

              {/* ── Planlegg jakt ── erstatter det tidligere mini-kartet
                  (MiniMapPreview) — den native kart-visningen krasjet appen
                  og var allerede diagnostisk avskrudd (DIAGNOSTIC_DISABLE_
                  NATIVE_MAP), så den viste uansett bare en "Kart (diagnose:
                  deaktivert)"-plassholder her, ikke noe reelt kart. Samme
                  CTA-mønster/stil som Jakt-fanens "Dagens jakt"-kort
                  (dagensBtn/dagensBtnSecondary) — "Planlegg jakten" åpner
                  Kart med Jaktplan-arket auto-åpnet (openPlan=1), "Se på
                  kart" åpner Kart uten det, samme dyplenke-mønster som
                  knappene der alltid har brukt. */}
              <View style={styles.section}>
                <Surface variant="elevated" style={styles.planleggKort}>
                  <Text style={styles.planleggEyebrow}>Planlegg jakt</Text>
                  {gjeldendeAnbefaling ? (
                    <>
                      <Pressable
                        style={styles.planleggBtn}
                        onPress={() =>
                          router.push({
                            pathname: "/kart",
                            params: {
                              focusLat: String(gjeldendeAnbefaling.zone.center.latitude),
                              focusLng: String(gjeldendeAnbefaling.zone.center.longitude),
                              filter: NORSK_ART[selectedSpecies],
                              heatmap: "1",
                              openPlan: "1",
                            },
                          })
                        }
                      >
                        <Ionicons name="compass-outline" size={15} color={uiColor.primaryText} />
                        <Text style={styles.planleggBtnTxt}>Planlegg jakten</Text>
                      </Pressable>
                      <Pressable
                        style={styles.planleggBtnSecondary}
                        onPress={() =>
                          router.push({
                            pathname: "/kart",
                            params: {
                              focusLat: String(gjeldendeAnbefaling.zone.center.latitude),
                              focusLng: String(gjeldendeAnbefaling.zone.center.longitude),
                              filter: NORSK_ART[selectedSpecies],
                              heatmap: "1",
                            },
                          })
                        }
                      >
                        <Ionicons name="map-outline" size={15} color={uiColor.textSecondary} />
                        <Text style={styles.planleggBtnSecondaryTxt}>Se på kart</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Text style={styles.planleggForklaring}>
                      {userPos
                        ? "Ikke nok ferske observasjoner i området til en tydelig anbefaling ennå."
                        : "Trenger posisjon for å vurdere dagens jakt — sjekk stedstjenester."}
                    </Text>
                  )}
                </Surface>
              </View>

              {/* ── Statrad ── */}
              <View style={styles.statRow}>
                <StatCard icon="navigate-outline" label="Vind" value={vær ? `${vindRetningLabel(vær.vindRetning)} ${Math.round(vær.vindHastighet)} m/s` : "—"} tone={uiColor.info} />
                <StatCard icon="thermometer-outline" label="Temperatur" value={vær ? `${vær.temperatur}°` : "—"} tone={uiColor.warning} />
                <StatCard icon="triangle-outline" label="Høyde" value={høydeMeter != null ? `${Math.round(høydeMeter)} moh` : "—"} tone={uiColor.textSecondary} />
                <StatCard icon="eye-outline" label="Observasjoner" value={String(observasjoner.length)} tone={uiColor.primary} />
              </View>

              {/* ── Jaktlaget ditt ── */}
              <View style={styles.recentHeader}>
                <Text style={styles.recentTitle}>Jaktlaget ditt</Text>
                {jaktlag && <Text style={styles.recentCount}>{aktiveITerrenget + 1} aktive i terrenget</Text>}
              </View>

              {!jaktlag ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="people-outline" size={28} color={uiColor.borderStrong} />
                  <Text style={styles.emptyTitle}>Ikke med i et jaktlag ennå</Text>
                  <Text style={styles.emptyText}>Opprett eller bli med i et lag under Profil for å dele posisjon og chatte med laget.</Text>
                </View>
              ) : (
                <Surface style={styles.recentListCard}>
                  {medlemmer.map((m, i) => {
                    const erMeg = m.uid === egenUid;
                    const pos = posisjoner.find((p) => p.uid === m.uid);
                    const ms = pos?.updatedAt?.toMillis?.();
                    const erAktiv = typeof ms === "number" && Date.now() - ms <= PRESENCE_TERSKEL_MS;
                    const navn = m.navn || utledNavnFraEpost(m.epost);
                    const avstand = pos && userPos ? distanceMeters(userPos, pos) : null;
                    return (
                      <View key={m.uid} style={[styles.medlemRad, i < medlemmer.length - 1 && styles.medlemDivider]}>
                        <Avatar navn={navn} size={36} presence={erMeg ? "aktiv" : pos ? (erAktiv ? "aktiv" : "inaktiv") : undefined} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.medlemNavn} numberOfLines={1}>{navn}{erMeg ? " (deg)" : ""}</Text>
                          <Text style={styles.medlemMeta} numberOfLines={1}>
                            {erMeg
                              ? "Din posisjon"
                              : pos
                              ? `${avstand != null ? avstandLabel(avstand) : ""} · sist oppdatert ${hentRelativTid(new Date(ms!).toISOString())}`
                              : "Ingen posisjon delt"}
                          </Text>
                        </View>
                        {m.rolle === "leder" && (
                          <View style={styles.lederBadge}><Text style={styles.lederBadgeText}>Leder</Text></View>
                        )}
                      </View>
                    );
                  })}
                </Surface>
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
  safe:   { flex: 1, backgroundColor: uiColor.background },
  screen: { flex: 1 },
  scroll: { paddingTop: 16, paddingHorizontal: 18, paddingBottom: 160, width: "100%", maxWidth: 640, alignSelf: "center" },

  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: uiSpacing.lg },
  brandWordmark: { flexDirection: "row", alignItems: "baseline" },
  brandVilt: { ...uiType.sectionTitle, fontSize: 19, color: uiColor.textPrimary },
  brandIQ:   { ...uiType.sectionTitle, fontSize: 19, color: uiColor.primary },
  brandActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: uiColor.surface, borderWidth: 1, borderColor: uiColor.border,
  },
  iconBadge: {
    position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 8,
    paddingHorizontal: 3, backgroundColor: uiColor.danger, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: uiColor.background,
  },
  iconBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },

  greetRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: uiSpacing.md, marginBottom: uiSpacing.xl },
  greetTitle: { ...uiType.pageTitle, color: uiColor.textPrimary, fontSize: 26 },
  greetSubtitle: { ...uiType.body, color: uiColor.textMuted, fontSize: 13, marginTop: 4 },
  jaktlagPill: {
    backgroundColor: uiColor.surface, borderWidth: 1, borderColor: uiColor.borderStrong,
    borderRadius: uiRadius.pill, paddingHorizontal: uiSpacing.md, paddingVertical: 7, maxWidth: 150,
  },
  jaktlagPillNavn: { color: uiColor.textPrimary, fontSize: 12, fontWeight: "800" },
  jaktlagPillRolle: { color: uiColor.primary, fontSize: 10, fontWeight: "700", marginTop: 1 },

  // Loading / Error
  loadCard: {
    backgroundColor: uiColor.surface, borderRadius: 22,
    padding: 32, alignItems: "center", marginBottom: 16,
    borderWidth: 1, borderColor: uiColor.border,
  },
  loadTitle: { color: uiColor.textPrimary, fontSize: 17, fontWeight: "800", marginTop: 16 },
  errorCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: uiColor.danger + "14", borderWidth: 1, borderColor: uiColor.danger + "33",
    borderRadius: 18, padding: 18, marginBottom: 16,
  },
  errorTitle: { color: uiColor.danger, fontSize: 15, fontWeight: "800" },
  errorText:  { color: uiColor.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 20 },

  besteGlowWrap: { marginBottom: uiSpacing.lg, borderRadius: uiRadius.xl + 6, padding: 8 },
  // Art-indikator under hero-kortet — bevisst LITEN (§5: "ikke en stor
  // fane-bar"), tre tappbare navn+prikk, ikke et eget dropdown/menu-element.
  artDotsRad: {
    flexDirection: "row", justifyContent: "center", alignItems: "center",
    gap: uiSpacing.lg, marginTop: uiSpacing.sm, paddingTop: 2,
  },
  artDott: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, paddingHorizontal: 2 },
  artPrikk: { width: 6, height: 6, borderRadius: 3, backgroundColor: uiColor.borderStrong },
  artPrikkAktiv: { backgroundColor: uiColor.primary, width: 8, height: 8, borderRadius: 4 },
  artDottTekst: { color: uiColor.textFaint, fontSize: 12, fontWeight: "700" },
  artDottTekstAktiv: { color: uiColor.textPrimary, fontWeight: "900" },
  besteCard: {
    height: HERO_KORT_HØYDE, borderRadius: uiRadius.xl, overflow: "hidden", position: "relative",
    borderWidth: 1, borderColor: uiColor.borderStrong, backgroundColor: uiColor.surfaceElevated,
  },
  // Ankret til høyre kant med FASTE piksel-mål (ikke prosent/aspectRatio,
  // som viste seg å regne feil mot en fjern positionert forelder på web) —
  // dyret sitter alltid til høyre i kildebildet, så dette garanterer at HELE
  // dyret er synlig og kun det tomme rommet til venstre (der teksten uansett
  // skal ligge) beskjæres bort.
  besteBilde: {
    position: "absolute", top: 0, right: 0,
    height: HERO_KORT_HØYDE, width: HERO_BILDE_BREDDE,
  },
  besteOverlay: {
    flex: 1, justifyContent: "center",
    paddingHorizontal: uiSpacing.xl, paddingVertical: uiSpacing.xl,
    maxWidth: "68%",
  },
  besteEyebrow: {
    color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.2, marginBottom: uiSpacing.sm,
  },
  besteNivaa: { fontSize: 24, fontWeight: "900", letterSpacing: -0.4 },
  besteScorePill: {
    color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: "800", marginTop: 4,
  },
  besteRetning: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", marginTop: uiSpacing.md },
  besteSummary: {
    color: "rgba(255,255,255,0.88)", fontSize: 13, lineHeight: 19, marginTop: uiSpacing.sm,
  },
  noDataText: { color: "rgba(255,255,255,0.85)", fontSize: 14, lineHeight: 20 },
  besteColdStart: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "700", marginTop: uiSpacing.sm },
  besteLasterRad: { flexDirection: "row", alignItems: "center", gap: uiSpacing.sm },
  besteLasterText: { color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 19, flexShrink: 1 },

  section: { marginBottom: uiSpacing.lg },

  // "Planlegg jakt"-kortet — samme visuelle språk/tokens som Jakt-fanens
  // "Dagens jakt"-kort (dagensKort/dagensBtn/dagensBtnSecondary i jakt.tsx),
  // gjenbrukt her i stedet for å finne opp en ny stil for CTA-en som
  // erstattet mini-kartet.
  planleggKort:    { padding: uiSpacing.xl - 2 },
  planleggEyebrow: { ...uiType.eyebrow, color: uiColor.primary, marginBottom: uiSpacing.sm },
  planleggForklaring: { color: uiColor.textSecondary, fontSize: 13, lineHeight: 19 },
  planleggBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: uiColor.primary, borderRadius: uiRadius.md, paddingVertical: 13,
  },
  planleggBtnTxt: { color: uiColor.primaryText, fontSize: 13, fontWeight: "900" },
  planleggBtnSecondary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "transparent", borderRadius: uiRadius.md, paddingVertical: 12,
    marginTop: uiSpacing.sm, borderWidth: 1, borderColor: uiColor.border,
  },
  planleggBtnSecondaryTxt: { color: uiColor.textSecondary, fontSize: 13, fontWeight: "800" },

  statRow: { flexDirection: "row", gap: 8, marginBottom: uiSpacing.lg },

  recentHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 12,
  },
  recentTitle: { ...uiType.sectionTitle, color: uiColor.textPrimary, fontSize: 17 },
  recentCount: { ...uiType.caption, color: uiColor.textFaint },
  emptyCard: {
    backgroundColor: uiColor.surface, borderWidth: 1, borderColor: uiColor.border,
    borderRadius: 20, padding: 28, alignItems: "center", marginBottom: 12,
  },
  emptyTitle: { color: uiColor.textMuted, fontSize: 15, fontWeight: "800", marginTop: 12 },
  emptyText:  { color: uiColor.textFaint, fontSize: 13, marginTop: 6, textAlign: "center", lineHeight: 20 },

  recentListCard: { paddingHorizontal: uiSpacing.lg, marginBottom: 12 },
  medlemRad: { flexDirection: "row", alignItems: "center", gap: uiSpacing.md, paddingVertical: uiSpacing.sm + 2 },
  medlemDivider: { borderBottomWidth: 1, borderBottomColor: uiColor.border },
  medlemNavn: { ...uiType.bodyStrong, color: uiColor.textPrimary },
  medlemMeta: { ...uiType.caption, color: uiColor.textMuted, marginTop: 1 },
  lederBadge: { backgroundColor: uiColor.primary + "26", borderWidth: 1, borderColor: uiColor.primary, borderRadius: uiRadius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  lederBadgeText: { color: uiColor.primary, fontSize: 10, fontWeight: "900" },
});
