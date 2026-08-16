import { Ionicons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { alpha, color, elevation, glass, radius, spacing, typography, zIndex } from "@/src/design/tokens";

type TabProps = {
  href: "/" | "/kart" | "/logg" | "/jakt";
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
};

function Tab({ href, icon, label, active }: TabProps) {
  return (
    <Link href={href} asChild>
      <Pressable style={styles.tab}>
        <View style={[styles.inner, active && styles.innerActive]}>
          <View style={[styles.iconPlate, active && styles.iconPlateActive]}>
            <Ionicons
              name={icon}
              size={16}
              color={active ? color.textPrimary : color.textMuted}
            />
          </View>

          <Text style={[styles.label, active && styles.labelActive]}>
            {label}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

export default function BottomDock() {
  const pathname = usePathname();

  const isActive = (route: string) => pathname === route;

  return (
    <View style={styles.wrap}>
      <View style={styles.dockWrap}>
        <View style={styles.aura} />
        <View style={styles.shadow} />

        <View style={styles.dock}>
          <Tab href="/" icon="home" label="Hjem" active={isActive("/")} />
          <Tab href="/kart" icon="map" label="Kart" active={isActive("/kart")} />
          <Tab href="/logg" icon="add-circle-outline" label="Logg" active={isActive("/logg")} />
          <Tab href="/jakt" icon="trophy-outline" label="Jakt" active={isActive("/jakt")} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    alignItems: "center",
    zIndex: zIndex.navigation,
  },

  // Redesign-oppdraget §36: på brede skjermer skal ikke dokken strekke seg
  // til full bredde med enorme mellomrom mellom de 4 fanene — samme
  // kompakte, pill-formede dokk som på mobil, bare sentrert.
  dockWrap: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
  },

  aura: {
    position: "absolute",
    bottom: 10,
    width: "72%",
    height: 40,
    borderRadius: 999,
    backgroundColor: color.primary + alpha.soft,
  },

  shadow: {
    position: "absolute",
    bottom: -2,
    width: "90%",
    height: 46,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.22)",
  },

  dock: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: glass.controlBgStrong,
    borderWidth: 1,
    borderColor: glass.controlBorder,
    borderRadius: 34,
    paddingHorizontal: 6,
    paddingVertical: spacing.sm,
    ...elevation.floating,
  },

  tab: {
    flex: 1,
    minHeight: 64,
    justifyContent: "center",
    alignItems: "center",
  },

  inner: {
    minWidth: 56,
    minHeight: 52,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 7,
  },

  innerActive: {
    backgroundColor: color.surfaceHover,
    borderWidth: 1,
    borderColor: color.borderStrong,
  },

  iconPlate: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: color.surfaceElevated,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: "center",
    justifyContent: "center",
  },

  iconPlateActive: {
    backgroundColor: color.primary + alpha.soft,
    borderColor: color.primary,
  },

  label: {
    ...typography.caption,
    color: color.textMuted,
    letterSpacing: 0.1,
  },

  labelActive: {
    color: color.textPrimary,
  },
});