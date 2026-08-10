import AsyncStorage from "@react-native-async-storage/async-storage";

export type AppSettings = {
  radiusKm: 10 | 25 | 50;
  notificationsEnabled: boolean;
};

const SETTINGS_KEY = "viltiq_settings_v1";

const DEFAULT_SETTINGS: AppSettings = {
  radiusKm: 50,
  notificationsEnabled: true,
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
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export { DEFAULT_SETTINGS };
