import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import "react-native-reanimated";
import { auth } from "../src/config/firebase";

function AuthGate({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const segments = useSegments();
  const [klar, setKlar] = useState(false);
  const segRef = useRef(segments);
  segRef.current = segments;

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      const påOnboarding = segRef.current[0] === "onboarding";

      if (!user) {
        if (!påOnboarding) router.replace("/onboarding");
      } else if (påOnboarding) {
        router.replace("/");
      }

      setKlar(true);
    });
    return unsub;
  }, []);

  if (!klar) return <View style={{ flex: 1, backgroundColor: "#060E08" }} />;
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <AuthGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index"         options={{ headerShown: false }} />
        <Stack.Screen name="onboarding"    options={{ headerShown: false }} />
        <Stack.Screen name="logg"          options={{ headerShown: false }} />
        <Stack.Screen name="kart"          options={{ headerShown: false }} />
        <Stack.Screen name="statistikk"    options={{ headerShown: false }} />
        <Stack.Screen name="felling"       options={{ headerShown: false }} />
        <Stack.Screen name="innstillinger" options={{ headerShown: false }} />
        <Stack.Screen name="kamera/[id]"   options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="light" />
    </AuthGate>
  );
}
