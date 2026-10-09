import { Ionicons } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomDock from "../components/BottomDock";
import Avatar from "../components/ui/Avatar";
import Surface from "../components/ui/Surface";
import { auth } from "../src/config/firebase";
import {
  color as uiColor,
  radius as uiRadius,
  spacing as uiSpacing,
  typography as uiType,
} from "../src/design/tokens";
import { hentRelativTid } from "../src/lib/aktivitet";
import {
  hentSistLest,
  subscribeToChatMeldinger,
  type ChatMelding,
} from "../src/services/chat";
import { getAktivtJaktlagId } from "../src/services/jaktlag";

const FORHANDSVISNING_MAKS = 110;

function korteMelding(tekst: string): string {
  const trimmet = tekst.trim();
  if (trimmet.length <= FORHANDSVISNING_MAKS) return trimmet;
  return trimmet.slice(0, FORHANDSVISNING_MAKS).trimEnd() + "…";
}

export default function VarslerScreen() {
  const router = useRouter();

  const [laster, setLaster] = useState(true);
  const [jaktlagId, setJaktlagId] = useState<string | null>(null);
  const [meldinger, setMeldinger] = useState<ChatMelding[]>([]);
  const [sistLestMs, setSistLestMs] = useState(0);

  // Hentes som et engangs-øyeblikksbilde ved åpning — varsellisten skal ikke
  // tømme seg selv mens brukeren står og ser på den (det skjer først når
  // chat.tsx selv kaller markerChatSomLest ved faktisk besøk i chatten).
  useEffect(() => {
    let avbrutt = false;
    (async () => {
      setLaster(true);
      const id = await getAktivtJaktlagId();
      if (avbrutt) return;
      setJaktlagId(id);
      if (id) {
        const sistLest = await hentSistLest(id);
        if (!avbrutt) setSistLestMs(sistLest);
      } else {
        setLaster(false);
      }
    })();
    return () => {
      avbrutt = true;
    };
  }, []);

  useEffect(() => {
    if (!jaktlagId) return;
    const unsub = subscribeToChatMeldinger(jaktlagId, (data) => {
      setMeldinger(data);
      setLaster(false);
    });
    return unsub;
  }, [jaktlagId]);

  const egenUid = auth.currentUser?.uid;

  const nyeVarsler = useMemo(() => {
    return meldinger
      .filter((m) => m.senderUid !== egenUid && (m.sendtAtMs ?? 0) > sistLestMs)
      .slice()
      .reverse();
  }, [meldinger, egenUid, sistLestMs]);

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

            <Text style={styles.title}>Varsler</Text>
            <Text style={styles.subtitle}>
              Nye meldinger fra jaktlaget ditt siden sist du åpnet chatten.
            </Text>
          </View>

          {laster ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color={uiColor.primarySoft} />
              <Text style={styles.loadingTitle}>Laster varsler...</Text>
            </View>
          ) : !jaktlagId ? (
            <Surface style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Ionicons name="people-outline" size={22} color={uiColor.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>Ingen jaktlag ennå</Text>
              <Text style={styles.emptyText}>
                Bli med i eller opprett et jaktlag for å få varsler når noen skriver i chatten.
              </Text>
              <Link href="/innstillinger" asChild>
                <Pressable style={styles.emptyLink}>
                  <Text style={styles.emptyLinkTxt}>Gå til innstillinger</Text>
                  <Ionicons name="chevron-forward" size={15} color={uiColor.primarySoft} />
                </Pressable>
              </Link>
            </Surface>
          ) : nyeVarsler.length === 0 ? (
            <Surface style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Ionicons name="notifications-outline" size={22} color={uiColor.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>Ingen nye varsler</Text>
              <Text style={styles.emptyText}>
                Du har fått med deg alt fra jaktlaget. Nye meldinger dukker opp her.
              </Text>
            </Surface>
          ) : (
            <Surface style={styles.listCard}>
              {nyeVarsler.map((m, i) => (
                <Pressable
                  key={m.id}
                  onPress={() => router.push("/chat")}
                  style={[
                    styles.row,
                    i < nyeVarsler.length - 1 && styles.rowDivider,
                  ]}
                >
                  <Avatar navn={m.senderNavn} size={38} />
                  <View style={styles.rowBody}>
                    <View style={styles.rowTop}>
                      <Text style={styles.rowNavn} numberOfLines={1}>
                        {m.senderNavn}
                      </Text>
                      <Text style={styles.rowTid}>
                        {hentRelativTid(new Date(m.sendtAtMs ?? Date.now()).toISOString())}
                      </Text>
                    </View>
                    <Text style={styles.rowPreview} numberOfLines={2}>
                      {korteMelding(m.tekst)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </Surface>
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

  emptyCard: {
    padding: 28,
    alignItems: "center",
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: uiRadius.pill,
    backgroundColor: uiColor.surfaceHover,
    borderWidth: 1,
    borderColor: uiColor.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: uiSpacing.md,
  },
  emptyTitle: {
    color: uiColor.textPrimary,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyText: {
    ...uiType.body,
    color: uiColor.textSecondary,
    marginTop: uiSpacing.sm,
    textAlign: "center",
  },
  emptyLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: uiSpacing.lg,
    paddingTop: uiSpacing.md,
    borderTopWidth: 1,
    borderTopColor: uiColor.border,
    width: "100%",
    justifyContent: "center",
  },
  emptyLinkTxt: {
    color: uiColor.primarySoft,
    fontSize: 14,
    fontWeight: "800",
  },

  listCard: {
    padding: uiSpacing.sm,
    paddingHorizontal: uiSpacing.lg,
    marginBottom: uiSpacing.lg,
  },
  row: {
    flexDirection: "row",
    gap: uiSpacing.md,
    paddingVertical: uiSpacing.md,
    alignItems: "flex-start",
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: uiColor.border,
  },
  rowBody: {
    flex: 1,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: uiSpacing.sm,
  },
  rowNavn: {
    color: uiColor.textPrimary,
    fontSize: 14,
    fontWeight: "800",
    flexShrink: 1,
  },
  rowTid: {
    ...uiType.caption,
    color: uiColor.textFaint,
  },
  rowPreview: {
    ...uiType.body,
    color: uiColor.textSecondary,
    marginTop: 3,
  },
});
