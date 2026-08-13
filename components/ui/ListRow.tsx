import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, minTouchTarget, radius, spacing, typography } from "@/src/design/tokens";

type ListRowProps = {
  icon?: keyof typeof Ionicons.glyphMap;
  /** Artsemoji e.g. — har forrang over `icon`. */
  emoji?: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  /** Høyrejustert sekundærtekst, typisk tid ("for 20t siden"). */
  meta?: string;
  /** Egendefinert høyre-innhold — f.eks. en diskret "···"-knapp. Erstatter IKKE meta, vises ved siden av den. */
  trailing?: React.ReactNode;
  onPress?: () => void;
  /** Skillelinje under raden — slå av på siste rad i en liste. Default true. */
  divider?: boolean;
};

/**
 * Redesign-oppdraget §14/§24/§27: én lett rad-primitiv (ikonplate + tittel +
 * meta + skillelinje) i stedet for at hver liste bruker en full Surface-kort
 * per element. Brukt av Hjem sin "Nylig relevant aktivitet", Logg sin
 * registreringsliste, og Jakt sin fellingsliste — samme radspråk overalt en
 * liste av ferske hendelser vises.
 */
export default function ListRow({
  icon,
  emoji,
  iconColor = color.primary,
  title,
  subtitle,
  meta,
  trailing,
  onPress,
  divider = true,
}: ListRowProps) {
  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper
      style={[styles.row, divider && styles.divider]}
      {...(onPress ? { onPress, hitSlop: 4 } : {})}
    >
      {(icon || emoji) && (
        <View style={[styles.iconPlate, { borderColor: iconColor + "40" }]}>
          {emoji ? (
            <Text style={styles.emoji}>{emoji}</Text>
          ) : icon ? (
            <Ionicons name={icon} size={16} color={iconColor} />
          ) : null}
        </View>
      )}

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>

      {!!meta && <Text style={styles.meta}>{meta}</Text>}
      {trailing}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: minTouchTarget,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  iconPlate: {
    width: 32,
    height: 32,
    borderRadius: radius.md - 2,
    backgroundColor: color.surface,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 16 },
  body: { flex: 1, gap: 1 },
  title: { ...typography.bodyStrong, color: color.textPrimary },
  subtitle: { ...typography.caption, color: color.textMuted },
  meta: { ...typography.caption, color: color.textFaint },
});
