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