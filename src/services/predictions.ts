// Motor V1 — persistens for prediction-snapshots (se src/engine/snapshot.ts
// for den rene byggefunksjonen/typen). Denne filen er den EMESTE IO-halvparten:
// lagre et snapshot til Firestore, og en bevisst smal "bekreftet av en senere
// observasjon"-sjekk — ikke et fullverdig evaluerings-/kalibreringssystem
// (det er eksplisitt fremtidig arbeid, §24).

import { auth, db } from "@/src/config/firebase";
import type { EngineObservation, Species } from "@/src/engine";
import type {
  PredictionSnapshot,
  PredictionSnapshotZone,
} from "@/src/engine/snapshot";
import { distanceMeters } from "@/src/lib/geo";
import {
  addDoc,
  collection,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { getAktivtJaktlagId } from "./jaktlag";

const PREDICTIONS_COLLECTION = "predictions";

/**
 * Lagrer ett prediction-snapshot. jaktlagId løses ALLTID på nytt her, på
 * nøyaktig samme måte som observations.ts/felling.ts — vi stoler aldri på
 * snapshot.jaktlagId slik kalleren måtte ha satt den (kan være gammel/feil
 * hvis brukeren byttet aktivt jaktlag mellom motorkjøring og lagring), slik
 * at feltet som faktisk skrives til Firestore alltid er "" (offentlig) eller
 * brukerens EGET aktive lag akkurat nå.
 */
export async function savePredictionSnapshot(
  snapshot: PredictionSnapshot
): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Ikke innlogget");

  const jaktlagId = (await getAktivtJaktlagId()) ?? "";

  const ref = await addDoc(collection(db, PREDICTIONS_COLLECTION), {
    ...snapshot,
    jaktlagId,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export type SnapshotEvaluation = {
  outcome: "confirmed_hit";
  matchedZone: PredictionSnapshotZone;
  hoursAfterPrediction: number;
};

/**
 * BEVISST SMAL: dette er en "kan vi peke på POSITIV bekreftende evidens"-
 * sjekk, ikke en hit/miss-scorer. Et dyr kan finnes et sted uten å bli
 * observert der — fravær av en senere observasjon i en sone er derfor IKKE
 * bevis for at prediksjonen var feil, bare at ingen tilfeldigvis så/fotograferte
 * noe der i tidsvinduet. Denne funksjonen returnerer derfor ENTEN en konkret
 * "confirmed_hit" ENTEN null — ALDRI en "miss"/"unconfirmed"-klassifisering.
 * Ikke "forbedre" dette til en naiv hit/miss-scorer uten å lese dette
 * avsnittet igjen: en fullverdig evaluering/kalibrering er eksplisitt
 * fremtidig arbeid (§24), ikke noe denne funksjonen skal late som den gjør.
 *
 * Ren funksjon: tar ett snapshot og ÉN kandidat-observasjon, ingen Firestore-
 * kall her. Å hente kandidat-observasjoner er kallerens ansvar (utenfor
 * omfanget her).
 */
export function evaluateSnapshotAgainstObservation(
  snapshot: PredictionSnapshot,
  observation: EngineObservation
): SnapshotEvaluation | null {
  if (observation.species !== snapshot.species) return null;
  // Kan ikke bekrefte en prediksjon med data som fantes FØR prediksjonen selv
  // (validFrom), eller som ligger utenfor snapshotets gyldighetsvindu.
  if (observation.timestamp < snapshot.validFrom) return null;
  if (observation.timestamp > snapshot.validUntil) return null;

  for (const zone of snapshot.zones) {
    const distanceToZoneCenter = distanceMeters(observation.position, zone.center);
    if (distanceToZoneCenter <= zone.radiusMeters) {
      return {
        outcome: "confirmed_hit",
        matchedZone: zone,
        hoursAfterPrediction: (observation.timestamp - snapshot.calculatedAt) / 3_600_000,
      };
    }
  }

  // Rett art, rett tidsvindu, men utenfor alle sonenes radius — bevisst
  // fortsatt null, ikke en "miss". Se funksjonskommentaren over.
  return null;
}

function mapDocToSnapshot(d: { data: () => Record<string, unknown> }): PredictionSnapshot {
  const data = d.data();
  return {
    userId: (data.userId as string) ?? "",
    jaktlagId: (data.jaktlagId as string) ?? "",
    species: data.species as PredictionSnapshot["species"],
    engineVersion: (data.engineVersion as string) ?? "",
    configVersion: (data.configVersion as string) ?? "",
    calculatedAt: (data.calculatedAt as number) ?? 0,
    validFrom: (data.validFrom as number) ?? 0,
    validUntil: (data.validUntil as number) ?? 0,
    areaCenter: data.areaCenter as PredictionSnapshot["areaCenter"],
    areaRadiusMeters: (data.areaRadiusMeters as number) ?? 0,
    zones: (data.zones as PredictionSnapshot["zones"]) ?? [],
    observationsConsidered: (data.observationsConsidered as number) ?? 0,
    summary: (data.summary as string) ?? "",
  };
}

/**
 * Enkel lesing-tilbake for EGET aktive jaktlag (eller offentlig, hvis
 * brukeren ikke har noe aktivt lag) — ikke en full "mine + offentlige"-
 * sammenslåing slik subscribeToNearbyObservations gjør. Det holder for et
 * første lese-verktøy; utvid til to-spørrings-mønsteret i observations.ts
 * hvis et fremtidig behov faktisk krever "mitt lag OG offentlig" samtidig.
 */
export async function getRecentSnapshots(
  species: Species,
  limitCount = 20
): Promise<PredictionSnapshot[]> {
  const jaktlagId = (await getAktivtJaktlagId()) ?? "";

  const q = query(
    collection(db, PREDICTIONS_COLLECTION),
    where("jaktlagId", "==", jaktlagId),
    where("species", "==", species),
    orderBy("calculatedAt", "desc"),
    firestoreLimit(limitCount)
  );

  const snap = await getDocs(q);
  return snap.docs.map(mapDocToSnapshot);
}
