import { Ionicons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
              color={active ? "#F4FFF7" : "#8FA39A"}
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
      <View style={styles.aura} />
      <View style={styles.shadow} />

      <View style={styles.dock}>
        <Tab href="/" icon="home" label="Hjem" active={isActive("/")} />
        <Tab href="/kart" icon="map" label="Kart" active={isActive("/kart")} />
        <Tab href="/logg" icon="add-circle-outline" label="Logg" active={isActive("/logg")} />
        <Tab href="/jakt" icon="trophy-outline" label="Jakt" active={isActive("/jakt")} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    alignItems: "center",
  },

  aura: {
    position: "absolute",
    bottom: 10,
    width: "72%",
    height: 40,
    borderRadius: 999,
    backgroundColor: "rgba(44,195,107,0.09)",
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
    backgroundColor: "rgba(8,14,10,0.98)",
    borderWidth: 1,
    borderColor: "#1C2A22",
    borderRadius: 34,
    paddingHorizontal: 6,
    paddingVertical: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.34,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 18,
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
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 7,
  },

  innerActive: {
    backgroundColor: "#12211A",
    borderWidth: 1,
    borderColor: "#2A4738",
  },

  iconPlate: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#111B15",
    borderWidth: 1,
    borderColor: "#223129",
    alignItems: "center",
    justifyContent: "center",
  },

  iconPlateActive: {
    backgroundColor: "#1C3B29",
    borderColor: "#377856",
  },

  label: {
    color: "#8EA39A",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.1,
  },

  labelActive: {
    color: "#F8FAFC",
  },
});