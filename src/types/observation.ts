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

// Hvor gammelt et spor/tegn SÅ UT da jegeren fant det — kun meningsfullt når
// observationSource === "track". Dette er ET ANNET begrep enn hvor lenge
// siden observasjonen ble REGISTRERT (det er tid/createdAt, som motorens
// eksisterende tidsvekting allerede håndterer).
export type SporAlder = "fersk" | "noen_dager" | "gammel";

// Versjonerer FORMEN på Observasjon-dokumentet (hvilke felter som finnes),
// separat fra motorens egen CONFIG_VERSION/ENGINE_VERSION. Eldre dokumenter
// mangler dette feltet helt — de behandles som schemaVersion 1 ved lesing
// (se normaliserObservasjonData i src/services/observations.ts), det kreves
// ALDRI en engangs-datamigrering for å bumpe dette.
export const OBSERVASJON_SCHEMA_VERSION = 1;

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
  accuracyMeters?: number | null; // GPS-nøyaktighet (meter) på registreringstidspunktet, FØR anonymiserPosisjon()
  sporAlder?: SporAlder | null; // hvor gammelt sporet SÅ UT — kun meningsfullt når observationSource === "track"
  schemaVersion?: number; // se OBSERVASJON_SCHEMA_VERSION — mangler på eldre dokumenter, behandles da som 1
  createdAt?: any;
};
