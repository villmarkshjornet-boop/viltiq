import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { color, radius, spacing, typography } from "@/src/design/tokens";

type StatCardProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone?: string;
};

/** Én av fire like statistikk-kort i en rad (Vind/Temperatur/Høyde/Observasjoner) — bevisst lik vekt på alle fire, ingen dominerer. */
export default function StatCard({ icon, label, value, tone = color.primary }: StatCardProps) {
  return (
    <View style={styles.card}>
      <View style={[styles.iconPlate, { borderColor: tone + "40" }]}>
        <Ionicons name={icon} size={14} color={tone} />
      </View>
      <Text style={styles.value} numberOfLines={1}>{value}</Text>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: 6,
  },
  iconPlate: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.surfaceElevated,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  value: { ...typography.bodyStrong, fontSize: 15, color: color.textPrimary },
  label: { ...typography.caption, color: color.textMuted },
});
