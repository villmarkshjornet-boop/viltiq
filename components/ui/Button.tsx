import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { color, minTouchTarget, radius, spacing } from "@/src/design/tokens";

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Standard knapp — tre varianter dekker alle bruksområder i appen (§48: ikke flere enn nødvendig). Minimum touch target 44px (§39). */
export default function Button({ label, onPress, variant = "primary", icon, disabled, style }: ButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "ghost" && styles.ghost,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={17}
          color={variant === "primary" ? color.primaryText : color.primarySoft}
        />
      )}
      <Text
        style={[
          styles.label,
          variant === "primary" && styles.labelPrimary,
          variant === "ghost" && styles.labelGhost,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  primary: { backgroundColor: color.primary },
  secondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border },
  ghost: { backgroundColor: "transparent" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
  label: { fontSize: 14, fontWeight: "800", color: color.primarySoft },
  labelPrimary: { color: color.primaryText, fontWeight: "900" },
  labelGhost: { color: color.textSecondary },
});
