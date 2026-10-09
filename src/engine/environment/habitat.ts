// ViltIQ Engine — habitat/arealtype via NIBIO sitt AR5-WMS (Arealressurskart).
// Verifisert manuelt (2026-08-11): WMS 1.1.1 GetFeatureInfo mot
// wms.nibio.no/cgi-bin/ar5, lag "Arealtype", INFO_FORMAT=application/vnd.ogc.gml
// gir en <artype_beskrivelse> tekstverdi (norsk klartekst, f.eks. "Bebygd",
// "Skog", "Jordbruk", "Myr" — AR5s offisielle 5-klassers systemklasser).
// Parses via enkel regex, ikke en XML-parser-avhengighet — responsformatet er
// en kjent, kontrollert kilde (statlig WMS), ikke vilkårlig HTML.

import type { LatLng } from "../types";
import type { HabitatClass } from "./types";

const NIBIO_AR5_WMS_URL = "https://wms.nibio.no/cgi-bin/ar5";

function mapBeskrivelseToHabitatClass(beskrivelse: string): HabitatClass {
  const s = beskrivelse.toLowerCase();
  if (s.includes("jordbruk") || s.includes("dyrka") || s.includes("innmark")) return "jordbruk";
  if (s.includes("skog")) return "skog";
  if (s.includes("myr")) return "myr";
  if (s.includes("bebygd") || s.includes("samferdsel")) return "bebygd";
  if (s.includes("ferskvann") || s.includes("hav") || s.includes("vann")) return "vann";
  if (s.includes("fastmark") || s.includes("åpen")) return "apent";
  return "ukjent";
}

/**
 * V1.3 (§Q): utfallet av ETT nettverksforsøk — bevisst adskilt fra selve
 * klassen, som er "ukjent" BÅDE ved feil OG ved et gyldig "AR5 har ikke
 * klassifisert dette arealet"-svar (se HabitatClass sin doc-kommentar i
 * types.ts). Se resolve.ts for hvordan dette aggregeres til én kildestatus.
 */
export type FetchAttemptStatus = "available" | "unavailable";

/** Henter forenklet habitatklasse for ett punkt. Returnerer "ukjent" ved feil eller uklassifisert areal — kaster aldri. */
export async function fetchHabitatClass(point: LatLng): Promise<HabitatClass> {
  return (await fetchHabitatClassWithStatus(point)).value;
}

/**
 * V1.3 (§Q): som fetchHabitatClass over, men eksponerer i tillegg om selve
 * nettverksforsøket lyktes eller ikke — se elevation.ts sin
 * fetchElevationMetersWithStatus for samme mønster/begrunnelse. Bevisst en
 * EGEN, tilleggs-eksportert funksjon fremfor å endre fetchHabitatClass sin
 * signatur.
 */
export async function fetchHabitatClassWithStatus(
  point: LatLng
): Promise<{ value: HabitatClass; status: FetchAttemptStatus }> {
  try {
    // Liten bbox (~200 m) rundt punktet, spør ut senterpikselen.
    const d = 0.001; // ~100 m i breddegrad ved norske breddegrader
    const bbox = [point.longitude - d, point.latitude - d, point.longitude + d, point.latitude + d].join(",");
    const url =
      `${NIBIO_AR5_WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo` +
      `&LAYERS=Arealtype&QUERY_LAYERS=Arealtype&STYLES=` +
      `&BBOX=${bbox}&WIDTH=101&HEIGHT=101&X=50&Y=50&SRS=EPSG:4326` +
      `&INFO_FORMAT=${encodeURIComponent("application/vnd.ogc.gml")}&FEATURE_COUNT=1`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { value: "ukjent", status: "unavailable" };

    const text = await res.text();
    const match = text.match(/<artype_beskrivelse>([^<]*)<\/artype_beskrivelse>/);
    if (!match || !match[1]) return { value: "ukjent", status: "available" };
    return { value: mapBeskrivelseToHabitatClass(match[1]), status: "available" };
  } catch {
    return { value: "ukjent", status: "unavailable" };
  }
}
