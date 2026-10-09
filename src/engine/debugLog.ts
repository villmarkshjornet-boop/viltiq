// V1.2 §39: utvikler-diagnostikk for Intelligence Map — IKKE brukerrettet.
// Ren, testbar rapport-bygging (buildIntelligenceDebugReport) adskilt fra
// selve konsoll-loggingen (logIntelligenceDebug), slik at innholdet kan
// asserte på i tester uten å fange console.log-output. Leser KUN allerede
// beregnede felt fra EngineResult — regner aldri ut noe selv (samme regel
// som resten av UI-laget: motoren er sannhetskilden).

import type { EngineResult } from "./types";

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/** Bygger en flerlinjers diagnostikkrapport for én motorkjøring. Krever `debug: true` i RunEngineOptions for grid-/sample-statistikk (§39). */
export function buildIntelligenceDebugReport(result: EngineResult): string {
  const lines: string[] = [];
  lines.push(`=== Intelligence Map debug — ${result.species} @ ${new Date(result.generatedAt).toISOString()} ===`);
  lines.push(`engine=${result.engineVersion} config=${result.configVersion} observationsConsidered=${result.observationsConsidered}`);

  if (result.debug) {
    const d = result.debug;
    lines.push(
      `grid: cellCount=${d.gridCellCount} cellSizeMeters=${d.cellSizeMeters} obsInput=${d.totalObservationsInput} obsAfterNormalize=${d.totalObservationsAfterNormalize}`
    );
    // V1.2.1 §21 (spatial validity-instrumentering): valid_land/water/unknown
    // per gridcelle — "water" inkluderer også det (i dag ubrukte) "invalid",
    // se grid.ts/EngineDebugInfo. Kun til debug — aldri vist til brukeren.
    lines.push(`validity: validLand=${d.validLandCells} water=${d.waterCells} unknown=${d.unknownValidityCells}`);
    if (d.scoreStats) {
      const s = d.scoreStats;
      lines.push(
        `score: min=${s.min.toFixed(2)} p25=${s.p25.toFixed(2)} median=${s.median.toFixed(2)} p75=${s.p75.toFixed(2)} p90=${s.p90.toFixed(2)} max=${s.max.toFixed(2)}`
      );
    }
    if (d.topCells.length > 0) {
      const scores = d.topCells.map((c) => c.score).slice().sort((a, b) => a - b);
      lines.push(
        `topCells(${d.topCells.length}): min=${scores[0].toFixed(2)} p50=${percentile(scores, 50).toFixed(2)} p90=${percentile(scores, 90).toFixed(2)} max=${scores[scores.length - 1].toFixed(2)}`
      );
      lines.push(`  best cell: score=${d.topCells[0].score.toFixed(2)} validity=${d.topCells[0].validity}`);
    }
    lines.push(`corridors: ${d.corridors.length}`);
    for (const c of d.corridors) {
      lines.push(`  bearing=${c.bearingDeg.toFixed(0)}° strength=${c.strength.toFixed(2)} contributors=${c.contributingIds.length}`);
    }
  } else {
    lines.push("grid: (ingen debug-info — kjør med { debug: true } for sample-/grid-/vann-statistikk)");
  }

  // V1.3 (§Q): datakvalitet per ekstern miljøkilde — undefined for ren
  // runEngine (ingen resolver i det hele tatt, se EngineResult sin doc-
  // kommentar), IKKE utelatt/tomt av andre grunner. Trykkes kun når til
  // stede, samme "ingen debug-info"-mønster som result.debug over.
  if (result.dataQuality) {
    const q = result.dataQuality;
    lines.push(
      `dataQuality: elevation=${q.elevation} habitat=${q.habitat} roads=${q.roads} water=${q.water} weather=${q.weather}`
    );
  } else {
    lines.push("dataQuality: (ingen — kjørt uten miljøresolver, se runEngine/runEcologicalEngine)");
  }

  const weights = result.heatmapPoints.map((p) => p.weight).slice().sort((a, b) => a - b);
  if (weights.length > 0) {
    lines.push(
      `heatmap: points=${weights.length} min=${weights[0].toFixed(2)} p50=${percentile(weights, 50).toFixed(2)} max=${weights[weights.length - 1].toFixed(2)}`
    );
    // V1.3 (geografisk pan/zoom-stabilitetsbevis): posisjonen til det
    // TYNGSTE heatmap-punktet — den geografiske sannhetskilden testscript i
    // .e2e-scratch/ sammenligner før/etter kartnavigasjon, IKKE noe UI regner
    // ut selv. Kun det EKTE, allerede beregnede punktet — ingen ny utregning.
    let top = result.heatmapPoints[0];
    for (const p of result.heatmapPoints) {
      if (p.weight > top.weight) top = p;
    }
    lines.push(`  top point: weight=${top.weight.toFixed(2)} at ${top.latitude.toFixed(5)},${top.longitude.toFixed(5)}`);
  } else {
    lines.push("heatmap: 0 punkter");
  }

  lines.push(`zones (${result.zones.length}):`);
  for (const z of result.zones) {
    lines.push(
      `  ${z.id} score=${z.score.toFixed(1)} level=${z.level} confidence=${z.confidence.toFixed(2)}/${z.confidenceLevel} ` +
        `mode=${z.predictionMode} obs=${z.observationCount} distinctCam=${z.distinctCameraCount} radius=${z.radiusMeters.toFixed(0)}m ` +
        `center=${z.center.latitude.toFixed(5)},${z.center.longitude.toFixed(5)}`
    );
    // V1.3 (geografisk pan/zoom-stabilitetsbevis): sonens fulle, allerede
    // beregnede konvekse skrog (footprint.hull, se ZoneFootprint i types.ts)
    // — samme punkter kartet tegner (app/kart.tsx), kun serialisert til
    // debug-loggen slik pan/zoom-stabilitetstester kan sammenligne hele
    // polygonet, ikke bare senteret.
    if (z.footprint && z.footprint.hull.length > 0) {
      const hull = z.footprint.hull.map((pt) => `${pt.latitude.toFixed(5)},${pt.longitude.toFixed(5)}`).join(";");
      lines.push(`    hull(${z.footprint.hull.length}): ${hull}`);
    }
  }

  return lines.join("\n");
}

/** Skriver rapporten til console.log — kun ment kalt fra dev-only kode (f.eks. bak `__DEV__`). */
export function logIntelligenceDebug(result: EngineResult): void {
  // eslint-disable-next-line no-console
  console.log(buildIntelligenceDebugReport(result));
}
