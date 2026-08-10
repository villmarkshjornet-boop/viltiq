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
    Unsubscribe,
    updateDoc,
    where,
} from "firebase/firestore";

export type Viltkamera = {
  id: string;
  userId: string;
  name: string;
  latitude: number;
  longitude: number;
  direction: string;
  notes: string;
  createdAt?: any;
  updatedAt?: any;
  lastCheckedAt?: string;
  batteryStatus?: string;
  memoryCardStatus?: string;
  baitStatus?: string;
};

export async function saveCamera(input: {
  name: string;
  latitude: number;
  longitude: number;
  direction?: string;
  notes?: string;
}) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Bruker er ikke logget inn.");
  }

  await addDoc(collection(db, "cameras"), {
    userId: user.uid,
    name: input.name,
    latitude: input.latitude,
    longitude: input.longitude,
    direction: input.direction || "",
    notes: input.notes || "",
    lastCheckedAt: "",
    batteryStatus: "Ukjent",
    memoryCardStatus: "Ukjent",
    baitStatus: "Ukjent",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function subscribeToMyCameras(callback: (items: Viltkamera[]) => void) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Bruker er ikke logget inn.");
  }

  const q = query(
    collection(db, "cameras"),
    where("userId", "==", user.uid),
    orderBy("createdAt", "desc")
  );

  return onSnapshot(q, (snapshot) => {
    const items: Viltkamera[] = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Viltkamera, "id">),
    }));

    callback(items);
  });
}

/**
 * Sanntidsabonnement på ett enkelt kamera-dokument. Brukes av kamera-
 * detaljskjermen (app/kamera/[id].tsx) slik at f.eks. en sjekk registrert fra
 * en annen enhet dukker opp uten at brukeren må laste skjermen på nytt.
 * Kaller `callback(null)` dersom kameraet ikke (lenger) finnes.
 */
export function subscribeToCamera(
  id: string,
  callback: (item: Viltkamera | null) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, "cameras", id),
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback({
        id: snapshot.id,
        ...(snapshot.data() as Omit<Viltkamera, "id">),
      });
    },
    (error) => onError?.(error as Error)
  );
}

export async function updateCamera(
  id: string,
  input: Partial<Omit<Viltkamera, "id" | "userId">>
) {
  await updateDoc(doc(db, "cameras", id), {
    ...input,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCamera(id: string) {
  await deleteDoc(doc(db, "cameras", id));
}