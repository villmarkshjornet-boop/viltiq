import { StyleSheet, Text, View } from "react-native";
import { alpha, radius, spacing } from "@/src/design/tokens";

type BadgeProps = {
  label: string;
  color: string;
  size?: "sm" | "md";
};

/** Liten fargekodet etikett — brukes for aktivitetsnivå, confidence, status. Bevisst IKKE prosent med mindre verdien faktisk er en prosent (§17). */
export default function Badge({ label, color: c, size = "md" }: BadgeProps) {
  return (
    <View style={[styles.base, size === "sm" && styles.sm, { backgroundColor: c + alpha.soft }]}>
      <View style={[styles.dot, { backgroundColor: c }]} />
      <Text style={[styles.text, size === "sm" && styles.textSm, { color: c }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignSelf: "flex-start",
  },
  sm: { paddingHorizontal: spacing.sm, paddingVertical: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 12, fontWeight: "800" },
  textSm: { fontSize: 11 },
});
