import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, minTouchTarget, radius, spacing } from "@/src/design/tokens";

type ToggleProps = {
  label: string;
  active: boolean;
  onToggle: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  accentColor?: string;
};

/** Rad med ikon + etikett + av/på-bryter — brukt i kartlag-panelet (§21) og andre lister av innstillinger. */
export default function Toggle({ label, active, onToggle, icon, accentColor = color.primary }: ToggleProps) {
  return (
    <Pressable onPress={onToggle} style={styles.row} hitSlop={4}>
      <View style={styles.left}>
        {icon && (
          <Ionicons name={icon} size={17} color={active ? accentColor : color.textMuted} />
        )}
        <Text style={[styles.label, active && { color: color.textPrimary }]}>{label}</Text>
      </View>
      <View style={[styles.track, active && { backgroundColor: accentColor + "40" }]}>
        <View style={[styles.thumb, active && { backgroundColor: accentColor, alignSelf: "flex-end" }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: minTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  left: { flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 },
  label: { fontSize: 14, fontWeight: "700", color: color.textSecondary },
  track: {
    width: 40,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: color.border,
    padding: 3,
    justifyContent: "center",
  },
  thumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: color.textFaint,
  },
});
