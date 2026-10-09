import { StyleSheet, Text, View } from "react-native";
import { color } from "@/src/design/tokens";

type AvatarProps = {
  navn: string;
  size?: number;
  /** Grønn/grå prikk nederst i høyre hjørne — brukt for "aktiv i terrenget nå" (§ Jaktlaget ditt). Utelatt = ingen prikk. */
  presence?: "aktiv" | "inaktiv";
};

const PALETT = ["#2CC36B", "#60A5FA", "#FB923C", "#A78BFA", "#F87171", "#EAB308", "#4ADE80", "#38BDF8"];

function initialer(navn: string): string {
  const deler = navn.trim().split(/\s+/).filter(Boolean);
  if (deler.length === 0) return "?";
  if (deler.length === 1) return deler[0].slice(0, 2).toUpperCase();
  return (deler[0][0] + deler[deler.length - 1][0]).toUpperCase();
}

function paletteFarge(navn: string): string {
  let hash = 0;
  for (let i = 0; i < navn.length; i++) hash = (hash * 31 + navn.charCodeAt(i)) >>> 0;
  return PALETT[hash % PALETT.length];
}

/** Initialbasert avatar — appen har ingen bildeopplasting ennå, så dette er den etablerte visuelle identiteten for et medlem (deterministisk farge fra navn, ikke tilfeldig per render). */
export default function Avatar({ navn, size = 40, presence }: AvatarProps) {
  const bg = paletteFarge(navn || "?");
  return (
    <View style={{ width: size, height: size }}>
      <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg + "26", borderColor: bg }]}>
        <Text style={[styles.text, { fontSize: size * 0.38, color: bg }]}>{initialer(navn)}</Text>
      </View>
      {presence && (
        <View
          style={[
            styles.presenceDot,
            {
              width: Math.max(10, size * 0.28),
              height: Math.max(10, size * 0.28),
              borderRadius: Math.max(5, size * 0.14),
              backgroundColor: presence === "aktiv" ? color.success : color.textFaint,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  text: { fontWeight: "900" },
  presenceDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    borderWidth: 2,
    borderColor: color.background,
  },
});
