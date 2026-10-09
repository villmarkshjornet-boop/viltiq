import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { getSpeciesProfile, type PredictionZone } from "@/src/engine";
// V1.3 §O/§U: ZoneRecommendation er ikke (ennå) re-eksportert fra motorens
// offentlige barrel (src/engine/index.ts) — importert direkte fra types.ts i
// stedet for å røre index.ts, som er en av motorfilene denne oppgaven
// eksplisitt ikke skal endre (kun lese/bruke typer/funksjoner andre eksporterer).
import type { RecommendedTimeWindow, ZoneRecommendation } from "@/src/engine/types";
import { color, confidenceColor, levelColor, motion, spacing, typography } from "@/src/design/tokens";
import { avstandLabel, calcBearing, distanceMeters, retningNavn, type LatLng } from "@/src/lib/geo";
import { PREDICTION_MODE_DESCRIPTION } from "@/src/lib/zonePresentation";
import Badge from "./Badge";

type EngineStatusPanelProps = {
  zone: PredictionZone | null;
  /**
   * V1.3 §U: motorens strukturerte, deterministiske anbefaling for DENNE
   * sonen (buildZoneRecommendation()) — når satt, leder panelet med en
   * menneskelesbar anbefaling (summary/Hvorfor/Trekker ned/Datagrunnlag) i
   * stedet for den rå score-ledede visningen. Valgfri og BEVISST additiv:
   * `zone` alene (uten `recommendation`) skal fortsatt gi akkurat samme
   * visning som før denne omleggingen — ingen kalling-steder er tvunget til
   * å ha en ferdig ZoneRecommendation for å fungere.
   */
  recommendation?: ZoneRecommendation;
  /** true = kompakt (kun de to viktigste linjene, for collapsed bottom sheet / liten plass). */
  compact?: boolean;
  /** Maks antall signaler å vise (§22: ikke overdriv). Default 4. */
  maxSignals?: number;
  /**
   * Hunting-zones-oppdraget: brukerens EGEN posisjon (samme `userLocation`
   * kart.tsx allerede har fra GPS) — når satt, vises "Nordvest for deg · ca.
   * 620 m" i anbefalingsvisningen (bearing+avstand fra bruker til
   * `zone.center`, samme formatering som Hjem-skjermens hero-kort, se
   * src/lib/geo.ts sin retningNavn/avstandLabel). Valgfri og BEVISST additiv
   * — uten den vises panelet akkurat som før, ingen kalling-steder er tvunget
   * til å ha en posisjon tilgjengelig.
   */
  userLocation?: LatLng | null;
  /**
   * STEG 5 §5: vis motorens rå 0–100-visningsscore ("Score 82/100") og en
   * påminnelse om at sonen er et ANSLÅTT OMRÅDE, ikke en eksakt dyre-
   * posisjon — brukt kun der brukeren aktivt har bedt om en detaljert
   * forklaring (f.eks. ved å trykke på et hotspot i kartet), ikke i de
   * alltid-synlige oppsummeringene, så score ikke leses som en fasit.
   * ALDRI presentert som en sannsynlighet (§5 i oppdraget) — kun som
   * motorens egen, uklassifiserte visningsscore, atskilt fra confidence.
   */
  showScore?: boolean;
};

/** ZoneRecommendation sin "lav"/"middels"/"god" → samme fargeskala som ConfidenceLevel ("lav"/"middels"/"høy") — "god" er semantisk ekvivalent med "høy" her, ingen ny skala. */
function dataFreshnessColor(freshness: ZoneRecommendation["dataFreshness"]): string {
  if (freshness === "god") return color.confidenceHøy;
  if (freshness === "middels") return color.confidenceMiddels;
  return color.confidenceLav;
}

const DATA_FRESHNESS_LABEL: Record<ZoneRecommendation["dataFreshness"], string> = {
  lav: "Lav",
  middels: "Middels",
  god: "God",
};

/** "05:20" — lokalt klokkeslett. Selve tidspunkt-UTREGNINGEN (computeRecommendedTimeWindow, explain.ts) er motorens jobb og allerede ferdig; KUN klokkeslett-FORMATERINGEN er UI-ets ansvar her (§27). */
function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
}

/**
 * V1.3: "05:20–07:10", eller "05:20–07:10 · 20:40–22:10" når begge et
 * dawn- OG et dusk-vindu finnes for arten. `null` (IKKE en oppdiktet
 * placeholder-streng) når `windows` er tomt — se computeRecommendedTimeWindow
 * sin dokumentasjon for de tre grunnene det kan skje (ingen crepuscularActivity
 * for arten, ingen værdata, eller for svak styrke til å nå terskelen).
 */
function formatTimeWindowsLabel(windows: readonly RecommendedTimeWindow[]): string | null {
  if (windows.length === 0) return null;
  return windows.map((w) => `${formatClock(w.startMs)}–${formatClock(w.endMs)}`).join(" · ");
}

/**
 * Redesign-oppdraget §10: den ENE motor-statusanimasjonen (bevisst kun
 * confidence-baren, ikke også en hotspot-ring-puls i samme visning) —
 * animerer `width`, ikke `transform`, samme trygge mønster som
 * BottomSheet.tsx (en `transform`-basert innslagsanimasjon i ModalSheet.tsx
 * skapte tidligere en reell web-krasj i en helt annen sammenheng — se den
 * filens historie — så width holdes som den bevist trygge veien her også).
 */
function ConfidenceBar({ confidence, tone }: { confidence: number; tone: string }) {
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withTiming(Math.round(confidence * 100), {
      duration: motion.base,
      easing: Easing.out(Easing.cubic),
    });
  }, [confidence, width]);

  const animatedStyle = useAnimatedStyle(() => ({
    width: `${width.value}%`,
  }));

  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, animatedStyle, { backgroundColor: tone }]} />
    </View>
  );
}

/**
 * Motorens "5-sekunders svar" (§4): art, aktivitetsnivå, confidence og
 * viktigste signaler — ALDRI de underliggende beregningene. Samme komponent
 * brukes i desktop-panelet og i mobilens bottom sheet, kun med ulik
 * kompakthet, slik at de to opplevelsene aldri kan drifte fra hverandre.
 */
export default function EngineStatusPanel({ zone, recommendation, compact = false, maxSignals = 4, showScore = false, userLocation }: EngineStatusPanelProps) {
  if (!zone) {
    return (
      <View>
        <Text style={styles.emptyTitle}>Ingen tydelig vurdering ennå</Text>
        <Text style={styles.emptyText}>Slå på Prediksjon når det finnes nok data i området.</Text>
      </View>
    );
  }

  const speciesLabel = getSpeciesProfile(zone.species).label;
  const lColor = levelColor(zone.level);
  const cColor = confidenceColor(zone.confidenceLevel);
  // Hunting-zones-oppdraget: "Nordvest for deg · ca. 620 m" — samme
  // bearing+avstand-språk som Hjem-skjermens hero-kort (app/index.tsx sin
  // retningTilSone), gjenbrukt via de delte src/lib/geo.ts-helperne i stedet
  // for en ny, parallell beregning her. `null` (ingen linje vist) uten en
  // kjent brukerposisjon.
  const bearingDistanceLabel = userLocation
    ? `${retningNavn(calcBearing(userLocation, zone.center))} for deg · ${avstandLabel(distanceMeters(userLocation, zone.center))}`
    : null;
  // "annet" (f.eks. Rev) har ingen forskningsgjennomgått artsprofil (V1.1 §11)
  // — motoren bruker en nøytral fallback, IKKE en ferdig kalibrert modell.
  // Skal aldri fremstå som like godt fundert som Hjort/Rådyr/Elg i UI.
  const erEksperimentellArt = zone.species === "annet";

  if (compact) {
    return (
      <View style={styles.compactRow}>
        <View style={[styles.compactDot, { backgroundColor: lColor }]} />
        <Text style={styles.compactText} numberOfLines={1}>
          {zone.level} sannsynlighet · {speciesLabel}
          {erEksperimentellArt ? " (eksperimentell)" : ""}
        </Text>
        <Text style={[styles.compactConfidence, { color: cColor }]}>{zone.confidenceLevel}</Text>
      </View>
    );
  }

  // V1.3 §U: når en ZoneRecommendation finnes for DENNE sonen, leder panelet
  // med den menneskelesbare anbefalingen (summary → Hvorfor → Trekker ned →
  // Datagrunnlag) i stedet for den tidligere score/nivå-ledede visningen.
  // Uten recommendation (eldre kalling-steder, eller mens buildZoneRecommendation
  // ikke finnes ennå) faller panelet automatisk tilbake til nøyaktig samme
  // visning som før denne omleggingen — se fallback-grenen lenger ned.
  if (recommendation) {
    const rColor = levelColor(recommendation.probabilityLabel);
    const fColor = dataFreshnessColor(recommendation.dataFreshness);
    // §1 (rank-hierarki-oppdraget): rangeringen skal være ØYEBLIKKELIG synlig
    // i selve panelet også, ikke bare inferert fra kartets ringstørrelse —
    // "Sone #1" + "ANBEFALT" kun for den faktiske beste sonen (rank 1), aldri
    // en påstand om at #2/#3 er dårlige (de er fortsatt reelle alternativer,
    // se summary/Hvorfor-seksjonen for hver av dem).
    const erBesteSone = recommendation.rank === 1;
    const timeWindowLabel = formatTimeWindowsLabel(recommendation.recommendedTimeWindows);
    return (
      <View>
        <View style={styles.rankHeaderRow}>
          <Text style={styles.rankHeaderText}>
            Sone #{recommendation.rank} · {Math.round(recommendation.score)}/100
          </Text>
          {erBesteSone && <Badge label="ANBEFALT" color={color.primary} size="sm" />}
        </View>
        {!!bearingDistanceLabel && <Text style={styles.bearingText}>{bearingDistanceLabel}</Text>}

        <Text style={styles.eyebrow}>{speciesLabel}</Text>

        {erEksperimentellArt && (
          <Text style={styles.modeNote}>Generell/eksperimentell vurdering · ingen artsspesifikk forskningsprofil ennå</Text>
        )}

        <Text style={styles.sectionTitle}>Beste område nå</Text>
        <Text style={[styles.value, { color: rColor }]}>{recommendation.probabilityLabel}</Text>
        {!!recommendation.summary && <Text style={styles.summaryText}>{recommendation.summary}</Text>}

        {recommendation.positiveReasons.length > 0 && (
          <View style={styles.signals}>
            <Text style={styles.signalsTitle}>Hvorfor akkurat her?</Text>
            {recommendation.positiveReasons.slice(0, maxSignals).map((s, i) => (
              <View key={i} style={styles.signalRow}>
                <View style={styles.signalDot} />
                <Text style={styles.signalText}>{s}</Text>
              </View>
            ))}
          </View>
        )}

        {recommendation.negativeReasons.length > 0 && (
          <View style={[styles.signals, { marginTop: spacing.md }]}>
            <Text style={styles.signalsTitle}>Trekker ned</Text>
            {recommendation.negativeReasons.slice(0, 2).map((s, i) => (
              <View key={i} style={styles.signalRow}>
                <View style={[styles.signalDot, { backgroundColor: color.textMuted }]} />
                <Text style={styles.signalText}>{s}</Text>
              </View>
            ))}
          </View>
        )}

        {/* V1.3: "Beste tidspunkt" — EKTE klokkeslett-vindu fra
            computeRecommendedTimeWindow (explain.ts), aldri oppdiktet. Vises
            alltid (ikke betinget skjult) slik at fraværet av et vindu for en
            flat-aktivitets-art ("annet"/Rev) også er en tydelig, forklart
            konklusjon — ikke en stille utelatelse brukeren kan mistolke som
            en feil. */}
        <View style={[styles.signals, { marginTop: spacing.md }]}>
          <Text style={styles.signalsTitle}>Beste tidspunkt</Text>
          <Text style={styles.timeWindowText}>{timeWindowLabel ?? "Ingen tydelig tidsvindu"}</Text>
        </View>

        <View style={[styles.confidenceRow, { marginTop: spacing.lg }]}>
          <Text style={styles.confidenceLabel}>Datagrunnlag</Text>
          <Badge label={DATA_FRESHNESS_LABEL[recommendation.dataFreshness]} color={fColor} size="sm" />
          {zone.predictionMode === "environment_only" && (
            <Text style={styles.coldStartNote}>Cold start · miljøbasert</Text>
          )}
        </View>

        {showScore && (
          <Text style={styles.scoreLine}>
            Score {Math.round(recommendation.score)}/100 · motorens interne rangering, ikke selve sannsynlighets-nivået over
          </Text>
        )}

        {showScore && (
          <Text style={styles.areaNote}>
            Området er et anslag basert på tilgjengelig data — ikke dyrets eksakte posisjon.
          </Text>
        )}
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.eyebrow}>{speciesLabel}</Text>
      <Text style={[styles.value, { color: lColor }]}>{zone.level} sannsynlighet</Text>

      {erEksperimentellArt && (
        <Text style={styles.modeNote}>Generell/eksperimentell vurdering · ingen artsspesifikk forskningsprofil ennå</Text>
      )}

      <Text style={styles.modeNote}>{PREDICTION_MODE_DESCRIPTION[zone.predictionMode]}</Text>

      <View style={styles.confidenceRow}>
        <Text style={styles.confidenceLabel}>Lokalt datagrunnlag</Text>
        <ConfidenceBar confidence={zone.confidence} tone={cColor} />
        <Badge label={zone.confidenceLevel} color={cColor} size="sm" />
      </View>

      {showScore && (
        <Text style={styles.scoreLine}>
          Score {Math.round(zone.score)}/100 · motorens interne rangering, ikke selve sannsynlighets-nivået over
        </Text>
      )}

      {zone.dominantSignals.length > 0 && (
        <View style={styles.signals}>
          <Text style={styles.signalsTitle}>Viktigste signaler</Text>
          {zone.dominantSignals.slice(0, maxSignals).map((s, i) => (
            <View key={i} style={styles.signalRow}>
              <View style={styles.signalDot} />
              <Text style={styles.signalText}>{s}</Text>
            </View>
          ))}
        </View>
      )}

      {showScore && (
        <Text style={styles.areaNote}>
          Området er et anslag basert på tilgjengelig data — ikke dyrets eksakte posisjon.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // V1.3 (rank-hierarki-oppdraget §4): "Sone #1 · 68/100" + ANBEFALT-badge —
  // gjør rangeringen synlig i selve panelet, ikke bare på kartet.
  rankHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.xs },
  rankHeaderText: { fontSize: 13, fontWeight: "800", color: color.textSecondary, textTransform: "uppercase", letterSpacing: 0.4 },
  bearingText: { fontSize: 13, fontWeight: "700", color: color.textSecondary, marginBottom: spacing.md },
  timeWindowText: { fontSize: 15, fontWeight: "800", color: color.textPrimary },
  coldStartNote: { fontSize: 11, color: color.textMuted, fontStyle: "italic", marginLeft: spacing.xs },

  eyebrow: { ...typography.eyebrow, color: color.primary, marginBottom: spacing.xs },
  value: { ...typography.primaryValue, fontSize: 26, marginBottom: spacing.md },

  // V1.3 §U: "Beste område nå" / "Hvorfor" / "Trekker ned" / "Datagrunnlag" —
  // samme visuelle vekt som signalsTitle under, men brukt som seksjonsoverskrift
  // over anbefalingens hovedverdi i stedet for over en signalliste.
  sectionTitle: { fontSize: 12, fontWeight: "800", color: color.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: spacing.xs },
  summaryText: { ...typography.body, color: color.textSecondary, marginBottom: spacing.lg },

  modeNote: { fontSize: 12, color: color.textMuted, marginBottom: spacing.md },

  confidenceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  confidenceLabel: { fontSize: 12, fontWeight: "700", color: color.textMuted, width: 110, lineHeight: 15 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: color.border, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 3 },

  scoreLine: { fontSize: 12, color: color.textMuted, marginBottom: spacing.md, lineHeight: 17 },
  areaNote: { fontSize: 11, color: color.textFaint, marginTop: spacing.md, lineHeight: 16, fontStyle: "italic" },

  signals: { gap: spacing.sm },
  signalsTitle: { fontSize: 12, fontWeight: "800", color: color.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: spacing.xs },
  signalRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  signalDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: color.primary, marginTop: 7 },
  signalText: { flex: 1, fontSize: 13, color: color.textSecondary, lineHeight: 19 },

  compactRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  compactDot: { width: 8, height: 8, borderRadius: 4 },
  compactText: { flex: 1, fontSize: 14, fontWeight: "800", color: color.textPrimary },
  compactConfidence: { fontSize: 11, fontWeight: "800", textTransform: "capitalize" },

  emptyTitle: { fontSize: 14, fontWeight: "800", color: color.textSecondary },
  emptyText: { fontSize: 12, color: color.textMuted, marginTop: spacing.xs },
});
