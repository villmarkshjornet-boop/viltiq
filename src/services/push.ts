import { auth, db } from "@/src/config/firebase";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import {
    doc,
    serverTimestamp,
    setDoc,
} from "firebase/firestore";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function getProjectId() {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    throw new Error("Fant ikke Expo projectId. Sjekk app config / EAS config.");
  }

  return projectId;
}

export async function requestPushPermissions() {
  const existing = await Notifications.getPermissionsAsync();

  if (existing.status === "granted") {
    return true;
  }

  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === "granted";
}

export async function registerForPushNotificationsAsync() {
  if (!Device.isDevice) {
    throw new Error("Pushvarsler krever fysisk enhet.");
  }

  const granted = await requestPushPermissions();

  if (!granted) {
    throw new Error("Push-tillatelse ble ikke gitt.");
  }

  const projectId = getProjectId();

  const tokenResponse = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  return tokenResponse.data;
}

export async function syncUserPushSettingsToFirestore(input: {
  radiusKm: 10 | 25 | 50;
  notificationsEnabled: boolean;
  expoPushToken: string | null;
}) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Bruker er ikke logget inn.");
  }

  await setDoc(
    doc(db, "users", user.uid),
    {
      uid: user.uid,
      notificationsEnabled: input.notificationsEnabled,
      radiusKm: input.radiusKm,
      expoPushToken: input.expoPushToken,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}