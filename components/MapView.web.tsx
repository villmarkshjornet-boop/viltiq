// Web-fallback for react-native-maps.
//
// react-native-maps har ingen web-implementasjon i det hele tatt — å importere
// det direkte i app/kart.tsx eller app/kamera/[id].tsx får `expo export -p web`
// til å FEILE HELT (ikke bare degradere), fordi biblioteket importerer
// react-native-interne moduler (codegenNativeCommands) som ikke finnes på web.
//
// Løsningen er IKKE å endre native-koden, men å la app-skjermene importere
// kartet via denne lille wrapperen (components/MapView) i stedet for
// "react-native-maps" direkte. Metro velger automatisk MapView.tsx (ren
// videreeksport av det ekte biblioteket, null endring) for iOS/Android, og
// denne .web.tsx-varianten for nettleser — standard Expo/Metro-mønster for
// plattform-spesifikke filer (samme prinsipp som `.ios.tsx`/`.android.tsx`).
//
// Kartfunksjonen (plassere viltkamera, langtrykk, markører) er dermed ikke
// tilgjengelig i nettleser ennå — det vises en tydelig forklaring i stedet
// for at siden krasjer. Marker/Circle/Polygon er harmløse null-komponenter
// slik at eksisterende JSX i skjermene (som rendrer dem ubetinget som barn
// av MapView) fortsatt kan stå urørt.
import { StyleSheet, Text, View } from "react-native";

export default function MapView({ style }: { style?: any; [key: string]: any }) {
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.emoji}>🗺️</Text>
      <Text style={styles.title}>Kart er ikke tilgjengelig i nettleser ennå</Text>
      <Text style={styles.text}>
        Bruk ViltIQ på Android eller iPhone for å se kart, plassere viltkamera
        og registrere observasjoner direkte på kartet.
      </Text>
    </View>
  );
}

export function Marker(_props: any) {
  return null;
}
export function Circle(_props: any) {
  return null;
}
export function Polygon(_props: any) {
  return null;
}
export const PROVIDER_GOOGLE = "google";

export type LongPressEvent = {
  nativeEvent: { coordinate: { latitude: number; longitude: number } };
};

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0B1610",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#192420",
    padding: 32,
    gap: 10,
  },
  emoji: { fontSize: 36, marginBottom: 4 },
  title: { color: "#FFFFFF", fontSize: 16, fontWeight: "800", textAlign: "center" },
  text: { color: "#7A9A88", fontSize: 13, textAlign: "center", lineHeight: 20, maxWidth: 320 },
});
