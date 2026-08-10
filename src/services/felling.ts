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
import { getAktivtJaktlagId } from "./jaktlag";

export type Felling = {
  id: string;
  dyr: string;
  kjønn: "Hannkjønn" | "Hunkjønn" | "Ukjent";
  aldersklasse: "Kalv/kje" | "Ungdyr" | "Voksen";
  vektKg: number | null;
  dato: string;
  latitude: number | null;
  longitude: number | null;
  kommentar: string;
  uid: string;
  jaktlagId: string;
  opprettet: string;
};

type FellingInput = Omit<Felling, "id" | "uid" | "jaktlagId" | "opprettet">;

export async function lagreFelling(input: FellingInput): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Ikke innlogget");
  const jaktlagId = await getAktivtJaktlagId();

  const ref = await addDoc(collection(db, "fellings"), {
    ...input,
    uid,
    ...(jaktlagId ? { jaktlagId } : {}),
    opprettet: serverTimestamp(),
  });
  return ref.id;
}

export function subscribeFellings(
  onData: (fellings: Felling[]) => void,
  onError: (err: Error) => void
): () => void {
  const uid = auth.currentUser?.uid;
  if (!uid) { onError(new Error("Ikke innlogget")); return () => {}; }

  let unsub: (() => void) | undefined;

  getAktivtJaktlagId().then((jaktlagId) => {
    // Jaktlag-modus: hent alle fellings for laget
    // Offentlig modus: hent egne fellings via uid
    const q = jaktlagId
      ? query(collection(db, "fellings"), where("jaktlagId", "==", jaktlagId), orderBy("dato", "desc"))
      : query(collection(db, "fellings"), where("uid", "==", uid), orderBy("dato", "desc"));

    unsub = onSnapshot(
      q,
      (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Felling, "id">) }))),
      onError
    );
  });

  return () => unsub?.();
}

export async function slettFelling(id: string): Promise<void> {
  await deleteDoc(doc(db, "fellings", id));
}
