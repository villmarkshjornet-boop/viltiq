import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getSpeciesProfile, type PredictionZone } from "@/src/engine";
// Kontrakt-import: buildHuntPlan()/HuntPlan-typene bygges av en parallell
// motoroppgave i EN NY fil (src/engine/huntPlan.ts). Denne komponenten er
// bevisst en REN visningskomponent (samme mønster som EngineStatusPanel) —
// den kaller ALDRI selv vind-/bevegelses-/rangeringslogikk, den formaterer
// kun det motoren allerede har regnet ut. Se HuntPlan-oppdragets dokumenterte
// kontrakt for de eksakte feltnavnene brukt her.
import type { HuntPlan } from "@/src/engine/huntPlan";
import type { RecommendedTimeWindow } from "@/src/engine/types";
import { color, radius, spacing, typography } from "@/src/design/tokens";
import {
  cancelHuntPlanReminder,
  computeReminderFireAtMs,
  scheduleHuntPlanReminder,
} from "@/src/services/huntPlanReminder";
import { buildHowViltIQWouldHunt, buildRecommendedPostSummary, formatObservationAge, summarizeObservations } from "@/src/lib/huntPlanNarrative";
import type { LatLng } from "@/src/lib/geo";
import Badge from "./Badge";

/**
 * Terskel for når kartets bevegelsespil-overlay (app/kart.tsx) faktisk skal
 * TEGNES — selve HEDGING-SPRÅKET rundt bevegelse kommer allerede ferdig fra
 * motoren (`plan.expectedMovement.note`, se huntPlan.ts sin
 * computeExpectedMovement), denne UI-en dikter ALDRI opp sin egen
 * bevegelsestekst. Terskelen holdes her (ikke i kart.tsx) fordi den er en
 * ren VISNINGS-avgjørelse ("er dette sikkert nok til å tegne en pil"), ikke
 * en del av selve motorberegningen.
 */
export const MEANINGFUL_MOVEMENT_CONFIDENCE = 0.4;

export type TimePreset = "now" | "evening" | "tomorrow_early" | "custom";

/**
 * Fremtidig lag-/postfordeling (spec §3.13, "jaktlag"-integrasjon) er
 * BEVISST ikke bygget her ennå — men denne komponenten tar planen og sonen
 * som rene props (ingen enkelt-jeger-antakelse skjult dypt i rendering), så
 * en senere `teamMembers`/`assignedPosts`-prop kan legges til uten omskriving
 * av selve visningslogikken under.
 */
type HuntPlanPanelProps = {
  /** Sonen planen gjelder for — samme kilde som `plan.primaryZone`, brukt her kun for artsprofil-label og `level` (samme "sannsynlighet"-språk som EngineStatusPanel, ingen ny/parallell klassifisering). */
  zone: PredictionZone;
  /** Motorens ferdige plan for `zone` ved `targetDateTimeMs`. `null` mens den mangler grunnlag — se `unavailableReason`. */
  plan: HuntPlan | null;
  /** Ærlig statusbeskjed når planen IKKE kan bygges ennå (f.eks. miljødata ikke lastet) — vist i stedet for planinnhold, ALDRI en oppdiktet plan. */
  unavailableReason?: string | null;
  targetDateTimeMs: number;
  onTargetTimeChange: (ms: number) => void;
  onClose: () => void;
  /** V1.3 "Anbefalt jaktpost": brukerens EGEN posisjon — samme valgfrie, additive mønster som EngineStatusPanel sin `userLocation`-prop (se der for begrunnelsen). Uten den vises seksjonen akkurat som før, bare uten avstandslinjen. */
  userLocation?: LatLng | null;
  /**
   * V1.3 "Anbefalt jaktpost": trykk for å fokusere kartet på
   * `plan.recommendedPosition` — kalleren (app/kart.tsx) gjenbruker sitt
   * EKSISTERENDE `mapRef.current?.animateToRegion(...)`-mønster ("Sentrer
   * kart"), ingen ny navigasjon/state bygges her. Valgfri: uten den vises
   * punktet fortsatt, bare uten trykkbar fokusering.
   */
  onFocusRecommendedPost?: () => void;
};

const TIME_PRESETS: { key: TimePreset; label: string }[] = [
  { key: "now", label: "Nå" },
  { key: "evening", label: "I kveld" },
  { key: "tomorrow_early", label: "I morgen tidlig" },
  { key: "custom", label: "Egendefinert" },
];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** "Nå"/"I kveld"/"I morgen tidlig" → et konkret tidspunkt. Ren UI-datoaritmetikk (§3.6) — IKKE en prediksjon, kun VALG av hvilket tidspunkt motoren skal bygge planen for. */
function computePresetMs(preset: Exclude<TimePreset, "custom">): number {
  const now = new Date();
  if (preset === "now") return now.getTime();
  if (preset === "evening") {
    const d = new Date(now);
    d.setHours(20, 0, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  // "tomorrow_early"
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(5, 30, 0, 0);
  return d.getTime();
}

function computeCustomMs(dayOffset: number, hourStr: string, minuteStr: string): number {
  const hour = clamp(Math.trunc(Number(hourStr)) || 0, 0, 23);
  const minute = clamp(Math.trunc(Number(minuteStr)) || 0, 0, 59);
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit" });
}

function formatTargetMoment(ms: number): string {
  return new Date(ms).toLocaleString("no-NO", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeWindowsLabel(windows: readonly RecommendedTimeWindow[]): string | null {
  if (windows.length === 0) return null;
  return windows.map((w) => `${formatClock(w.startMs)}–${formatClock(w.endMs)}`).join(" · ");
}

const DATA_FRESHNESS_LABEL: Record<HuntPlan["dataFreshness"], string> = {
  lav: "Lav",
  middels: "Middels",
  god: "God",
};

function dataFreshnessColor(freshness: HuntPlan["dataFreshness"]): string {
  if (freshness === "god") return color.confidenceHøy;
  if (freshness === "middels") return color.confidenceMiddels;
  return color.confidenceLav;
}

/**
 * §3.1/§3.3: Jaktplan-visningen — samme visuelle språk som EngineStatusPanel
 * (samme tokens, samme seksjonstittel-stil), men for motorens buildHuntPlan()-
 * resultat i stedet for en enkelt sones score/rank. Ren visning: denne
 * komponenten regner ALDRI selv ut vind/bevegelse/rangering.
 */
export default function HuntPlanPanel({
  zone,
  plan,
  unavailableReason,
  targetDateTimeMs,
  onTargetTimeChange,
  onClose,
  userLocation,
  onFocusRecommendedPost,
}: HuntPlanPanelProps) {
  const [selectedPreset, setSelectedPreset] = useState<TimePreset>("now");
  const [customDayOffset, setCustomDayOffset] = useState<0 | 1>(0);
  const [customHour, setCustomHour] = useState("18");
  const [customMinute, setCustomMinute] = useState("00");

  // Jaktplan-produktflyt-oppdraget §3/§5: lokal påminnelse-status for DENNE
  // planen — "idle" (ingenting bedt om ennå), "scheduling" (venter på
  // tillatelse/scheduleNotificationAsync), "active" (bekreftet planlagt),
  // "denied" (bruker avslo varsel-tillatelse — Jaktplanen fungerer likevel
  // helt fint, se §4). Nullstilles når PLANEN selv endres (nytt tidspunkt/ny
  // sone gir en ny plan.id, se huntPlan.ts) — en påminnelse-knapp skal aldri
  // late som den fortsatt gjelder en plan som ikke lenger vises.
  const [reminderStatus, setReminderStatus] = useState<"idle" | "scheduling" | "active" | "denied">("idle");
  useEffect(() => {
    setReminderStatus("idle");
  }, [plan?.id]);

  useEffect(() => {
    if (selectedPreset !== "custom") return;
    onTargetTimeChange(computeCustomMs(customDayOffset, customHour, customMinute));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPreset, customDayOffset, customHour, customMinute]);

  function selectPreset(preset: TimePreset) {
    setSelectedPreset(preset);
    if (preset === "custom") {
      onTargetTimeChange(computeCustomMs(customDayOffset, customHour, customMinute));
      return;
    }
    onTargetTimeChange(computePresetMs(preset));
  }

  /** §3/§5: planlegger (eller, ved gjentatt trykk mens allerede aktiv, kansellerer) en lokal påminnelse for DENNE planens første tidsvindu. Reell IO (tillatelse + expo-notifications) — se src/services/huntPlanReminder.ts, denne komponenten dikter aldri opp egen varsel-logikk. */
  async function toggleReminder() {
    if (!plan) return;
    if (reminderStatus === "active") {
      await cancelHuntPlanReminder(plan);
      setReminderStatus("idle");
      return;
    }
    setReminderStatus("scheduling");
    const result = await scheduleHuntPlanReminder(plan);
    setReminderStatus(result.status === "scheduled" ? "active" : result.status === "permission_denied" ? "denied" : "idle");
  }

  const speciesLabel = getSpeciesProfile(zone.species).label;

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>Jaktplan — {speciesLabel}</Text>
        <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color={color.textSecondary} />
        </Pressable>
      </View>

      {plan && (
        <Text style={styles.scoreValue}>
          {Math.round(plan.primaryZone.score)}/100 · {zone.level} sannsynlighet
        </Text>
      )}

      {/* §3.6: Målt tidspunkt-velger — enkle chips, egendefinert er bevisst en enkel time/minutt-inputrad, ikke en full dato-velger-avhengighet. */}
      <View style={styles.presetRow}>
        {TIME_PRESETS.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => selectPreset(p.key)}
            style={[styles.presetChip, selectedPreset === p.key && styles.presetChipActive]}
          >
            <Text style={[styles.presetChipText, selectedPreset === p.key && styles.presetChipTextActive]}>
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {selectedPreset === "custom" && (
        <View style={styles.customRow}>
          <View style={styles.dayToggle}>
            {[{ v: 0 as const, label: "I dag" }, { v: 1 as const, label: "I morgen" }].map((d) => (
              <Pressable
                key={d.v}
                onPress={() => setCustomDayOffset(d.v)}
                style={[styles.dayChip, customDayOffset === d.v && styles.dayChipActive]}
              >
                <Text style={[styles.dayChipText, customDayOffset === d.v && styles.dayChipTextActive]}>{d.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.timeInputWrap}>
            <TextInput
              style={styles.timeInput}
              keyboardType="number-pad"
              maxLength={2}
              value={customHour}
              onChangeText={setCustomHour}
            />
            <Text style={styles.timeInputColon}>:</Text>
            <TextInput
              style={styles.timeInput}
              keyboardType="number-pad"
              maxLength={2}
              value={customMinute}
              onChangeText={setCustomMinute}
            />
          </View>
        </View>
      )}

      <Text style={styles.targetMomentCaption}>Planlegger for {formatTargetMoment(targetDateTimeMs)}</Text>

      {unavailableReason ? (
        <View style={styles.unavailableBox}>
          <Text style={styles.unavailableText}>{unavailableReason}</Text>
        </View>
      ) : !plan ? (
        <Text style={styles.unavailableText}>Beregner jaktplan …</Text>
      ) : (
        <>
          {/* Jaktanbefaling-nyttig-oppdraget §2/§9: den FØRSTE, viktigste
              seksjonen — en kort syntese brukeren kan lese på 5-10 sekunder,
              FØR detaljene under. Ren tekst-komposisjon av felt motoren
              allerede har regnet ut (se src/lib/huntPlanNarrative.ts) — denne
              komponenten genererer ALDRI selv ny hedging/sikkerhet. */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hvordan ville ViltIQ jaktet dette?</Text>
            <Text style={styles.bodyText}>{buildHowViltIQWouldHunt(plan)}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Når</Text>
            <Text style={styles.bodyText}>
              {formatTimeWindowsLabel(plan.timeWindows) ?? "Ingen tydelig tidsvindu for arten akkurat nå."}
            </Text>
            {/* §3/§5: kun vist når det faktisk finnes et tidsvindu å minne om,
                OG det ligger langt nok frem i tid til at en påminnelse gir
                mening (se computeReminderFireAtMs) — lover aldri en
                påminnelse for noe planen selv ikke har. */}
            {computeReminderFireAtMs(plan) != null && (
              <>
                <Pressable
                  onPress={toggleReminder}
                  disabled={reminderStatus === "scheduling"}
                  style={[styles.reminderBtn, reminderStatus === "active" && styles.reminderBtnActive]}
                >
                  <Ionicons
                    name={reminderStatus === "active" ? "notifications" : "notifications-outline"}
                    size={14}
                    color={reminderStatus === "active" ? color.primary : color.textSecondary}
                  />
                  <Text style={[styles.reminderBtnText, reminderStatus === "active" && styles.reminderBtnTextActive]}>
                    {reminderStatus === "scheduling"
                      ? "Planlegger …"
                      : reminderStatus === "active"
                        ? "Påminnelse aktiv · trykk for å slå av"
                        : "Minn meg på jaktstart"}
                  </Text>
                </Pressable>
                {/* §4: varsler er en tilleggstjeneste — avslått tillatelse
                    forklares kort, resten av Jaktplanen fungerer uendret. */}
                {reminderStatus === "denied" && (
                  <Text style={styles.hintText}>
                    Varsler er ikke tillatt for ViltIQ — slå det på i telefonens innstillinger hvis du vil bruke påminnelser. Resten av jaktplanen fungerer som normalt.
                  </Text>
                )}
              </>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hvor</Text>
            {/* V1.3: full begrunnelse (positionReasoning) flyttet ned til
                "🎯 Anbefalt jaktpost" rett under — unngår at samme tekst vises
                to ganger på rad og holder panelet fra å bli unødvendig langt. */}
            <Text style={styles.bodyText}>
              {zone.level} sannsynlighet innenfor sonen — anbefalt punkt vist på kartet, se «Anbefalt jaktpost» under.
            </Text>
          </View>

          {/* V1.3 "Gjør 'Hvor?' konkret: Anbefalt jaktpost" — gjør DET
              samme punktet (plan.recommendedPosition/positionReasoning/
              approach) konkret og trykkbart, i stedet for å bygge en ny
              beregning. Se src/lib/huntPlanNarrative.ts sin
              buildRecommendedPostSummary for hvorfor/hvordan-teksten og
              avstandslogikken — denne komponenten dikter ALDRI opp egne
              påstander om utsikt/skjul/kulefang/skytesektor e.l. som
              motoren ikke faktisk har data på. */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🎯 Anbefalt jaktpost</Text>
            {(() => {
              const post = buildRecommendedPostSummary(plan, userLocation);
              return (
                <>
                  <Pressable
                    onPress={onFocusRecommendedPost}
                    disabled={!onFocusRecommendedPost}
                    style={styles.recommendedPostRow}
                    hitSlop={6}
                  >
                    <Ionicons name="locate" size={16} color={color.primary} />
                    <Text style={styles.recommendedPostLinkText}>
                      {onFocusRecommendedPost ? "Vis punktet på kartet" : "Punktet er vist på kartet"}
                    </Text>
                    {onFocusRecommendedPost && (
                      <Ionicons name="chevron-forward" size={13} color={color.primary} />
                    )}
                  </Pressable>
                  {post.distanceLabel && <Text style={styles.hintText}>{post.distanceLabel}</Text>}
                  <Text style={[styles.bodyText, { marginTop: spacing.xs }]}>{post.hvorfor}</Text>
                  <Text style={styles.hintText}>{post.hvordan}</Text>
                </>
              );
            })()}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vind</Text>
            <Text style={styles.bodyText}>
              {plan.approach.windDirectionLabel}
              {plan.approach.windSpeedMs != null ? ` ${plan.approach.windSpeedMs.toFixed(1)} m/s` : ""}
            </Text>
            {plan.approach.recommendedApproachDirectionDeg != null && (
              <Text style={styles.hintText}>Anbefalt tilnærming: fra {plan.approach.recommendedApproachLabel}</Text>
            )}
            {/* plan.approach.note er motorens EGEN, ferdig hedgede
                forklaringstekst (huntPlan.ts sin computeWindApproach) —
                denne komponenten dikter ALDRI opp sin egen vindtekst. */}
            <Text style={styles.hintText}>{plan.approach.note}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Forventet bruk av terrenget</Text>
            {/* §3.4: plan.expectedMovement.note er motorens EGEN, allerede
                hedgede tekst (huntPlan.ts sin computeExpectedMovement) —
                "sannsynlig"/"usikker"/"utilstrekkelig grunnlag" avhengig av
                confidence/basis er ALLEREDE bakt inn der. Denne komponenten
                genererer ALDRI sin egen parallelle bevegelsestekst. */}
            <Text style={styles.bodyText}>{plan.expectedMovement.note}</Text>
          </View>

          {/* Jaktanbefaling-nyttig-oppdraget §4: "Hvorfor"-paraplyen med to
              BEVISST ATSKILTE deler — ViltIQs vurdering (terreng/vind/tid,
              samme Støtter/Trekker ned-liste som før) og Observasjoner (rene
              tall fra zone, ALDRI hentet fra den blandede reasons-listen, se
              huntPlanNarrative.ts). Brukeren skal aldri måtte gjette om en
              linje er noe ViltIQ har regnet ut eller noe som faktisk er sett. */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Hvorfor dette området?</Text>

              {(plan.reasons.positive.length > 0 || plan.reasons.negative.length > 0) && (
                <View style={{ marginBottom: spacing.md }}>
                  <Text style={styles.subLabel}>ViltIQs vurdering</Text>
                  {plan.reasons.positive.slice(0, 4).map((r, i) => (
                    <View key={`pos-${i}`} style={styles.signalRow}>
                      <View style={styles.signalDot} />
                      <Text style={styles.signalText}>{r}</Text>
                    </View>
                  ))}
                  {plan.reasons.negative.slice(0, 2).map((r, i) => (
                    <View key={`neg-${i}`} style={styles.signalRow}>
                      <View style={[styles.signalDot, { backgroundColor: color.textMuted }]} />
                      <Text style={styles.signalText}>{r}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View>
                <Text style={styles.subLabel}>Observasjoner</Text>
                {(() => {
                  const obs = summarizeObservations(zone);
                  if (!obs.hasObservations) {
                    return (
                      <View style={styles.signalRow}>
                        <View style={[styles.signalDot, { backgroundColor: color.textMuted }]} />
                        <Text style={styles.signalText}>Ingen registrerte observasjoner i området.</Text>
                      </View>
                    );
                  }
                  const countLabel = `${obs.count} registrert${obs.count === 1 ? "" : "e"} observasjon${obs.count === 1 ? "" : "er"} i området, nyeste ${formatObservationAge(obs.newestAgeMinutes)}.`;
                  return (
                    <>
                      <View style={styles.signalRow}>
                        <View style={styles.signalDot} />
                        <Text style={styles.signalText}>{countLabel}</Text>
                      </View>
                      {obs.distinctCameraCount > 0 && (
                        <View style={styles.signalRow}>
                          <View style={styles.signalDot} />
                          <Text style={styles.signalText}>
                            {obs.distinctCameraCount} kamera{obs.distinctCameraCount === 1 ? "" : "er"} har registrert aktivitet i området.
                          </Text>
                        </View>
                      )}
                    </>
                  );
                })()}
              </View>
          </View>

          {/* §3.11: Plan B vises KUN når motoren faktisk har alternativer —
              aldri en tom/plassholder-seksjon (spec: "aldri vis en tom Plan
              B"). */}
          {plan.alternatives.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Plan B</Text>
              {plan.alternatives.map((a) => (
                <View key={a.zoneId} style={styles.altRow}>
                  <Text style={styles.altRank}>#{a.rank}</Text>
                  <Text style={styles.bodyText}>{a.condition}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.freshnessRow}>
            <Text style={styles.confidenceLabel}>Datagrunnlag</Text>
            <Badge label={DATA_FRESHNESS_LABEL[plan.dataFreshness]} color={dataFreshnessColor(plan.dataFreshness)} size="sm" />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  eyebrow: { ...typography.eyebrow, color: color.primary },
  closeBtn: { padding: spacing.xs },

  scoreValue: { ...typography.primaryValue, fontSize: 24, color: color.textPrimary, marginBottom: spacing.md },

  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  presetChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: color.border,
    backgroundColor: color.surface,
  },
  presetChipActive: { backgroundColor: color.primary, borderColor: color.primary },
  presetChipText: { fontSize: 13, fontWeight: "700", color: color.textSecondary },
  presetChipTextActive: { color: color.primaryText },

  customRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm },
  dayToggle: { flexDirection: "row", gap: spacing.xs },
  dayChip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: color.border },
  dayChipActive: { backgroundColor: color.surfaceHover, borderColor: color.borderStrong },
  dayChipText: { fontSize: 12, fontWeight: "700", color: color.textMuted },
  dayChipTextActive: { color: color.textPrimary },
  timeInputWrap: { flexDirection: "row", alignItems: "center", gap: 2 },
  timeInput: {
    width: 40, textAlign: "center", fontSize: 15, fontWeight: "800", color: color.textPrimary,
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm,
    paddingVertical: 6,
  },
  timeInputColon: { color: color.textMuted, fontWeight: "800" },

  targetMomentCaption: { ...typography.caption, color: color.textMuted, marginBottom: spacing.lg, textTransform: "capitalize" },

  unavailableBox: {
    backgroundColor: color.surface, borderRadius: radius.md, borderWidth: 1, borderColor: color.border,
    padding: spacing.md,
  },
  unavailableText: { fontSize: 13, color: color.textMuted, lineHeight: 19, fontStyle: "italic" },

  section: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 12, fontWeight: "800", color: color.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: spacing.xs },
  // Jaktanbefaling-nyttig-oppdraget §4: mindre, dempet under-etikett for
  // "ViltIQs vurdering"/"Observasjoner" INNI "Hvorfor dette området?" —
  // bevisst svakere enn sectionTitle (som fortsatt markerer selve
  // hovedseksjonene) slik at det visuelle hierarkiet holder seg tydelig.
  subLabel: { fontSize: 11, fontWeight: "700", color: color.primary, marginBottom: spacing.xs },
  bodyText: { ...typography.body, color: color.textSecondary },
  hintText: { fontSize: 12, color: color.textMuted, marginTop: 2, lineHeight: 17 },

  // V1.3 "Anbefalt jaktpost": samme "Sentrer kart"-lenke-mønster (ikon +
  // tekst + chevron, primærfarge) som gjenbrukes andre steder i kart.tsx —
  // ingen ny visuell stil oppfunnet for denne trykkbare raden.
  recommendedPostRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  recommendedPostLinkText: { fontSize: 13, fontWeight: "700", color: color.primary },

  // Jaktplan-produktflyt-oppdraget §3/§5: samme visuelle språk som presetChip
  // (pill, border, dempet i idle-tilstand) — aktiv tilstand bruker ViltIQ sin
  // primærfarge, samme mønster som resten av appens "på/av"-knapper.
  reminderBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill, borderWidth: 1, borderColor: color.border,
    backgroundColor: color.surface,
  },
  reminderBtnActive: { borderColor: color.primary, backgroundColor: color.primary + "1A" },
  reminderBtnText: { fontSize: 12, fontWeight: "700", color: color.textSecondary },
  reminderBtnTextActive: { color: color.primary, fontWeight: "800" },

  signalRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.xs },
  signalDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: color.primary, marginTop: 7 },
  signalText: { flex: 1, fontSize: 13, color: color.textSecondary, lineHeight: 19 },

  altRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.xs },
  altRank: { fontSize: 13, fontWeight: "800", color: color.textMuted, width: 28 },

  freshnessRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  confidenceLabel: { fontSize: 12, fontWeight: "700", color: color.textMuted },
});
