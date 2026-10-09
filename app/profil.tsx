import { Ionicons } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomDock from "../components/BottomDock";
import Avatar from "../components/ui/Avatar";
import Badge from "../components/ui/Badge";
import ListRow from "../components/ui/ListRow";
import Surface from "../components/ui/Surface";
import { auth } from "../src/config/firebase";
import {
  alpha as uiAlpha,
  color as uiColor,
  radius as uiRadius,
  spacing as uiSpacing,
  typography as uiType,
} from "../src/design/tokens";
import { visAlert } from "../src/lib/confirmAlert";
import { loggUt } from "../src/services/auth";
import {
  clearAktivtJaktlagId,
  getAktivtJaktlagId,
  hentJaktlag,
  subscribeMedlemmer,
  type Jaktlag,
  type Medlem,
} from "../src/services/jaktlag";
import { oppdaterDisplayName, subscribeToMinProfil, type MinProfil } from "../src/services/profile";

export default function ProfilScreen() {
  const router = useRouter();

  const [profil, setProfil] = useState<MinProfil | null>(null);
  const [lasterProfil, setLasterProfil] = useState(true);

  const [redigererNavn, setRedigererNavn] = useState(false);
  const [navnInput, setNavnInput] = useState("");
  const [lagrerNavn, setLagrerNavn] = useState(false);
  const [navnFeil, setNavnFeil] = useState("");

  const [jaktlagId, setJaktlagId] = useState<string | null>(null);
  const [jaktlag, setJaktlag] = useState<Jaktlag | null>(null);
  const [lasterJaktlag, setLasterJaktlag] = useState(true);
  const [medlemmer, setMedlemmer] = useState<Medlem[]>([]);

  // Live profil — navnet kan endres fra andre enheter, og skal oppdatere
  // seg selv med det samme her uten en manuell refetch.
  useEffect(() => {
    if (!auth.currentUser) {
      setLasterProfil(false);
      return;
    }
    const unsub = subscribeToMinProfil((p) => {
      setProfil(p);
      setLasterProfil(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    let avbrutt = false;
    (async () => {
      setLasterJaktlag(true);
      const id = await getAktivtJaktlagId();
      if (avbrutt) return;
      setJaktlagId(id);
      if (id) {
        const jl = await hentJaktlag(id);
        if (!avbrutt) setJaktlag(jl);
      } else {
        setJaktlag(null);
      }
      if (!avbrutt) setLasterJaktlag(false);
    })();
    return () => {
      avbrutt = true;
    };
  }, []);

  useEffect(() => {
    if (!jaktlagId) {
      setMedlemmer([]);
      return;
    }
    return subscribeMedlemmer(jaktlagId, setMedlemmer);
  }, [jaktlagId]);

  function startRedigerNavn() {
    setNavnInput(profil?.displayName ?? "");
    setNavnFeil("");
    setRedigererNavn(true);
  }

  function avbrytRedigerNavn() {
    setRedigererNavn(false);
    setNavnFeil("");
  }

  async function lagreNavn() {
    if (!navnInput.trim()) {
      setNavnFeil("Navnet kan ikke være tomt.");
      return;
    }
    setLagrerNavn(true);
    setNavnFeil("");
    try {
      await oppdaterDisplayName(navnInput.trim());
      setRedigererNavn(false);
    } catch (e: any) {
      setNavnFeil(e?.message || "Klarte ikke lagre navnet.");
    } finally {
      setLagrerNavn(false);
    }
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

  const egenUid = auth.currentUser?.uid;
  const erLeder = !!jaktlag && !!egenUid && jaktlag.lederUid === egenUid;

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

            <Text style={styles.title}>Profil</Text>
            <Text style={styles.subtitle}>
              Navnet og jaktlaget ditt, samlet på ett sted.
            </Text>
          </View>

          {lasterProfil ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color={uiColor.primarySoft} />
              <Text style={styles.loadingTitle}>Laster profil...</Text>
            </View>
          ) : (
            <>
              {/* ── Profilhode ── */}
              <Surface variant="elevated" style={styles.profileCard}>
                <View style={styles.profileTop}>
                  <Avatar navn={profil?.displayName ?? ""} size={64} />

                  <View style={styles.profileInfo}>
                    {redigererNavn ? (
                      <View>
                        <TextInput
                          style={styles.navnInput}
                          value={navnInput}
                          onChangeText={setNavnInput}
                          placeholder="Ditt navn"
                          placeholderTextColor={uiColor.textFaint}
                          autoFocus
                          maxLength={40}
                        />
                        {!!navnFeil && <Text style={styles.navnFeil}>{navnFeil}</Text>}
                        <View style={styles.navnKnappRad}>
                          <Pressable
                            style={styles.navnKnapp}
                            onPress={avbrytRedigerNavn}
                            disabled={lagrerNavn}
                          >
                            <Text style={styles.navnKnappTxt}>Avbryt</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.navnKnapp, styles.navnKnappPrimær, lagrerNavn && styles.disabled]}
                            onPress={lagreNavn}
                            disabled={lagrerNavn}
                          >
                            {lagrerNavn ? (
                              <ActivityIndicator size="small" color={uiColor.primaryText} />
                            ) : (
                              <Text style={styles.navnKnappPrimærTxt}>Lagre</Text>
                            )}
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <>
                        <View style={styles.navnRad}>
                          <Text style={styles.navnTxt} numberOfLines={1}>
                            {profil?.displayName || "Jeger"}
                          </Text>
                          <Pressable onPress={startRedigerNavn} hitSlop={10} style={styles.editIconBtn}>
                            <Ionicons name="pencil" size={13} color={uiColor.primarySoft} />
                          </Pressable>
                        </View>
                        <Text style={styles.epostTxt} numberOfLines={1}>
                          {profil?.epost}
                        </Text>
                      </>
                    )}
                  </View>
                </View>

                {!redigererNavn && (
                  <Text style={styles.navnCaption}>
                    Dette navnet vises til resten av jaktlaget ditt i chat og medlemslister.
                  </Text>
                )}
              </Surface>

              {/* ── Jaktlag ── */}
              <Surface style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardEyebrow}>Jaktlag</Text>
                    <Text style={styles.cardTitle}>
                      {lasterJaktlag ? "Laster..." : jaktlag ? jaktlag.navn : "Ingen aktivt jaktlag"}
                    </Text>
                  </View>
                  {jaktlag && (
                    <Badge
                      label={erLeder ? "Leder" : "Jeger"}
                      color={erLeder ? uiColor.primary : uiColor.info}
                      size="sm"
                    />
                  )}
                </View>

                {!lasterJaktlag && jaktlag && (
                  <>
                    <View style={styles.statsRow}>
                      <View style={styles.statBox}>
                        <Text style={styles.statValue}>{medlemmer.length}</Text>
                        <Text style={styles.statLabel}>
                          {medlemmer.length === 1 ? "medlem" : "medlemmer"}
                        </Text>
                      </View>
                      <View style={styles.statBox}>
                        <Text style={styles.statValueKode}>{jaktlag.invitKode}</Text>
                        <Text style={styles.statLabel}>invitasjonskode</Text>
                      </View>
                    </View>

                    <Link href="/innstillinger" asChild>
                      <Pressable style={styles.linkRow}>
                        <Text style={styles.linkTxt}>Administrer jaktlag</Text>
                        <Ionicons name="chevron-forward" size={16} color={uiColor.primarySoft} />
                      </Pressable>
                    </Link>
                  </>
                )}

                {!lasterJaktlag && !jaktlag && (
                  <>
                    <Text style={styles.cardText}>
                      Du er ikke med i noe jaktlag ennå. Opprett et nytt lag eller bli med i et
                      eksisterende for å dele observasjoner og chatte med de andre.
                    </Text>
                    <Link href="/innstillinger" asChild>
                      <Pressable style={styles.linkRow}>
                        <Text style={styles.linkTxt}>Opprett eller bli med i jaktlag</Text>
                        <Ionicons name="chevron-forward" size={16} color={uiColor.primarySoft} />
                      </Pressable>
                    </Link>
                  </>
                )}
              </Surface>

              {/* ── Snarveier ── */}
              <Surface style={styles.linksCard}>
                <ListRow
                  icon="settings-outline"
                  title="Innstillinger"
                  subtitle="Radius, pushvarsler og jaktlag"
                  onPress={() => router.push("/innstillinger")}
                />
                <ListRow
                  icon="trophy-outline"
                  title="Jakt"
                  subtitle="Fellinger og kvoter"
                  onPress={() => router.push("/jakt")}
                />
                <ListRow
                  icon="stats-chart-outline"
                  title="Statistikk"
                  subtitle="Aktivitet og trender"
                  onPress={() => router.push("/statistikk")}
                  divider={false}
                />
              </Surface>

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

  profileCard: {
    padding: uiSpacing.xl,
    marginBottom: uiSpacing.lg,
  },
  profileTop: {
    flexDirection: "row",
    gap: uiSpacing.lg,
    alignItems: "center",
  },
  profileInfo: {
    flex: 1,
  },
  navnRad: {
    flexDirection: "row",
    alignItems: "center",
    gap: uiSpacing.sm,
  },
  navnTxt: {
    color: uiColor.textPrimary,
    fontSize: 21,
    fontWeight: "900",
    flexShrink: 1,
  },
  editIconBtn: {
    width: 26,
    height: 26,
    borderRadius: uiRadius.pill,
    backgroundColor: uiColor.surfaceHover,
    borderWidth: 1,
    borderColor: uiColor.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  epostTxt: {
    color: uiColor.textSecondary,
    fontSize: 14,
    marginTop: 4,
  },
  navnCaption: {
    ...uiType.caption,
    color: uiColor.textMuted,
    marginTop: uiSpacing.md,
    paddingTop: uiSpacing.md,
    borderTopWidth: 1,
    borderTopColor: uiColor.border,
    lineHeight: 16,
  },
  navnInput: {
    backgroundColor: uiColor.surface,
    borderRadius: uiRadius.md,
    borderWidth: 1,
    borderColor: uiColor.borderStrong,
    color: uiColor.textPrimary,
    fontSize: 17,
    fontWeight: "800",
    paddingHorizontal: uiSpacing.md,
    paddingVertical: 10,
  },
  navnFeil: {
    color: uiColor.danger,
    fontSize: 12,
    marginTop: 6,
  },
  navnKnappRad: {
    flexDirection: "row",
    gap: uiSpacing.sm,
    marginTop: uiSpacing.sm,
  },
  navnKnapp: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: uiColor.surface,
    borderWidth: 1,
    borderColor: uiColor.border,
    borderRadius: uiRadius.md,
  },
  navnKnappTxt: {
    color: uiColor.primarySoft,
    fontSize: 13,
    fontWeight: "700",
  },
  navnKnappPrimær: {
    backgroundColor: uiColor.primary,
    borderColor: uiColor.primary,
  },
  navnKnappPrimærTxt: {
    color: uiColor.primaryText,
    fontSize: 13,
    fontWeight: "900",
  },
  disabled: { opacity: 0.6 },

  card: {
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
  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: uiSpacing.lg,
  },
  statBox: {
    flex: 1,
    backgroundColor: uiColor.surfaceHover,
    borderWidth: 1,
    borderColor: uiColor.border,
    borderRadius: uiRadius.lg,
    padding: 14,
  },
  statValue: {
    color: uiColor.textPrimary,
    fontSize: 20,
    fontWeight: "900",
  },
  statValueKode: {
    color: uiColor.primarySoft,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 2,
  },
  statLabel: {
    ...uiType.metadata,
    color: uiColor.textMuted,
    marginTop: 4,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: uiSpacing.lg,
    paddingTop: uiSpacing.md,
    borderTopWidth: 1,
    borderTopColor: uiColor.border,
  },
  linkTxt: {
    color: uiColor.primarySoft,
    fontSize: 14,
    fontWeight: "800",
  },

  linksCard: {
    padding: uiSpacing.md,
    paddingHorizontal: uiSpacing.lg,
    marginBottom: uiSpacing.lg,
  },

  loggUtKnapp: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: uiSpacing.sm,
    marginTop: uiSpacing.sm,
    marginBottom: uiSpacing.sm,
    borderWidth: 1,
    borderColor: uiColor.danger + uiAlpha.medium,
    borderRadius: uiRadius.lg,
    paddingVertical: uiSpacing.lg,
    backgroundColor: uiColor.danger + uiAlpha.soft,
  },
  loggUtTxt: { color: uiColor.danger, fontSize: 15, fontWeight: "800" },
});
