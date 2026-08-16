import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomDock from "../components/BottomDock";
import { auth } from "../src/config/firebase";
import { loggUt } from "../src/services/auth";
import {
    bliMedIJaktlag,
    clearAktivtJaktlagId,
    forlatJaktlag,
    getAktivtJaktlagId,
    hentJaktlag,
    opprettJaktlag,
    subscribeMedlemmer,
    type Jaktlag,
    type Medlem,
} from "../src/services/jaktlag";
import {
    registerForPushNotificationsAsync,
    syncUserPushSettingsToFirestore,
} from "../src/services/push";
import {
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
    type AppSettings,
} from "../src/services/settings";
import {
    alpha as uiAlpha,
    color as uiColor,
    radius as uiRadius,
    spacing as uiSpacing,
    typography as uiType,
} from "../src/design/tokens";
import { visAlert } from "../src/lib/confirmAlert";

const radiusOptions: Array<10 | 25 | 50> = [10, 25, 50];

export default function InnstillingerScreen() {
  const router = useRouter();

  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [settings,   setSettings]   = useState<AppSettings>(DEFAULT_SETTINGS);
  const [message,    setMessage]    = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error" | "info">("info");
  const [pushToken,  setPushToken]  = useState<string | null>(null);
  const [jaktlag,      setJaktlag]      = useState<Jaktlag | null>(null);
  const [jaktlagPanel, setJaktlagPanel] = useState<"ingen" | "opprett" | "bliMed">("ingen");
  const [jaktlagNavn,  setJaktlagNavn]  = useState("");
  const [invitKode,    setInvitKode]    = useState("");
  const [jaktlagLaster, setJaktlagLaster] = useState(false);
  const [jaktlagFeil,  setJaktlagFeil]  = useState("");
  const [medlemmer,    setMedlemmer]    = useState<Medlem[]>([]);
  const epost = auth.currentUser?.email ?? "";

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        setMessage("");
        const current = await getSettings();
        setSettings(current);

        const jaktlagId = await getAktivtJaktlagId();
        if (jaktlagId) {
          const jl = await hentJaktlag(jaktlagId);
          setJaktlag(jl);
        }
      } catch (error: any) {
        setMessageTone("error");
        setMessage(error?.message || "Kunne ikke laste innstillinger.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Lytt på jaktlag-medlemmer når jaktlag er kjent
  useEffect(() => {
    if (!jaktlag?.id) { setMedlemmer([]); return; }
    const unsub = subscribeMedlemmer(jaktlag.id, setMedlemmer);
    return unsub;
  }, [jaktlag?.id]);

  async function handterOpprettJaktlag() {
    if (!jaktlagNavn.trim()) { setJaktlagFeil("Skriv inn et navn på jaktlaget."); return; }
    setJaktlagFeil(""); setJaktlagLaster(true);
    try {
      const jl = await opprettJaktlag(jaktlagNavn.trim());
      setJaktlag(jl); setJaktlagPanel("ingen"); setJaktlagNavn("");
    } catch (e: any) {
      setJaktlagFeil(e?.message || "Klarte ikke opprette jaktlag.");
    } finally { setJaktlagLaster(false); }
  }

  async function handterBliMed() {
    if (!invitKode.trim()) { setJaktlagFeil("Skriv inn invitasjonskoden."); return; }
    setJaktlagFeil(""); setJaktlagLaster(true);
    try {
      const jl = await bliMedIJaktlag(invitKode.trim());
      setJaktlag(jl); setJaktlagPanel("ingen"); setInvitKode("");
    } catch (e: any) {
      setJaktlagFeil(e?.message || "Fant ikke jaktlag med den koden.");
    } finally { setJaktlagLaster(false); }
  }

  async function handterForlat() {
    if (!jaktlag) return;
    visAlert(
      "Forlat jaktlag",
      `Er du sikker på at du vil forlate ${jaktlag.navn}? Du kan bli med igjen via invitasjonskoden.`,
      [
        { text: "Avbryt", style: "cancel" },
        {
          text: "Forlat",
          style: "destructive",
          onPress: async () => {
            try {
              await forlatJaktlag(jaktlag.id);
              setJaktlag(null);
              setMedlemmer([]);
            } catch (e: any) {
              setMessageTone("error");
              setMessage(e?.message || "Klarte ikke forlate jaktlaget.");
            }
          },
        },
      ]
    );
  }

  async function handterLoggUt() {
    visAlert(
      "Logg ut",
      "Er du sikker på at du vil logge ut?",
      [
        { text: "Avbryt", style: "cancel" },
        {
          text: "Logg ut",
          style: "destructive",
          onPress: async () => {
            await clearAktivtJaktlagId();
            await loggUt();
            router.replace("/onboarding");
          },
        },
      ]
    );
  }

  async function persist(
    next: AppSettings,
    nextPushToken: string | null = pushToken,
    successMessage = "Innstillinger lagret."
  ) {
    try {
      setSaving(true);
      setMessage("");

      await saveSettings(next);
      await syncUserPushSettingsToFirestore({
        radiusKm: next.radiusKm,
        notificationsEnabled: next.notificationsEnabled,
        expoPushToken: nextPushToken,
      });

      setSettings(next);
      setPushToken(nextPushToken);
      setMessageTone("success");
      setMessage(successMessage);
    } catch (error: any) {
      setMessageTone("error");
      setMessage(error?.message || "Kunne ikke lagre innstillinger.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleNotifications(value: boolean) {
    if (!value) {
      await persist(
        {
          ...settings,
          notificationsEnabled: false,
        },
        null
      );
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const token = await registerForPushNotificationsAsync();
      await persist(
        { ...settings, notificationsEnabled: true },
        token,
        "Pushvarsler er aktivert."
      );
    } catch (error: any) {
      setMessageTone("error");
      setMessage(error?.message || "Kunne ikke aktivere pushvarsler.");
      setSaving(false);
    }
  }

  async function selectRadius(radiusKm: 10 | 25 | 50) {
    await persist({
      ...settings,
      radiusKm,
    });
  }

  const activeDescription =
    settings.radiusKm === 10
      ? "Tett og lokalt område – best for nærområdet ditt."
      : settings.radiusKm === 25
      ? "Balansert radius – god standard for jaktområder."
      : "Maks oversikt – viser bred aktivitet rundt deg.";

  const messageStyle =
    messageTone === "error"
      ? styles.messageError
      : messageTone === "success"
      ? styles.messageSuccess
      : styles.messageInfo;

  const messageTextStyle =
    messageTone === "error"
      ? styles.messageErrorText
      : messageTone === "success"
      ? styles.messageSuccessText
      : styles.messageInfoText;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} style={styles.backRow} hitSlop={8}>
              <Ionicons name="chevron-back" size={18} color={uiColor.primarySoft} />
              <Text style={styles.backText}>Tilbake</Text>
            </Pressable>

            <View style={styles.brandRow}>
              <View style={styles.brandDot} />
              <Text style={styles.brandText}>ViltIQ</Text>
            </View>

            <Text style={styles.title}>Innstillinger</Text>
            <Text style={styles.subtitle}>
              Styr radius, varsler og hvordan ViltIQ skal følge aktivitet i
              området ditt.
            </Text>
          </View>

          {loading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color={uiColor.primarySoft} />
              <Text style={styles.loadingTitle}>Laster innstillinger...</Text>
              <Text style={styles.loadingText}>
                Henter lagret radius og varselvalg.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.heroCard}>
                <View style={styles.heroTop}>
                  <View style={styles.heroIcon}>
                    <Ionicons name="locate" size={24} color={uiColor.primarySoft} />
                  </View>

                  <View style={styles.heroTextWrap}>
                    <Text style={styles.heroEyebrow}>Aktiv radius</Text>
                    <Text style={styles.heroTitle}>{settings.radiusKm} km</Text>
                    <Text style={styles.heroText}>{activeDescription}</Text>
                  </View>
                </View>

                <View style={styles.heroStatsRow}>
                  <View style={styles.heroStat}>
                    <Text style={styles.heroStatValue}>
                      {settings.notificationsEnabled ? "På" : "Av"}
                    </Text>
                    <Text style={styles.heroStatLabel}>varsler</Text>
                  </View>

                  <View style={styles.heroStat}>
                    <Text style={styles.heroStatValue}>Live</Text>
                    <Text style={styles.heroStatLabel}>Firestore</Text>
                  </View>
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.cardEyebrow}>Område</Text>
                    <Text style={styles.cardTitle}>Velg radius</Text>
                  </View>

                  <View style={styles.miniBadge}>
                    <Text style={styles.miniBadgeText}>
                      {settings.radiusKm} km
                    </Text>
                  </View>
                </View>

                <Text style={styles.cardText}>
                  Radiusen brukes på forsiden, kartet og senere for pushvarsler.
                </Text>

                <View style={styles.radiusRow}>
                  {radiusOptions.map((radius) => {
                    const active = settings.radiusKm === radius;

                    return (
                      <Pressable
                        key={radius}
                        disabled={saving}
                        onPress={() => selectRadius(radius)}
                        style={[
                          styles.radiusChip,
                          active && styles.radiusChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.radiusValue,
                            active && styles.radiusValueActive,
                          ]}
                        >
                          {radius}
                        </Text>
                        <Text
                          style={[
                            styles.radiusLabel,
                            active && styles.radiusLabelActive,
                          ]}
                        >
                          km
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.switchRow}>
                  <View style={styles.switchIcon}>
                    <Ionicons
                      name={
                        settings.notificationsEnabled
                          ? "notifications"
                          : "notifications-off"
                      }
                      size={22}
                      color={uiColor.primarySoft}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardEyebrow}>Varsler</Text>
                    <Text style={styles.cardTitle}>Pushvarsler</Text>
                    <Text style={styles.cardText}>
                      Få beskjed når nye observasjoner kommer innen valgt
                      radius. Backend-push kan aktiveres når Cloud Functions er
                      klar.
                    </Text>
                  </View>

                  <Switch
                    value={settings.notificationsEnabled}
                    onValueChange={toggleNotifications}
                    disabled={saving}
                  />
                </View>

                <View style={styles.statusLine}>
                  <View
                    style={[
                      styles.statusDot,
                      settings.notificationsEnabled
                        ? styles.statusDotOn
                        : styles.statusDotOff,
                    ]}
                  />
                  <Text style={styles.statusText}>
                    {settings.notificationsEnabled
                      ? "Varsler er aktivert på denne enheten"
                      : "Varsler er slått av"}
                  </Text>
                </View>
              </View>

              {/* ── Jaktlag ── */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.cardEyebrow}>Jaktlag</Text>
                    <Text style={styles.cardTitle}>
                      {jaktlag ? jaktlag.navn : "Ingen jaktlag"}
                    </Text>
                  </View>
                  {jaktlag && (
                    <View style={styles.miniBadge}>
                      <Text style={styles.miniBadgeText}>
                        {jaktlag.lederUid === auth.currentUser?.uid ? "Leder" : "Jeger"}
                      </Text>
                    </View>
                  )}
                </View>

                {jaktlag ? (
                  <>
                    <Text style={styles.cardText}>{epost}</Text>

                    {/* Invitasjonskode */}
                    <View style={styles.kodeRad}>
                      <View>
                        <Text style={styles.kodeLabel}>Invitasjonskode</Text>
                        <Text style={styles.kodeTekst}>{jaktlag.invitKode}</Text>
                      </View>
                      <Text style={styles.kodeHint}>Del med laget</Text>
                    </View>

                    {/* Medlemsliste */}
                    <View style={styles.medlSection}>
                      <View style={styles.medlHeader}>
                        <Text style={styles.medlHeaderTxt}>Medlemmer</Text>
                        <View style={styles.medlBadge}>
                          <Text style={styles.medlBadgeTxt}>{medlemmer.length}</Text>
                        </View>
                      </View>
                      {medlemmer.map((m) => (
                        <View key={m.uid} style={styles.medlRad}>
                          <View style={styles.medlAvatar}>
                            <Text style={styles.medlAvatarTxt}>
                              {(m.epost?.[0] ?? "J").toUpperCase()}
                            </Text>
                          </View>
                          <Text style={styles.medlEpost} numberOfLines={1}>
                            {m.epost || m.uid}
                          </Text>
                          <View style={[
                            styles.medlRolleBadge,
                            m.rolle === "leder" && styles.medlRolleBadgeLeder,
                          ]}>
                            <Text style={[
                              styles.medlRolleTxt,
                              m.rolle === "leder" && styles.medlRolleTxtLeder,
                            ]}>
                              {m.rolle === "leder" ? "Leder" : "Jeger"}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>

                    {/* Forlat jaktlag */}
                    <Pressable style={styles.forlatKnapp} onPress={handterForlat}>
                      <Ionicons name="exit-outline" size={15} color={uiColor.danger} />
                      <Text style={styles.forlatTxt}>Forlat jaktlag</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.cardText}>
                      Appen fungerer offentlig uten jaktlag. Opprett eller bli med for å dele data privat med laget.
                    </Text>

                    {/* Knapper for å velge handling */}
                    {jaktlagPanel === "ingen" && (
                      <View style={styles.jaktlagKnappRad}>
                        <Pressable
                          style={styles.jaktlagKnapp}
                          onPress={() => { setJaktlagPanel("bliMed"); setJaktlagFeil(""); }}
                        >
                          <Ionicons name="enter-outline" size={16} color={uiColor.primarySoft} />
                          <Text style={styles.jaktlagKnappTxt}>Bli med</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.jaktlagKnapp, styles.jaktlagKnappAlt]}
                          onPress={() => { setJaktlagPanel("opprett"); setJaktlagFeil(""); }}
                        >
                          <Ionicons name="add-circle-outline" size={16} color={uiColor.primarySoft} />
                          <Text style={styles.jaktlagKnappTxt}>Opprett nytt</Text>
                        </Pressable>
                      </View>
                    )}

                    {/* Bli med-skjema */}
                    {jaktlagPanel === "bliMed" && (
                      <View style={styles.jaktlagSkjema}>
                        <Text style={styles.jaktlagSkjemaLabel}>Invitasjonskode</Text>
                        <TextInput
                          style={styles.jaktlagInput}
                          value={invitKode}
                          onChangeText={setInvitKode}
                          placeholder="F.EKS. AB12CD"
                          placeholderTextColor={uiColor.textFaint}
                          autoCapitalize="characters"
                          maxLength={6}
                        />
                        {!!jaktlagFeil && <Text style={styles.jaktlagFeil}>{jaktlagFeil}</Text>}
                        <View style={styles.jaktlagKnappRad}>
                          <Pressable style={styles.jaktlagKnapp} onPress={() => setJaktlagPanel("ingen")}>
                            <Text style={styles.jaktlagKnappTxt}>Avbryt</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.jaktlagKnapp, styles.jaktlagKnappPrimær, jaktlagLaster && { opacity: 0.5 }]}
                            onPress={handterBliMed}
                            disabled={jaktlagLaster}
                          >
                            <Text style={styles.jaktlagKnappPrimærTxt}>
                              {jaktlagLaster ? "Kobler til…" : "Bli med"}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    )}

                    {/* Opprett-skjema */}
                    {jaktlagPanel === "opprett" && (
                      <View style={styles.jaktlagSkjema}>
                        <Text style={styles.jaktlagSkjemaLabel}>Navn på jaktlaget</Text>
                        <TextInput
                          style={styles.jaktlagInput}
                          value={jaktlagNavn}
                          onChangeText={setJaktlagNavn}
                          placeholder="F.eks. Nordmarka Jaktlag"
                          placeholderTextColor={uiColor.textFaint}
                        />
                        {!!jaktlagFeil && <Text style={styles.jaktlagFeil}>{jaktlagFeil}</Text>}
                        <View style={styles.jaktlagKnappRad}>
                          <Pressable style={styles.jaktlagKnapp} onPress={() => setJaktlagPanel("ingen")}>
                            <Text style={styles.jaktlagKnappTxt}>Avbryt</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.jaktlagKnapp, styles.jaktlagKnappPrimær, jaktlagLaster && { opacity: 0.5 }]}
                            onPress={handterOpprettJaktlag}
                            disabled={jaktlagLaster}
                          >
                            <Text style={styles.jaktlagKnappPrimærTxt}>
                              {jaktlagLaster ? "Oppretter…" : "Opprett"}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </>
                )}
              </View>

              <View style={styles.infoCard}>
                <Ionicons name="shield-checkmark" size={20} color={uiColor.primarySoft} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoTitle}>Personvern og posisjon</Text>
                  <Text style={styles.infoText}>
                    Posisjon brukes for å vise observasjoner i nærheten og for
                    fremtidige varsler. Observasjoner lagres med anonymisert GPS.
                  </Text>
                </View>
              </View>

              {!!message && (
                <View style={[styles.messageBox, messageStyle]}>
                  <Text style={[styles.messageText, messageTextStyle]}>
                    {message}
                  </Text>
                </View>
              )}

              {saving ? (
                <View style={styles.savingRow}>
                  <ActivityIndicator size="small" color={uiColor.primarySoft} />
                  <Text style={styles.savingText}>Lagrer...</Text>
                </View>
              ) : null}

              {/* ── Logg ut ── */}
              <Pressable style={styles.loggUtKnapp} onPress={handterLoggUt}>
                <Ionicons name="log-out-outline" size={18} color={uiColor.danger} />
                <Text style={styles.loggUtTxt}>Logg ut</Text>
              </Pressable>
            </>
          )}
        </ScrollView>

        <BottomDock />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: uiColor.background,
  },
  screen: {
    flex: 1,
  },
  container: {
    paddingHorizontal: uiSpacing.xl,
    paddingTop: uiSpacing.md,
    paddingBottom: 162,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
  },
  header: {
    marginTop: 6,
    marginBottom: 18,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: uiSpacing.xs,
    marginBottom: 14,
  },
  backText: { color: uiColor.primarySoft, fontSize: 15, fontWeight: "700" },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: uiSpacing.sm,
    marginBottom: 14,
  },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: uiRadius.pill,
    backgroundColor: uiColor.primary,
  },
  brandText: {
    ...uiType.eyebrow,
    color: uiColor.textMuted,
  },
  title: {
    ...uiType.pageTitle,
    color: uiColor.textPrimary,
  },
  subtitle: {
    ...uiType.body,
    color: uiColor.textSecondary,
    marginTop: uiSpacing.sm,
    maxWidth: "94%",
  },
  loadingCard: {
    backgroundColor: uiColor.surface,
    borderWidth: 1,
    borderColor: uiColor.border,
    borderRadius: uiRadius.xl,
    padding: 24,
    alignItems: "center",
  },
  loadingTitle: {
    color: uiColor.textPrimary,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 14,
  },
  loadingText: {
    color: uiColor.textSecondary,
    fontSize: 14,
    marginTop: 6,
  },
  heroCard: {
    backgroundColor: uiColor.surfaceElevated,
    borderWidth: 1,
    borderColor: uiColor.borderStrong,
    borderRadius: uiRadius.xl,
    padding: uiSpacing.xl,
    marginBottom: uiSpacing.lg,
  },
  heroTop: {
    flexDirection: "row",
    gap: 14,
    alignItems: "flex-start",
  },
  heroIcon: {
    width: 50,
    height: 50,
    borderRadius: uiRadius.lg,
    backgroundColor: uiColor.surfaceHover,
    borderWidth: 1,
    borderColor: uiColor.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTextWrap: {
    flex: 1,
  },
  heroEyebrow: {
    ...uiType.eyebrow,
    color: uiColor.textMuted,
  },
  heroTitle: {
    ...uiType.display,
    color: uiColor.textPrimary,
    marginTop: 4,
  },
  heroText: {
    color: uiColor.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 6,
  },
  heroStatsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  heroStat: {
    flex: 1,
    backgroundColor: uiColor.surfaceHover,
    borderWidth: 1,
    borderColor: uiColor.border,
    borderRadius: uiRadius.lg,
    padding: 14,
  },
  heroStatValue: {
    color: uiColor.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  heroStatLabel: {
    ...uiType.metadata,
    color: uiColor.textMuted,
    marginTop: 4,
  },
  card: {
    backgroundColor: uiColor.surface,
    borderWidth: 1,
    borderColor: uiColor.border,
    borderRadius: uiRadius.xl,
    padding: 18,
    marginBottom: uiSpacing.lg,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: uiSpacing.md,
    alignItems: "flex-start",
  },
  cardEyebrow: {
    ...uiType.eyebrow,
    color: uiColor.textMuted,
    marginBottom: 5,
  },
  cardTitle: {
    color: uiColor.textPrimary,
    fontSize: 19,
    fontWeight: "900",
  },
  cardText: {
    ...uiType.body,
    color: uiColor.textSecondary,
    marginTop: uiSpacing.sm,
  },
  miniBadge: {
    backgroundColor: uiColor.surfaceHover,
    borderWidth: 1,
    borderColor: uiColor.borderStrong,
    borderRadius: uiRadius.pill,
    paddingHorizontal: uiSpacing.md,
    paddingVertical: 7,
  },
  miniBadgeText: {
    color: uiColor.primarySoft,
    fontSize: 12,
    fontWeight: "900",
  },
  radiusRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  radiusChip: {
    flex: 1,
    backgroundColor: uiColor.surface,
    borderWidth: 1,
    borderColor: uiColor.border,
    borderRadius: uiRadius.xl,
    paddingVertical: 18,
    alignItems: "center",
  },
  radiusChipActive: {
    backgroundColor: uiColor.surfaceHover,
    borderColor: uiColor.borderStrong,
  },
  radiusValue: {
    color: uiColor.textPrimary,
    fontSize: 24,
    fontWeight: "900",
  },
  radiusValueActive: {
    color: uiColor.primarySoft,
  },
  radiusLabel: {
    color: uiColor.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  radiusLabelActive: {
    color: uiColor.primarySoft,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  switchIcon: {
    width: 46,
    height: 46,
    borderRadius: uiRadius.lg,
    backgroundColor: uiColor.surfaceHover,
    borderWidth: 1,
    borderColor: uiColor.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  statusLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: uiSpacing.sm,
    marginTop: uiSpacing.lg,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: uiColor.border,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: uiRadius.pill,
  },
  statusDotOn: {
    backgroundColor: uiColor.primarySoft,
  },
  statusDotOff: {
    backgroundColor: uiColor.textFaint,
  },
  statusText: {
    color: uiColor.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  infoCard: {
    flexDirection: "row",
    gap: uiSpacing.md,
    backgroundColor: uiColor.surface,
    borderWidth: 1,
    borderColor: uiColor.border,
    borderRadius: uiRadius.xl,
    padding: 18,
    marginBottom: uiSpacing.lg,
  },
  infoTitle: {
    ...uiType.sectionTitle,
    color: uiColor.textPrimary,
  },
  infoText: {
    ...uiType.body,
    color: uiColor.textSecondary,
    marginTop: uiSpacing.sm,
  },
  messageBox: {
    borderRadius: uiRadius.lg,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 14,
    borderWidth: 1,
  },
  messageText: {
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  messageSuccess: {
    backgroundColor: uiColor.success + uiAlpha.soft,
    borderColor: uiColor.success + uiAlpha.medium,
  },
  messageSuccessText: {
    color: uiColor.primarySoft,
  },
  messageError: {
    backgroundColor: uiColor.danger + uiAlpha.soft,
    borderColor: uiColor.danger + uiAlpha.medium,
  },
  messageErrorText: {
    color: uiColor.danger,
  },
  messageInfo: {
    backgroundColor: uiColor.info + uiAlpha.soft,
    borderColor: uiColor.info + uiAlpha.medium,
  },
  messageInfoText: {
    color: uiColor.info,
  },
  savingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: uiSpacing.sm,
    marginTop: uiSpacing.xs,
  },
  savingText: {
    color: uiColor.primarySoft,
    fontSize: 13,
    fontWeight: "800",
  },

  kodeRad: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: uiColor.border,
  },
  kodeLabel: { ...uiType.eyebrow, color: uiColor.textMuted, marginBottom: uiSpacing.xs },
  kodeTekst: { color: uiColor.primarySoft, fontSize: 22, fontWeight: "900", letterSpacing: 3 },
  kodeHint:  { color: uiColor.textFaint, fontSize: 12, fontWeight: "600" },

  medlSection: {
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: uiColor.border,
  },
  medlHeader:    { flexDirection: "row", alignItems: "center", gap: uiSpacing.sm, marginBottom: 10 },
  medlHeaderTxt: { ...uiType.eyebrow, color: uiColor.textMuted },
  medlBadge: {
    backgroundColor: uiColor.primary + uiAlpha.soft,
    borderRadius: uiRadius.pill, paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: uiColor.primary + uiAlpha.medium,
  },
  medlBadgeTxt: { color: uiColor.primary, fontSize: 11, fontWeight: "900" },
  medlRad: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: uiSpacing.sm,
    borderBottomWidth: 1, borderBottomColor: uiColor.border,
  },
  medlAvatar: {
    width: 30, height: 30, borderRadius: uiRadius.pill,
    backgroundColor: uiColor.surfaceHover, borderWidth: 1, borderColor: uiColor.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  medlAvatarTxt:    { color: uiColor.primary, fontSize: 13, fontWeight: "900" },
  medlEpost:        { color: uiColor.textSecondary, fontSize: 13, flex: 1 },
  medlRolleBadge:   { backgroundColor: uiColor.surface, borderRadius: uiRadius.pill, paddingHorizontal: uiSpacing.sm, paddingVertical: 3, borderWidth: 1, borderColor: uiColor.border },
  medlRolleBadgeLeder: { backgroundColor: uiColor.surfaceHover, borderColor: uiColor.primary },
  medlRolleTxt:     { color: uiColor.textMuted, fontSize: 11, fontWeight: "800" },
  medlRolleTxtLeder:{ color: uiColor.primarySoft },

  forlatKnapp: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 7, marginTop: 14, paddingVertical: uiSpacing.md,
    borderWidth: 1, borderColor: uiColor.danger + uiAlpha.medium,
    borderRadius: uiRadius.md, backgroundColor: uiColor.danger + uiAlpha.soft,
  },
  forlatTxt: { color: uiColor.danger, fontSize: 14, fontWeight: "700" },

  loggUtKnapp: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: uiSpacing.sm, marginTop: uiSpacing.sm, marginBottom: uiSpacing.sm,
    borderWidth: 1, borderColor: uiColor.danger + uiAlpha.medium,
    borderRadius: uiRadius.lg, paddingVertical: uiSpacing.lg,
    backgroundColor: uiColor.danger + uiAlpha.soft,
  },
  loggUtTxt: { color: uiColor.danger, fontSize: 15, fontWeight: "800" },

  jaktlagKnappRad:      { flexDirection: "row", gap: 10, marginTop: 14 },
  jaktlagKnapp:         { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: uiColor.surface, borderWidth: 1, borderColor: uiColor.border, borderRadius: uiRadius.md, paddingVertical: 13 },
  jaktlagKnappTxt:      { color: uiColor.primarySoft, fontSize: 14, fontWeight: "700" },
  jaktlagKnappAlt:      { borderColor: uiColor.borderStrong },
  jaktlagSkjema:        { marginTop: 14 },
  jaktlagSkjemaLabel:   { ...uiType.eyebrow, color: uiColor.textFaint, marginBottom: uiSpacing.sm, marginTop: uiSpacing.xs },
  jaktlagInput:         { backgroundColor: uiColor.surface, borderRadius: uiRadius.md, borderWidth: 1, borderColor: uiColor.border, color: uiColor.textPrimary, fontSize: 16, paddingHorizontal: uiSpacing.lg, paddingVertical: 14 },
  jaktlagFeil:          { color: uiColor.danger, fontSize: 13, marginTop: 6 },
  jaktlagKnappPrimær:   { backgroundColor: uiColor.primary, borderColor: uiColor.primary },
  jaktlagKnappPrimærTxt:{ color: uiColor.primaryText, fontSize: 14, fontWeight: "900" },
});