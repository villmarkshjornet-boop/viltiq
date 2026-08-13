import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { color, elevation, motion, radius, spacing, zIndex } from "@/src/design/tokens";

export type SheetSnap = "collapsed" | "medium" | "expanded";

type BottomSheetProps = {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  collapsedHeight: number;
  mediumHeight: number;
  /** Maks høyde i "expanded" — typisk skjermhøyde minus litt luft øverst. Sheet vokser aldri forbi dette (§25: dekker aldri navigasjon permanent — bruk avstand nok til at bunnnavigasjon alltid er nåbar ved å lukke). */
  expandedHeight: number;
  children: React.ReactNode;
  /** Innhold vist ALLTID, uansett snap-tilstand (den kollapsede oppsummeringen). */
  summary: React.ReactNode;
};

/**
 * Enkel, forutsigbar bottom sheet med tre faste snap-punkter (§25). Trykk på
 * håndtaket for å sykle collapsed → medium → expanded → collapsed. Bevisst
 * IKKE en fri dra-i-hvilken-som-helst-høyde-implementasjon — det gir en
 * enklere, mer testbar og mer forutsigbar interaksjon, med lavere risiko for
 * gestkonflikt med kartets egne pan/zoom-gester under.
 *
 * Redesign-oppdraget §11/§41: første reelle bruk av react-native-reanimated i
 * appen (tidligere kun sideeffekt-importert i app/_layout.tsx for Expo
 * Router). Erstatter React Native sin gamle Animated.timing med
 * withTiming — samme varighet (motion.base = 220ms, uendret følelse), men på
 * UI-tråden, og etablerer mønsteret resten av mikroanimasjons-arbeidet i
 * appen bygger videre på.
 */
export default function BottomSheet({
  snap,
  onSnapChange,
  collapsedHeight,
  mediumHeight,
  expandedHeight,
  children,
  summary,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const heightValue = useSharedValue(collapsedHeight);
  const contentHeightRef = useRef(0);

  const targetHeight =
    snap === "expanded" ? expandedHeight : snap === "medium" ? mediumHeight : collapsedHeight;

  useEffect(() => {
    heightValue.value = withTiming(targetHeight, {
      duration: motion.base,
      easing: Easing.out(Easing.cubic),
    });
  }, [targetHeight, heightValue]);

  const animatedStyle = useAnimatedStyle(() => ({
    height: heightValue.value,
  }));

  function cycleSnap() {
    if (snap === "collapsed") onSnapChange("medium");
    else if (snap === "medium") onSnapChange("expanded");
    else onSnapChange("collapsed");
  }

  function onContentLayout(e: LayoutChangeEvent) {
    contentHeightRef.current = e.nativeEvent.layout.height;
  }

  return (
    <Animated.View
      style={[
        styles.wrap,
        elevation.panel,
        animatedStyle,
        { paddingBottom: insets.bottom },
      ]}
    >
      <Pressable onPress={cycleSnap} style={styles.handleArea} hitSlop={8}>
        <View style={styles.handle} />
      </Pressable>

      <View style={styles.summaryRow}>
        <View style={{ flex: 1 }}>{summary}</View>
        <Pressable onPress={cycleSnap} style={styles.chevronBtn} hitSlop={10}>
          <Ionicons
            name={snap === "expanded" ? "chevron-down" : "chevron-up"}
            size={18}
            color={color.textSecondary}
          />
        </Pressable>
      </View>

      {snap !== "collapsed" && (
        <View style={styles.content} onLayout={onContentLayout}>
          {children}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.surfaceElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderBottomWidth: 0,
    overflow: "hidden",
    zIndex: zIndex.bottomSheet,
  },
  handleArea: { alignItems: "center", paddingTop: spacing.sm, paddingBottom: spacing.xs },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.border },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chevronBtn: { padding: spacing.sm },
  content: { flex: 1, paddingHorizontal: spacing.lg },
});
