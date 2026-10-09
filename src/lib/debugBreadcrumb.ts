import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../config/firebase";

/**
 * MIDLERTIDIG diagnoseverktøy for iOS-fryse-krasjet (se samtale) — appen
 * fryser på en ekte enhet uten at iOS genererer noen krasjelogg, og vi har
 * ingen Mac/Xcode-konsoll tilgjengelig. Fyrer en asynkron, fire-and-forget
 * Firestore-skriving ved hvert sjekkpunkt i Hjem sin oppstartsrekkefølge —
 * det siste sjekkpunktet som faktisk nådde serveren før en fryse/krasj
 * forteller oss nøyaktig hvor langt appen kom. Fjernes når krasjet er løst.
 */
export function breadcrumb(step: string, extra?: Record<string, unknown>): void {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  addDoc(collection(db, "users", uid, "debugBreadcrumbs"), {
    step,
    extra: extra ?? null,
    ts: serverTimestamp(),
    clientTs: Date.now(),
  }).catch(() => {});
}
