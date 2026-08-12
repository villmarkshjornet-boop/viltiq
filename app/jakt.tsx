import { Ionicons } from "@expo/vector-icons";
import { Link, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  type DimensionValue,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import BottomDock from "../components/BottomDock";
import Surface from "../components/ui/Surface";
import {
  lagreFelling,
  slettFelling,
  subscribeFellings,
  type Felling,
} from "../src/services/felling";
import { getUserPosition, type UserPosition } from "../src/services/location";
import { subscribeToNearbyObservations } from "../src/services/observations";
import { getSettings } from "../src/services/settings";
import type { Observasjon } from "../src/types/observation";
import { getKvoter, oppdaterKvote, type Kvoter } from "../src/services/kvoter";
import { runEngine, PRIORITERTE_ARTER, getSpeciesProfile, type PredictionZone, type Species } from "../src/engine";
import { color as uiColor } from "../src/design/tokens";

const NORSK_ART: Record<Species, string> = { hjort: "Hjort", radyr: "Rådyr", elg: "Elg", annet: "Annet" };

const DYR_LISTE  = ["Rådyr", "Elg", "Hjort", "Rev", "Annet"];
const KJØNN      = ["Hannkjønn", "Hunkjønn", "Ukjent"] as const;
const ALDERSKLASSE = ["Kalv/kje", "Ungdyr", "Voksen"] as const;

function dyrEmoji(dyr: string) {
  if (dyr === "Rev")  return "🦊";
  if (dyr === "Elg")  return "🫎";
  return "🦌";
}

function formaterDato(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}

function ChipRow<T extends string>({
  vals, selected, onSelect,
}: { vals: readonly T[]; selected: T; onSelect: (v: T) => void }) {
  return (
    <View style={styles.chipRow}>
      {vals.map((v) => (
        <Pressable
          key={v}
          style={[styles.chip, selected === v && styles.chipActive]}
          onPress={() => onSelect(v)}
        >
          <Text style={[styles.chipTxt, selected === v && styles.chipTxtActive]}>{v}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const KVOTE_DYR = ["Rådyr", "Elg", "Hjort", "Rev"];

export default function JaktScreen() {
  const [fellings,    setFellings]    = useState<Felling[]>([]);
  const [kvoter,      setKvoter]      = useState<Kvoter>({});
  const [modalVis,    setModalVis]    = useState(false);
  const [kvoteModal,  setKvoteModal]  = useState(false);
  const [lagrer,      setLagrer]      = useState(false);

  // ── Dagens jakt (§17A): gjenbruker ViltIQ Engine (ren observasjonsbasert
  // runEngine — samme motor som kartet, ikke en egen vurdering) for å
  // anbefale ett område/en art akkurat nå. Bevisst KUN den synkrone
  // observasjonsmotoren her (ikke den økologiske varianten med miljøoppslag)
  // for å holde Jakt-siden rask og alltid tilgjengelig uten nettverkskall.
  const [observasjoner, setObservasjoner] = useState<Observasjon[]>([]);
  const [userLocation,  setUserLocation]  = useState<UserPosition | null>(null);

  // Skjema-state
  const [valgtDyr,   setValgtDyr]   = useState("Rådyr");
  const [kjønn,      setKjønn]      = useState<typeof KJØNN[number]>("Hannkjønn");
  const [aldersklasse, setAlders]   = useState<typeof ALDERSKLASSE[number]>("Voksen");
  const [vektTekst,  setVektTekst]  = useState("");
  const [kommentar,  setKommentar]  = useState("");
  const [dateTekst,  setDateTekst]  = useState(() => new Date().toISOString().slice(0, 10));

  useFocusEffect(
    useCallback(() => {
      let unsubFellings: (() => void) | undefined;
      let unsubObs: (() => void) | undefined;
      let aktiv = true;
      (async () => {
        const k = await getKvoter();
        if (aktiv) setKvoter(k);
        unsubFellings = subscribeFellings(
          (data) => { if (aktiv) setFellings(data); },
          () => {}
        );

        const settings = await getSettings();
        if (!aktiv) return;
        const pos = await getUserPosition();
        if (!aktiv) return;
        if (pos) {
          setUserLocation(pos);
          unsubObs = subscribeToNearbyObservations(
            { center: pos, radiusKm: settings.radiusKm },
            (items) => { if (aktiv) setObservasjoner(items); },
            () => { /* stille — "Dagens jakt" er en hjelp, ikke kritisk */ }
          );
        }
      })();
      return () => { aktiv = false; unsubFellings?.(); unsubObs?.(); };
    }, [])
  );

  const dagensJakt = useMemo(() => {
    let beste: { species: Species; zone: PredictionZone } | null = null;
    for (const species of PRIORITERTE_ARTER) {
      const resultat = runEngine(observasjoner, species);
      const sone = resultat.zones[0];
      if (sone && (!beste || sone.score > beste.zone.score)) {
        beste = { species, zone: sone };
      }
    }
    return beste;
  }, [observasjoner]);

  function åpneModal() {
    setValgtDyr("Rådyr");
    setKjønn("Hannkjønn");
    setAlders("Voksen");
    setVektTekst("");
    setKommentar("");
    setDateTekst(new Date().toISOString().slice(0, 10));
    setModalVis(true);
  }

  async function lagreNy() {
    if (lagrer) return;
    setLagrer(true);
    try {
      const pos = await getUserPosition();
      await lagreFelling({
        dyr: valgtDyr,
        kjønn,
        aldersklasse,
        vektKg: vektTekst ? parseFloat(vektTekst.replace(",", ".")) : null,
        dato: dateTekst,
        latitude:  pos?.latitude  ?? null,
        longitude: pos?.longitude ?? null,
        kommentar: kommentar.trim(),
      });
      setModalVis(false);
    } catch (e) {
      console.log("lagre felling-feil:", e);
      Alert.alert("Feil", "Klarte ikke lagre felling. Prøv igjen.");
    } finally {
      setLagrer(false);
    }
  }

  function bekreftSlett(f: Felling) {
    Alert.alert(
      "Slett felling",
      `Slette ${f.dyr} felt ${formaterDato(f.dato)}?`,
      [
        { text: "Avbryt", style: "cancel" },
        {
          text: "Slett",
          style: "destructive",
          onPress: async () => {
            try {
              await slettFelling(f.id);
            } catch (e: any) {
              Alert.alert("Feil", e?.message || "Klarte ikke slette fellingen.");
            }
          },
        },
      ]
    );
  }

  const totalVekt = fellings.reduce((s, f) => s + (f.vektKg ?? 0), 0);

  async function endreKvote(dyr: string, delta: number) {
    const nåværende = kvoter[dyr] ?? 0;
    const ny = Math.max(0, nåværende + delta);
    await oppdaterKvote(dyr, ny);
    setKvoter((prev) => ({ ...prev, [dyr]: ny }));
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.screen}>

        {/* ── Header ── */}
        <View style={s.header}>
          <View>
            <Text style={s.eyebrow}>ViltIQ</Text>
            <Text style={s.title}>Jakt</Text>
          </View>
          <Pressable style={s.nyBtn} onPress={åpneModal}>
            <Ionicons name="add" size={20} color="#060E08" />
            <Text style={s.nyBtnTxt}>Logg felling</Text>
          </Pressable>
        </View>

        {/* ── Dagens jakt (§17A) — motorens anbefaling for området nå ── */}
        <Surface style={s.dagensKort}>
          <Text style={s.dagensEyebrow}>Dagens jakt</Text>
          {dagensJakt ? (
            <>
              <Text style={s.dagensArt}>
                {getSpeciesProfile(dagensJakt.species).label} · {dagensJakt.zone.level.toLowerCase()} aktivitet
              </Text>
              <Text style={s.dagensForklaring}>{dagensJakt.zone.explanation}</Text>
              <Link
                href={{
                  pathname: "/kart",
                  params: {
                    focusLat: String(dagensJakt.zone.center.latitude),
                    focusLng: String(dagensJakt.zone.center.longitude),
                    filter: NORSK_ART[dagensJakt.species],
                  },
                }}
                asChild
              >
                <Pressable style={s.dagensBtn}>
                  <Ionicons name="map-outline" size={15} color={uiColor.primaryText} />
                  <Text style={s.dagensBtnTxt}>Åpne i kart</Text>
                </Pressable>
              </Link>
            </>
          ) : (
            <Text style={s.dagensForklaring}>
              {userLocation
                ? "Ikke nok ferske observasjoner i området til en tydelig anbefaling ennå."
                : "Trenger posisjon for å vurdere dagens jakt — sjekk stedstjenester."}
            </Text>
          )}
        </Surface>

        {/* ── Sammendrag ── */}
        {fellings.length > 0 && (
          <View style={s.sumRad}>
            <View style={s.sumKort}>
              <Text style={s.sumVerdi}>{fellings.length}</Text>
              <Text style={s.sumLabel}>Totalt felt</Text>
            </View>
            <View style={[s.sumKort, s.sumKortMid]}>
              <Text style={s.sumVerdi}>
                {totalVekt > 0 ? `${totalVekt.toFixed(1)} kg` : "—"}
              </Text>
              <Text style={s.sumLabel}>Total vekt</Text>
            </View>
            <View style={s.sumKort}>
              <Text style={s.sumVerdi}>
                {[...new Set(fellings.map((f) => f.dyr))].length}
              </Text>
              <Text style={s.sumLabel}>Arter</Text>
            </View>
          </View>
        )}

        {/* ── Kvoter ── */}
        <View style={s.kvoteKort}>
          <View style={s.kvoteHeaderRad}>
            <Text style={s.kvoteKortTittel}>Kvoteoversikt</Text>
            <Pressable onPress={() => setKvoteModal(true)} style={s.kvoteEditKnapp}>
              <Ionicons name="pencil-outline" size={14} color="#2CC36B" />
              <Text style={s.kvoteEditTxt}>Sett kvoter</Text>
            </Pressable>
          </View>
          {KVOTE_DYR.map((dyr) => {
            const kvote = kvoter[dyr] ?? 0;
            const felt  = fellings.filter((f) => f.dyr === dyr).length;
            const pst   = kvote > 0 ? Math.min(felt / kvote, 1) : 0;
            const over  = kvote > 0 && felt >= kvote;
            return (
              <View key={dyr} style={s.kvoteRad}>
                <Text style={s.kvoteDyr}>{dyrEmoji(dyr)} {dyr}</Text>
                <View style={s.kvoteBarWrap}>
                  <View style={[s.kvoteBar, { width: `${Math.round(pst * 100)}%` as DimensionValue, backgroundColor: over ? "#F87171" : "#2CC36B" }]} />
                </View>
                <Text style={[s.kvoteTall, over && s.kvoteTallOver]}>
                  {felt}/{kvote > 0 ? kvote : "—"}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ── Liste ── */}
        <ScrollView
          contentContainerStyle={s.liste}
          showsVerticalScrollIndicator={false}
        >
          {fellings.length === 0 ? (
            <View style={s.tomtKort}>
              <Text style={s.tomtEmoji}>🏹</Text>
              <Text style={s.tomtTittel}>Ingen fellings registrert</Text>
              <Text style={s.tomtSub}>Trykk «Logg felling» for å registrere din første felling.</Text>
            </View>
          ) : (
            fellings.map((f) => (
              <View key={f.id} style={s.kort}>
                <View style={s.kortTop}>
                  <View style={s.kortEmojiBoks}>
                    <Text style={s.kortEmoji}>{dyrEmoji(f.dyr)}</Text>
                  </View>
                  <View style={s.kortInfo}>
                    <Text style={s.kortDyr}>{f.dyr}</Text>
                    <Text style={s.kortMeta}>
                      {f.kjønn} · {f.aldersklasse}
                      {f.vektKg != null ? ` · ${f.vektKg} kg` : ""}
                    </Text>
                    <Text style={s.kortDato}>{formaterDato(f.dato)}</Text>
                  </View>
                  <Pressable style={s.slettKnapp} onPress={() => bekreftSlett(f)}>
                    <Ionicons name="trash-outline" size={16} color="#4D6858" />
                  </Pressable>
                </View>
                {!!f.kommentar && (
                  <Text style={s.kortKommentar}>{f.kommentar}</Text>
                )}
              </View>
            ))
          )}
        </ScrollView>

        <BottomDock />
      </View>

      {/* ── Modal: Sett kvoter ── */}
      <Modal visible={kvoteModal} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.handle} />
            <Text style={m.tittel}>Sett kvoter</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {KVOTE_DYR.map((dyr) => (
                <View key={dyr} style={kq.rad}>
                  <Text style={kq.dyr}>{dyrEmoji(dyr)} {dyr}</Text>
                  <View style={kq.teller}>
                    <Pressable style={kq.btn} onPress={() => endreKvote(dyr, -1)}>
                      <Ionicons name="remove" size={18} color="#FFFFFF" />
                    </Pressable>
                    <Text style={kq.antall}>{kvoter[dyr] ?? 0}</Text>
                    <Pressable style={[kq.btn, kq.btnPlus]} onPress={() => endreKvote(dyr, 1)}>
                      <Ionicons name="add" size={18} color="#060E08" />
                    </Pressable>
                  </View>
                </View>
              ))}
              <Pressable style={[m.lagreKnapp, { marginTop: 12 }]} onPress={() => setKvoteModal(false)}>
                <Text style={m.lagreTxt}>Ferdig</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Modal: Ny felling ── */}
      <Modal visible={modalVis} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.handle} />
            <Text style={m.tittel}>Registrer felling</Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={m.label}>Art</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                <View style={styles.chipRow}>
                  {DYR_LISTE.map((d) => (
                    <Pressable
                      key={d}
                      style={[styles.chip, valgtDyr === d && styles.chipActive]}
                      onPress={() => setValgtDyr(d)}
                    >
                      <Text style={[styles.chipTxt, valgtDyr === d && styles.chipTxtActive]}>
                        {dyrEmoji(d)} {d}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              <Text style={m.label}>Kjønn</Text>
              <ChipRow vals={KJØNN} selected={kjønn} onSelect={setKjønn} />

              <Text style={m.label}>Aldersklasse</Text>
              <ChipRow vals={ALDERSKLASSE} selected={aldersklasse} onSelect={setAlders} />

              <Text style={m.label}>Vekt (kg)</Text>
              <TextInput
                style={m.input}
                value={vektTekst}
                onChangeText={setVektTekst}
                placeholder="F.eks. 68.5"
                placeholderTextColor="#3D5446"
                keyboardType="decimal-pad"
              />

              <Text style={m.label}>Dato (ÅÅÅÅ-MM-DD)</Text>
              <TextInput
                style={m.input}
                value={dateTekst}
                onChangeText={setDateTekst}
                placeholder="2024-10-15"
                placeholderTextColor="#3D5446"
                keyboardType="numbers-and-punctuation"
              />

              <Text style={m.label}>Kommentar (valgfritt)</Text>
              <TextInput
                style={[m.input, m.inputTall]}
                value={kommentar}
                onChangeText={setKommentar}
                placeholder="Notater om fellingen..."
                placeholderTextColor="#3D5446"
                multiline
                numberOfLines={3}
              />

              <View style={m.knappeRad}>
                <Pressable style={m.avbrytKnapp} onPress={() => setModalVis(false)}>
                  <Text style={m.avbrytTxt}>Avbryt</Text>
                </Pressable>
                <Pressable
                  style={[m.lagreKnapp, lagrer && m.lagreKnappDis]}
                  onPress={lagreNy}
                  disabled={lagrer}
                >
                  <Text style={m.lagreTxt}>{lagrer ? "Lagrer..." : "Lagre felling"}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: "#060E08" },
  screen: { flex: 1 },

  header: {
    flexDirection: "row", alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10,
  },
  eyebrow: { color: "#2CC36B", fontSize: 11, fontWeight: "800", letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 4 },
  title:   { color: "#FFFFFF", fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  nyBtn:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#2CC36B", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, marginTop: 6 },
  nyBtnTxt: { color: "#060E08", fontSize: 14, fontWeight: "800" },

  dagensKort:       { marginHorizontal: 20, marginBottom: 14, padding: 18 },
  dagensEyebrow:    { color: "#2CC36B", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 },
  dagensArt:        { color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginBottom: 6 },
  dagensForklaring: { color: "#7A9A88", fontSize: 13, lineHeight: 19, marginBottom: 12 },
  dagensBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#2CC36B", borderRadius: 12, paddingVertical: 11, alignSelf: "flex-start", paddingHorizontal: 16,
  },
  dagensBtnTxt: { color: "#04110A", fontSize: 13, fontWeight: "900" },

  // Kvoter
  kvoteKort:       { marginHorizontal: 20, marginBottom: 14, backgroundColor: "#0B1610", borderRadius: 18, borderWidth: 1, borderColor: "#192420", padding: 16 },
  kvoteHeaderRad:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  kvoteKortTittel: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  kvoteEditKnapp:  { flexDirection: "row", alignItems: "center", gap: 5 },
  kvoteEditTxt:    { color: "#2CC36B", fontSize: 12, fontWeight: "700" },
  kvoteRad:        { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  kvoteDyr:        { color: "#C8D8D0", fontSize: 13, fontWeight: "700", width: 80 },
  kvoteBarWrap:    { flex: 1, height: 6, backgroundColor: "#0E1A10", borderRadius: 3, overflow: "hidden" },
  kvoteBar:        { height: "100%", borderRadius: 3 },
  kvoteTall:       { color: "#4D6858", fontSize: 12, fontWeight: "800", width: 36, textAlign: "right" },
  kvoteTallOver:   { color: "#F87171" },

  sumRad:    { flexDirection: "row", gap: 8, paddingHorizontal: 20, marginBottom: 16 },
  sumKort:   { flex: 1, backgroundColor: "#0B1610", borderRadius: 16, borderWidth: 1, borderColor: "#192420", padding: 14, alignItems: "center" },
  sumKortMid: { borderColor: "#1C2A20" },
  sumVerdi:  { color: "#FFFFFF", fontSize: 20, fontWeight: "900" },
  sumLabel:  { color: "#3D5446", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 4 },

  liste: { paddingHorizontal: 20, paddingBottom: 140, gap: 10 },

  tomtKort:    { alignItems: "center", paddingVertical: 60 },
  tomtEmoji:   { fontSize: 48, marginBottom: 16 },
  tomtTittel:  { color: "#FFFFFF", fontSize: 18, fontWeight: "800", marginBottom: 8 },
  tomtSub:     { color: "#4D6858", fontSize: 14, textAlign: "center", lineHeight: 20 },

  kort:       { backgroundColor: "#0B1610", borderRadius: 18, borderWidth: 1, borderColor: "#192420", padding: 16 },
  kortTop:    { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  kortEmojiBoks: { width: 44, height: 44, borderRadius: 12, backgroundColor: "#0E1F14", alignItems: "center", justifyContent: "center" },
  kortEmoji:  { fontSize: 22 },
  kortInfo:   { flex: 1 },
  kortDyr:    { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  kortMeta:   { color: "#6B8A76", fontSize: 13, marginTop: 2 },
  kortDato:   { color: "#3D5446", fontSize: 12, marginTop: 4 },
  slettKnapp: { padding: 6 },
  kortKommentar: { color: "#4D6858", fontSize: 13, marginTop: 10, lineHeight: 18 },
});

const m = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet:    { backgroundColor: "#0B1610", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingBottom: 40, paddingTop: 14, maxHeight: "90%" },
  handle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: "#192420", alignSelf: "center", marginBottom: 20 },
  tittel:   { color: "#FFFFFF", fontSize: 20, fontWeight: "900", marginBottom: 20 },
  label:    { color: "#4D6858", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  input:    { backgroundColor: "#0E1A10", borderRadius: 14, borderWidth: 1, borderColor: "#192420", color: "#FFFFFF", fontSize: 15, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 18 },
  inputTall: { height: 90, textAlignVertical: "top", paddingTop: 13 },
  knappeRad: { flexDirection: "row", gap: 10, marginTop: 4 },
  avbrytKnapp: { flex: 1, borderRadius: 14, borderWidth: 1, borderColor: "#192420", paddingVertical: 15, alignItems: "center" },
  avbrytTxt:   { color: "#6B8A76", fontSize: 15, fontWeight: "700" },
  lagreKnapp:  { flex: 2, borderRadius: 14, backgroundColor: "#2CC36B", paddingVertical: 15, alignItems: "center" },
  lagreKnappDis: { opacity: 0.5 },
  lagreTxt:    { color: "#060E08", fontSize: 15, fontWeight: "800" },
});

const styles = StyleSheet.create({
  chipRow:       { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip:          { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: "#0E1A10", borderWidth: 1, borderColor: "#192420" },
  chipActive:    { backgroundColor: "#122C1C", borderColor: "#2CC36B" },
  chipTxt:       { color: "#6B8A76", fontSize: 13, fontWeight: "700" },
  chipTxtActive: { color: "#A9F2BF", fontWeight: "800" },
});

const kq = StyleSheet.create({
  rad:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#0E1A10" },
  dyr:    { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  teller: { flexDirection: "row", alignItems: "center", gap: 16 },
  btn:    { width: 34, height: 34, borderRadius: 10, backgroundColor: "#1A2B1A", borderWidth: 1, borderColor: "#1E3020", alignItems: "center", justifyContent: "center" },
  btnPlus: { backgroundColor: "#2CC36B", borderColor: "#2CC36B" },
  antall: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", minWidth: 28, textAlign: "center" },
});
