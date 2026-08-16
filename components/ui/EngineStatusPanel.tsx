import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { getSpeciesProfile, type PredictionZone } from "@/src/engine";
import { color, confidenceColor, levelColor, motion, spacing, typography } from "@/src/design/tokens";
import Badge from "./Badge";

type EngineStatusPanelProps = {
  zone: PredictionZone | null;
  /** true = kompakt (kun de to viktigste linjene, for collapsed bottom sheet / liten plass). */
  compact?: boolean;
  /** Maks antall signaler å vise (§22: ikke overdriv). Default 4. */
  maxSignals?: number;
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
export default function EngineStatusPanel({ zone, compact = false, maxSignals = 4, showScore = false }: EngineStatusPanelProps) {
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

  if (compact) {
    return (
      <View style={styles.compactRow}>
        <View style={[styles.compactDot, { backgroundColor: lColor }]} />
        <Text style={styles.compactText} numberOfLines={1}>
          {zone.level} aktivitet · {speciesLabel}
        </Text>
        <Text style={[styles.compactConfidence, { color: cColor }]}>{zone.confidenceLevel}</Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.eyebrow}>{speciesLabel}</Text>
      <Text style={[styles.value, { color: lColor }]}>{zone.level} aktivitet</Text>

      <View style={styles.confidenceRow}>
        <Text style={styles.confidenceLabel}>Confidence</Text>
        <ConfidenceBar confidence={zone.confidence} tone={cColor} />
        <Badge label={zone.confidenceLevel} color={cColor} size="sm" />
      </View>

      {showScore && (
        <Text style={styles.scoreLine}>
          Score {Math.round(zone.score)}/100 · viser motorens interne rangering, ikke en sannsynlighet
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
  eyebrow: { ...typography.eyebrow, color: color.primary, marginBottom: spacing.xs },
  value: { ...typography.primaryValue, fontSize: 26, marginBottom: spacing.md },

  confidenceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg },
  confidenceLabel: { fontSize: 12, fontWeight: "700", color: color.textMuted, width: 76 },
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
