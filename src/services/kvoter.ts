import { db } from "@/src/config/firebase";
import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { getAktivtJaktlagId } from "./jaktlag";

export type Kvoter = Record<string, number>;

const STANDARD: Kvoter = { Rådyr: 0, Elg: 0, Hjort: 0, Rev: 0 };

function kvoteRef(jaktlagId: string) {
  return doc(db, "jaktlag", jaktlagId, "kvoter", "gjeldende");
}

export async function getKvoter(): Promise<Kvoter> {
  const id = await getAktivtJaktlagId();
  if (!id) return { ...STANDARD };
  try {
    const snap = await getDoc(kvoteRef(id));
    if (!snap.exists()) return { ...STANDARD };
    return { ...STANDARD, ...(snap.data() as Kvoter) };
  } catch {
    return { ...STANDARD };
  }
}

export async function saveKvoter(kvoter: Kvoter): Promise<void> {
  const id = await getAktivtJaktlagId();
  if (!id) return;
  await setDoc(kvoteRef(id), kvoter, { merge: true });
}

export async function oppdaterKvote(dyr: string, antall: number): Promise<void> {
  const gjeldende = await getKvoter();
  gjeldende[dyr] = Math.max(0, antall);
  await saveKvoter(gjeldende);
}

export function subscribeKvoter(
  jaktlagId: string,
  onData: (k: Kvoter) => void
): () => void {
  return onSnapshot(kvoteRef(jaktlagId), (snap) => {
    onData(snap.exists() ? { ...STANDARD, ...(snap.data() as Kvoter) } : { ...STANDARD });
  });
}
