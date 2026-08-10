export type Observasjon = {
  id: string;
  userId: string;
  dyr: string;
  type: string;
  kommentar: string;
  tid: string;
  latitude: number | null;
  longitude: number | null;
  geohash: string;
  retning?: number | null; // kompassretning i grader 0–360 (0=N, 90=Ø, 180=S, 270=V)
  createdAt?: any;
};
