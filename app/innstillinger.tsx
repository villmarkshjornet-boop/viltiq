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
import { color as uiColor, radius as uiRadius } from "../src/design/tokens";
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
                <View style={styles.heroGlow} />

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
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 162,
  },
  header: {
    marginTop: 6,
    marginBottom: 18,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 14,
  },
  backText: { color: uiColor.primarySoft, fontSize: 15, fontWeight: "700" },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: uiRadius.pill,
    backgroundColor: uiColor.primary,
    shadowColor: uiColor.primary,
    shadowOpacity: 0.45,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
  },
  brandText: {
    color: uiColor.textMuted,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.15,
    textTransform: "uppercase",
  },
  title: {
    color: uiColor.textPrimary,
    fontSize: 35,
    fontWeight: "900",
  },
  subtitle: {
    color: uiColor.textSecondary,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 8,
    maxWidth: "94%",
  },
  loadingCard: {
    backgroundColor: uiColor.surface,
    borderWidth: 1,
    borderColor: uiColor.border,
    borderRadius: 24,
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
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#102018",
    borderWidth: 1,
    borderColor: uiColor.borderStrong,
    borderRadius: 30,
    padding: 20,
    marginBottom: 16,
  },
  heroGlow: {
    position: "absolute",
    right: -40,
    top: -45,
    width: 160,
    height: 160,
    borderRadius: uiRadius.pill,
    backgroundColor: "rgba(124,255,178,0.10)",
  },
  heroTop: {
    flexDirection: "row",
    gap: 14,
    alignItems: "flex-start",
  },
  heroIcon: {
    width: 50,
    height: 50,
    borderRadius: 20,
    backgroundColor: "#183225",
    borderWidth: 1,
    borderColor: uiColor.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTextWrap: {
    flex: 1,
  },
  heroEyebrow: {
    color: uiColor.textMuted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  heroTitle: {
    color: uiColor.textPrimary,
    fontSize: 36,
    fontWeight: "900",
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
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    borderRadius: uiRadius.lg,
    padding: 14,
  },
  heroStatValue: {
    color: uiColor.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  heroStatLabel: {
    color: uiColor.textMuted,
    fontSize: 12,
    marginTop: 4,
    fontWeight: "700",
  },
  card: {
    backgroundColor: uiColor.surface,
    borderWidth: 1,
    borderColor: uiColor.border,
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  cardEyebrow: {
    color: uiColor.textMuted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    marginBottom: 5,
  },
  cardTitle: {
    color: uiColor.textPrimary,
    fontSize: 19,
    fontWeight: "900",
  },
  cardText: {
    color: uiColor.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  miniBadge: {
    backgroundColor: uiColor.surfaceHover,
    borderWidth: 1,
    borderColor: uiColor.borderStrong,
    borderRadius: uiRadius.pill,
    paddingHorizontal: 12,
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
    borderColor: "rgba(255,255,255,0.06)",
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
    backgroundColor: "#13261D",
    borderWidth: 1,
    borderColor: uiColor.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  statusLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
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
    gap: 12,
    backgroundColor: uiColor.surface,
    borderWidth: 1,
    borderColor: "rgba(110,231,183,0.12)",
    borderRadius: uiRadius.xl,
    padding: 18,
    marginBottom: 16,
  },
  infoTitle: {
    color: uiColor.textPrimary,
    fontSize: 16,
    fontWeight: "900",
  },
  infoText: {
    color: uiColor.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
  },
  messageBox: {
    borderRadius: 16,
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
    backgroundColor: "rgba(34,197,94,0.10)",
    borderColor: "rgba(34,197,94,0.18)",
  },
  messageSuccessText: {
    color: uiColor.primarySoft,
  },
  messageError: {
    backgroundColor: "rgba(239,68,68,0.10)",
    borderColor: "rgba(239,68,68,0.18)",
  },
  messageErrorText: {
    color: uiColor.danger,
  },
  messageInfo: {
    backgroundColor: "rgba(148,163,184,0.10)",
    borderColor: "rgba(148,163,184,0.18)",
  },
  messageInfoText: {
    color: "#CBD5E1",
  },
  savingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
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
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)",
  },
  kodeLabel: { color: uiColor.textMuted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  kodeTekst: { color: uiColor.primarySoft, fontSize: 22, fontWeight: "900", letterSpacing: 3 },
  kodeHint:  { color: uiColor.textFaint, fontSize: 12, fontWeight: "600" },

  medlSection: {
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)",
  },
  medlHeader:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  medlHeaderTxt: { color: uiColor.textMuted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  medlBadge: {
    backgroundColor: "rgba(44,195,107,0.12)",
    borderRadius: uiRadius.pill, paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: "rgba(44,195,107,0.2)",
  },
  medlBadgeTxt: { color: uiColor.primary, fontSize: 11, fontWeight: "900" },
  medlRad: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.04)",
  },
  medlAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: uiColor.surfaceHover, borderWidth: 1, borderColor: uiColor.borderStrong,
    alignItems: "center", justifyContent: "center",
  },
  medlAvatarTxt:    { color: uiColor.primary, fontSize: 13, fontWeight: "900" },
  medlEpost:        { color: uiColor.textSecondary, fontSize: 13, flex: 1 },
  medlRolleBadge:   { backgroundColor: uiColor.surface, borderRadius: uiRadius.pill, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: uiColor.border },
  medlRolleBadgeLeder: { backgroundColor: uiColor.surfaceHover, borderColor: uiColor.primary },
  medlRolleTxt:     { color: uiColor.textMuted, fontSize: 11, fontWeight: "800" },
  medlRolleTxtLeder:{ color: uiColor.primarySoft },

  forlatKnapp: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 7, marginTop: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: "rgba(248,113,113,0.18)",
    borderRadius: uiRadius.md, backgroundColor: "rgba(248,113,113,0.06)",
  },
  forlatTxt: { color: uiColor.danger, fontSize: 14, fontWeight: "700" },

  loggUtKnapp: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, marginTop: 8, marginBottom: 8,
    borderWidth: 1, borderColor: "rgba(248,113,113,0.2)",
    borderRadius: uiRadius.lg, paddingVertical: 16,
    backgroundColor: "rgba(248,113,113,0.06)",
  },
  loggUtTxt: { color: uiColor.danger, fontSize: 15, fontWeight: "800" },

  jaktlagKnappRad:      { flexDirection: "row", gap: 10, marginTop: 14 },
  jaktlagKnapp:         { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: uiColor.surface, borderWidth: 1, borderColor: uiColor.border, borderRadius: uiRadius.md, paddingVertical: 13 },
  jaktlagKnappTxt:      { color: uiColor.primarySoft, fontSize: 14, fontWeight: "700" },
  jaktlagKnappAlt:      { borderColor: uiColor.borderStrong },
  jaktlagSkjema:        { marginTop: 14 },
  jaktlagSkjemaLabel:   { color: uiColor.textFaint, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  jaktlagInput:         { backgroundColor: uiColor.surface, borderRadius: uiRadius.md, borderWidth: 1, borderColor: uiColor.border, color: uiColor.textPrimary, fontSize: 16, paddingHorizontal: 16, paddingVertical: 14 },
  jaktlagFeil:          { color: uiColor.danger, fontSize: 13, marginTop: 6 },
  jaktlagKnappPrimær:   { backgroundColor: uiColor.primary, borderColor: uiColor.primary },
  jaktlagKnappPrimærTxt:{ color: "#060E08", fontSize: 14, fontWeight: "900" },
});