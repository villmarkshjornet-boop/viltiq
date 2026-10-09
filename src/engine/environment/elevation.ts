// ViltIQ Engine — høydedata via Geonorge (Kartverkets punkt-høyde-API).
// Verifisert manuelt (2026-08-11): GET mot ws.geonorge.no/hoydedata/v1/punkt
// med ost/nord (lon/lat, WGS84) returnerer { punkter: [{ z: <høyde i meter> }] },
// ingen API-nøkkel kreves.

import type { LatLng } from "../types";

const GEONORGE_HEIGHT_URL = "https://ws.geonorge.no/hoydedata/v1/punkt";

/**
 * V1.3 (§Q): utfallet av ETT nettverksFORSØK — bevisst adskilt fra selve
 * verdien, som kan være null både ved feil OG ved et gyldig "Geonorge har
 * ingen høydepunkt akkurat her"-svar. Se resolve.ts for hvordan dette
 * aggregeres til én kildestatus for hele motorkjøringen.
 */
export type FetchAttemptStatus = "available" | "unavailable";

/** Henter høyde over havet (m) for ett punkt. Returnerer null ved feil — kaller ALDRI kaster. */
export async function fetchElevationMeters(point: LatLng): Promise<number | null> {
  return (await fetchElevationMetersWithStatus(point)).value;
}

/**
 * V1.3 (§Q): som fetchElevationMeters over, men eksponerer i tillegg om selve
 * nettverksforsøket lyktes eller ikke (roads.ts sin filkommentar dokumenterer
 * V1.2.2-funnet som gjorde dette nødvendig: et stille feilende kall er
 * umulig å skille fra "ingen data" uten akkurat dette signalet). Bevisst en
 * EGEN, tilleggs-eksportert funksjon fremfor å endre fetchElevationMeters sin
 * signatur — ingen eksisterende kallere (kun resolve.ts bruker denne filen
 * direkte i dag) trenger å endres eller vite om denne.
 */
export async function fetchElevationMetersWithStatus(
  point: LatLng
): Promise<{ value: number | null; status: FetchAttemptStatus }> {
  try {
    const url = `${GEONORGE_HEIGHT_URL}?ost=${point.longitude}&nord=${point.latitude}&koordsys=4326&geojson=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { value: null, status: "unavailable" };
    const data = await res.json();
    const z = data?.punkter?.[0]?.z;
    const value = typeof z === "number" && Number.isFinite(z) ? z : null;
    return { value, status: "available" };
  } catch {
    return { value: null, status: "unavailable" };
  }
}
