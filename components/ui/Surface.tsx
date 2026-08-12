import { StyleSheet, View, type ViewProps } from "react-native";
import { color, radius } from "@/src/design/tokens";

type SurfaceProps = ViewProps & {
  /** "flat" = standard kortoverflate. "elevated" = løftet panel (flytende over kartet, får skygge av kalleren). */
  variant?: "flat" | "elevated";
};

/** Grunnleggende kort/panel-overflate — samme visuelle språk overalt (§15: færre, tydeligere kort). */
export default function Surface({ variant = "flat", style, ...rest }: SurfaceProps) {
  return (
    <View
      style={[
        styles.base,
        variant === "elevated" && styles.elevated,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
  },
  elevated: {
    backgroundColor: color.surfaceElevated,
    borderColor: color.borderStrong,
  },
});
