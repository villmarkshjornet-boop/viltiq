// Brukerprofil — visningsnavn. Kanonisk verdi lever i users/{uid} (privat,
// samme dokument push.ts allerede skriver notifikasjonsinnstillinger til).
// En kopi denormaliseres til jaktlag/{id}/members/{uid}.navn slik at andre
// medlemmer (som ikke har lesetilgang til users/{uid}, se firestore.rules)
// kan vise navnet i medlemslister og chat uten et eget oppslag.

import { auth, db } from "@/src/config/firebase";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { utledNavnFraEpost } from "../lib/navn";
import { getAktivtJaktlagId } from "./jaktlag";

export type MinProfil = {
  uid: string;
  epost: string;
  displayName: string;
};

export async function hentMinProfil(): Promise<MinProfil> {
  const user = auth.currentUser;
  if (!user) throw new Error("Ikke innlogget");

  const snap = await getDoc(doc(db, "users", user.uid));
  const data = snap.exists() ? snap.data() : null;
  const epost = user.email ?? "";
  return {
    uid: user.uid,
    epost,
    displayName: (data?.displayName as string | undefined) || utledNavnFraEpost(epost),
  };
}

export function subscribeToMinProfil(onData: (profil: MinProfil) => void): () => void {
  const user = auth.currentUser;
  if (!user) throw new Error("Ikke innlogget");
  const epost = user.email ?? "";

  return onSnapshot(doc(db, "users", user.uid), (snap) => {
    const data = snap.exists() ? snap.data() : null;
    onData({
      uid: user.uid,
      epost,
      displayName: (data?.displayName as string | undefined) || utledNavnFraEpost(epost),
    });
  });
}

/** Oppdaterer visningsnavnet — kanonisk (users/{uid}) OG kopien på det aktive jaktlagets medlemsdokument, hvis brukeren er med i et lag. */
export async function oppdaterDisplayName(navn: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("Ikke innlogget");
  const trimmet = navn.trim();
  if (!trimmet) throw new Error("Navnet kan ikke være tomt.");

  await setDoc(
    doc(db, "users", user.uid),
    { uid: user.uid, displayName: trimmet, updatedAt: serverTimestamp() },
    { merge: true }
  );

  const jaktlagId = await getAktivtJaktlagId();
  if (jaktlagId) {
    await updateDoc(doc(db, "jaktlag", jaktlagId, "members", user.uid), { navn: trimmet });
  }
}
