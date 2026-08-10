import { auth, db } from "@/src/config/firebase";
import type { Observasjon } from "@/src/types/observation";
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
    Unsubscribe,
    where,
} from "firebase/firestore";
import {
    distanceBetween,
    geohashForLocation,
    geohashQueryBounds,
} from "geofire-common";
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
    dyr:       data.dyr       ?? "",
    type:      data.type      ?? "",
    kommentar: data.kommentar ?? "",
    tid:       data.tid       ?? "",
    latitude:  data.latitude  ?? null,
    longitude: data.longitude ?? null,
    geohash:   data.geohash   ?? "",
    retning:   data.retning   ?? null,
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

async function saveObservationToFirestore(
  input: SaveObservationInput & { userId: string; jaktlagId: string }
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
    createdAt: serverTimestamp(),
  };
  if (geohash) payload.geohash = geohash;

  const ref = await addDoc(collection(db, OBSERVATIONS_COLLECTION), payload);
  return ref.id;
}

export async function saveObservation(
  input: SaveObservationInput
): Promise<{ id: string; offline: boolean }> {
  const user = auth.currentUser;
  if (!user) throw new Error("Bruker er ikke logget inn.");

  const jaktlagId = (await getAktivtJaktlagId()) ?? undefined;

  try {
    const id = await saveObservationToFirestore({ ...input, userId: user.uid, jaktlagId: jaktlagId ?? "" });
    return { id, offline: false };
  } catch {
    await leggIKø({
      dyr:       input.dyr,
      type:      input.type,
      kommentar: input.kommentar,
      tid:       input.tid,
      latitude:  input.latitude,
      longitude: input.longitude,
      retning:   input.retning ?? null,
    });
    return { id: "offline", offline: true };
  }
}

export async function drainOfflineQueue(): Promise<number> {
  const user = auth.currentUser;
  if (!user) return 0;
  const jaktlagId = await getAktivtJaktlagId();
  if (!jaktlagId) return 0;

  const kø = await hentKø();
  let synket = 0;
  for (const obs of kø) {
    try {
      await saveObservationToFirestore({ ...obs, userId: user.uid, jaktlagId });
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

  const latestPerQuery = new Map<number, Observasjon[]>();
  const unsubscribers:  Unsubscribe[] = [];

  // Hent jaktlagId én gang, bruk den for klient-side filtrering
  let jaktlagId: string | null = null;
  getAktivtJaktlagId().then((id) => { jaktlagId = id; });

  const emitMerged = () => {
    onData(dedupeObservations(Array.from(latestPerQuery.values()).flat()));
  };

  bounds.forEach(([startHash, endHash], index) => {
    const q = query(
      collection(db, OBSERVATIONS_COLLECTION),
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
          // Filtrer på jaktlag hvis tilgjengelig
          if (jaktlagId && d.data().jaktlagId && d.data().jaktlagId !== jaktlagId) return;
          if (isWithinRadiusKm(item as { latitude: number; longitude: number }, center, radiusKm)) {
            items.push(item);
          }
        });
        latestPerQuery.set(index, items);
        emitMerged();
      },
      (error) => onError?.(error as Error)
    );
    unsubscribers.push(unsub);
  });

  return () => unsubscribers.forEach((u) => u());
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
