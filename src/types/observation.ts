// Kilden som observasjonen ble registrert fra — brukes til å vekte data ulikt
// i statistikk/prediksjon (direkte observasjon vs. viltkamera vs. spor).
export type ObservasjonKilde = "manual" | "camera" | "track";

// Sportype for spor/indirekte observasjoner (observationSource === "track").
export type SporType =
  | "Fotspor"
  | "Avføring"
  | "Beitespor"
  | "Liggeplass"
  | "Feiing"
  | "Annet";

export type Observasjon = {
  id: string;
  userId: string;
  jaktlagId?: string;
  dyr: string;
  type: string;
  kommentar: string;
  tid: string;
  latitude: number | null;
  longitude: number | null;
  geohash: string;
  retning?: number | null; // kompassretning i grader 0–360 (0=N, 90=Ø, 180=S, 270=V)
  antall: number; // antall dyr i denne observasjonen (default 1)
  observationSource: ObservasjonKilde;
  cameraId?: string | null; // satt når observationSource === "camera"
  cameraDirectionDegrees?: number | null; // øyeblikksbilde av kameraets retning da observasjonen ble lagret
  sporType?: SporType | null; // satt når observationSource === "track"
  kjonn?: string | null;
  alder?: string | null;
  createdAt?: any;
};
