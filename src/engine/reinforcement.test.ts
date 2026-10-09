import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { computeMovementCorridors, corridorBonusAt } = await import("./reinforcement");
const { getSpeciesProfile } = await import("./species/profiles");
const { DEFAULT_ENGINE_CONFIG } = await import("./config");
const { movePoint, distanceMeters } = await import("@/src/lib/geo");

// § kritisk korrigering: computeMovementCorridors/corridorBonusAt hadde INGEN
// egen testdekning i det hele tatt før denne filen (bekreftet av eget audit).
// Disse testene dokumenterer eksplisitt at korridor-mekanismen (a) ALDRI kan
// utløses av én enkelt observasjon, og (b) alltid projiserer et BEGRENSET,
// konfigurert stykke forbi siste reelle observasjon — aldri en lang,
// hastighet×tid-basert projeksjon.

const cfg = DEFAULT_ENGINE_CONFIG;
const profile = getSpeciesProfile("hjort");
const NOW = new Date("2026-08-10T12:00:00.000Z").getTime();

let idCounter = 0;
function engineObs(overrides: Record<string, unknown> = {}) {
  idCounter += 1;
  return {
    id: `eo-${idCounter}`,
    species: "hjort",
    timestamp: NOW,
    position: { latitude: 60.0, longitude: 10.0 },
    source: "camera",
    movementDirectionDeg: null,
    cameraDirectionDeg: null,
    count: 1,
    sex: null,
    age: null,
    trackType: null,
    cameraId: "camA",
    jaktlagId: "",
    dataQuality: 0.8,
    ...overrides,
  };
}

test("computeMovementCorridors: ÉN observasjon kan ALDRI danne en korridor, uansett kjent retning", () => {
  const single = [engineObs({ movementDirectionDeg: 90 })];
  assert.deepEqual(computeMovementCorridors(single as never, cfg.reinforcement), []);
});

test("computeMovementCorridors: to observasjoner med konsistent retning innenfor terskel danner nøyaktig én korridor", () => {
  const p1 = { latitude: 60.0, longitude: 10.0 };
  const p2 = movePoint(p1.latitude, p1.longitude, 90, 500); // 500 m øst
  const obs = [
    engineObs({ position: p1, timestamp: NOW - 2 * 3600000 }),
    engineObs({ position: p2, timestamp: NOW }),
  ];
  const corridors = computeMovementCorridors(obs as never, cfg.reinforcement);
  assert.equal(corridors.length, 1);
  assert.ok(Math.abs(corridors[0].bearingDeg - 90) < 1, `forventet ~90° østlig korridor, fikk ${corridors[0].bearingDeg}`);
});

test("computeMovementCorridors: korridorens projiserte punkt er ALLTID begrenset til corridorProjectionMeters forbi siste observasjon, uansett fart/avstand mellom observasjonene", () => {
  const p1 = { latitude: 60.0, longitude: 10.0 };
  const p2 = movePoint(p1.latitude, p1.longitude, 90, 2900); // nær corridorMaxLinkDistanceMeters=3000, på 1 time
  const obs = [
    engineObs({ position: p1, timestamp: NOW - 1 * 3600000 }),
    engineObs({ position: p2, timestamp: NOW }),
  ];
  const corridors = computeMovementCorridors(obs as never, cfg.reinforcement);
  assert.equal(corridors.length, 1);
  const distFraSisteObs = distanceMeters(p2, corridors[0].point);
  assert.ok(
    Math.abs(distFraSisteObs - cfg.reinforcement.corridorProjectionMeters) < 1,
    `forventet projeksjon nøyaktig ${cfg.reinforcement.corridorProjectionMeters} m forbi siste observasjon (IKKE fart×tid-skalert), fikk ${distFraSisteObs} m`
  );
});

test("computeMovementCorridors: observasjoner for langt fra hverandre i avstand kobles IKKE sammen til en korridor", () => {
  const p1 = { latitude: 60.0, longitude: 10.0 };
  const p2 = movePoint(p1.latitude, p1.longitude, 90, 5000); // over corridorMaxLinkDistanceMeters=3000
  const obs = [
    engineObs({ position: p1, timestamp: NOW - 1 * 3600000 }),
    engineObs({ position: p2, timestamp: NOW }),
  ];
  assert.deepEqual(computeMovementCorridors(obs as never, cfg.reinforcement), []);
});

test("computeMovementCorridors: observasjoner for langt fra hverandre i TID kobles IKKE sammen til en korridor", () => {
  const p1 = { latitude: 60.0, longitude: 10.0 };
  const p2 = movePoint(p1.latitude, p1.longitude, 90, 500);
  const obs = [
    engineObs({ position: p1, timestamp: NOW - (cfg.reinforcement.corridorMaxLinkHours + 1) * 3600000 }),
    engineObs({ position: p2, timestamp: NOW }),
  ];
  assert.deepEqual(computeMovementCorridors(obs as never, cfg.reinforcement), []);
});

test("corridorBonusAt: bonus avtar med avstand fra korridorpunktet, og er tak-begrenset til maxCorridorBonus", () => {
  const corridor = { point: { latitude: 60.0, longitude: 10.0 }, bearingDeg: 90, strength: 1, contributingIds: ["a", "b"] };
  const near = corridorBonusAt(corridor.point, [corridor], profile, cfg);
  const far = corridorBonusAt(movePoint(corridor.point.latitude, corridor.point.longitude, 0, 5000), [corridor], profile, cfg);
  assert.ok(near > far, `forventet avtagende bonus med avstand, fikk near=${near} far=${far}`);
  assert.ok(near <= cfg.reinforcement.maxCorridorBonus + 1e-9);
  assert.ok(far < 1e-6, `forventet neglisjerbar bonus 5 km fra korridorpunktet, fikk ${far}`);
});

test("corridorBonusAt: ingen korridorer gir null bonus", () => {
  assert.equal(corridorBonusAt({ latitude: 60, longitude: 10 }, [], profile, cfg), 0);
});
