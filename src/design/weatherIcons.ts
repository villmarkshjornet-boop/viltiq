// Presentasjonslag-oppslag: værkode/månefase → Ionicons-navn. Erstatter
// emoji (☀️🌧☁️🌑 osv.) på Statistikk-skjermen med appens vanlige
// ikonspråk (Redesign-oppdraget §— "ingen emoji som ikonerstatning, unntatt
// artsemoji"). Rører IKKE `VærData`/`MåneFase`-typene eller funksjonene som
// produserer dem (src/services/weather.ts, src/lib/maane.ts) — kun et
// oppslag brukt der skjermen faktisk TEGNER et ikon.

import type { Ionicons } from "@expo/vector-icons";
import type { MåneFase } from "../lib/maane";

export type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * Værkode (0–99, samme WMO-koder som open-meteo/værkodeInfo() i
 * services/weather.ts) → Ionicons-navn. Terskelbøttene her speiler bevisst
 * de samme grensene som værkodeInfo() bruker for den norske beskrivelsen,
 * slik at ikon og tekst («Yr», «Regnbyger» osv.) alltid samsvarer.
 */
export function værIkon(værkode: number): IoniconName {
  if (værkode === 0) return "sunny-outline";        // Klart
  if (værkode <= 2) return "partly-sunny-outline";   // Lettskyet
  if (værkode === 3) return "cloudy-outline";        // Overskyet
  if (værkode <= 49) return "cloud-outline";         // Tåke
  if (værkode <= 59) return "rainy-outline";         // Yr
  if (værkode <= 69) return "rainy-outline";         // Regn
  if (værkode <= 79) return "snow-outline";          // Sludd/snø
  if (værkode <= 82) return "rainy-outline";         // Regnbyger
  if (værkode <= 89) return "snow-outline";          // Haglbyger
  return "thunderstorm-outline";                     // Storm
}

/**
 * Månefase → Ionicons-navn. Ionicons har ingen egne glyffer per månefase
 * (kun fylt "moon" / omriss "moon-outline") — vi bruker derfor fylt ikon fra
 * halvveis belyst og oppover, omriss under, som en grov men lesbar antydning
 * av belysningsgrad. Bruker kun `belysning`-feltet som allerede finnes på
 * MåneFase — ingen ny beregning.
 */
export function måneIkon(måne: Pick<MåneFase, "belysning">): IoniconName {
  return måne.belysning >= 50 ? "moon" : "moon-outline";
}
