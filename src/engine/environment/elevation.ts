// ViltIQ Engine — høydedata via Geonorge (Kartverkets punkt-høyde-API).
// Verifisert manuelt (2026-08-11): GET mot ws.geonorge.no/hoydedata/v1/punkt
// med ost/nord (lon/lat, WGS84) returnerer { punkter: [{ z: <høyde i meter> }] },
// ingen API-nøkkel kreves.

import type { LatLng } from "../types";

const GEONORGE_HEIGHT_URL = "https://ws.geonorge.no/hoydedata/v1/punkt";

/** Henter høyde over havet (m) for ett punkt. Returnerer null ved feil — kaller ALDRI kaster. */
export async function fetchElevationMeters(point: LatLng): Promise<number | null> {
  try {
    const url = `${GEONORGE_HEIGHT_URL}?ost=${point.longitude}&nord=${point.latitude}&koordsys=4326&geojson=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const z = data?.punkter?.[0]?.z;
    return typeof z === "number" && Number.isFinite(z) ? z : null;
  } catch {
    return null;
  }
}
