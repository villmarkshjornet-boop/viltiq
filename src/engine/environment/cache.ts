// ViltIQ Engine — enkel TTL-cache for miljødata (§R i motor-oppdraget:
// statiske trekk skal ikke hentes på nytt for hver motorberegning).

import type { LatLng } from "../types";

type CacheEntry<T> = { value: T; expiresAt: number };

export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

/** Avrundet koordinat som cache-nøkkel — ~111 m presisjon ved 3 desimaler, fint nok for grove miljøprøvepunkter. */
export function roundedCoordKey(point: LatLng, decimals = 3): string {
  return `${point.latitude.toFixed(decimals)},${point.longitude.toFixed(decimals)}`;
}

const DAY_MS = 24 * 3600000;

/** Statiske trekk (høyde, habitat, vei) endrer seg praktisk talt aldri — lang levetid. */
export const staticElevationCache = new TtlCache<number | null>(7 * DAY_MS);
export const staticHabitatCache = new TtlCache<string>(7 * DAY_MS);

/** Dynamiske trekk (vær/snø) endrer seg time for time — kort levetid. */
export const dynamicWeatherCache = new TtlCache<unknown>(30 * 60000);
