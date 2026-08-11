// ViltIQ Engine v1 — normalisering.
//
// Eneste sted som vet noe om ViltIQs faktiske lagringsformat (Observasjon fra
// src/types/observation.ts). Resten av motoren jobber utelukkende mot
// EngineObservation (types.ts) og trenger aldri å tolke norske tekstverdier,
// Firestore-tidsstempler eller rå gradverdier selv.

import type { Observasjon } from "@/src/types/observation";
import type { EngineObservation, EngineSource, Species } from "./types";

/**
 * Norske artstekster i dagens data → motorens interne artstype. Gjøres ETT
 * sted slik at "Hjort", "hjort", " Hjort " osv. aldri kan sprike inne i
 * motoren. Ukjente/uprioriterte arter (f.eks. "Rev") blir "annet" — de
 * påvirker aldri en prioritert arts score (se engine.ts sin artsisolasjon).
 */
export function normalizeSpecies(dyr: string): Species {
  const s = dyr.trim().toLowerCase();
  if (s === "hjort") return "hjort";
  if (s === "rådyr" || s === "radyr") return "radyr";
  if (s === "elg") return "elg";
  return "annet";
}

/**
 * Normaliser en vilkårlig gradverdi til [0, 360). Egen, liten kopi av
 * cameras.ts sin normaliserGrader — bevisst IKKE importert derfra, siden den
 * filen drar med seg Firebase-konfigurasjon og ville gjort motoren
 * avhengig av Firebase for noe som er ren matematikk.
 */
export function normalizeDegrees(grader: number): number {
  if (!Number.isFinite(grader)) return 0;
  const g = grader % 360;
  return g < 0 ? g + 360 : g;
}

function normalizeSource(kilde: string | null | undefined): EngineSource {
  if (kilde === "camera" || kilde === "track") return kilde;
  return "manual";
}

/** ISO-streng/annet → epoketid i ms, eller null hvis ugyldig/tomt. */
function normalizeTimestamp(tid: string): number | null {
  const ms = new Date(tid).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function normalizeCount(antall: number | undefined): number {
  return typeof antall === "number" && antall > 0 ? antall : 1;
}

function normalizeDirectionField(retning: number | null | undefined): number | null {
  return typeof retning === "number" && Number.isFinite(retning)
    ? normalizeDegrees(retning)
    : null;
}

/**
 * Grov 0–1 fullstendighetsheuristikk — brukes som et svakt signal
 * (datakvalitet), ALDRI som en påstand om at observasjonen er korrekt.
 */
function estimateDataQuality(o: {
  species: Species;
  movementDirectionDeg: number | null;
  cameraDirectionDeg: number | null;
  count: number;
}): number {
  let q = 0.4; // grunnlinje: har posisjon, tidspunkt og art i det hele tatt (garantert her)
  if (o.species !== "annet") q += 0.2;
  if (o.movementDirectionDeg != null || o.cameraDirectionDeg != null) q += 0.2;
  if (o.count >= 1 && o.count <= 20) q += 0.2;
  return Math.min(1, q);
}

/**
 * Normaliser rå ViltIQ-observasjoner til motorens interne format. Filtrerer
 * BEVISST bort observasjoner motoren ikke kan bruke trygt — den later ikke
 * som en observasjon uten posisjon eller gyldig tidspunkt finnes:
 *  - mangler latitude/longitude (en del observasjoner registreres uten GPS)
 *  - tid er tom/ugyldig og kan ikke tolkes som en dato
 * Dupliserte id-er (samme observasjon i input to ganger) dedupliseres.
 */
export function normalizeObservations(input: readonly Observasjon[]): EngineObservation[] {
  const byId = new Map<string, EngineObservation>();

  for (const o of input) {
    if (typeof o.latitude !== "number" || typeof o.longitude !== "number") continue;
    if (!Number.isFinite(o.latitude) || !Number.isFinite(o.longitude)) continue;

    const timestamp = normalizeTimestamp(o.tid);
    if (timestamp == null) continue;

    const species = normalizeSpecies(o.dyr);
    const movementDirectionDeg = normalizeDirectionField(o.retning);
    const cameraDirectionDeg = normalizeDirectionField(o.cameraDirectionDegrees);
    const count = normalizeCount(o.antall);

    byId.set(o.id, {
      id: o.id,
      species,
      timestamp,
      position: { latitude: o.latitude, longitude: o.longitude },
      source: normalizeSource(o.observationSource),
      movementDirectionDeg,
      cameraDirectionDeg,
      count,
      sex: o.kjonn ?? null,
      age: o.alder ?? null,
      trackType: o.sporType ?? null,
      cameraId: o.cameraId ?? null,
      jaktlagId: o.jaktlagId ?? "",
      dataQuality: estimateDataQuality({ species, movementDirectionDeg, cameraDirectionDeg, count }),
    });
  }

  return Array.from(byId.values());
}
