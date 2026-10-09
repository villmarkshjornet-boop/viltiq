import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { isPointInPolygon, coastlineSide, determineWaterStatusFromOsm } = await import("./water");

// V1.2.2 §3: geografisk validitet er nå BEVISST frikoblet fra habitat-
// prøvegridet — denne filen tester den nye, uavhengige OSM-geometrien i
// isolasjon, med syntetisk data (ingen nettverksavhengighet).

// ===========================================================================
// isPointInPolygon — innsjøer/water-polygoner
// ===========================================================================

const squareLake = [
  { latitude: 60.0, longitude: 10.0 },
  { latitude: 60.0, longitude: 10.01 },
  { latitude: 60.01, longitude: 10.01 },
  { latitude: 60.01, longitude: 10.0 },
];

test("isPointInPolygon: punkt midt i en enkel kvadratisk innsjø er inni", () => {
  assert.equal(isPointInPolygon({ latitude: 60.005, longitude: 10.005 }, squareLake), true);
});

test("isPointInPolygon: punkt godt utenfor polygonet er utenfor", () => {
  assert.equal(isPointInPolygon({ latitude: 61.0, longitude: 11.0 }, squareLake), false);
});

test("isPointInPolygon: under 3 punkter er aldri et gyldig polygon", () => {
  assert.equal(isPointInPolygon({ latitude: 60.005, longitude: 10.005 }, [{ latitude: 60.0, longitude: 10.0 }, { latitude: 60.01, longitude: 10.01 }]), false);
});

// ===========================================================================
// coastlineSide — hav/fjord-grense
// ===========================================================================

// En rett kystlinje langs breddegrad 60.0 — OSM-konvensjon: tegnet ØSTOVER
// (økende longitude) betyr land til VENSTRE (nord, høyere breddegrad),
// vann til HØYRE (sør, lavere breddegrad).
const straightCoastline = [[
  { latitude: 60.0, longitude: 9.9 },
  { latitude: 60.0, longitude: 10.1 },
]];

test("coastlineSide: punkt nord for en østgående kystlinje er land", () => {
  const side = coastlineSide({ latitude: 60.002, longitude: 10.0 }, straightCoastline, 1000);
  assert.equal(side, "land");
});

test("coastlineSide: punkt sør for en østgående kystlinje er vann", () => {
  const side = coastlineSide({ latitude: 59.998, longitude: 10.0 }, straightCoastline, 1000);
  assert.equal(side, "water");
});

test("coastlineSide: punkt langt fra all hentet kystlinje gir null (ikke gjett)", () => {
  const side = coastlineSide({ latitude: 65.0, longitude: 20.0 }, straightCoastline, 1000);
  assert.equal(side, null);
});

test("coastlineSide: velger NÆRMESTE segment blant flere kystlinjer, ikke bare den første", () => {
  // To parallelle "kystlinjer" — én langt unna (feil side ville gitt feil svar), én nær.
  const farCoastline = [{ latitude: 55.0, longitude: 9.9 }, { latitude: 55.0, longitude: 10.1 }];
  const nearCoastline = [{ latitude: 60.0, longitude: 9.9 }, { latitude: 60.0, longitude: 10.1 }];
  const side = coastlineSide({ latitude: 60.002, longitude: 10.0 }, [farCoastline, nearCoastline], 1000);
  assert.equal(side, "land", "skal bruke DEN NÆRMESTE kystlinjen (60.0), ikke feilaktig den fjerne (55.0)");
});

// ===========================================================================
// determineWaterStatusFromOsm — den samlede avgjørelsen
// ===========================================================================

test("determineWaterStatusFromOsm: punkt inni en water-polygon er 'water', selv om det også er nær en 'land'-side kystlinje andre steder", () => {
  const water = { waterPolygons: [squareLake], coastlineSegments: straightCoastline };
  const status = determineWaterStatusFromOsm({ latitude: 60.005, longitude: 10.005 }, water, 1000);
  assert.equal(status, "water");
});

test("determineWaterStatusFromOsm: ingen polygon-treff, men kystlinje sier vann -> 'water'", () => {
  const water = { waterPolygons: [], coastlineSegments: straightCoastline };
  const status = determineWaterStatusFromOsm({ latitude: 59.998, longitude: 10.0 }, water, 1000);
  assert.equal(status, "water");
});

test("determineWaterStatusFromOsm: ingen polygon, kystlinje sier land -> 'land'", () => {
  const water = { waterPolygons: [], coastlineSegments: straightCoastline };
  const status = determineWaterStatusFromOsm({ latitude: 60.002, longitude: 10.0 }, water, 1000);
  assert.equal(status, "land");
});

test("determineWaterStatusFromOsm: ingen data i det hele tatt -> 'unknown', ALDRI 'water' by default", () => {
  const status = determineWaterStatusFromOsm({ latitude: 60.0, longitude: 10.0 }, { waterPolygons: [], coastlineSegments: [] }, 1000);
  assert.equal(status, "unknown");
});

// ===========================================================================
// §8 (regresjonsmatrise-forberedelse): smal fjord/sund — beviser at denne
// mekanismen IKKE er avhengig av et sample-grid i det hele tatt, og derfor
// kan løse et vannkanal-scenario som er SMALERE enn en typisk prøvepunkt-
// avstand (500 m-1,2 km) — akkurat V1.2.1 sin dokumenterte svakhet.
// ===========================================================================

test("§8: smalt sund (100 m bredt) mellom to øyer klassifiseres korrekt som vann midt i sundet, selv med tett landgeometri på begge sider", () => {
  // To parallelle kystlinjer 100 m fra hverandre (langt under en typisk
  // miljø-prøvepunktavstand) — sundet mellom dem.
  const metersPerDegLat = 111320;
  const offsetDeg = 50 / metersPerDegLat; // 50 m til hver side => 100 m sund
  const north = [{ latitude: 60.0 + offsetDeg, longitude: 9.9 }, { latitude: 60.0 + offsetDeg, longitude: 10.1 }]; // vann sør for denne (høyre side østover)
  const south = [{ latitude: 60.0 - offsetDeg, longitude: 10.1 }, { latitude: 60.0 - offsetDeg, longitude: 9.9 }]; // tegnet vestover -> vann nord for denne
  const water = { waterPolygons: [], coastlineSegments: [north, south] };

  const midSund = { latitude: 60.0, longitude: 10.0 };
  const status = determineWaterStatusFromOsm(midSund, water, 200);
  assert.equal(status, "water", "midt i et 100 m sund skal klassifiseres som vann");
});
