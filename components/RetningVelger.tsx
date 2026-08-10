import { vindRetningLabel } from "@/src/lib/geo";
import { useRef } from "react";
import { PanResponder, StyleSheet, Text, View } from "react-native";

type Props = {
  /** Grader 0–359, 0 = nord, 90 = øst, 180 = sør, 270 = vest. */
  value: number;
  onChange: (grader: number) => void;
  size?: number;
  label?: string;
};

function beregnGrader(locationX: number, locationY: number, senter: number): number {
  const dx = locationX - senter;
  const dy = locationY - senter;
  const radianer = Math.atan2(dx, -dy); // 0 = opp (nord), medurs
  const grader = (radianer * 180) / Math.PI;
  return Math.round((grader + 360) % 360);
}

/**
 * Delt kompass-/retningsvelger — dra rundt ringen eller trykk et sted på den
 * for å sette en retning i grader. Brukt både når et viltkamera plasseres
 * (kart.tsx) og når retningen redigeres i etterkant (kamera/[id].tsx), slik
 * at interaksjonen er lik begge steder.
 */
export default function RetningVelger({ value, onChange, size = 180, label }: Props) {
  const senter = size / 2;
  const radius = senter - 26;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        onChange(beregnGrader(evt.nativeEvent.locationX, evt.nativeEvent.locationY, senter));
      },
      onPanResponderMove: (evt) => {
        onChange(beregnGrader(evt.nativeEvent.locationX, evt.nativeEvent.locationY, senter));
      },
    })
  ).current;

  return (
    <View style={styles.wrap}>
      <View
        style={[styles.dial, { width: size, height: size, borderRadius: size / 2 }]}
        {...panResponder.panHandlers}
      >
        {/* Himmelretnings-merker */}
        <Text style={[styles.tick, { top: 6, left: senter - 8 }]}>N</Text>
        <Text style={[styles.tick, { top: senter - 8, right: 6 }]}>Ø</Text>
        <Text style={[styles.tick, { bottom: 6, left: senter - 8 }]}>S</Text>
        <Text style={[styles.tick, { top: senter - 8, left: 6 }]}>V</Text>

        <View style={styles.senterDot} />

        {/* Pil fra senter i valgt retning — roterer rundt dial-senteret (0° = opp/nord) */}
        <View
          style={[
            styles.pilWrap,
            { width: size, height: size, transform: [{ rotate: `${value}deg` }] },
          ]}
          pointerEvents="none"
        >
          <View
            style={[
              styles.pilLinje,
              { left: senter - 1.5, top: senter - radius, height: radius },
            ]}
          />
          <View
            style={[
              styles.pilHode,
              { left: senter - 7, top: senter - radius - 11 },
            ]}
          />
        </View>
      </View>

      <View style={styles.avlesning}>
        {!!label && <Text style={styles.avlesningLabel}>{label}</Text>}
        <Text style={styles.avlesningVerdi}>
          {value}° · {vindRetningLabel(value)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 12 },
  dial: {
    backgroundColor: "#0E1A10",
    borderWidth: 1.5,
    borderColor: "#1E3226",
    alignItems: "center",
    justifyContent: "center",
  },
  tick: {
    position: "absolute",
    color: "#4D6858",
    fontSize: 13,
    fontWeight: "800",
    width: 16,
    textAlign: "center",
  },
  senterDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2CC36B",
  },
  pilWrap: {
    position: "absolute",
  },
  pilLinje: {
    position: "absolute",
    width: 3,
    backgroundColor: "#2CC36B",
    borderRadius: 2,
  },
  pilHode: {
    position: "absolute",
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 12,
    borderStyle: "solid",
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#2CC36B",
  },
  avlesning: { alignItems: "center" },
  avlesningLabel: {
    color: "#4D6858",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  avlesningVerdi: { color: "#A9F2BF", fontSize: 16, fontWeight: "900" },
});
