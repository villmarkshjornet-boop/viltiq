import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { toRenderWeight, applyHeatmapRenderWeight, HEATMAP_RENDER_GAMMA } = await import("./heatmapRender");
const { HEATMAP_GRADIENT } = await import("@/components/MapView.types");

// V1.2.1 §10-11 kritisk korrigering: realistiske score-fordelinger klumper
// seg lavt (0.05-0.5), som gjorde heatmapet nesten usynlig mot en gradient
// kalibrert for vekter nær 1.0. toRenderWeight() er en REN, monoton
// gamma-kurve — testene her beviser den løser synlighetsproblemet UTEN å
// ødelegge rekkefølge eller absolutte forskjeller mellom scener.

test("toRenderWeight: 0 og 1 er faste punkter (0→0, 1→1)", () => {
  assert.equal(toRenderWeight(0), 0);
  assert.equal(toRenderWeight(1), 1);
});

test("toRenderWeight: løfter svake-men-ikke-null vekter synlig opp (ikke nesten usynlig lenger)", () => {
  // Brukerens eget eksempel: rå vekter 0.08–0.48 fra en realistisk cold-start-scene.
  const svak = toRenderWeight(0.08);
  const median = toRenderWeight(0.27);
  const sterkest = toRenderWeight(0.48);
  assert.ok(svak > 0.2, `forventet at selv den svakeste vekten (0.08) løftes til synlig nivå, fikk ${svak}`);
  assert.ok(median > 0.4 && median < 0.7, `forventet median (0.27) midt i det synlige båndet, fikk ${median}`);
  assert.ok(sterkest < 1, "forventet at selv den sterkeste vekten i en svak scene ikke når helt til 1.0");
});

test("toRenderWeight: er strengt monoton (bevarer motorens rangering av celler)", () => {
  const weights = [0, 0.03, 0.1, 0.27, 0.48, 0.7, 0.9, 1];
  const rendered = weights.map(toRenderWeight);
  for (let i = 1; i < rendered.length; i++) {
    assert.ok(rendered[i] > rendered[i - 1], `forventet strengt økende renderWeight, ${rendered[i - 1]} -> ${rendered[i]}`);
  }
});

test("toRenderWeight: bevarer ABSOLUTTE forskjeller mellom scener — en svak cold-start-scene skal IKKE se like «het» ut som en scene med ferske observasjoner (§11)", () => {
  const coldStartMax = toRenderWeight(0.24); // "cold-start max = 24" i brukerens eksempel, skalert til 0-1
  const ferskObsMax = toRenderWeight(0.78); // "ferske observasjoner max = 78"
  assert.ok(ferskObsMax > coldStartMax, "forventet at den sterkere scenen fortsatt renderer tydelig hetere");
  assert.ok(ferskObsMax - coldStartMax > 0.15, `forventet en tydelig visuell forskjell, fikk ${(ferskObsMax - coldStartMax).toFixed(3)}`);
});

test("toRenderWeight: clamper input utenfor [0,1] i stedet for å krasje eller returnere NaN", () => {
  assert.equal(toRenderWeight(-0.5), 0);
  assert.equal(toRenderWeight(1.5), 1);
});

test("applyHeatmapRenderWeight: endrer KUN weight, ikke koordinater, og muterer ikke input-arrayet", () => {
  const points = [
    { latitude: 60.1, longitude: 10.1, weight: 0.2 },
    { latitude: 60.2, longitude: 10.2, weight: 0.6 },
  ];
  const rendered = applyHeatmapRenderWeight(points);
  assert.equal(rendered.length, 2);
  assert.equal(rendered[0].latitude, 60.1);
  assert.equal(rendered[0].longitude, 10.1);
  assert.equal(rendered[0].weight, toRenderWeight(0.2));
  assert.equal(points[0].weight, 0.2, "input-punktene skal IKKE muteres — motorens egen weight er sannhetskilden");
});

test("HEATMAP_RENDER_GAMMA er en dokumentert konstant under 1 (løftende kurve, ikke identitet eller komprimerende)", () => {
  assert.ok(HEATMAP_RENDER_GAMMA > 0 && HEATMAP_RENDER_GAMMA < 1);
});

// ---------------------------------------------------------------------------
// HEATMAP_GRADIENT — V1.3 (§K/§L): startPoints ble flyttet tidligere/tettere
// ([0, 0.15, 0.4, 0.6, 0.8, 1] → [0, 0.10, 0.32, 0.55, 0.78, 1]) for at
// heatmapet skal lese som en sammenhengende varm SONE fremfor spredte
// prikker. Testene her låser fast at denne justeringen IKKE brøt de to
// hardt-invariante egenskapene fra Redesign-/V1.2.1-oppdraget: (1) den
// laveste enden forblir fullstendig usynlig (§7 — ikke mal hele kartet), og
// (2) skalaen forblir monotont VARM (gul→oransje→rød), aldri grønn.
// ---------------------------------------------------------------------------

function hexAlpha(color: string): number {
  // 9-tegns hex #RRGGBBAA — de to siste tegnene er alpha-kanalen (0-255).
  return parseInt(color.slice(7, 9), 16);
}

function hexRgb(color: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(color.slice(1, 3), 16),
    g: parseInt(color.slice(3, 5), 16),
    b: parseInt(color.slice(5, 7), 16),
  };
}

test("HEATMAP_GRADIENT: startPoints og colors har samme lengde (ett fargestopp per posisjon)", () => {
  assert.equal(HEATMAP_GRADIENT.startPoints.length, HEATMAP_GRADIENT.colors.length);
});

test("HEATMAP_GRADIENT: startPoints er strengt økende, starter på 0.0 og slutter på 1.0", () => {
  const pts = HEATMAP_GRADIENT.startPoints;
  assert.equal(pts[0], 0.0);
  assert.equal(pts[pts.length - 1], 1.0);
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i] > pts[i - 1], `forventet strengt økende startPoints, ${pts[i - 1]} -> ${pts[i]}`);
  }
});

test("HEATMAP_GRADIENT: 0.0-stoppet er helt gjennomsiktig (§7 — lav/neglisjerbar score skal IKKE males)", () => {
  assert.equal(hexAlpha(HEATMAP_GRADIENT.colors[0]), 0, "forventet alpha=0 (00) på det aller laveste stoppet");
});

test("HEATMAP_GRADIENT: alpha er monotont ikke-avtagende langs skalaen (sterkere vekt skal aldri se svakere ut enn en lavere)", () => {
  const alphas = HEATMAP_GRADIENT.colors.map(hexAlpha);
  for (let i = 1; i < alphas.length; i++) {
    assert.ok(alphas[i] >= alphas[i - 1], `forventet ikke-avtagende alpha, ${alphas[i - 1]} -> ${alphas[i]} ved stopp ${i}`);
  }
});

test("HEATMAP_GRADIENT: skalaen er monotont VARM (rød-kanal >= grønn-kanal i hvert stopp) — grønn skal ALDRI bety høy sannsynlighet (§5/§6)", () => {
  for (const c of HEATMAP_GRADIENT.colors) {
    const { r, g } = hexRgb(c);
    assert.ok(r >= g, `forventet rød-kanal >= grønn-kanal i ${c} (fargen skal aldri lese som "grønn")`);
  }
});

test("HEATMAP_GRADIENT: siste stopp er en mettet, nesten helt opak rød (den varmeste enden av skalaen)", () => {
  const last = HEATMAP_GRADIENT.colors[HEATMAP_GRADIENT.colors.length - 1];
  const { r, g, b } = hexRgb(last);
  assert.ok(r > 150 && r > g && r > b, `forventet en dominerende rød siste farge, fikk ${last}`);
  assert.ok(hexAlpha(last) >= 200, `forventet nesten helt opak siste farge, fikk alpha ${hexAlpha(last)} i ${last}`);
});
