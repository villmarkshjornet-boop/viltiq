import * as Location from "expo-location";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../config/firebase";
import { getAktivtJaktlagId } from "./jaktlag";

export type UserPosition = {
  latitude: number;
  longitude: number;
};

export type MedlemPosisjon = {
  uid: string;
  epost: string;
  latitude: number;
  longitude: number;
  updatedAt?: any;
};

/**
 * Feltrapport (fysisk enhet, V1.3): "Planlegg jakt"/observasjoner ga verken
 * feilmelding eller resultat — sporet til at `Location.getCurrentPositionAsync`
 * IKKE har noen innebygd timeout. Ved et kaldt GPS-fix (f.eks. innendørs, eller
 * første posisjonsoppslag etter appstart) kan kallet henge i svært lang tid —
 * UI-et som venter på det (Hjem/Jakt/Kart) blir da stående i "laster"-tilstand
 * på ubestemt tid, ikke en synlig feil, nøyaktig det brukeren beskrev.
 */
const POSITION_TIMEOUT_MS = 12000;

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("Posisjon tok for lang tid")), ms));
}

export async function getUserPosition(): Promise<UserPosition | null> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") return null;

  try {
    const location = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      timeoutAfter(POSITION_TIMEOUT_MS),
    ]);
    return { latitude: location.coords.latitude, longitude: location.coords.longitude };
  } catch {
    // Fersk GPS-måling tok for lang tid — prøv SISTE KJENTE posisjon
    // (øyeblikkelig, ingen ny måling) i stedet for å gi brukeren ingenting.
    // Fortsatt `null` (samme, allerede håndterte "ingen posisjon"-tilstand
    // nedstrøms) hvis heller ingen slik finnes.
    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    return last ? { latitude: last.coords.latitude, longitude: last.coords.longitude } : null;
  }
}

export async function syncUserLocation(input: UserPosition): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("Bruker er ikke logget inn.");

  const jaktlagId = await getAktivtJaktlagId();

  await setDoc(
    doc(db, "user_locations", user.uid),
    {
      uid:       user.uid,
      epost:     user.email ?? "",
      latitude:  input.latitude,
      longitude: input.longitude,
      jaktlagId: jaktlagId ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// Abonner på andre jaktlag-medlemmers siste posisjon (siste 4 timer).
export function subscribeToJaktlagLocations(
  jaktlagId: string,
  onData: (posisjoner: MedlemPosisjon[]) => void
): () => void {
  const currentUid = auth.currentUser?.uid;

  const q = query(
    collection(db, "user_locations"),
    where("jaktlagId", "==", jaktlagId)
  );

  return onSnapshot(q, (snap) => {
    const items: MedlemPosisjon[] = [];
    snap.forEach((d) => {
      if (d.id === currentUid) return; // ikke vis eget spor
      const data = d.data();
      if (typeof data.latitude !== "number" || typeof data.longitude !== "number") return;
      // Filtrer bort gamle posisjoner (>4t)
      const age = data.updatedAt?.toMillis
        ? Date.now() - data.updatedAt.toMillis()
        : Infinity;
      if (age > 4 * 3600000) return;
      items.push({
        uid:       d.id,
        epost:     data.epost ?? "",
        latitude:  data.latitude,
        longitude: data.longitude,
        updatedAt: data.updatedAt,
      });
    });
    onData(items);
  });
}
