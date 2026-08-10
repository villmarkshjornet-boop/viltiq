import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

admin.initializeApp();

type UserDoc = {
  uid?: string;
  notificationsEnabled?: boolean;
  radiusKm?: 10 | 25 | 50;
  expoPushToken?: string | null;
};

type ObservationDoc = {
  dyr?: string;
  type?: string;
  kommentar?: string;
  tid?: string;
  latitude?: number | null;
  longitude?: number | null;
  jaktlagId?: string;
};

type UserLocationDoc = {
  latitude?: number;
  longitude?: number;
  jaktlagId?: string | null;
};

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function distanceKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
) {
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);

  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) *
      Math.cos(toRad(bLat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

export const sendObservationPush = onDocumentCreated(
  {
    document: "observations/{observationId}",
    region: "europe-west1",
    retry: false,
  },
  async (event) => {
    const snapshot = event.data;

    if (!snapshot) {
      console.log("Mangler snapshot.");
      return;
    }

    const observation = snapshot.data() as ObservationDoc;

    if (
      typeof observation.latitude !== "number" ||
      typeof observation.longitude !== "number"
    ) {
      console.log("Observasjon uten GPS, hopper over push.");
      return;
    }

    const observationLat = observation.latitude;
    const observationLng = observation.longitude;

    const [usersSnap, locationsSnap] = await Promise.all([
      admin.firestore().collection("users").get(),
      admin.firestore().collection("user_locations").get(),
    ]);

    const userLocations = new Map<
      string,
      { latitude: number; longitude: number; jaktlagId?: string | null }
    >();

    locationsSnap.forEach((doc) => {
      const data = doc.data() as UserLocationDoc;

      if (
        typeof data.latitude === "number" &&
        typeof data.longitude === "number"
      ) {
        userLocations.set(doc.id, {
          latitude: data.latitude,
          longitude: data.longitude,
          jaktlagId: data.jaktlagId ?? null,
        });
      }
    });

    const messages: Array<{
      to: string;
      sound: "default";
      title: string;
      body: string;
      data: Record<string, unknown>;
    }> = [];

    usersSnap.forEach((doc) => {
      const user = doc.data() as UserDoc;

      if (!user.notificationsEnabled) return;
      if (!user.expoPushToken) return;

      const location = userLocations.get(doc.id);
      if (!location) return;

      // Personvern: en observasjon knyttet til et privat jaktlag skal kun
      // varsle medlemmer av det jaktlaget. Offentlige observasjoner
      // (jaktlagId === "") varsler alle innen radius, som før.
      const observationJaktlagId = observation.jaktlagId ?? "";
      if (observationJaktlagId !== "" && location.jaktlagId !== observationJaktlagId) {
        return;
      }

      const radiusKm =
        user.radiusKm === 10 || user.radiusKm === 25 || user.radiusKm === 50
          ? user.radiusKm
          : 50;

      const distance = distanceKm(
        observationLat,
        observationLng,
        location.latitude,
        location.longitude
      );

      if (distance > radiusKm) return;

      messages.push({
        to: user.expoPushToken,
        sound: "default",
        title: `Ny ${observation.dyr ?? "observasjon"} i nærheten`,
        body: `${observation.type ?? "Observasjon"} innen ${radiusKm} km`,
        data: {
          type: "observation",
          observationId: snapshot.id,
          dyr: observation.dyr ?? null,
        },
      });
    });

    if (messages.length === 0) {
      console.log("Ingen pushmeldinger å sende.");
      return;
    }

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    const result = await response.text();
    console.log("Expo push response:", result);
  }
);