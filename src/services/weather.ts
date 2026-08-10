import { vindRetningLabel } from "../lib/geo";

export type Vær = {
  temperatur: number;
  vindHastighet: number; // m/s
  vindRetning: number;   // grader 0–360
  værkode: number;
};

export type VærData = Vær & {
  vindLabel: string;
  beskrivelse: string;
  emoji: string;
};

export { vindRetningLabel };

export function jaktVindRad(vindRetning: number): string {
  // Jegeren bør ha vinden i ansiktet — stå MOT vindretningen
  const motVind = (vindRetning + 180) % 360;
  return `Still deg mot ${vindRetningLabel(motVind)} — vinden i ansiktet`;
}

function værkodeInfo(kode: number): { beskrivelse: string; emoji: string } {
  if (kode === 0)              return { beskrivelse: "Klart",         emoji: "☀️" };
  if (kode <= 2)               return { beskrivelse: "Lettskyet",     emoji: "🌤" };
  if (kode === 3)              return { beskrivelse: "Overskyet",     emoji: "☁️" };
  if (kode <= 49)              return { beskrivelse: "Tåke",          emoji: "🌫" };
  if (kode <= 59)              return { beskrivelse: "Yr",            emoji: "🌧" };
  if (kode <= 69)              return { beskrivelse: "Regn",          emoji: "🌧" };
  if (kode <= 79)              return { beskrivelse: "Sludd/snø",     emoji: "🌨" };
  if (kode <= 82)              return { beskrivelse: "Regnbyger",     emoji: "🌦" };
  if (kode <= 89)              return { beskrivelse: "Haglbyger",     emoji: "🌩" };
  return                              { beskrivelse: "Storm",          emoji: "⛈" };
}

export async function hentVær(lat: number, lon: number): Promise<VærData> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code` +
    `&wind_speed_unit=ms`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Klarte ikke hente vær");

  const data = await resp.json();
  const c    = data.current;
  const info = værkodeInfo(c.weather_code);

  return {
    temperatur:    Math.round(c.temperature_2m),
    vindHastighet: parseFloat(c.wind_speed_10m.toFixed(1)),
    vindRetning:   Math.round(c.wind_direction_10m),
    værkode:       c.weather_code,
    vindLabel:     vindRetningLabel(c.wind_direction_10m),
    beskrivelse:   info.beskrivelse,
    emoji:         info.emoji,
  };
}
