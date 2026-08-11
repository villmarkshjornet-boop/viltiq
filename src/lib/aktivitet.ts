// Delt "hvor aktivt er det nå"-logikk. Tidligere fantes fire nesten like
// kopier (app/index.tsx, app/kart.tsx, app/statistikk.tsx, app/kamera/[id].tsx)
// med ulike vekter/terskler, som gjorde at samme observasjonsdata kunne vises
// som "Høy" ett sted og "Medium" et annet. Denne filen er nå eneste kilde.

export type Nivå = "Høy" | "Medium" | "Lav";

/** Timer siden et ISO-tidspunkt. Ugyldig/tomt tidspunkt regnes som uendelig gammelt. */
export function hentTimerSiden(tid: string): number {
  const ms = new Date(tid).getTime();
  if (Number.isNaN(ms)) return Number.POSITIVE_INFINITY;
  return (Date.now() - ms) / (1000 * 60 * 60);
}

/** Vekt for én observasjon basert på ferskhet — ferske observasjoner teller mest. */
export function hentTidsvekt(tid: string): number {
  const t = hentTimerSiden(tid);
  if (t <= 6) return 5;
  if (t <= 24) return 4;
  if (t <= 72) return 3;
  if (t <= 168) return 2;
  return 1;
}

/** Slå sammen en akkumulert score til et nivå — brukt konsekvent på tvers av appen. */
export function hentNivå(score: number): Nivå {
  if (score >= 14) return "Høy";
  if (score >= 6) return "Medium";
  return "Lav";
}

export function nivåFarge(nivå: string): string {
  if (nivå === "Høy") return "#F97316";
  if (nivå === "Medium") return "#EAB308";
  return "#22C55E";
}

export function dyrEmoji(dyr: string): string {
  return dyr === "Rev" ? "🦊" : "🦌";
}

/** Relativ tid på norsk, f.eks. "for 12m siden" / "for 3t siden" / "for 2d siden". */
export function hentRelativTid(tid: string): string {
  const ms = Date.now() - new Date(tid).getTime();
  const min = Math.round(ms / 60000);
  const hrs = Math.round(ms / 3600000);
  const days = Math.round(ms / 86400000);
  if (min < 60) return `for ${min}m siden`;
  if (hrs < 24) return `for ${hrs}t siden`;
  return `for ${days}d siden`;
}
