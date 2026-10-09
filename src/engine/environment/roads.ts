// ViltIQ Engine — avstand til vei via OpenStreetMap/Overpass API.
// Verifisert manuelt (2026-08-11): Overpass returnerer highway-veier innenfor
// en gitt radius som JSON. Bevisst ÉN spørring for HELE analyseområdet per
// motorkjøring (ikke én per rutepunkt) — avstand til hvert prøvepunkt regnes
// deretter lokalt mot de returnerte veigeometriene, se resolve.ts.
//
// DOKUMENTERT BEGRENSNING (V1.1 §22): spørringen henter ALLE `highway=*`-
// veier uendret (motorvei/hovedvei/skogsbilvei/sti behandles likt) — motoren
// har i dag ÉN udifferensiert "avstand til vei"-faktor, ikke separate
// vekter per veitype. OSM sitt `highway`-tag (motorway/primary/secondary/
// track/path osv.) ville gjort en slik inndeling teknisk mulig uten en ny
// datakilde, men research-grunnlaget for HVORDAN ulike veityper faktisk bør
// vektes ulikt for hjortevilt (jf. Meisingset et al. 2013: "veistørrelse har
// liten betydning" for hjort) taler foreløpig mot å bygge en mer detaljert
// modell enn kildene støtter. Bevisst utsatt til en senere versjon.

import { distanceMeters } from "@/src/lib/geo";
import type { LatLng } from "../types";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/**
 * V1.3 (§Q): utfallet av ETT nettverksforsøk — bevisst adskilt fra selve
 * veilisten, som er en tom liste BÅDE ved feil OG ved et gyldig "ingen vei i
 * søkeradiusen"-svar. Nettopp DENNE forvekslingen (§Q: "IKKE tolk dette som
 * 'ingen vei i nærheten'") var V1.2.2-406-funnet dokumentert i filkommentaren
 * under — se resolve.ts for hvordan statusen faktisk brukes.
 */
export type FetchAttemptStatus = "available" | "unavailable";

/** Henter veigeometrier (som lister av punkter) innenfor `radiusMeters` av `center`. Tom liste ved feil. */
export async function fetchRoadsNear(center: LatLng, radiusMeters: number): Promise<LatLng[][]> {
  return (await fetchRoadsNearWithStatus(center, radiusMeters)).value;
}

/**
 * V1.3 (§Q): som fetchRoadsNear over, men eksponerer i tillegg om selve
 * nettverksforsøket lyktes eller ikke — se elevation.ts sin
 * fetchElevationMetersWithStatus for samme mønster/begrunnelse. Bevisst en
 * EGEN, tilleggs-eksportert funksjon fremfor å endre fetchRoadsNear sin
 * signatur.
 */
export async function fetchRoadsNearWithStatus(
  center: LatLng,
  radiusMeters: number
): Promise<{ value: LatLng[][]; status: FetchAttemptStatus }> {
  try {
    const query = `[out:json][timeout:10];way["highway"](around:${radiusMeters},${center.latitude},${center.longitude});out geom;`;
    const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    // V1.2.2 KRITISK FUNN: overpass-api.de sin Apache-instans svarer 406 Not
    // Acceptable på Node sin (undici) standard fetch() UTEN eksplisitt
    // Accept-header — bekreftet ved direkte sammenligning (curl fungerte,
    // bar fetch() feilet 406, samme fetch() MED disse headerne fungerte).
    // Denne funksjonen har dermed sannsynligvis feilet STILLE (tom liste,
    // aldri kastet — se catch under) gjennom hele V1.1/V1.2/V1.2.1, uten at
    // noen la merke til det siden roadDistanceFactor() degraderer usynlig
    // til "ingen straff" ved manglende data. Se water.ts for samme fiks.
    // V1.3: DETTE er nøyaktig klassen av feil dataQuality/§Q skal gjøre
    // synlig fremover — se resolve.ts sin bruk av status under.
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "*/*", "User-Agent": "ViltIQ/1.0 (+https://viltiq.no)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return { value: [], status: "unavailable" };

    const data = await res.json();
    const elements: unknown[] = Array.isArray(data?.elements) ? data.elements : [];

    const roads: LatLng[][] = [];
    for (const el of elements) {
      const geometry = (el as { geometry?: { lat: number; lon: number }[] })?.geometry;
      if (!Array.isArray(geometry)) continue;
      const pts = geometry
        .filter((g) => typeof g?.lat === "number" && typeof g?.lon === "number")
        .map((g) => ({ latitude: g.lat, longitude: g.lon }));
      if (pts.length > 0) roads.push(pts);
    }
    return { value: roads, status: "available" };
  } catch {
    return { value: [], status: "unavailable" };
  }
}

/** Nærmeste avstand (m) fra et punkt til en av veigeometriene. Null hvis ingen veier ble funnet. */
export function distanceToNearestRoadMeters(point: LatLng, roads: readonly LatLng[][]): number | null {
  let min = Infinity;
  for (const road of roads) {
    for (const node of road) {
      const d = distanceMeters(point, node);
      if (d < min) min = d;
    }
  }
  return Number.isFinite(min) ? min : null;
}
