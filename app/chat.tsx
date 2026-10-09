import { Ionicons } from "@expo/vector-icons";
import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Avatar from "../components/ui/Avatar";
import { auth } from "../src/config/firebase";
import {
  alpha,
  color as uiColor,
  radius as uiRadius,
  spacing as uiSpacing,
  typography as uiType,
} from "../src/design/tokens";
import { hentRelativTid } from "../src/lib/aktivitet";
import {
  markerChatSomLest,
  sendChatMelding,
  subscribeToChatMeldinger,
  type ChatMelding,
} from "../src/services/chat";
import { getAktivtJaktlagId, hentJaktlag, type Jaktlag } from "../src/services/jaktlag";
import { hentMinProfil } from "../src/services/profile";

export default function ChatScreen() {
  const router = useRouter();

  const [laster, setLaster] = useState(true);
  const [jaktlagId, setJaktlagId] = useState<string | null>(null);
  const [jaktlag, setJaktlag] = useState<Jaktlag | null>(null);
  const [meldinger, setMeldinger] = useState<ChatMelding[]>([]);
  const [visningsnavn, setVisningsnavn] = useState("");

  const [tekst, setTekst] = useState("");
  const [sender, setSender] = useState(false);
  const [feil, setFeil] = useState("");

  const egenUid = auth.currentUser?.uid;
  // Sporer forrige antall meldinger slik at "sist lest" kun oppdateres på
  // nytt når det faktisk kommer en NY melding mens skjermen er åpen (§4),
  // ikke ved hver eneste snapshot (som ville vært et unødvendig AsyncStorage-
  // skriv per render).
  const forrigeAntall = useRef<number>(-1);

  useFocusEffect(
    useCallback(() => {
      let aktiv = true;
      let unsub: (() => void) | undefined;
      forrigeAntall.current = -1;

      (async () => {
        try {
          setLaster(true);
          setFeil("");
          const id = await getAktivtJaktlagId();
          if (!aktiv) return;
          setJaktlagId(id);

          if (!id) {
            setLaster(false);
            return;
          }

          const [jl, profil] = await Promise.all([hentJaktlag(id), hentMinProfil()]);
          if (!aktiv) return;
          setJaktlag(jl);
          setVisningsnavn(profil.displayName);

          await markerChatSomLest(id);
          if (!aktiv) return;

          unsub = subscribeToChatMeldinger(id, (liste) => {
            if (!aktiv) return;
            setMeldinger(liste);
            setLaster(false);

            if (forrigeAntall.current !== -1 && liste.length > forrigeAntall.current) {
              markerChatSomLest(id).catch(() => {});
            }
            forrigeAntall.current = liste.length;
          });
        } catch (e: any) {
          if (!aktiv) return;
          setFeil(e?.message || "Klarte ikke laste chat.");
          setLaster(false);
        }
      })();

      return () => {
        aktiv = false;
        unsub?.();
      };
    }, [])
  );

  async function handterSend() {
    const trimmet = tekst.trim();
    if (!trimmet || !jaktlagId || sender) return;

    setSender(true);
    setFeil("");
    try {
      await sendChatMelding(jaktlagId, trimmet, visningsnavn || "Jeger");
      setTekst("");
    } catch (e: any) {
      setFeil(e?.message || "Klarte ikke sende meldingen. Prøv igjen.");
    } finally {
      setSender(false);
    }
  }

  const inverterteMeldinger = [...meldinger].reverse();

  function renderMelding({ item }: { item: ChatMelding }) {
    const erEgen = item.senderUid === egenUid;
    const tidTekst = item.sendtAtMs != null
      ? hentRelativTid(new Date(item.sendtAtMs).toISOString())
      : "Sender...";

    return (
      <View style={[styles.msgRow, erEgen && styles.msgRowOwn]}>
        {!erEgen && (
          <View style={styles.msgAvatar}>
            <Avatar navn={item.senderNavn} size={28} />
          </View>
        )}
        <View style={[styles.bubbleCol, erEgen && styles.bubbleColOwn]}>
          {!erEgen && <Text style={styles.senderNavn}>{item.senderNavn}</Text>}
          <View style={[styles.bubble, erEgen ? styles.bubbleOwn : styles.bubbleOther]}>
            <Text style={[styles.bubbleText, erEgen && styles.bubbleTextOwn]}>{item.tekst}</Text>
          </View>
          <Text style={[styles.tidTekst, erEgen && styles.tidTekstOwn]}>{tidTekst}</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={20} color={uiColor.textPrimary} />
          </Pressable>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>Chat</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {jaktlag ? jaktlag.navn : "Jaktlaget ditt"}
            </Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        {/* ── Innhold ── */}
        <View style={styles.body}>
          {laster ? (
            <View style={styles.centerWrap}>
              <ActivityIndicator size="large" color={uiColor.primarySoft} />
              <Text style={styles.loadingText}>Laster chat...</Text>
            </View>
          ) : !jaktlagId ? (
            <View style={styles.centerWrap}>
              <Ionicons name="people-outline" size={36} color={uiColor.borderStrong} />
              <Text style={styles.emptyTitle}>Du er ikke med i et jaktlag ennå</Text>
              <Text style={styles.emptyText}>
                Chat er delt med hele jaktlaget ditt. Opprett eller bli med i et jaktlag under
                Innstillinger for å komme i gang.
              </Text>
              <Link href="/innstillinger" asChild>
                <Pressable style={styles.emptyBtn}>
                  <Ionicons name="settings-outline" size={16} color={uiColor.primaryText} />
                  <Text style={styles.emptyBtnText}>Gå til innstillinger</Text>
                </Pressable>
              </Link>
            </View>
          ) : meldinger.length === 0 ? (
            <View style={styles.centerWrap}>
              <Ionicons name="chatbubble-ellipses-outline" size={36} color={uiColor.borderStrong} />
              <Text style={styles.emptyTitle}>Ingen meldinger ennå</Text>
              <Text style={styles.emptyText}>Si hei til laget ditt!</Text>
            </View>
          ) : (
            <FlatList
              data={inverterteMeldinger}
              keyExtractor={(item) => item.id}
              renderItem={renderMelding}
              inverted
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>

        {!!feil && (
          <View style={styles.feilBoks}>
            <Ionicons name="warning-outline" size={14} color={uiColor.danger} />
            <Text style={styles.feilText}>{feil}</Text>
          </View>
        )}

        {/* ── Inntastingsrad ── */}
        {!!jaktlagId && (
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={tekst}
              onChangeText={setTekst}
              placeholder="Skriv en melding..."
              placeholderTextColor={uiColor.textFaint}
              multiline
              maxLength={1000}
            />
            <Pressable
              testID="chat-send-knapp"
              onPress={handterSend}
              disabled={!tekst.trim() || sender}
              style={[styles.sendBtn, (!tekst.trim() || sender) && styles.sendBtnDisabled]}
            >
              {sender ? (
                <ActivityIndicator size="small" color={uiColor.primaryText} />
              ) : (
                <Ionicons name="send" size={17} color={uiColor.primaryText} />
              )}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: uiColor.background },
  screen: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: uiSpacing.lg,
    paddingVertical: uiSpacing.md,
    borderBottomWidth: 1,
    borderBottomColor: uiColor.border,
    gap: uiSpacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: uiColor.surface,
    borderWidth: 1,
    borderColor: uiColor.border,
  },
  headerTextWrap: { flex: 1 },
  headerTitle: { ...uiType.sectionTitle, color: uiColor.textPrimary, fontSize: 18 },
  headerSubtitle: { ...uiType.caption, color: uiColor.textMuted, marginTop: 2 },
  headerSpacer: { width: 40 },

  body: { flex: 1 },

  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: uiSpacing.xxl,
  },
  loadingText: { ...uiType.body, color: uiColor.textMuted, marginTop: uiSpacing.md },
  emptyTitle: {
    ...uiType.sectionTitle,
    color: uiColor.textPrimary,
    marginTop: uiSpacing.md,
    textAlign: "center",
  },
  emptyText: {
    ...uiType.body,
    color: uiColor.textMuted,
    marginTop: uiSpacing.sm,
    textAlign: "center",
  },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: uiSpacing.sm,
    backgroundColor: uiColor.primary,
    borderRadius: uiRadius.pill,
    paddingHorizontal: uiSpacing.xl,
    paddingVertical: uiSpacing.md,
    marginTop: uiSpacing.xl,
  },
  emptyBtnText: { color: uiColor.primaryText, fontSize: 14, fontWeight: "900" },

  listContent: {
    paddingHorizontal: uiSpacing.lg,
    paddingVertical: uiSpacing.md,
  },

  msgRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: uiSpacing.sm,
    marginBottom: uiSpacing.md,
    maxWidth: "100%",
  },
  msgRowOwn: { justifyContent: "flex-end" },
  msgAvatar: { marginBottom: 2 },

  bubbleCol: { maxWidth: "78%", alignItems: "flex-start" },
  bubbleColOwn: { alignItems: "flex-end" },

  senderNavn: {
    ...uiType.caption,
    color: uiColor.textMuted,
    marginBottom: 4,
    marginLeft: 2,
  },

  bubble: {
    borderRadius: uiRadius.lg,
    paddingHorizontal: uiSpacing.md + 2,
    paddingVertical: uiSpacing.sm + 2,
  },
  bubbleOther: {
    backgroundColor: uiColor.surface,
    borderWidth: 1,
    borderColor: uiColor.border,
    borderBottomLeftRadius: uiRadius.sm,
  },
  bubbleOwn: {
    backgroundColor: uiColor.primary,
    borderBottomRightRadius: uiRadius.sm,
  },
  bubbleText: { ...uiType.body, color: uiColor.textPrimary },
  bubbleTextOwn: { color: uiColor.primaryText },

  tidTekst: {
    ...uiType.caption,
    color: uiColor.textFaint,
    marginTop: 4,
    marginLeft: 2,
  },
  tidTekstOwn: { marginLeft: 0, marginRight: 2 },

  feilBoks: {
    flexDirection: "row",
    alignItems: "center",
    gap: uiSpacing.sm,
    marginHorizontal: uiSpacing.lg,
    marginBottom: uiSpacing.sm,
    paddingHorizontal: uiSpacing.md,
    paddingVertical: uiSpacing.sm + 2,
    borderRadius: uiRadius.md,
    backgroundColor: uiColor.danger + alpha.soft,
    borderWidth: 1,
    borderColor: uiColor.danger + alpha.medium,
  },
  feilText: { color: uiColor.danger, fontSize: 13, fontWeight: "700", flex: 1 },

  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: uiSpacing.sm,
    paddingHorizontal: uiSpacing.lg,
    paddingVertical: uiSpacing.md,
    borderTopWidth: 1,
    borderTopColor: uiColor.border,
    backgroundColor: uiColor.background,
  },
  input: {
    flex: 1,
    backgroundColor: uiColor.surface,
    borderWidth: 1,
    borderColor: uiColor.border,
    borderRadius: uiRadius.lg,
    paddingHorizontal: uiSpacing.md + 2,
    paddingVertical: uiSpacing.sm + 4,
    color: uiColor.textPrimary,
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: uiColor.primary,
  },
  sendBtnDisabled: { opacity: 0.4 },
});
