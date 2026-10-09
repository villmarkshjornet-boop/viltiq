// Jaktlag-chat — én delt samtale per jaktlag (jaktlag/{id}/messages), samme
// medlemskaps-modell (isMember) som kvoter/medlemmer. "Sist lest"-tidspunkt
// holdes lokalt i AsyncStorage (samme mønster som getAktivtJaktlagId i
// jaktlag.ts) — enkel og krever ingen ny Firestore-skriving/regel bare for å
// telle uleste meldinger.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth, db } from "@/src/config/firebase";
import {
  addDoc,
  collection,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

const LAST_READ_KEY_PREFIX = "chat_sist_lest_v1_";
const MAX_MELDINGER = 200;

export type ChatMelding = {
  id: string;
  senderUid: string;
  senderNavn: string;
  tekst: string;
  sendtAtMs: number | null; // null helt kort mens serverTimestamp() ennå ikke er skrevet tilbake
};

export async function sendChatMelding(jaktlagId: string, tekst: string, senderNavn: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Ikke innlogget");
  const trimmet = tekst.trim();
  if (!trimmet) return;

  await addDoc(collection(db, "jaktlag", jaktlagId, "messages"), {
    senderUid: uid,
    senderNavn,
    tekst: trimmet,
    sendtAt: serverTimestamp(),
  });
}

export function subscribeToChatMeldinger(
  jaktlagId: string,
  onData: (meldinger: ChatMelding[]) => void
): () => void {
  const q = query(
    collection(db, "jaktlag", jaktlagId, "messages"),
    orderBy("sendtAt", "asc"),
    fsLimit(MAX_MELDINGER)
  );
  return onSnapshot(q, (snap) => {
    onData(
      snap.docs.map((d) => {
        const data = d.data();
        const ts = data.sendtAt as Timestamp | undefined;
        return {
          id: d.id,
          senderUid: data.senderUid ?? "",
          senderNavn: data.senderNavn ?? "Jeger",
          tekst: data.tekst ?? "",
          sendtAtMs: ts?.toMillis?.() ?? null,
        };
      })
    );
  });
}

export async function hentSistLest(jaktlagId: string): Promise<number> {
  const raw = await AsyncStorage.getItem(LAST_READ_KEY_PREFIX + jaktlagId);
  return raw ? Number(raw) || 0 : 0;
}

export async function markerChatSomLest(jaktlagId: string): Promise<void> {
  await AsyncStorage.setItem(LAST_READ_KEY_PREFIX + jaktlagId, String(Date.now()));
}

/** Antall meldinger fra ANDRE medlemmer sendt etter "sist lest"-tidspunktet. */
export function tellUlesteMeldinger(meldinger: ChatMelding[], sistLestMs: number, egenUid: string | undefined): number {
  return meldinger.filter((m) => m.senderUid !== egenUid && (m.sendtAtMs ?? 0) > sistLestMs).length;
}
