import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ObservasjonKilde, SporType } from "@/src/types/observation";

const KEY = "offline_obs_queue_v1";

export type QueuedObservation = {
  id: string;          // lokal UUID for dedup
  dyr: string;
  type: string;
  kommentar: string;
  tid: string;
  latitude: number | null;
  longitude: number | null;
  retning: number | null;
  antall?: number;
  observationSource?: ObservasjonKilde;
  cameraId?: string | null;
  cameraDirectionDegrees?: number | null;
  sporType?: SporType | null;
  kjonn?: string | null;
  alder?: string | null;
  koelagtTid: string; // når den ble lagt i kø
};

export async function leggIKø(obs: Omit<QueuedObservation, "id" | "koelagtTid">): Promise<void> {
  const kø = await hentKø();
  kø.push({
    ...obs,
    id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
    koelagtTid: new Date().toISOString(),
  });
  await AsyncStorage.setItem(KEY, JSON.stringify(kø));
}

export async function hentKø(): Promise<QueuedObservation[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function fjernFraKø(id: string): Promise<void> {
  const kø = await hentKø();
  await AsyncStorage.setItem(KEY, JSON.stringify(kø.filter((o) => o.id !== id)));
}

export async function tømKø(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

export async function køLengde(): Promise<number> {
  return (await hentKø()).length;
}
