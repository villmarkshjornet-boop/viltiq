import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Se src/lib/geo.test.ts for hvorfor denne hooken trengs (extensionless
// relative import nedenfor).
register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { smoothPolygonRing, scaleHexAlpha, zoneVisualWeight, PREDICTION_MODE_LABEL, PREDICTION_MODE_DESCRIPTION } =
  await import("./zonePresentation");

// ---------------------------------------------------------------------------
// smoothPolygonRing
// ---------------------------------------------------------------------------

const SQUARE = [
  { latitude: 0, longitude: 0 },
  { latitude: 0, longitude: 1 },
  { latitude: 1, longitude: 1 },
  { latitude: 1, longitude: 0 },
];

test("smoothPolygonRing: under 3 punkter returneres uendret", () => {
  const line = [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 }];
  assert.deepEqual(smoothPolygonRing(line), line);
});

test("smoothPolygonRing: 0 iterasjoner returnerer input uendret (formen selv, ikke bare punktantall)", () => {
  const result = smoothPolygonRing(SQUARE, 0);
  assert.deepEqual(result, SQUARE);
});

test("smoothPolygonRing: dobler punktantallet per iterasjon (Chaikin corner-cutting)", () => {
  const oneIter = smoothPolygonRing(SQUARE, 1);
  assert.equal(oneIter.length, SQUARE.length * 2);
  const twoIter = smoothPolygonRing(SQUARE, 2);
  assert.equal(twoIter.length, SQUARE.length * 4);
});

test("smoothPolygonRing: glattet omriss forblir innenfor det opprinnelige omrisset sin bounding box (flytter aldri formen utover)", () => {
  const result = smoothPolygonRing(SQUARE, 3);
  for (const p of result) {
    assert.ok(p.latitude >= 0 && p.latitude <= 1, `latitude ${p.latitude} utenfor [0,1]`);
    assert.ok(p.longitude >= 0 && p.longitude <= 1, `longitude ${p.longitude} utenfor [0,1]`);
  }
});

test("smoothPolygonRing: bevarer omtrentlig sentrum (flytter ikke hotspotet) for et symmetrisk omriss", () => {
  const centroidOf = (pts: readonly { latitude: number; longitude: number }[]) => {
    const lat = pts.reduce((s, p) => s + p.latitude, 0) / pts.length;
    const lon = pts.reduce((s, p) => s + p.longitude, 0) / pts.length;
    return { lat, lon };
  };
  const before = centroidOf(SQUARE);
  const after = centroidOf(smoothPolygonRing(SQUARE, 3));
  assert.ok(Math.abs(before.lat - after.lat) < 0.01, `centroid lat drev fra ${before.lat} til ${after.lat}`);
  assert.ok(Math.abs(before.lon - after.lon) < 0.01, `centroid lon drev fra ${before.lon} til ${after.lon}`);
});

test("smoothPolygonRing: svært mange punkter (over MAX_SMOOTH_INPUT_POINTS) begrenses til 1 iterasjon selv om flere ble bedt om", () => {
  const many = Array.from({ length: 250 }, (_, i) => ({ latitude: Math.sin(i), longitude: Math.cos(i) }));
  const result = smoothPolygonRing(many, 3);
  assert.equal(result.length, many.length * 2, "skal ha kjørt kun 1 runde (2x), ikke 3 runder (8x)");
});

// ---------------------------------------------------------------------------
// scaleHexAlpha
// ---------------------------------------------------------------------------

test("scaleHexAlpha: FF-alpha halvert blir 80 (avrundet)", () => {
  assert.equal(scaleHexAlpha("#22C55EFF", 0.5), "#22C55E80");
});

test("scaleHexAlpha: faktor 1 endrer ingenting", () => {
  assert.equal(scaleHexAlpha("#22C55E40", 1), "#22C55E40");
});

test("scaleHexAlpha: farge uten alpha-hale ('#RRGGBB') behandles som fullt opak (FF) før skalering", () => {
  assert.equal(scaleHexAlpha("#22C55E", 0.5), "#22C55E80");
});

test("scaleHexAlpha: faktor 0 gir helt gjennomsiktig (00)", () => {
  assert.equal(scaleHexAlpha("#22C55EFF", 0), "#22C55E00");
});

// ---------------------------------------------------------------------------
// zoneVisualWeight / PREDICTION_MODE_*
// ---------------------------------------------------------------------------

test("zoneVisualWeight: environment_only er dashed og svakere enn local_dominant", () => {
  const coldStart = zoneVisualWeight("environment_only");
  const localDominant = zoneVisualWeight("local_dominant");
  assert.equal(coldStart.dashed, true);
  assert.equal(localDominant.dashed, false);
  assert.ok(coldStart.fillAlphaFactor < localDominant.fillAlphaFactor);
  assert.ok(coldStart.strokeAlphaFactor < localDominant.strokeAlphaFactor);
  assert.equal(localDominant.fillAlphaFactor, 1);
  assert.equal(localDominant.strokeAlphaFactor, 1);
});

test("zoneVisualWeight: environment_plus_local ligger mellom de to andre", () => {
  const mixed = zoneVisualWeight("environment_plus_local");
  const coldStart = zoneVisualWeight("environment_only");
  const localDominant = zoneVisualWeight("local_dominant");
  assert.ok(mixed.fillAlphaFactor > coldStart.fillAlphaFactor && mixed.fillAlphaFactor < localDominant.fillAlphaFactor);
  assert.equal(mixed.dashed, false);
});

test("PREDICTION_MODE_LABEL/PREDICTION_MODE_DESCRIPTION: alle tre motor-modiene har en definert etikett og forklaring", () => {
  const modes = ["environment_only", "environment_plus_local", "local_dominant"] as const;
  for (const m of modes) {
    assert.ok(PREDICTION_MODE_LABEL[m] && PREDICTION_MODE_LABEL[m].length > 0);
    assert.ok(PREDICTION_MODE_DESCRIPTION[m] && PREDICTION_MODE_DESCRIPTION[m].length > 0);
  }
});
