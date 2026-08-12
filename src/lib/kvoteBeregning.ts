import type { Kvoter } from "@/src/services/kvoter";

/**
 * STEG 5 §4: "felt"-tallet for en kvote-kategori er ALDRI en lagret teller —
 * det regnes her, live, ut fra selve fellings-listen. Det er derfor en
 * felling som registreres/redigeres/slettes automatisk korrigerer riktig
 * kategoris status uten noen egen synk-kode: neste gang denne funksjonen
 * kjører (som skjer på hver render i app/jakt.tsx, siden fellings kommer fra
 * en live Firestore-subscription) teller den bare på nytt.
 */
export type KvoteRad = {
  dyr: string;
  kategoriId: string;
  navn: string;
  maks: number;
  felt: number;
};

type FellingLignende = { dyr: string; kategoriId: string | null };

export function beregnKvoteRader(
  kvoter: Kvoter,
  fellings: FellingLignende[],
  arter: readonly string[]
): KvoteRad[] {
  const rader: KvoteRad[] = [];
  for (const dyr of arter) {
    const kategorier = kvoter[dyr]?.kategorier ?? [];
    for (const kat of kategorier) {
      const felt = fellings.filter((f) => f.dyr === dyr && f.kategoriId === kat.id).length;
      rader.push({ dyr, kategoriId: kat.id, navn: kat.navn, maks: kat.maks, felt });
    }
  }
  return rader;
}

/**
 * Fellinger for en art vi sporer kvote for, som IKKE peker på en gyldig
 * kategori for den arten (aldri satt, eller kategorien er siden fjernet).
 * Brukt til å vise et synlig varsel i stedet for at de stille forsvinner fra
 * kvote-oversikten.
 */
export function fellingerUtenGyldigKategori(
  kvoter: Kvoter,
  fellings: FellingLignende[],
  arter: readonly string[]
): FellingLignende[] {
  return fellings.filter((f) => {
    if (!arter.includes(f.dyr)) return false;
    const kategorier = kvoter[f.dyr]?.kategorier ?? [];
    if (kategorier.length === 0) return false;
    return !f.kategoriId || !kategorier.some((k) => k.id === f.kategoriId);
  });
}
