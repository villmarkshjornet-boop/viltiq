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
  /**
   * STEG 5 §4: hvilken kvote-kategori (src/services/kvoter.ts) fellingen
   * telles mot, f.eks. "Bukk" for Hjort. null = arten har ingen kategorier
   * definert ennå, eller brukeren har ikke valgt en. Kvotens "felt"-tall
   * regnes ALLTID live fra denne koblingen (se app/jakt.tsx) — aldri en egen
   * lagret teller — så redigering/sletting av en felling korrigerer riktig
   * kategori automatisk, uten noen synk-kode.
   */
  kategoriId: string | null;
  uid: string;
  jaktlagId: string;
  opprettet: string;
};

type FellingInput = Omit<Felling, "id" | "uid" | "jaktlagId" | "opprettet">;

export async function lagreFelling(input: FellingInput): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Ikke innlogget");
  // "" = offentlig/intet jaktlag — samme konvensjon som cameras.ts/
  // mapPoints.ts/observations.ts. Feltet skrives alltid (aldri utelatt),
  // slik at det stemmer med Felling sin egen type (jaktlagId: string, ikke
  // valgfri) og med den sammensatte Firestore-regelen for fellings/create.
  const jaktlagId = (await getAktivtJaktlagId()) ?? "";

  const ref = await addDoc(collection(db, "fellings"), {
    ...input,
    uid,
    jaktlagId,
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
  let avbrutt = false;

  getAktivtJaktlagId().then((jaktlagId) => {
    if (avbrutt) return;

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

  return () => {
    avbrutt = true;
    unsub?.();
  };
}

/**
 * Retter en eksisterende felling (art, kjønn, alder, vekt, dato, kommentar,
 * kategori). Oppdaterer KUN feltene som sendes inn — uid/jaktlagId/opprettet
 * røres aldri, slik at eierskap og opprettelsestidspunkt ikke kan endres via
 * en redigering. Fordi kvotens "felt"-tall er live-beregnet fra fellings-
 * listen (se Felling.kategoriId), korrigerer dette automatisk BÅDE den
 * gamle og den nye kategoriens status når kategoriId endres — det finnes
 * ingen egen kvote-teller å holde synkron.
 */
export async function oppdaterFelling(id: string, input: FellingInput): Promise<void> {
  await updateDoc(doc(db, "fellings", id), { ...input });
}

export async function slettFelling(id: string): Promise<void> {
  await deleteDoc(doc(db, "fellings", id));
}
