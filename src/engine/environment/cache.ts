// ViltIQ Engine — enkel TTL-cache for miljødata (§R i motor-oppdraget:
// statiske trekk skal ikke hentes på nytt for hver motorberegning).

import type { LatLng } from "../types";

type CacheEntry<T> = { value: T; expiresAt: number };

export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, nowMs: number = Date.now()): void {
    this.store.set(key, { value, expiresAt: nowMs + this.ttlMs });
  }

  /**
   * V1.3 (§Q/§R): som get(), men eksponerer i tillegg HVOR LENGE SIDEN
   * verdien ble satt — kun vær-kilden (dynamicWeatherCache) trenger dette i
   * dag, for å skille "fersk fra cache" fra "cache nær sitt naturlige
   * oppfriskningsvindu" (se resolve.ts sin WEATHER_STALE_AFTER_MS). De
   * statiske kildene (høyde/habitat/vei/vann) har INGEN meningsfull "stale"
   * — en gyldig, ikke-utløpt 7-dagers-cache er like god som et ferskt kall
   * for terrengdata som praktisk talt aldri endrer seg, se filkommentaren
   * øverst. `nowMs` er valgfri (default Date.now()) kun slik at tester kan
   * simulere en nær-utløpt cache uten en faktisk 20+ minutters ventetid.
   */
  getWithAge(key: string, nowMs: number = Date.now()): { value: T; ageMs: number } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (nowMs > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return { value: entry.value, ageMs: this.ttlMs - (entry.expiresAt - nowMs) };
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
/**
 * V1.2: veinettet er like statisk som høyde/habitat, men ble tidligere hentet
 * på nytt for HVER resolveEnvironmentContext()-kjøring (ett Overpass-kall per
 * kall, ikke bare per prøvepunkt) — selv om brukeren bare panorerte kartet
 * marginalt og traff samme (avrundede) senterområde igjen. Nøkkel inkluderer
 * radius, siden ulike analyseradiuser rundt samme senter er reelt ulike spørringer.
 */
export const staticRoadsCache = new TtlCache<unknown>(7 * DAY_MS);
/** V1.2.2: vann-/kystlinjegeometri (water.ts) — like statisk som vei, samme cache-strategi (nøkkel inkluderer radius). */
export const staticWaterCache = new TtlCache<unknown>(7 * DAY_MS);

/**
 * Dynamiske trekk (vær/snø) endrer seg time for time — kort levetid. Definert
 * i V1.1, men aldri faktisk koblet inn før V1.2 (resolve.ts hentet vær på
 * nytt for hvert eneste kall) — se resolve.ts sin cachedDynamicEnvironment().
 */
export const dynamicWeatherCache = new TtlCache<unknown>(30 * 60000);
