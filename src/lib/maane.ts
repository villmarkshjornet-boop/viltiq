// Månefase basert på synodisk syklus. Tidligere duplisert likt i
// app/index.tsx og app/statistikk.tsx.

export type MåneFase = { navn: string; emoji: string; belysning: number };

export function måneFase(dato: Date): MåneFase {
  const referanse = new Date(2000, 0, 6, 18, 14, 0);
  const synodisk  = 29.53058867;
  const diff      = (dato.getTime() - referanse.getTime()) / (1000 * 60 * 60 * 24);
  const fase      = ((diff % synodisk) + synodisk) % synodisk;
  const p         = fase / synodisk;
  const belysning = Math.round(50 * (1 - Math.cos(p * 2 * Math.PI)));

  if (p < 0.03 || p > 0.97) return { navn: "Nymåne",        emoji: "🌑", belysning: 0 };
  if (p < 0.22)              return { navn: "Voksende sigd", emoji: "🌒", belysning };
  if (p < 0.28)              return { navn: "Halvmåne",      emoji: "🌓", belysning: 50 };
  if (p < 0.47)              return { navn: "Voksende",      emoji: "🌔", belysning };
  if (p < 0.53)              return { navn: "Fullmåne",      emoji: "🌕", belysning: 100 };
  if (p < 0.72)              return { navn: "Minkende",      emoji: "🌖", belysning };
  if (p < 0.78)              return { navn: "Halvmåne",      emoji: "🌗", belysning: 50 };
  return                            { navn: "Minkende sigd", emoji: "🌘", belysning };
}
