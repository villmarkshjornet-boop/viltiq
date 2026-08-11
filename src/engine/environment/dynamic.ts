// ViltIQ Engine — dynamiske miljødata (temperatur/vind/snø/nedbør/dagslys)
// via Open-Meteo. Samme værtjeneste som src/services/weather.ts (som driver
// "vind i ansiktet"-tipset i UI) bruker, men et EGET, motor-internt kall —
// motoren skal ikke koble seg til en UI-tjeneste. Verifisert manuelt
// (2026-08-11): current=temperature_2m,wind_speed_10m,wind_direction_10m,
// snow_depth,precipitation + daily=sunrise,sunset gir alle feltene i én
// spørring, ingen API-nøkkel.
//
// Hentes ÉN GANG per motorkjøring (ikke per rutepunkt) — vær/snø/dagslys
// varierer ikke nok over en jaktlags-skala analyseflate til å rettferdiggjøre
// separate kall per celle, se docs/ENGINE_RESEARCH.md sin metodenotat.

import type { LatLng } from "../types";
import { UKJENT_DYNAMIC_FEATURES, type DynamicEnvironmentalFeatures } from "./types";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

export async function fetchDynamicEnvironment(center: LatLng): Promise<DynamicEnvironmentalFeatures> {
  try {
    const url =
      `${OPEN_METEO_URL}?latitude=${center.latitude.toFixed(3)}&longitude=${center.longitude.toFixed(3)}` +
      `&current=temperature_2m,wind_speed_10m,wind_direction_10m,snow_depth,precipitation` +
      `&daily=sunrise,sunset&timezone=auto`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return UKJENT_DYNAMIC_FEATURES;

    const data = await res.json();
    const current = data?.current ?? {};
    const daily = data?.daily ?? {};
    const sunriseIso: string | undefined = daily?.sunrise?.[0];
    const sunsetIso: string | undefined = daily?.sunset?.[0];

    return {
      temperatureC: typeof current.temperature_2m === "number" ? current.temperature_2m : null,
      windSpeedMs: typeof current.wind_speed_10m === "number" ? current.wind_speed_10m / 3.6 : null, // km/h -> m/s
      windDirectionDeg: typeof current.wind_direction_10m === "number" ? current.wind_direction_10m : null,
      snowDepthMeters: typeof current.snow_depth === "number" ? current.snow_depth : null,
      precipitationMm: typeof current.precipitation === "number" ? current.precipitation : null,
      sunriseMs: sunriseIso ? new Date(sunriseIso).getTime() : null,
      sunsetMs: sunsetIso ? new Date(sunsetIso).getTime() : null,
    };
  } catch {
    return UKJENT_DYNAMIC_FEATURES;
  }
}
