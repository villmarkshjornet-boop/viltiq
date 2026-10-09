import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { buildIntelligenceDebugReport } = await import("./debugLog");
const { runEngine } = await import("./engine");

const NOW = new Date("2026-08-10T21:31:00.000Z").getTime();

let idCounter = 0;
function obs(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `obs-${idCounter}`,
    userId: "u1",
    jaktlagId: "",
    dyr: "Hjort",
    type: "Sett",
    kommentar: "",
    tid: new Date(NOW).toISOString(),
    latitude: 60.0,
    longitude: 10.0,
    geohash: "u4",
    retning: null,
    antall: 1,
    observationSource: "camera",
    cameraId: "camA",
    cameraDirectionDegrees: 90,
    sporType: null,
    kjonn: null,
    alder: null,
    ...overrides,
  };
}

// V1.2 §39: kritisk korrigering — dette er ren utvikler-diagnostikk (aldri
// vist til brukeren), men rapport-BYGGINGEN skal likevel være testet som
// vanlig kode, adskilt fra selve console.log-kallet (se debugLog.ts).

test("buildIntelligenceDebugReport: inneholder art, grid-/heatmap-statistikk og sonedetaljer uten debug:true", () => {
  const result = runEngine([obs()] as never, "hjort", { now: NOW });
  const rapport = buildIntelligenceDebugReport(result);
  assert.match(rapport, /hjort/);
  assert.match(rapport, /heatmap: points=\d+/);
  assert.match(rapport, /zones \(\d+\):/);
  assert.match(rapport, /ingen debug-info/, "uten { debug: true } skal grid-seksjonen forklare hvorfor den mangler");
});

test("buildIntelligenceDebugReport: eksponerer grid-/topCells-persentiler og korridorer når debug:true", () => {
  const result = runEngine([obs(), obs({ tid: new Date(NOW - 30 * 60000).toISOString() })] as never, "hjort", {
    now: NOW,
    debug: true,
  });
  const rapport = buildIntelligenceDebugReport(result);
  assert.match(rapport, /grid: cellCount=\d+ cellSizeMeters=\d+/);
  assert.match(rapport, /topCells\(\d+\): min=.+ p50=.+ p90=.+ max=/);
  assert.match(rapport, /corridors: \d+/);
});

// V1.2.1 §21: spatial validity-instrumentering — validLand/water/unknown-
// tellere og score-persentiler skal være synlige i debug-rapporten når
// debug:true, selv uten miljødata (runEngine gir "unknown" for alle celler,
// aldri "water" — se grid.ts sin default).

test("buildIntelligenceDebugReport: viser validity-tellere (valid_land/water/unknown) og score-persentiler når debug:true", () => {
  const result = runEngine([obs()] as never, "hjort", { now: NOW, debug: true });
  const rapport = buildIntelligenceDebugReport(result);
  assert.match(rapport, /validity: validLand=\d+ water=\d+ unknown=\d+/);
  assert.match(rapport, /score: min=.+ p25=.+ median=.+ p75=.+ p90=.+ max=/);
  // Ren runEngine (ingen miljøresolver) skal aldri klassifisere noe som vann.
  const validityLine = rapport.split("\n").find((l) => l.startsWith("validity:"));
  assert.match(validityLine ?? "", /water=0/);
});

test("buildIntelligenceDebugReport: håndterer null soner og tomt heatmap uten å krasje", () => {
  const result = runEngine([], "hjort", { now: NOW });
  const rapport = buildIntelligenceDebugReport(result);
  assert.match(rapport, /zones \(0\):/);
  assert.match(rapport, /heatmap: 0 punkter/);
});
