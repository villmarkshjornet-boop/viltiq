import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
          {/* Logo */}
          <View style={s.logoWrap}>
            <View style={s.logoDot} />
            <Text style={s.logoText}>ViltIQ</Text>
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
              placeholderTextColor="#3D5446"
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
              placeholderTextColor="#3D5446"
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
                  {samtykke && <Ionicons name="checkmark" size={13} color="#060E08" />}
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
                <Ionicons name="warning-outline" size={15} color="#F87171" />
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
                ? <ActivityIndicator color="#060E08" />
                : <Text style={s.primærTxt}>
                    {authModus === "logginn" ? "Logg inn" : "Opprett konto"}
                  </Text>
              }
            </Pressable>
          </View>

          {/* Info */}
          <View style={s.infoWrap}>
            <Ionicons name="people-outline" size={16} color="#3D5446" />
            <Text style={s.infoTxt}>
              Jaktlag kan opprettes eller bli med i etter innlogging — under Innstillinger.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Personvern-modal */}
      <Modal
        visible={visPersonvern}
        transparent
        animationType="slide"
        onRequestClose={() => setVisPersonvern(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalKort}>
            <View style={s.modalTopp}>
              <Text style={s.modalTittel}>Personvernerklæring</Text>
              <Pressable onPress={() => setVisPersonvern(false)} style={s.lukkKnapp}>
                <Ionicons name="close" size={18} color="#6B8A76" />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={s.modalTekst}>{PERSONVERN_TEKST}</Text>
            </ScrollView>
            <Pressable
              style={s.modalGodtaKnapp}
              onPress={() => { setSamtykke(true); setVisPersonvern(false); }}
            >
              <Ionicons name="checkmark-circle" size={18} color="#060E08" />
              <Text style={s.modalGodtaTxt}>Godta og lukk</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  safe:   { flex: 1, backgroundColor: "#060E08" },
  scroll: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 60 },

  logoWrap: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 52 },
  logoDot:  { width: 10, height: 10, borderRadius: 5, backgroundColor: "#2CC36B" },
  logoText: { color: "#2CC36B", fontSize: 13, fontWeight: "900", letterSpacing: 2, textTransform: "uppercase" },

  tittel: { color: "#FFFFFF", fontSize: 34, fontWeight: "900", letterSpacing: -0.5, marginBottom: 10 },
  sub:    { color: "#4D6858", fontSize: 15, lineHeight: 23, marginBottom: 28 },

  modusRad:         { flexDirection: "row", gap: 8, marginBottom: 20 },
  modusKnapp:       { flex: 1, paddingVertical: 13, borderRadius: 14, backgroundColor: "#0B1610", borderWidth: 1, borderColor: "#192420", alignItems: "center" },
  modusKnappActive: { backgroundColor: "#122C1C", borderColor: "#2CC36B" },
  modusTxt:         { color: "#6B8A76", fontSize: 14, fontWeight: "700" },
  modusTxtActive:   { color: "#A9F2BF", fontWeight: "800" },

  kortWrap: { backgroundColor: "#0B1610", borderRadius: 22, borderWidth: 1, borderColor: "#192420", padding: 20 },
  label:    { color: "#4D6858", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, marginTop: 8 },
  input:    { backgroundColor: "#0E1A10", borderRadius: 14, borderWidth: 1, borderColor: "#1E2E20", color: "#FFFFFF", fontSize: 16, paddingHorizontal: 16, paddingVertical: 14 },

  samtykkeRad:   { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 16 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: "#2E4836",
    backgroundColor: "#0E1A10",
    alignItems: "center", justifyContent: "center",
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: "#2CC36B", borderColor: "#2CC36B" },
  samtykkeTxt:   { color: "#8EA0AA", fontSize: 14, lineHeight: 22, flex: 1 },
  personvernLink:{ color: "#2CC36B", fontWeight: "700", textDecorationLine: "underline" },

  feilBoks: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(248,113,113,0.08)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(248,113,113,0.2)", padding: 12, marginTop: 12 },
  feilTxt:  { color: "#FCA5A5", fontSize: 13, flex: 1 },

  primærKnapp:    { backgroundColor: "#2CC36B", borderRadius: 14, paddingVertical: 17, alignItems: "center", marginTop: 20 },
  primærKnappDis: { opacity: 0.45 },
  primærTxt:      { color: "#060E08", fontSize: 16, fontWeight: "900" },

  infoWrap: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 24, paddingHorizontal: 4 },
  infoTxt:  { color: "#3D5446", fontSize: 13, lineHeight: 20, flex: 1 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalKort: {
    backgroundColor: "#0C1610",
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderWidth: 1, borderBottomWidth: 0, borderColor: "#1E3226",
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 40,
    maxHeight: "85%",
  },
  modalTopp:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  modalTittel: { color: "#FFFFFF", fontSize: 18, fontWeight: "900" },
  lukkKnapp:   { width: 34, height: 34, borderRadius: 17, backgroundColor: "#111827", alignItems: "center", justifyContent: "center" },
  modalTekst:  { color: "#8EA0AA", fontSize: 13, lineHeight: 22, marginBottom: 24 },
  modalGodtaKnapp: {
    backgroundColor: "#2CC36B", borderRadius: 14, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 8,
  },
  modalGodtaTxt: { color: "#060E08", fontSize: 15, fontWeight: "900" },
});
