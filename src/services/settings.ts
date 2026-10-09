import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Species } from "../engine/types";

export type AppSettings = {
  radiusKm: 10 | 25 | 50;
  notificationsEnabled: boolean;
  /** Sist valgte art i Hjem sin art-karusell / Kart sitt artsfilter — delt mellom de to (§3 i art-karusell-oppdraget). Kun de tre prioriterte artene er gyldige valg her, "annet" har ingen egen hero/profil. */
  selectedSpecies: Species;
};

const SETTINGS_KEY = "viltiq_settings_v1";

const GYLDIGE_KARUSELL_ARTER: readonly Species[] = ["hjort", "radyr", "elg"];

const DEFAULT_SETTINGS: AppSettings = {
  radiusKm: 50,
  notificationsEnabled: true,
  selectedSpecies: "hjort",
};

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);

    if (!raw) return DEFAULT_SETTINGS;

    const parsed = JSON.parse(raw);

    return {
      radiusKm:
        parsed?.radiusKm === 10 || parsed?.radiusKm === 25 || parsed?.radiusKm === 50
          ? parsed.radiusKm
          : DEFAULT_SETTINGS.radiusKm,
      notificationsEnabled:
        typeof parsed?.notificationsEnabled === "boolean"
          ? parsed.notificationsEnabled
          : DEFAULT_SETTINGS.notificationsEnabled,
      selectedSpecies: GYLDIGE_KARUSELL_ARTER.includes(parsed?.selectedSpecies)
        ? (parsed.selectedSpecies as Species)
        : DEFAULT_SETTINGS.selectedSpecies,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export { DEFAULT_SETTINGS };
