import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ModalSheet from "../components/ui/ModalSheet";
import {
  color as uiColor,
  heat as uiHeat,
  radius as uiRadius,
  spacing as uiSpacing,
  typography as uiType,
} from "../src/design/tokens";
import { loggInn, registrer } from "../src/services/auth";

type AuthModus = "logginn" | "registrer";

const PERSONVERN_TEKST = `Personvernerklæring for ViltIQ
Versjon 1.0 — 2026

Hva vi samler inn
• E-postadresse, brukt til pålogging og identifikasjon i jaktlag.
• GPS-posisjon, anonymisert med ±200 m tilfeldig avvik før lagring.
• Jaktdata: observasjoner, fellinger og kamera-plasseringer.
• Live-posisjon deles med jaktlag-medlemmer og slettes automatisk etter 4 timer.

Hvorfor vi samler det inn
Dataene brukes til å vise aktivitet i jaktterrenget og koordinere jaktlaget ditt. Vi selger eller deler aldri dine data med tredjeparter for kommersielle formål.

Hvem ser dataene
• Observasjoner i offentlig modus: alle innloggede brukere.
• Observasjoner i jaktlag-modus: kun medlemmer av ditt jaktlag.
• Fellinger og kvoter: kun jaktlag-medlemmer.
• Din live-posisjon: kun jaktlag-medlemmer, siste 4 timer.

Lagring og sletting
Data lagres i Google Firebase (region europe-west). Du kan når som helst slette dine egne observasjoner og fellinger fra appen. For full sletting av kontoen, send en e-post til personvern@viltiq.no.

Dine rettigheter (GDPR)
Du har rett til innsyn, retting og sletting av dine personopplysninger. Ta kontakt på personvern@viltiq.no.

Samtykke
Ved å opprette konto samtykker du til at ViltIQ behandler dine opplysninger som beskrevet over. Du kan trekke samtykket tilbake ved å slette kontoen din.`;

export default function OnboardingScreen() {
  const router = useRouter();

  const [authModus,  setAuthModus]  = useState<AuthModus>("logginn");
  const [epost,      setEpost]      = useState("");
  const [passord,    setPassord]    = useState("");
  const [laster,     setLaster]     = useState(false);
  const [feil,       setFeil]       = useState("");
  const [samtykke,   setSamtykke]   = useState(false);
  const [visPersonvern, setVisPersonvern] = useState(false);

  async function handterAuth() {
    if (!epost.trim())       { setFeil("Fyll inn e-post."); return; }
    if (passord.length < 6)  { setFeil("Passordet må være minst 6 tegn."); return; }
    if (authModus === "registrer" && !samtykke) {
      setFeil("Du må godta personvernerklæringen for å opprette konto.");
      return;
    }
    setFeil("");
    setLaster(true);
    try {
      if (authModus === "registrer") {
        await registrer(epost.trim().toLowerCase(), passord);
      } else {
        await loggInn(epost.trim().toLowerCase(), passord);
      }
      router.replace("/");
    } catch (e: any) {
      console.error("Auth-feil:", e?.code, e?.message);
      setFeil(tolkFeil(e?.code, e?.message));
    } finally {
      setLaster(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo — svak, rolig glød bak merket (samme teknikk som hero-kortet
              på Hjem, §12/§13: ALDRI en heldekket farget boks, kun en dempet
              aura). Gir det aller første skjermbildet et rolig merkevare-øyeblikk
              uten å bikke over i noe markedsførings-aktig. */}
          <View style={s.logoGlowWrap}>
            <LinearGradient
              colors={uiHeat.glowLow}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="none"
            />
            <View style={s.logoWrap}>
              <View style={s.logoDot} />
              <Text style={s.logoText}>ViltIQ</Text>
            </View>
          </View>

          <Text style={s.tittel}>Kom i gang</Text>
          <Text style={s.sub}>
            {authModus === "logginn"
              ? "Logg inn for å fortsette."
              : "Opprett en konto for å komme i gang."}
          </Text>

          {/* Tabs */}
          <View style={s.modusRad}>
            <Pressable
              style={[s.modusKnapp, authModus === "logginn" && s.modusKnappActive]}
              onPress={() => { setAuthModus("logginn"); setFeil(""); }}
            >
              <Text style={[s.modusTxt, authModus === "logginn" && s.modusTxtActive]}>
                Logg inn
              </Text>
            </Pressable>
            <Pressable
              style={[s.modusKnapp, authModus === "registrer" && s.modusKnappActive]}
              onPress={() => { setAuthModus("registrer"); setFeil(""); }}
            >
              <Text style={[s.modusTxt, authModus === "registrer" && s.modusTxtActive]}>
                Ny konto
              </Text>
            </Pressable>
          </View>

          {/* Skjema */}
          <View style={s.kortWrap}>
            <Text style={s.label}>E-post</Text>
            <TextInput
              style={s.input}
              value={epost}
              onChangeText={setEpost}
              placeholder="jeger@jaktlag.no"
              placeholderTextColor={uiColor.textFaint}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
            />

            <Text style={s.label}>Passord</Text>
            <TextInput
              style={s.input}
              value={passord}
              onChangeText={setPassord}
              placeholder="Minst 6 tegn"
              placeholderTextColor={uiColor.textFaint}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handterAuth}
            />

            {/* Samtykke — kun ved registrering */}
            {authModus === "registrer" && (
              <Pressable
                style={s.samtykkeRad}
                onPress={() => setSamtykke((v) => !v)}
              >
                <View style={[s.checkbox, samtykke && s.checkboxChecked]}>
                  {samtykke && <Ionicons name="checkmark" size={13} color={uiColor.primaryText} />}
                </View>
                <Text style={s.samtykkeTxt}>
                  Jeg godtar{" "}
                  <Text
                    style={s.personvernLink}
                    onPress={(e) => { e.stopPropagation(); setVisPersonvern(true); }}
                  >
                    personvernerklæringen
                  </Text>
                </Text>
              </Pressable>
            )}

            {!!feil && (
              <View style={s.feilBoks}>
                <Ionicons name="warning-outline" size={15} color={uiColor.danger} />
                <Text style={s.feilTxt}>{feil}</Text>
              </View>
            )}

            <Pressable
              style={[
                s.primærKnapp,
                (laster || (authModus === "registrer" && !samtykke)) && s.primærKnappDis,
              ]}
              onPress={handterAuth}
              disabled={laster}
            >
              {laster
                ? <ActivityIndicator color={uiColor.primaryText} />
                : <Text style={s.primærTxt}>
                    {authModus === "logginn" ? "Logg inn" : "Opprett konto"}
                  </Text>
              }
            </Pressable>
          </View>

          {/* Info */}
          <View style={s.infoWrap}>
            <Ionicons name="people-outline" size={16} color={uiColor.textFaint} />
            <Text style={s.infoTxt}>
              Jaktlag kan opprettes eller bli med i etter innlogging — under Innstillinger.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Personvern-modal — migrert til delt ModalSheet-primitiv (§31), samme
          lukk-semantikk som før: X-knapp lukker uten samtykke, "Godta og
          lukk" setter samtykke=true OG lukker. ModalSheet legger i tillegg
          til trykk-utenfor-for-å-lukke, i tråd med resten av appens allerede
          migrerte modaler (logg.tsx, jakt.tsx). */}
      <ModalSheet visible={visPersonvern} onClose={() => setVisPersonvern(false)}>
        <View style={s.modalTopp}>
          <Text style={s.modalTittel}>Personvernerklæring</Text>
          <Pressable onPress={() => setVisPersonvern(false)} style={s.lukkKnapp} hitSlop={8}>
            <Ionicons name="close" size={18} color={uiColor.textMuted} />
          </Pressable>
        </View>
        <ScrollView style={s.modalScroll} showsVerticalScrollIndicator={false}>
          <Text style={s.modalTekst}>{PERSONVERN_TEKST}</Text>
        </ScrollView>
        <Pressable
          style={s.modalGodtaKnapp}
          onPress={() => { setSamtykke(true); setVisPersonvern(false); }}
        >
          <Ionicons name="checkmark-circle" size={18} color={uiColor.primaryText} />
          <Text style={s.modalGodtaTxt}>Godta og lukk</Text>
        </Pressable>
      </ModalSheet>
    </SafeAreaView>
  );
}

function tolkFeil(code?: string, message?: string): string {
  switch (code) {
    case "auth/invalid-email":          return "Ugyldig e-postadresse.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":     return "Feil e-post eller passord.";
    case "auth/email-already-in-use":   return "E-posten er allerede i bruk.";
    case "auth/weak-password":          return "Passordet er for svakt (minst 6 tegn).";
    case "auth/too-many-requests":      return "For mange forsøk. Prøv igjen om litt.";
    case "auth/operation-not-allowed":  return "E-post/passord er ikke aktivert i Firebase Console.";
    case "auth/network-request-failed": return "Ingen internettforbindelse.";
    default:
      return message ? `Feil: ${message}` : "Noe gikk galt. Prøv igjen.";
  }
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: uiColor.background },
  scroll: { paddingHorizontal: uiSpacing.xl, paddingTop: uiSpacing.xxl, paddingBottom: 60 },

  logoGlowWrap: { alignSelf: "flex-start", marginBottom: uiSpacing.xxxl + 12, borderRadius: uiRadius.xl, padding: uiSpacing.sm },
  logoWrap: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoDot:  { width: 10, height: 10, borderRadius: 5, backgroundColor: uiColor.primary },
  logoText: { color: uiColor.primary, fontSize: 13, fontWeight: "900", letterSpacing: 2, textTransform: "uppercase" },

  tittel: { ...uiType.display, color: uiColor.textPrimary, marginBottom: 10 },
  sub:    { ...uiType.body, fontSize: 15, lineHeight: 23, color: uiColor.textMuted, marginBottom: uiSpacing.xxl },

  modusRad:         { flexDirection: "row", gap: uiSpacing.sm, marginBottom: uiSpacing.xl },
  modusKnapp:       { flex: 1, paddingVertical: 13, borderRadius: uiRadius.md, backgroundColor: uiColor.surface, borderWidth: 1, borderColor: uiColor.border, alignItems: "center" },
  modusKnappActive: { backgroundColor: uiColor.surfaceElevated, borderColor: uiColor.primary },
  modusTxt:         { ...uiType.bodyStrong, fontWeight: "700", color: uiColor.textMuted },
  modusTxtActive:   { color: uiColor.primarySoft, fontWeight: "800" },

  kortWrap: { backgroundColor: uiColor.surface, borderRadius: uiRadius.xl, borderWidth: 1, borderColor: uiColor.border, padding: uiSpacing.xl },
  label:    { ...uiType.eyebrow, letterSpacing: 1, color: uiColor.textMuted, marginBottom: uiSpacing.sm, marginTop: uiSpacing.sm },
  input:    { backgroundColor: uiColor.surfaceElevated, borderRadius: uiRadius.md, borderWidth: 1, borderColor: uiColor.border, color: uiColor.textPrimary, fontSize: 16, paddingHorizontal: uiSpacing.lg, paddingVertical: 14 },

  samtykkeRad: { flexDirection: "row", alignItems: "flex-start", gap: uiSpacing.md, marginTop: uiSpacing.lg },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: uiColor.borderStrong,
    backgroundColor: uiColor.surfaceElevated,
    alignItems: "center", justifyContent: "center",
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: uiColor.primary, borderColor: uiColor.primary },
  samtykkeTxt:    { ...uiType.body, fontSize: 14, lineHeight: 22, color: uiColor.textSecondary, flex: 1 },
  personvernLink: { color: uiColor.primary, fontWeight: "700", textDecorationLine: "underline" },

  feilBoks: { flexDirection: "row", alignItems: "center", gap: uiSpacing.sm, backgroundColor: uiColor.danger + "14", borderRadius: uiRadius.sm + 2, borderWidth: 1, borderColor: uiColor.danger + "33", padding: uiSpacing.md, marginTop: uiSpacing.md },
  feilTxt:  { fontSize: 13, color: uiColor.danger, flex: 1 },

  primærKnapp:    { backgroundColor: uiColor.primary, borderRadius: uiRadius.md, paddingVertical: 17, alignItems: "center", marginTop: uiSpacing.xl },
  primærKnappDis: { opacity: 0.45 },
  primærTxt:      { ...uiType.sectionTitle, color: uiColor.primaryText },

  infoWrap: { flexDirection: "row", alignItems: "flex-start", gap: uiSpacing.sm + 2, marginTop: uiSpacing.xl, paddingHorizontal: 4 },
  infoTxt:  { ...uiType.body, fontSize: 13, lineHeight: 20, color: uiColor.textFaint, flex: 1 },

  // Personvern-modal — kun innhold; overlay/ark/håndtak/animasjon kommer fra ModalSheet.
  modalTopp:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: uiSpacing.lg },
  modalTittel: { ...uiType.sectionTitle, fontSize: 18, color: uiColor.textPrimary },
  lukkKnapp:   { width: 34, height: 34, borderRadius: 17, backgroundColor: uiColor.surfaceHover, alignItems: "center", justifyContent: "center" },
  modalScroll: { flex: 1 },
  modalTekst:  { ...uiType.body, fontSize: 13, lineHeight: 22, color: uiColor.textSecondary, marginBottom: uiSpacing.xl },
  modalGodtaKnapp: {
    backgroundColor: uiColor.primary, borderRadius: uiRadius.md, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: uiSpacing.sm,
    marginTop: uiSpacing.xs,
  },
  modalGodtaTxt: { ...uiType.bodyStrong, fontSize: 15, fontWeight: "900", color: uiColor.primaryText },
});
