import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const {
  timeWeight,
  distanceWeight,
  effectiveRadiusMeters,
  countWeight,
  sourceWeight,
  angularDifferenceDeg,
  directionalAlignment,
  trackFreshnessAgeOffsetHours,
} = await import("./signals");

const TIME_CFG = { halfLifeHours: 5, backgroundFloor: 0.05 };
const DIST_CFG = { ageRadiusGrowthPerHour: 0.01, maxAgeRadiusMultiplier: 1.5 };

// ---------------------------------------------------------------------------
// timeWeight
// ---------------------------------------------------------------------------

test("timeWeight: alder 0 gir maks vekt 1.0", () => {
  assert.equal(timeWeight(0, TIME_CFG), 1);
});

test("timeWeight: fremtidig tidspunkt (negativ alder) klippes til maks vekt, krasjer ikke", () => {
  assert.equal(timeWeight(-100, TIME_CFG), 1);
});

test("timeWeight: er halvert ved halfLifeHours", () => {
  const w = timeWeight(TIME_CFG.halfLifeHours, TIME_CFG);
  const expected = TIME_CFG.backgroundFloor + (1 - TIME_CFG.backgroundFloor) * 0.5;
  assert.ok(Math.abs(w - expected) < 1e-9, `forventet ${expected}, fikk ${w}`);
});

test("timeWeight: avtar monotont og går aldri under backgroundFloor", () => {
  let prev = timeWeight(0, TIME_CFG);
  for (const h of [1, 5, 24, 72, 168, 24 * 365]) {
    const w = timeWeight(h, TIME_CFG);
    assert.ok(w <= prev, `vekt økte fra ${prev} til ${w} ved ${h}t`);
    assert.ok(w >= TIME_CFG.backgroundFloor - 1e-9, `vekt ${w} under backgroundFloor ved ${h}t`);
    prev = w;
  }
});

test("timeWeight: ekstremt gammel observasjon gir et endelig tall nær backgroundFloor, ikke NaN/0", () => {
  const w = timeWeight(1_000_000, TIME_CFG);
  assert.ok(Number.isFinite(w), `forventet endelig tall, fikk ${w}`);
  assert.ok(Math.abs(w - TIME_CFG.backgroundFloor) < 1e-6, `forventet nær ${TIME_CFG.backgroundFloor}, fikk ${w}`);
});

// ---------------------------------------------------------------------------
// distanceWeight / effectiveRadiusMeters
// ---------------------------------------------------------------------------

test("distanceWeight: avstand 0 gir maks vekt 1.0", () => {
  assert.equal(distanceWeight(0, 300), 1);
});

test("distanceWeight: avtar monotont med avstand", () => {
  const w0 = distanceWeight(0, 300);
  const w1 = distanceWeight(150, 300);
  const w2 = distanceWeight(300, 300);
  const w3 = distanceWeight(900, 300);
  assert.ok(w0 > w1 && w1 > w2 && w2 > w3, `forventet strengt avtagende, fikk ${w0},${w1},${w2},${w3}`);
});

test("effectiveRadiusMeters: vokser med alder, men er tak-begrenset til maxAgeRadiusMultiplier", () => {
  const base = 300;
  const r0 = effectiveRadiusMeters(base, 0, DIST_CFG);
  const rOld = effectiveRadiusMeters(base, 100000, DIST_CFG);
  assert.equal(r0, base);
  assert.ok(Math.abs(rOld - base * DIST_CFG.maxAgeRadiusMultiplier) < 1e-9);
});

// ---------------------------------------------------------------------------
// countWeight
// ---------------------------------------------------------------------------

test("countWeight: sqrt-skalert og tak-begrenset", () => {
  assert.equal(countWeight(1, 50), 1);
  assert.equal(countWeight(4, 50), 2);
  assert.equal(countWeight(500, 50), Math.sqrt(50));
});

// ---------------------------------------------------------------------------
// sourceWeight
// ---------------------------------------------------------------------------

test("sourceWeight: slår opp riktig vekt per kilde", () => {
  const weights = { camera: 1.0, manual: 0.9, track: 0.5 };
  assert.equal(sourceWeight("camera", weights), 1.0);
  assert.equal(sourceWeight("manual", weights), 0.9);
  assert.equal(sourceWeight("track", weights), 0.5);
});

// ---------------------------------------------------------------------------
// angularDifferenceDeg / directionalAlignment
// ---------------------------------------------------------------------------

test("angularDifferenceDeg: korteste vei rundt sirkelen", () => {
  assert.equal(angularDifferenceDeg(10, 350), 20);
  assert.equal(angularDifferenceDeg(0, 180), 180);
  assert.equal(angularDifferenceDeg(90, 90), 0);
});

test("directionalAlignment: maks vekt rett foran (0°), floor rett bak (180°)", () => {
  const floor = 0.35;
  assert.ok(Math.abs(directionalAlignment(0, 0, floor) - 1) < 1e-9);
  assert.ok(Math.abs(directionalAlignment(180, 0, floor) - floor) < 1e-9);
});

test("directionalAlignment: glatt og symmetrisk overgang mellom foran og bak", () => {
  const floor = 0.35;
  const at90 = directionalAlignment(90, 0, floor);
  const atMinus90 = directionalAlignment(270, 0, floor);
  assert.ok(Math.abs(at90 - atMinus90) < 1e-9, "90° til hver side skal gi samme vekt");
  assert.ok(at90 > floor && at90 < 1, `forventet verdi mellom floor og 1, fikk ${at90}`);
});

// ---------------------------------------------------------------------------
// trackFreshnessAgeOffsetHours
// ---------------------------------------------------------------------------

test("trackFreshnessAgeOffsetHours: 'fresh' gir ingen ekstra alder", () => {
  assert.equal(trackFreshnessAgeOffsetHours("fresh"), 0);
});

test("trackFreshnessAgeOffsetHours: 'days' og 'old' gir stigende, positiv ekstra alder", () => {
  const days = trackFreshnessAgeOffsetHours("days");
  const old = trackFreshnessAgeOffsetHours("old");
  assert.ok(days > 0, `forventet 'days' > 0, fikk ${days}`);
  assert.ok(old > days, `forventet 'old' (${old}) > 'days' (${days})`);
});

test("trackFreshnessAgeOffsetHours: undefined (feltet ikke satt) gir 0 — no-op for bakoverkompatibilitet", () => {
  assert.equal(trackFreshnessAgeOffsetHours(undefined), 0);
});
