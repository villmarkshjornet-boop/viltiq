import { auth, db } from "@/src/config/firebase";
import type { Observasjon, ObservasjonKilde, SporType } from "@/src/types/observation";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    endAt,
    limit as firestoreLimit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    startAt,
    where,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import {
    distanceBetween,
    geohashForLocation,
    geohashQueryBounds,
} from "geofire-common";
import { getCamera } from "./cameras";
import { getAktivtJaktlagId } from "./jaktlag";
import { fjernFraKø, hentKø, leggIKø } from "./offlineQueue";

const OBSERVATIONS_COLLECTION = "observations";

type SaveObservationInput = {
  dyr: string;
  type: string;
  kommentar: string;
  tid: string;
  latitude: number | null;
  longitude: number | null;
  retning?: number | null;
  antall?: number;
  observationSource?: ObservasjonKilde;
  cameraId?: string | null;
  sporType?: SporType | null;
  kjonn?: string | null;
  alder?: string | null;
};

type NearbyOptions = {
  center: { latitude: number; longitude: number };
  radiusKm?: number;
};

function mapDocToObservation(d: any): Observasjon {
  const data = d.data();
  return {
    id:        d.id,
    userId:    data.userId    ?? "",
    jaktlagId: data.jaktlagId ?? "",
    dyr:       data.dyr       ?? "",
    type:      data.type      ?? "",
    kommentar: data.kommentar ?? "",
    tid:       data.tid       ?? "",
    latitude:  data.latitude  ?? null,
    longitude: data.longitude ?? null,
    geohash:   data.geohash   ?? "",
    retning:   data.retning   ?? null,
    antall:    typeof data.antall === "number" && data.antall > 0 ? data.antall : 1,
    observationSource: data.observationSource ?? "manual",
    cameraId:  data.cameraId ?? null,
    cameraDirectionDegrees: data.cameraDirectionDegrees ?? null,
    sporType:  data.sporType ?? null,
    kjonn:     data.kjonn ?? null,
    alder:     data.alder ?? null,
    createdAt: data.createdAt,
  };
}

function dedupeObservations(items: Observasjon[]): Observasjon[] {
  const map = new Map<string, Observasjon>();
  for (const item of items) map.set(item.id, item);
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.tid || 0).getTime() - new Date(a.tid || 0).getTime()
  );
}

function isWithinRadiusKm(
  item:   { latitude: number; longitude: number },
  center: { latitude: number; longitude: number },
  radiusKm: number
): boolean {
  return distanceBetween([item.latitude, item.longitude], [center.latitude, center.longitude]) <= radiusKm;
}

type SaveObservationToFirestoreInput = SaveObservationInput & {
  userId: string;
  jaktlagId: string;
  cameraDirectionDegrees?: number | null;
};

async function saveObservationToFirestore(
  input: SaveObservationToFirestoreInput
): Promise<string> {
  const hasGps  = typeof input.latitude === "number" && typeof input.longitude === "number";
  const geohash = hasGps
    ? geohashForLocation([input.latitude as number, input.longitude as number])
    : null;

  const payload: any = {
    userId:    input.userId,
    jaktlagId: input.jaktlagId,
    dyr:       input.dyr,
    type:      input.type,
    kommentar: input.kommentar,
    tid:       input.tid,
    latitude:  input.latitude,
    longitude: input.longitude,
    retning:   input.retning ?? null,
    antall:    input.antall && input.antall > 0 ? input.antall : 1,
    observationSource: input.observationSource ?? "manual",
    cameraId:  input.cameraId ?? null,
    cameraDirectionDegrees: input.cameraDirectionDegrees ?? null,
    sporType:  input.sporType ?? null,
    kjonn:     input.kjonn ?? null,
    alder:     input.alder ?? null,
    createdAt: serverTimestamp(),
  };
  if (geohash) payload.geohash = geohash;

  const ref = await addDoc(collection(db, OBSERVATIONS_COLLECTION), payload);
  return ref.id;
}

/**
 * Slår opp kameraet en observasjon skal knyttes til, og gir tilbake
 * autoritative verdier (posisjon, retning-øyeblikksbilde, jaktlagId) hentet
 * fra selve kamera-dokumentet — ikke det klienten måtte ha sendt inn.
 * Slik arver en kameraobservasjon alltid riktig jaktlagId fra kameraet
 * (§16), uansett hvilket jaktlag brukeren lokalt har "aktivt" akkurat nå.
 * Faller tilbake til input uendret dersom oppslaget feiler (f.eks. offline).
 */
async function berikMedKameraData(
  input: SaveObservationInput,
  fallbackJaktlagId: string
): Promise<{ input: SaveObservationInput; jaktlagId: string; cameraDirectionDegrees: number | null }> {
  if (!input.cameraId) {
    return { input, jaktlagId: fallbackJaktlagId, cameraDirectionDegrees: null };
  }

  try {
    const kamera = await getCamera(input.cameraId);
    if (!kamera) return { input, jaktlagId: fallbackJaktlagId, cameraDirectionDegrees: null };

    return {
      input: {
        ...input,
        latitude: kamera.latitude,
        longitude: kamera.longitude,
      },
      jaktlagId: kamera.jaktlagId ?? "",
      cameraDirectionDegrees: kamera.directionDegrees,
    };
  } catch {
    // Offline e.l. — behold input som den er, bruk brukerens eget aktive jaktlag.
    return { input, jaktlagId: fallbackJaktlagId, cameraDirectionDegrees: null };
  }
}

export async function saveObservation(
  input: SaveObservationInput
): Promise<{ id: string; offline: boolean }> {
  const user = auth.currentUser;
  if (!user) throw new Error("Bruker er ikke logget inn.");

  const egetJaktlagId = (await getAktivtJaktlagId()) ?? "";
  const { input: beriket, jaktlagId, cameraDirectionDegrees } =
    await berikMedKameraData(input, egetJaktlagId);

  try {
    const id = await saveObservationToFirestore({
      ...beriket,
      userId: user.uid,
      jaktlagId,
      cameraDirectionDegrees,
    });
    return { id, offline: false };
  } catch {
    await leggIKø({
      dyr:       beriket.dyr,
      type:      beriket.type,
      kommentar: beriket.kommentar,
      tid:       beriket.tid,
      latitude:  beriket.latitude,
      longitude: beriket.longitude,
      retning:   beriket.retning ?? null,
      antall:    beriket.antall ?? 1,
      observationSource: beriket.observationSource ?? "manual",
      cameraId:  beriket.cameraId ?? null,
      cameraDirectionDegrees,
      sporType:  beriket.sporType ?? null,
      kjonn:     beriket.kjonn ?? null,
      alder:     beriket.alder ?? null,
    });
    return { id: "offline", offline: true };
  }
}

export async function drainOfflineQueue(): Promise<number> {
  const user = auth.currentUser;
  if (!user) return 0;
  const egetJaktlagId = (await getAktivtJaktlagId()) ?? "";

  const kø = await hentKø();
  let synket = 0;
  for (const obs of kø) {
    try {
      // Kameraobservasjoner: slå opp kameraet på nytt ved synk (ikke bare ved
      // lagring), i tilfelle kameraets jaktlag-tilknytning er endret siden
      // observasjonen ble lagt i kø mens enheten var offline.
      const { jaktlagId, cameraDirectionDegrees } = await berikMedKameraData(obs, egetJaktlagId);

      await saveObservationToFirestore({
        ...obs,
        userId: user.uid,
        jaktlagId,
        cameraDirectionDegrees: obs.cameraDirectionDegrees ?? cameraDirectionDegrees,
      });
      await fjernFraKø(obs.id);
      synket++;
    } catch {
      break;
    }
  }
  return synket;
}

export function subscribeToNearbyObservations(
  { center, radiusKm = 50 }: NearbyOptions,
  onData: (items: Observasjon[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const radiusInM = radiusKm * 1000;
  const bounds    = geohashQueryBounds([center.latitude, center.longitude], radiusInM);

  const latestPerQuery = new Map<string, Observasjon[]>();
  const unsubscribers:  Unsubscribe[] = [];
  let avbrutt = false;

  const emitMerged = () => {
    onData(dedupeObservations(Array.from(latestPerQuery.values()).flat()));
  };

  // Firestore validerer en spørring mot dens *mulige* resultatsett, ikke de
  // faktiske dokumentene. Sikkerhetsregelen for `observations` sjekker
  // jaktlagId — så en geohash-spørring UTEN en tilsvarende where("jaktlagId")
  // ville blitt avvist i sin helhet (permission-denied), ikke bare filtrert.
  // Derfor kjører vi to eksplisitte, "beviselig trygge" spørringer per
  // geohash-intervall: én for offentlige observasjoner (jaktlagId == "") og
  // én for eget aktivt jaktlag (jaktlagId == mitt lag) — begge matcher
  // Firestore-regelen nøyaktig og trenger ingen klient-side etterfiltrering.
  getAktivtJaktlagId().then((jaktlagId) => {
    if (avbrutt) return;

    const jaktlagIder = jaktlagId ? ["", jaktlagId] : [""];

    bounds.forEach(([startHash, endHash], boundIndex) => {
      jaktlagIder.forEach((id) => {
        const key = `${boundIndex}:${id}`;
        const q = query(
          collection(db, OBSERVATIONS_COLLECTION),
          where("jaktlagId", "==", id),
          orderBy("geohash"),
          startAt(startHash),
          endAt(endHash)
        );

        const unsub = onSnapshot(
          q,
          (snapshot) => {
            const items: Observasjon[] = [];
            snapshot.forEach((d) => {
              const item = mapDocToObservation(d);
              if (typeof item.latitude !== "number" || typeof item.longitude !== "number") return;
              if (isWithinRadiusKm(item as { latitude: number; longitude: number }, center, radiusKm)) {
                items.push(item);
              }
            });
            latestPerQuery.set(key, items);
            emitMerged();
          },
          (error) => onError?.(error as Error)
        );
        unsubscribers.push(unsub);
      });
    });
  });

  return () => {
    avbrutt = true;
    unsubscribers.forEach((u) => u());
  };
}

/**
 * Observasjoner eksplisitt koblet til ett viltkamera (via cameraId) — brukes
 * av kamera-statistikkskjermen. Mer presist enn en radius-basert
 * nærhetsspørring, og respekterer jaktlag-personvernet på samme måte som
 * subscribeToNearbyObservations (jaktlagId må oppgis og matche kameraets
 * eget jaktlagId for at spørringen skal være bevisbart trygg for Firestore).
 */
export function subscribeToObservationsByCamera(
  cameraId: string,
  jaktlagId: string,
  onData: (items: Observasjon[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, OBSERVATIONS_COLLECTION),
    where("jaktlagId", "==", jaktlagId),
    where("cameraId", "==", cameraId),
    orderBy("tid", "desc")
  );

  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map(mapDocToObservation)),
    (error) => onError?.(error as Error)
  );
}

export async function deleteObservation(id: string): Promise<void> {
  await deleteDoc(doc(db, OBSERVATIONS_COLLECTION, id));
}

export function subscribeToMyObservations(
  onData: (items: Observasjon[]) => void,
  antall = 40
): Unsubscribe {
  const uid = auth.currentUser?.uid;
  if (!uid) { onData([]); return () => {}; }

  const q = query(
    collection(db, OBSERVATIONS_COLLECTION),
    where("userId", "==", uid),
    orderBy("createdAt", "desc"),
    firestoreLimit(antall)
  );

  return onSnapshot(q, (snap) => {
    onData(snap.docs.map(mapDocToObservation));
  });
}
