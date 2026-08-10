import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth, db } from "@/src/config/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const AKTIV_KEY = "aktiv_jaktlag_v1";

export type Jaktlag = {
  id: string;
  navn: string;
  invitKode: string;
  lederUid: string;
  opprettet: string;
};

export type Medlem = {
  uid: string;
  epost: string;
  rolle: "leder" | "jeger";
};

function genKode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ─── Lokalt cache ─────────────────────────────────────────────────────────────

export async function getAktivtJaktlagId(): Promise<string | null> {
  return AsyncStorage.getItem(AKTIV_KEY);
}

export async function setAktivtJaktlagId(id: string): Promise<void> {
  await AsyncStorage.setItem(AKTIV_KEY, id);
}

export async function clearAktivtJaktlagId(): Promise<void> {
  await AsyncStorage.removeItem(AKTIV_KEY);
}

// ─── Firestore ────────────────────────────────────────────────────────────────

export async function opprettJaktlag(navn: string): Promise<Jaktlag> {
  const uid   = auth.currentUser?.uid;
  const epost = auth.currentUser?.email ?? "";
  if (!uid) throw new Error("Ikke innlogget");

  const invitKode = genKode();
  const ref = await addDoc(collection(db, "jaktlag"), {
    navn,
    invitKode,
    lederUid: uid,
    opprettet: serverTimestamp(),
  });

  await setDoc(doc(db, "jaktlag", ref.id, "members", uid), {
    uid, epost, rolle: "leder", blagtTil: serverTimestamp(),
  });

  const jaktlag: Jaktlag = { id: ref.id, navn, invitKode, lederUid: uid, opprettet: new Date().toISOString() };
  await setAktivtJaktlagId(ref.id);
  return jaktlag;
}

export async function bliMedIJaktlag(kode: string): Promise<Jaktlag> {
  const uid   = auth.currentUser?.uid;
  const epost = auth.currentUser?.email ?? "";
  if (!uid) throw new Error("Ikke innlogget");

  const snap = await getDocs(
    query(collection(db, "jaktlag"), where("invitKode", "==", kode.toUpperCase().trim()))
  );
  if (snap.empty) throw new Error("Fant ikke noe jaktlag med den koden.");

  const d      = snap.docs[0];
  const data   = d.data();
  const jaktlag: Jaktlag = {
    id:         d.id,
    navn:       data.navn,
    invitKode:  data.invitKode,
    lederUid:   data.lederUid,
    opprettet:  data.opprettet?.toDate?.()?.toISOString() ?? "",
  };

  await setDoc(doc(db, "jaktlag", d.id, "members", uid), {
    uid, epost, rolle: "jeger", blagtTil: serverTimestamp(),
  });

  await setAktivtJaktlagId(d.id);
  return jaktlag;
}

export async function hentJaktlag(id: string): Promise<Jaktlag | null> {
  const snap = await getDoc(doc(db, "jaktlag", id));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    id:        snap.id,
    navn:      data.navn,
    invitKode: data.invitKode,
    lederUid:  data.lederUid,
    opprettet: data.opprettet?.toDate?.()?.toISOString() ?? "",
  };
}

export async function hentMedlemmer(jaktlagId: string): Promise<Medlem[]> {
  const snap = await getDocs(collection(db, "jaktlag", jaktlagId, "members"));
  return snap.docs.map((d) => d.data() as Medlem);
}

export function subscribeMedlemmer(
  jaktlagId: string,
  onData: (m: Medlem[]) => void
): () => void {
  return onSnapshot(
    collection(db, "jaktlag", jaktlagId, "members"),
    (snap) => onData(snap.docs.map((d) => d.data() as Medlem))
  );
}

export async function oppdaterJaktlagNavn(id: string, navn: string): Promise<void> {
  await updateDoc(doc(db, "jaktlag", id), { navn });
}

export async function forlatJaktlag(jaktlagId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Ikke innlogget");
  await deleteDoc(doc(db, "jaktlag", jaktlagId, "members", uid));
  await clearAktivtJaktlagId();
}
