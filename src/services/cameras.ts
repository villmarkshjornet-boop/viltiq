import { auth, db } from "@/src/config/firebase";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
    where,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { getAktivtJaktlagId } from "./jaktlag";

export type Viltkamera = {
  id: string;
  userId: string;
  jaktlagId: string; // "" = ikke tilknyttet noe jaktlag (offentlig/eget)
  name: string;
  latitude: number;
  longitude: number;
  directionDegrees: number; // 0=nord, 90=øst, 180=sør, 270=vest
  notes: string;
  installedAt?: any; // Firestore Timestamp — når kameraet ble satt opp
  createdAt?: any;
  updatedAt?: any;
  active: boolean; // false = "fjernet" (myk sletting, historikk beholdes)
  removedAt?: any | null;
  lastCheckedAt?: string;
  batteryStatus?: string;
  memoryCardStatus?: string;
  baitStatus?: string;
};

/**
 * Eldre kamera-dokumenter kan mangle directionDegrees/jaktlagId/active
 * (fra før disse feltene fantes). Gi trygge standardverdier ved lesing i
 * stedet for å kreve en engangs-datamigrering.
 */
function normaliserKameraData(id: string, data: any): Viltkamera {
  return {
    id,
    userId: data.userId ?? "",
    jaktlagId: data.jaktlagId ?? "",
    name: data.name ?? "",
    latitude: data.latitude,
    longitude: data.longitude,
    directionDegrees:
      typeof data.directionDegrees === "number" ? data.directionDegrees : 0,
    notes: data.notes ?? "",
    installedAt: data.installedAt ?? data.createdAt,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    active: data.active ?? true,
    removedAt: data.removedAt ?? null,
    lastCheckedAt: data.lastCheckedAt || "",
    batteryStatus: data.batteryStatus || "Ukjent",
    memoryCardStatus: data.memoryCardStatus || "Ukjent",
    baitStatus: data.baitStatus || "Ukjent",
  };
}

export async function saveCamera(input: {
  name: string;
  latitude: number;
  longitude: number;
  directionDegrees: number;
  notes?: string;
}): Promise<string> {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Bruker er ikke logget inn.");
  }

  const jaktlagId = (await getAktivtJaktlagId()) ?? "";

  const ref = await addDoc(collection(db, "cameras"), {
    userId: user.uid,
    jaktlagId,
    name: input.name,
    latitude: input.latitude,
    longitude: input.longitude,
    directionDegrees: normaliserGrader(input.directionDegrees),
    notes: input.notes || "",
    lastCheckedAt: "",
    batteryStatus: "Ukjent",
    memoryCardStatus: "Ukjent",
    baitStatus: "Ukjent",
    active: true,
    removedAt: null,
    installedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}

/** Normaliser en vilkårlig gradverdi til intervallet [0, 360). */
export function normaliserGrader(grader: number): number {
  const g = grader % 360;
  return g < 0 ? g + 360 : g;
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
    callback(snapshot.docs.map((d) => normaliserKameraData(d.id, d.data())));
  });
}

/**
 * Kameraer brukeren skal se på kartet: alle egne kameraer, pluss aktive
 * kameraer som tilhører jaktlaget brukeren er med i (satt opp av lagkamerater).
 * To separate spørringer (én per felt sikkerhetsregelen kan bevise trygt),
 * slått sammen og deduplisert — se subscribeToNearbyObservations i
 * observations.ts for samme mønster og begrunnelse.
 */
export function subscribeToVisibleCameras(
  jaktlagId: string | null,
  onData: (items: Viltkamera[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const user = auth.currentUser;
  if (!user) {
    onData([]);
    return () => {};
  }

  const latest = new Map<string, Viltkamera[]>();
  const emit = () => {
    const map = new Map<string, Viltkamera>();
    for (const items of latest.values()) {
      for (const k of items) map.set(k.id, k);
    }
    onData(Array.from(map.values()));
  };

  const unsubscribers: Unsubscribe[] = [];

  const egneQ = query(collection(db, "cameras"), where("userId", "==", user.uid));
  unsubscribers.push(
    onSnapshot(
      egneQ,
      (snap) => {
        latest.set("egne", snap.docs.map((d) => normaliserKameraData(d.id, d.data())));
        emit();
      },
      (err) => onError?.(err as Error)
    )
  );

  if (jaktlagId) {
    const lagQ = query(collection(db, "cameras"), where("jaktlagId", "==", jaktlagId));
    unsubscribers.push(
      onSnapshot(
        lagQ,
        (snap) => {
          latest.set("lag", snap.docs.map((d) => normaliserKameraData(d.id, d.data())));
          emit();
        },
        (err) => onError?.(err as Error)
      )
    );
  }

  return () => unsubscribers.forEach((u) => u());
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
      callback(normaliserKameraData(snapshot.id, snapshot.data()));
    },
    (error) => onError?.(error as Error)
  );
}

export async function getCamera(id: string): Promise<Viltkamera | null> {
  const snap = await getDoc(doc(db, "cameras", id));
  if (!snap.exists()) return null;
  return normaliserKameraData(snap.id, snap.data());
}

export async function updateCamera(
  id: string,
  input: Partial<Omit<Viltkamera, "id" | "userId" | "jaktlagId">>
) {
  const payload: any = { ...input, updatedAt: serverTimestamp() };
  if (typeof payload.directionDegrees === "number") {
    payload.directionDegrees = normaliserGrader(payload.directionDegrees);
  }
  await updateDoc(doc(db, "cameras", id), payload);
}

/**
 * "Fjern kamera" er en myk sletting: kameraet slutter å vises som aktivt på
 * kartet, men historiske observasjoner og statistikk knyttet til det
 * (via cameraId) beholdes uendret. Bruk kun ekte hard-sletting
 * (deleteCamera) når brukeren eksplisitt vil kvitte seg med et feilopprettet
 * kamera uten historikk.
 */
export async function deactivateCamera(id: string): Promise<void> {
  await updateDoc(doc(db, "cameras", id), {
    active: false,
    removedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteCamera(id: string) {
  await deleteDoc(doc(db, "cameras", id));
}
