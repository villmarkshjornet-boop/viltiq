import { db } from "@/src/config/firebase";
import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { getAktivtJaktlagId } from "./jaktlag";

/**
 * STEG 5 §4: kvoter er ikke lenger ett tall per art — hver art kan ha egne,
 * fritt navngitte kategorier (f.eks. Hjort: Bukk/Kolle/Kalv, Elg: Okse/Ku/
 * Kalv), hver med sitt eget maks-antall. Datamodellen sier ingenting om
 * HVILKE kategorier en art skal ha — det er opp til brukeren, se
 * leggTilKategori/fjernKategori under. "Antall felt" for en kategori
 * beregnes ALDRI her — det gjøres alltid live i app/jakt.tsx ut fra
 * fellings-listen (samme prinsipp som det flate systemet hadde), slik at
 * sletting/redigering av en felling automatisk korrigerer kvotestatus uten
 * noen egen synk-logikk.
 */
export type KvoteKategori = {
  id: string;
  navn: string;
  maks: number;
};

export type ArtKvoter = {
  kategorier: KvoteKategori[];
};

export type Kvoter = Record<string, ArtKvoter>;

/** Gammelt format (før STEG 5): { [art]: number }. Beholdt kun for migrering. */
type LegacyKvoter = Record<string, number>;

function nyKategoriId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Konverterer lagret data til gjeldende format. Gammel, flat lagring
 * ({ Hjort: 5 }) blir til ÉN kategori kalt "Alle" med maks = det gamle
 * tallet, slik at et jaktlag som satte kvoter før STEG 5 ikke mister dem —
 * de dukker opp som én kategori brukeren kan dele opp videre selv om de vil.
 * Data som allerede er i det nye formatet ({ Hjort: { kategorier: [...] } })
 * går gjennom uendret.
 */
export function migrerKvoter(raw: unknown): Kvoter {
  if (!raw || typeof raw !== "object") return {};
  const inn = raw as Record<string, unknown>;
  const ut: Kvoter = {};
  for (const [dyr, verdi] of Object.entries(inn)) {
    if (typeof verdi === "number") {
      ut[dyr] = { kategorier: [{ id: "alle", navn: "Alle", maks: Math.max(0, verdi) }] };
    } else if (verdi && typeof verdi === "object" && Array.isArray((verdi as ArtKvoter).kategorier)) {
      ut[dyr] = {
        kategorier: (verdi as ArtKvoter).kategorier.map((k) => ({
          id: k.id, navn: k.navn, maks: Math.max(0, k.maks),
        })),
      };
    }
  }
  return ut;
}

function kvoteRef(jaktlagId: string) {
  return doc(db, "jaktlag", jaktlagId, "kvoter", "gjeldende");
}

export async function getKvoter(): Promise<Kvoter> {
  const id = await getAktivtJaktlagId();
  if (!id) return {};
  try {
    const snap = await getDoc(kvoteRef(id));
    if (!snap.exists()) return {};
    return migrerKvoter(snap.data() as LegacyKvoter | Kvoter);
  } catch {
    return {};
  }
}

/**
 * Skriver HELE kvote-tilstanden (ikke en delvis oppdatering) — alle
 * mutator-funksjonene under henter alltid gjeldende tilstand med getKvoter()
 * først, så et fullstendig overskriv her er korrekt og unngår at Firestores
 * merge-semantikk for nøstede kategori-lister gir overraskelser.
 */
export async function saveKvoter(kvoter: Kvoter): Promise<void> {
  const id = await getAktivtJaktlagId();
  if (!id) return;
  await setDoc(kvoteRef(id), kvoter);
}

export function subscribeKvoter(
  jaktlagId: string,
  onData: (k: Kvoter) => void
): () => void {
  return onSnapshot(kvoteRef(jaktlagId), (snap) => {
    onData(snap.exists() ? migrerKvoter(snap.data() as LegacyKvoter | Kvoter) : {});
  });
}

/** Legger til en ny, tom kategori for arten og returnerer dens id. */
export async function leggTilKategori(dyr: string, navn: string, maks: number): Promise<string> {
  const gjeldende = await getKvoter();
  const art = gjeldende[dyr] ?? { kategorier: [] };
  const id = nyKategoriId();
  gjeldende[dyr] = { kategorier: [...art.kategorier, { id, navn: navn.trim() || "Uten navn", maks: Math.max(0, maks) }] };
  await saveKvoter(gjeldende);
  return id;
}

/** Oppdaterer navn og/eller maks for én eksisterende kategori. */
export async function oppdaterKategori(
  dyr: string,
  kategoriId: string,
  patch: { navn?: string; maks?: number }
): Promise<void> {
  const gjeldende = await getKvoter();
  const art = gjeldende[dyr];
  if (!art) return;
  gjeldende[dyr] = {
    kategorier: art.kategorier.map((k) =>
      k.id === kategoriId
        ? { ...k, navn: patch.navn?.trim() || k.navn, maks: patch.maks != null ? Math.max(0, patch.maks) : k.maks }
        : k
    ),
  };
  await saveKvoter(gjeldende);
}

/** Fjerner en kategori. Fellinger som pekte på den mister IKKE dataen sin (kategoriId blir "foreldreløs" — se app/jakt.tsx sin visning av fellinger uten gyldig kategori), kun selve kvote-rammen forsvinner. */
export async function fjernKategori(dyr: string, kategoriId: string): Promise<void> {
  const gjeldende = await getKvoter();
  const art = gjeldende[dyr];
  if (!art) return;
  gjeldende[dyr] = { kategorier: art.kategorier.filter((k) => k.id !== kategoriId) };
  await saveKvoter(gjeldende);
}
