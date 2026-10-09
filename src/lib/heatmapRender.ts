// ViltIQ — heatmap render-normalisering (V1.2.1 §10-11 i spatial validity-
// oppdraget). BEVISST en presentasjons-fil i src/lib, ikke src/engine: den
// endrer ALDRI motorens faktiske score (HeatmapPoint.weight er og forblir
// `saturateScore(cell.score, saturation) / 100` — et absolutt, meningsfullt
// 0–1-tall, se engine.ts). Dette laget bygger bare et SEPARAT, rent visuelt
// `renderWeight` for kartlaget.
//
// Rotårsak til at heatmapet tidligere så nesten usynlig ut: realistiske
// score-fordelinger (både cold-start og enkeltobservasjoner) samler seg i et
// smalt, lavt bånd — typisk 0.05–0.5, sjelden i nærheten av 1.0 (som
// gradientens varmeste farge og Leaflet.heat sin implisitte `max`-antakelse
// er kalibrert mot). Løsningen er en fast GAMMA-kurve (potensfunksjon med
// eksponent < 1): monotont voksende (bevarer rekkefølge OG at 0→0, 1→1),
// løfter svake-men-ikke-null vekter synlig opp uten å komprimere hele
// skalaen til ett nesten identisk nivå. Ren funksjon av den ABSOLUTTE
// motor-vekten — IKKE en lokal min-maks-strekking av denne ene kartrutens
// datasett, som ville fått et svakt cold-start-område til å se like "hett"
// ut som et område med ferske observasjoner (§11: bevar absolutte forskjeller).
export const HEATMAP_RENDER_GAMMA = 0.55;

/** `renderWeight = clamp(weight,0,1) ** GAMMA` — se filkommentaren for begrunnelse. */
export function toRenderWeight(weight: number): number {
  const clamped = Math.max(0, Math.min(1, weight));
  return Math.pow(clamped, HEATMAP_RENDER_GAMMA);
}

/** Anvender toRenderWeight() på et sett HeatmapPoint uten å røre latitude/longitude. */
export function applyHeatmapRenderWeight<T extends { weight: number }>(points: readonly T[]): T[] {
  return points.map((p) => ({ ...p, weight: toRenderWeight(p.weight) }));
}
