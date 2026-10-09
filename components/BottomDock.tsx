import { Ionicons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { alpha, color, elevation, glass, radius, spacing, typography, zIndex } from "@/src/design/tokens";
import { useUlesteMeldinger } from "@/src/hooks/useUlesteMeldinger";

type TabProps = {
  href: "/" | "/kart" | "/logg" | "/chat" | "/profil";
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  badge?: number;
  prominent?: boolean;
};

function Tab({ href, icon, label, active, badge, prominent }: TabProps) {
  return (
    <Link href={href} asChild>
      <Pressable style={styles.tab}>
        <View style={[styles.inner, active && styles.innerActive]}>
          <View style={[styles.iconPlate, active && styles.iconPlateActive, prominent && styles.iconPlateProminent]}>
            <Ionicons
              name={icon}
              size={prominent ? 22 : 16}
              color={prominent ? color.primaryText : active ? color.textPrimary : color.textMuted}
            />
            {!!badge && badge > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
              </View>
            )}
          </View>

          {!prominent && (
            <Text style={[styles.label, active && styles.labelActive]}>
              {label}
            </Text>
          )}
        </View>
      </Pressable>
    </Link>
  );
}

/** Redesign-oppdraget (Hjem-dashbord): dokken har nå 5 faner i stedet for 4 — "Jakt" er ikke lenger en dock-fane (nås fra Profil), "Logg" er omdøpt til "Observasjon" og løftet visuelt som en fremtredende sentrert "+"-knapp, og "Chat" er ny. */
export default function BottomDock() {
  const pathname = usePathname();
  const uleste = useUlesteMeldinger();

  const isActive = (route: string) => pathname === route;

  return (
    <View style={styles.wrap}>
      <View style={styles.dockWrap}>
        <View style={styles.aura} />
        <View style={styles.shadow} />

        <View style={styles.dock}>
          <Tab href="/" icon="home" label="Hjem" active={isActive("/")} />
          <Tab href="/kart" icon="map" label="Kart" active={isActive("/kart")} />
          <Tab href="/logg" icon="add" label="Observasjon" active={isActive("/logg")} prominent />
          <Tab href="/chat" icon="chatbubble-ellipses" label="Chat" active={isActive("/chat")} badge={uleste} />
          <Tab href="/profil" icon="person" label="Profil" active={isActive("/profil")} />
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
  // til full bredde med enorme mellomrom mellom fanene — samme kompakte,
  // pill-formede dokk som på mobil, bare sentrert.
  dockWrap: {
    width: "100%",
    maxWidth: 440,
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
    minWidth: 52,
    minHeight: 52,
    borderRadius: radius.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 4,
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

  // Observasjon-fanen (Logg): fremhevet som appens hurtighandling —
  // heldekket primærgrønn, litt større, og uten tekstetikett under (§ mockup:
  // en sentrert, dominant "+" mellom de fire vanlige fanene).
  iconPlateProminent: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.primary,
    borderColor: color.primary,
    marginBottom: -2,
  },

  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: color.danger,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: color.background,
  },
  badgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },

  label: {
    ...typography.caption,
    color: color.textMuted,
    letterSpacing: 0.1,
  },

  labelActive: {
    color: color.textPrimary,
  },
});
