// Jaktplan-produktflyt-oppdraget §3/§5 — REN logikk for jaktplan-påminnelsen:
// når den skal fyre, og hva den skal si. Bevisst adskilt fra
// src/services/huntPlanReminder.ts (som gjør selve expo-notifications-IO-en)
// av samme grunn som src/engine/huntPlan.ts er adskilt fra
// src/services/predictions.ts — ren, testbar logikk uten native/IO-
// avhengigheter, samme mønster som resten av kodebasen allerede bruker.
// expo-notifications kan ikke importeres under vanlig Node (drar med seg
// native modul-oppsett) — derfor bor INGENTING fra det biblioteket her.

// Importert fra den SPESIFIKKE filen, ikke motorens offentlige barrel
// (@/src/engine) — barrelen er et katalog-import som Node sin ESM-resolver
// (brukt av node:test, se testSupport/nodeEsmTestLoader.mjs) ikke støtter for
// en EKTE runtime-import (kun for rene `import type`, som strippes bort før
// kjøretid — se f.eks. predictions.ts). Samme mønster som huntPlan.ts selv
// allerede bruker for nøyaktig denne funksjonen.
import { getSpeciesProfile } from "@/src/engine/species/profiles";
import type { HuntPlan } from "@/src/engine/huntPlan";

/** Hvor lenge før tidsvinduet starter påminnelsen fyres — en fast, dokumentert UI-margin, ikke noe motoren har regnet ut. */
export const REMINDER_MARGIN_MINUTES = 15;
/** Planlegger ALDRI en påminnelse som ville fyrt mindre enn dette frem i tid — unngår en notification som enten fyrer "med det samme" (forvirrende) eller stille ikke fyrer i det hele tatt fordi tidspunktet allerede er passert. */
const MIN_LEAD_MS = 30_000;

/**
 * SAMME identifikator hver gang for NØYAKTIG samme plan (art + sone +
 * planlagt tidspunkt + hvilken motorkjøring den kom fra, se huntPlan.ts sin
 * `HuntPlan.id`) — å planlegge på nytt med samme identifier ERSTATTER
 * automatisk en tidligere ventende notification på både iOS og Android i
 * stedet for å legge til en ny (§5: "unngå duplikate notifications").
 */
export function reminderIdentifier(plan: HuntPlan): string {
  return `viltiq-huntplan-${plan.id}`;
}

/**
 * `null` når det enten ikke finnes noe tidsvindu i det hele tatt (§3: "bruk
 * første relevante timeWindows[0]"), eller når vinduet (minus margin) allerede
 * ligger for nært/i fortiden til at en påminnelse gir mening — kalleren viser
 * da ingen påminnelses-knapp i stedet for å love noe som ikke kan holdes.
 * `nowMs` er valgfri (kun til testing — se huntPlanReminder.test.ts), samme
 * mønster som resten av motoren (aldri et skjult internt Date.now()-kall som
 * gjør funksjonen ikke-deterministisk uten at kalleren kan overstyre den).
 */
export function computeReminderFireAtMs(plan: HuntPlan, nowMs = Date.now()): number | null {
  const window = plan.timeWindows[0];
  if (!window) return null;
  const fireAtMs = window.startMs - REMINDER_MARGIN_MINUTES * 60_000;
  if (fireAtMs <= nowMs + MIN_LEAD_MS) return null;
  return fireAtMs;
}

/**
 * §3: teksten er bevisst kort og nyttig, og lover ALDRI mer enn planen
 * faktisk sier — artsnavnet kommer direkte fra `plan.species` (samme
 * artsprofil-label som resten av UI-et bruker), ingen oppdiktet detalj.
 */
export function buildReminderContent(plan: HuntPlan): { title: string; body: string } {
  const speciesLabel = getSpeciesProfile(plan.species).label;
  return {
    title: "ViltIQ – jaktvindu nærmer seg",
    body: `${speciesLabel} – anbefalt jaktvindu starter snart.`,
  };
}
