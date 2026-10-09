// Jaktplan-produktflyt-oppdraget §3/§4/§5 — lokal (klient-side) påminnelse for
// en HuntPlan sitt anbefalte tidsvindu. BEVISST separat fra push.ts sitt
// eksterne push-varsel-oppsett (Expo push-token/Cloud Function) — dette
// bruker KUN expo-notifications sin lokale scheduling-API, ingen backend,
// ingen Firestore, ingen ny notification-arkitektur. Gjenbruker
// requestPushPermissions() fra push.ts (samme underliggende OS-tillatelse
// dekker både lokale og eksterne varsler på både iOS og Android — ikke to
// separate tillatelser å be om).
//
// Ren IO-wrapper — selve logikken (fyretidspunkt, tekst, identifikator) bor i
// src/lib/huntPlanReminder.ts og er testet der, uten å måtte laste
// expo-notifications (som ikke kan importeres under vanlig Node — se den
// filens toppkommentar).

import * as Notifications from "expo-notifications";
import type { HuntPlan } from "@/src/engine/huntPlan";
import { buildReminderContent, computeReminderFireAtMs, reminderIdentifier } from "@/src/lib/huntPlanReminder";
import { requestPushPermissions } from "./push";

export { computeReminderFireAtMs, buildReminderContent } from "@/src/lib/huntPlanReminder";

export type ScheduleReminderResult =
  | { status: "scheduled" }
  | { status: "no_window" }
  | { status: "too_late" }
  | { status: "permission_denied" }
  | { status: "failed" };

export async function scheduleHuntPlanReminder(plan: HuntPlan): Promise<ScheduleReminderResult> {
  if (plan.timeWindows.length === 0) return { status: "no_window" };
  const fireAtMs = computeReminderFireAtMs(plan);
  if (fireAtMs == null) return { status: "too_late" };

  // §4: naturlig tillatelsesforespørsel — samme etablerte helper som det
  // eksisterende push-varsel-oppsettet allerede bruker, ikke en ny sti.
  let granted: boolean;
  try {
    granted = await requestPushPermissions();
  } catch {
    // §4/§15: skal ALDRI krasje Jaktplanen — en plattform/enhet der selve
    // tillatelses-oppslaget feiler (f.eks. ukjent web-oppførsel) behandles
    // likt som "tillatelse ikke gitt", ikke en ukontrollert feil.
    return { status: "permission_denied" };
  }
  if (!granted) return { status: "permission_denied" };

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: reminderIdentifier(plan),
      content: buildReminderContent(plan),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAtMs },
    });
    return { status: "scheduled" };
  } catch {
    return { status: "failed" };
  }
}

/** Trygt å kalle selv om ingenting faktisk var planlagt (f.eks. brukeren slår av en påminnelse som aldri ble bekreftet planlagt) — cancel på en ukjent identifikator er et stille no-op på både iOS og Android. Svelger feil av samme §4/§15-grunn som scheduleHuntPlanReminder over. */
export async function cancelHuntPlanReminder(plan: HuntPlan): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(reminderIdentifier(plan));
  } catch {
    // no-op — se filkommentaren.
  }
}
