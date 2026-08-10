import { auth, db } from "@/src/config/firebase";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    where,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { getAktivtJaktlagId } from "./jaktlag";

const MAP_POINTS_COLLECTION = "mapPoints";

// Frittstående punkttyper for "Annet" i kartet. Holdt som en åpen streng
// (ikke en snever union) i selve datamodellen slik at flere typer kan
// legges til i UI-et senere uten en datamigrering — se KartPunktType for
// forslagene som i dag vises i velgeren.
export const KART_PUNKT_TYPER = [
  "Saltstein",
  "Fôringsplass",
  "Post",
  "Åte",
  "Terrenginformasjon",
  "Annet",
] as const;

export type KartPunktType = (typeof KART_PUNKT_TYPER)[number];

export type MapPoint = {
  id: string;
  userId: string;
  jaktlagId: string; // "" = offentlig
  latitude: number;
  longitude: number;
  pointType: string;
  label: string;
  kommentar: string;
  createdAt?: any;
};

export async function saveMapPoint(input: {
  latitude: number;
  longitude: number;
  pointType: string;
  label?: string;
  kommentar?: string;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Bruker er ikke logget inn.");

  const jaktlagId = (await getAktivtJaktlagId()) ?? "";

  const ref = await addDoc(collection(db, MAP_POINTS_COLLECTION), {
    userId: user.uid,
    jaktlagId,
    latitude: input.latitude,
    longitude: input.longitude,
    pointType: input.pointType,
    label: input.label?.trim() || "",
    kommentar: input.kommentar?.trim() || "",
    createdAt: serverTimestamp(),
  });

  return ref.id;
}

/**
 * Kartpunkter brukeren skal se: egne, pluss jaktlagets (samme "to trygge
 * spørringer"-mønster som observations.ts og cameras.ts — se kommentaren i
 * subscribeToNearbyObservations for hvorfor dette er nødvendig).
 */
export function subscribeToVisibleMapPoints(
  jaktlagId: string | null,
  onData: (items: MapPoint[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const user = auth.currentUser;
  if (!user) {
    onData([]);
    return () => {};
  }

  const latest = new Map<string, MapPoint[]>();
  const emit = () => {
    const map = new Map<string, MapPoint>();
    for (const items of latest.values()) {
      for (const p of items) map.set(p.id, p);
    }
    onData(Array.from(map.values()));
  };

  const toMapPoint = (id: string, data: any): MapPoint => ({
    id,
    userId: data.userId ?? "",
    jaktlagId: data.jaktlagId ?? "",
    latitude: data.latitude,
    longitude: data.longitude,
    pointType: data.pointType ?? "Annet",
    label: data.label ?? "",
    kommentar: data.kommentar ?? "",
    createdAt: data.createdAt,
  });

  const unsubscribers: Unsubscribe[] = [];

  const egneQ = query(
    collection(db, MAP_POINTS_COLLECTION),
    where("userId", "==", user.uid),
    orderBy("createdAt", "desc")
  );
  unsubscribers.push(
    onSnapshot(
      egneQ,
      (snap) => {
        latest.set("egne", snap.docs.map((d) => toMapPoint(d.id, d.data())));
        emit();
      },
      (err) => onError?.(err as Error)
    )
  );

  if (jaktlagId) {
    const lagQ = query(
      collection(db, MAP_POINTS_COLLECTION),
      where("jaktlagId", "==", jaktlagId),
      orderBy("createdAt", "desc")
    );
    unsubscribers.push(
      onSnapshot(
        lagQ,
        (snap) => {
          latest.set("lag", snap.docs.map((d) => toMapPoint(d.id, d.data())));
          emit();
        },
        (err) => onError?.(err as Error)
      )
    );
  }

  return () => unsubscribers.forEach((u) => u());
}

export async function deleteMapPoint(id: string): Promise<void> {
  await deleteDoc(doc(db, MAP_POINTS_COLLECTION, id));
}
