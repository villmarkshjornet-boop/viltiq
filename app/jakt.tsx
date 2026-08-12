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
  oppdaterFelling,
  slettFelling,
  subscribeFellings,
  type Felling,
} from "../src/services/felling";
import { getUserPosition, type UserPosition } from "../src/services/location";
import { subscribeToNearbyObservations } from "../src/services/observations";
import { getSettings } from "../src/services/settings";
import type { Observasjon } from "../src/types/observation";
import {
  fjernKategori,
  getKvoter,
  leggTilKategori,
  oppdaterKategori,
  type Kvoter,
} from "../src/services/kvoter";
import { runEngine, PRIORITERTE_ARTER, getSpeciesProfile, type PredictionZone, type Species } from "../src/engine";
import { color as uiColor, spacing as uiSpacing, radius as uiRadius, typography as uiType } from "../src/design/tokens";
import { beregnKvoteRader, fellingerUtenGyldigKategori } from "../src/lib/kvoteBeregning";

const NORSK_ART: Record<Species, string> = { hjort: "Hjort", radyr: "Rådyr", elg: "Elg", annet: "Annet" };

const DYR_LISTE  = ["Rådyr", "Elg", "Hjort", "Rev", "Annet"];
const KJØNN      = ["Hannkjønn", "Hunkjønn", "Ukjent"] as const;
const ALDERSKLASSE = ["Kalv/kje", "Ungdyr", "Voksen"] as const;
const KVOTE_DYR = ["Rådyr", "Elg", "Hjort", "Rev"];

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

  // Skjema-state — brukes BÅDE ved ny felling og ved redigering (§4:
  // redigering er samme modal, kun forhåndsutfylt og med en annen lagre-
  // funksjon, i stedet for en egen skjerm/komponent for det samme skjemaet).
  const [redigererFelling, setRedigererFelling] = useState<Felling | null>(null);
  const [valgtDyr,   setValgtDyr]   = useState("Rådyr");
  const [valgtKategoriId, setValgtKategoriId] = useState<string | null>(null);
  const [kjønn,      setKjønn]      = useState<typeof KJØNN[number]>("Hannkjønn");
  const [aldersklasse, setAlders]   = useState<typeof ALDERSKLASSE[number]>("Voksen");
  const [vektTekst,  setVektTekst]  = useState("");
  const [kommentar,  setKommentar]  = useState("");
  const [dateTekst,  setDateTekst]  = useState(() => new Date().toISOString().slice(0, 10));

  // Kvote-modalens skjema for "ny kategori" — én utkast-rad per art.
  const [nyKatNavn, setNyKatNavn] = useState<Record<string, string>>({});
  const [nyKatMaks, setNyKatMaks] = useState<Record<string, string>>({});
  const [katNavnUtkast, setKatNavnUtkast] = useState<Record<string, string>>({});

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

  function kategorierFor(dyr: string) {
    return kvoter[dyr]?.kategorier ?? [];
  }

  function åpneModal() {
    setRedigererFelling(null);
    setValgtDyr("Rådyr");
    setValgtKategoriId(kategorierFor("Rådyr")[0]?.id ?? null);
    setKjønn("Hannkjønn");
    setAlders("Voksen");
    setVektTekst("");
    setKommentar("");
    setDateTekst(new Date().toISOString().slice(0, 10));
    setModalVis(true);
  }

  function åpneRedigerModal(f: Felling) {
    setRedigererFelling(f);
    setValgtDyr(f.dyr);
    setValgtKategoriId(f.kategoriId ?? kategorierFor(f.dyr)[0]?.id ?? null);
    setKjønn(f.kjønn);
    setAlders(f.aldersklasse);
    setVektTekst(f.vektKg != null ? String(f.vektKg) : "");
    setKommentar(f.kommentar);
    setDateTekst(f.dato);
    setModalVis(true);
  }

  function velgDyrIModal(d: string) {
    setValgtDyr(d);
    setValgtKategoriId(kategorierFor(d)[0]?.id ?? null);
  }

  async function lagreNy() {
    if (lagrer) return;
    setLagrer(true);
    try {
      const input = {
        dyr: valgtDyr,
        kjønn,
        aldersklasse,
        vektKg: vektTekst ? parseFloat(vektTekst.replace(",", ".")) : null,
        dato: dateTekst,
        kommentar: kommentar.trim(),
        kategoriId: valgtKategoriId,
      };
      if (redigererFelling) {
        // Retting (§4): posisjon endres bevisst ikke her — den ble satt der
        // fellingen faktisk skjedde, og skal ikke flyttes til der brukeren
        // tilfeldigvis står når de retter et tastefeil i ettertid.
        await oppdaterFelling(redigererFelling.id, {
          ...input,
          latitude: redigererFelling.latitude,
          longitude: redigererFelling.longitude,
        });
      } else {
        const pos = await getUserPosition();
        await lagreFelling({
          ...input,
          latitude:  pos?.latitude  ?? null,
          longitude: pos?.longitude ?? null,
        });
      }
      setModalVis(false);
      setRedigererFelling(null);
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

  // Fellinger for arter vi sporer kvote for, men uten (lenger) en gyldig
  // kategori-kobling — enten registrert før §4 fantes, eller kategorien de
  // pekte på er siden fjernet. Disse skal ALDRI forsvinne stille — se
  // notatet under Kvoteoversikt.
  const fellingerUtenKategori = useMemo(
    () => fellingerUtenGyldigKategori(kvoter, fellings, KVOTE_DYR),
    [fellings, kvoter]
  );

  const kvoteRader = useMemo(
    () => beregnKvoteRader(kvoter, fellings, KVOTE_DYR),
    [fellings, kvoter]
  );

  async function leggTilKategoriHandler(dyr: string) {
    const navn = (nyKatNavn[dyr] ?? "").trim();
    const maks = parseInt(nyKatMaks[dyr] ?? "", 10);
    if (!navn || !Number.isFinite(maks) || maks < 0) {
      Alert.alert("Ugyldig kategori", "Skriv et navn og et gyldig maks-antall (0 eller mer).");
      return;
    }
    await leggTilKategori(dyr, navn, maks);
    setKvoter(await getKvoter());
    setNyKatNavn((p) => ({ ...p, [dyr]: "" }));
    setNyKatMaks((p) => ({ ...p, [dyr]: "" }));
  }

  async function endreKategoriMaks(dyr: string, kategoriId: string, delta: number) {
    const nåværende = kategorierFor(dyr).find((k) => k.id === kategoriId)?.maks ?? 0;
    await oppdaterKategori(dyr, kategoriId, { maks: Math.max(0, nåværende + delta) });
    setKvoter(await getKvoter());
  }

  async function lagreKategoriNavn(dyr: string, kategoriId: string) {
    const navn = katNavnUtkast[kategoriId];
    if (navn == null || !navn.trim()) return;
    await oppdaterKategori(dyr, kategoriId, { navn });
    setKvoter(await getKvoter());
  }

  function bekreftFjernKategori(dyr: string, kategoriId: string, navn: string) {
    Alert.alert(
      "Fjern kategori",
      `Fjerne kvote-kategorien «${navn}» for ${dyr}? Fellinger som er knyttet til den slettes ikke, men teller ikke lenger mot noen kvote før du kobler dem til en annen kategori.`,
      [
        { text: "Avbryt", style: "cancel" },
        {
          text: "Fjern",
          style: "destructive",
          onPress: async () => {
            await fjernKategori(dyr, kategoriId);
            setKvoter(await getKvoter());
          },
        },
      ]
    );
  }

  const konfigurerteArter = KVOTE_DYR.filter((d) => kategorierFor(d).length > 0);

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
            <Ionicons name="add" size={20} color={uiColor.primaryText} />
            <Text style={s.nyBtnTxt}>Logg felling</Text>
          </Pressable>
        </View>

        {/* ── Dagens jakt (§17A) — motorens anbefaling for området nå ── */}
        <Surface variant="elevated" style={s.dagensKort}>
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
                    heatmap: "1",
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
            <Surface style={s.sumKort}>
              <Text style={s.sumVerdi}>{fellings.length}</Text>
              <Text style={s.sumLabel}>Totalt felt</Text>
            </Surface>
            <Surface style={s.sumKort}>
              <Text style={s.sumVerdi}>
                {totalVekt > 0 ? `${totalVekt.toFixed(1)} kg` : "—"}
              </Text>
              <Text style={s.sumLabel}>Total vekt</Text>
            </Surface>
            <Surface style={s.sumKort}>
              <Text style={s.sumVerdi}>
                {[...new Set(fellings.map((f) => f.dyr))].length}
              </Text>
              <Text style={s.sumLabel}>Arter</Text>
            </Surface>
          </View>
        )}

        {/* ── Kvoter (§4: én rad PER KATEGORI, ikke lenger én rad per art) ── */}
        <Surface style={s.kvoteKort}>
          <View style={s.kvoteHeaderRad}>
            <Text style={s.kvoteKortTittel}>Kvoteoversikt</Text>
            <Pressable onPress={() => setKvoteModal(true)} style={s.kvoteEditKnapp}>
              <Ionicons name="pencil-outline" size={14} color={uiColor.primary} />
              <Text style={s.kvoteEditTxt}>Kategorier</Text>
            </Pressable>
          </View>
          {konfigurerteArter.length === 0 ? (
            <View style={s.kvoteTomt}>
              <Text style={s.kvoteTomtTekst}>
                Ingen kvote-kategorier satt opp ennå. Trykk «Kategorier» for å legge til
                (f.eks. Bukk/Kolle/Kalv for Hjort).
              </Text>
            </View>
          ) : (
            kvoteRader.map((rad) => {
              const pst  = rad.maks > 0 ? Math.min(rad.felt / rad.maks, 1) : 0;
              const over = rad.maks > 0 && rad.felt >= rad.maks;
              return (
                <View key={rad.kategoriId} style={s.kvoteRad}>
                  <Text style={s.kvoteDyr} numberOfLines={1}>
                    {dyrEmoji(rad.dyr)} {rad.dyr} · {rad.navn}
                  </Text>
                  <View style={s.kvoteBarWrap}>
                    <View style={[s.kvoteBar, { width: `${Math.round(pst * 100)}%` as DimensionValue, backgroundColor: over ? uiColor.danger : uiColor.primary }]} />
                  </View>
                  <Text style={[s.kvoteTall, over && s.kvoteTallOver]}>
                    {rad.felt}/{rad.maks > 0 ? rad.maks : "—"}
                  </Text>
                </View>
              );
            })
          )}
          {fellingerUtenKategori.length > 0 && (
            <Text style={s.kvoteUkobletNote}>
              {fellingerUtenKategori.length} felling{fellingerUtenKategori.length === 1 ? "" : "er"} uten
              (gyldig) kvote-kategori — rediger dem for å telle riktig.
            </Text>
          )}
        </Surface>

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
            fellings.map((f) => {
              const katNavn = kategorierFor(f.dyr).find((k) => k.id === f.kategoriId)?.navn;
              return (
                <Surface key={f.id} style={s.kort}>
                  <View style={s.kortTop}>
                    <View style={s.kortEmojiBoks}>
                      <Text style={s.kortEmoji}>{dyrEmoji(f.dyr)}</Text>
                    </View>
                    <View style={s.kortInfo}>
                      <Text style={s.kortDyr}>{f.dyr}{katNavn ? ` · ${katNavn}` : ""}</Text>
                      <Text style={s.kortMeta}>
                        {f.kjønn} · {f.aldersklasse}
                        {f.vektKg != null ? ` · ${f.vektKg} kg` : ""}
                      </Text>
                      <Text style={s.kortDato}>{formaterDato(f.dato)}</Text>
                    </View>
                    <Pressable style={s.ikonKnapp} onPress={() => åpneRedigerModal(f)} hitSlop={8}>
                      <Ionicons name="pencil-outline" size={16} color={uiColor.textMuted} />
                    </Pressable>
                    <Pressable style={s.ikonKnapp} onPress={() => bekreftSlett(f)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={16} color={uiColor.textMuted} />
                    </Pressable>
                  </View>
                  {!!f.kommentar && (
                    <Text style={s.kortKommentar}>{f.kommentar}</Text>
                  )}
                </Surface>
              );
            })
          )}
        </ScrollView>

        <BottomDock />
      </View>

      {/* ── Modal: Kategorier/kvoter (§4) ── */}
      <Modal visible={kvoteModal} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.handle} />
            <Text style={m.tittel}>Kvote-kategorier</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {KVOTE_DYR.map((dyr) => (
                <View key={dyr} style={kq.artBlokk}>
                  <Text style={kq.artTittel}>{dyrEmoji(dyr)} {dyr}</Text>
                  {kategorierFor(dyr).map((kat) => (
                    <View key={kat.id} style={kq.rad}>
                      <TextInput
                        style={kq.navnInput}
                        value={katNavnUtkast[kat.id] ?? kat.navn}
                        onChangeText={(t) => setKatNavnUtkast((p) => ({ ...p, [kat.id]: t }))}
                        onEndEditing={() => lagreKategoriNavn(dyr, kat.id)}
                        placeholder="Kategorinavn"
                        placeholderTextColor={uiColor.textFaint}
                      />
                      <View style={kq.teller}>
                        <Pressable style={kq.btn} onPress={() => endreKategoriMaks(dyr, kat.id, -1)}>
                          <Ionicons name="remove" size={16} color={uiColor.textPrimary} />
                        </Pressable>
                        <Text style={kq.antall}>{kat.maks}</Text>
                        <Pressable style={[kq.btn, kq.btnPlus]} onPress={() => endreKategoriMaks(dyr, kat.id, 1)}>
                          <Ionicons name="add" size={16} color={uiColor.primaryText} />
                        </Pressable>
                      </View>
                      <Pressable
                        style={kq.fjernBtn}
                        onPress={() => bekreftFjernKategori(dyr, kat.id, kat.navn)}
                        hitSlop={8}
                      >
                        <Ionicons name="close" size={16} color={uiColor.textFaint} />
                      </Pressable>
                    </View>
                  ))}
                  <View style={kq.nyRad}>
                    <TextInput
                      style={kq.nyNavnInput}
                      value={nyKatNavn[dyr] ?? ""}
                      onChangeText={(t) => setNyKatNavn((p) => ({ ...p, [dyr]: t }))}
                      placeholder="Ny kategori (f.eks. Bukk)"
                      placeholderTextColor={uiColor.textFaint}
                    />
                    <TextInput
                      style={kq.nyMaksInput}
                      value={nyKatMaks[dyr] ?? ""}
                      onChangeText={(t) => setNyKatMaks((p) => ({ ...p, [dyr]: t.replace(/[^0-9]/g, "") }))}
                      placeholder="Maks"
                      placeholderTextColor={uiColor.textFaint}
                      keyboardType="number-pad"
                    />
                    <Pressable style={kq.leggTilBtn} onPress={() => leggTilKategoriHandler(dyr)}>
                      <Ionicons name="add" size={18} color={uiColor.primaryText} />
                    </Pressable>
                  </View>
                </View>
              ))}
              <Pressable style={[m.lagreKnapp, { marginTop: 4 }]} onPress={() => setKvoteModal(false)}>
                <Text style={m.lagreTxt}>Ferdig</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Modal: Ny/rediger felling ── */}
      <Modal visible={modalVis} transparent animationType="slide">
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.handle} />
            <Text style={m.tittel}>{redigererFelling ? "Rediger felling" : "Registrer felling"}</Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={m.label}>Art</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                <View style={styles.chipRow}>
                  {DYR_LISTE.map((d) => (
                    <Pressable
                      key={d}
                      style={[styles.chip, valgtDyr === d && styles.chipActive]}
                      onPress={() => velgDyrIModal(d)}
                    >
                      <Text style={[styles.chipTxt, valgtDyr === d && styles.chipTxtActive]}>
                        {dyrEmoji(d)} {d}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              {kategorierFor(valgtDyr).length > 0 && (
                <>
                  <Text style={m.label}>Kategori</Text>
                  <View style={styles.chipRow}>
                    {kategorierFor(valgtDyr).map((kat) => (
                      <Pressable
                        key={kat.id}
                        style={[styles.chip, valgtKategoriId === kat.id && styles.chipActive]}
                        onPress={() => setValgtKategoriId(kat.id)}
                      >
                        <Text style={[styles.chipTxt, valgtKategoriId === kat.id && styles.chipTxtActive]}>
                          {kat.navn}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

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
                placeholderTextColor={uiColor.textFaint}
                keyboardType="decimal-pad"
              />

              <Text style={m.label}>Dato (ÅÅÅÅ-MM-DD)</Text>
              <TextInput
                style={m.input}
                value={dateTekst}
                onChangeText={setDateTekst}
                placeholder="2024-10-15"
                placeholderTextColor={uiColor.textFaint}
                keyboardType="numbers-and-punctuation"
              />

              <Text style={m.label}>Kommentar (valgfritt)</Text>
              <TextInput
                style={[m.input, m.inputTall]}
                value={kommentar}
                onChangeText={setKommentar}
                placeholder="Notater om fellingen..."
                placeholderTextColor={uiColor.textFaint}
                multiline
                numberOfLines={3}
              />

              <View style={m.knappeRad}>
                <Pressable style={m.avbrytKnapp} onPress={() => { setModalVis(false); setRedigererFelling(null); }}>
                  <Text style={m.avbrytTxt}>Avbryt</Text>
                </Pressable>
                <Pressable
                  style={[m.lagreKnapp, lagrer && m.lagreKnappDis]}
                  onPress={lagreNy}
                  disabled={lagrer}
                >
                  <Text style={m.lagreTxt}>{lagrer ? "Lagrer..." : redigererFelling ? "Lagre endringer" : "Lagre felling"}</Text>
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
  safe:   { flex: 1, backgroundColor: uiColor.background },
  screen: { flex: 1 },

  header: {
    flexDirection: "row", alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: uiSpacing.xl, paddingTop: uiSpacing.lg, paddingBottom: uiSpacing.sm,
  },
  eyebrow: { ...uiType.eyebrow, color: uiColor.primary, marginBottom: uiSpacing.xs },
  title:   { ...uiType.pageTitle, color: uiColor.textPrimary },
  nyBtn:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: uiColor.primary, borderRadius: uiRadius.pill, paddingHorizontal: uiSpacing.lg, paddingVertical: uiSpacing.sm + 2, marginTop: 6 },
  nyBtnTxt: { color: uiColor.primaryText, fontSize: 14, fontWeight: "800" },

  dagensKort:       { marginHorizontal: uiSpacing.xl, marginBottom: uiSpacing.lg, padding: uiSpacing.xl - 2 },
  dagensEyebrow:    { ...uiType.eyebrow, color: uiColor.primary, marginBottom: uiSpacing.sm },
  dagensArt:        { color: uiColor.textPrimary, fontSize: 18, fontWeight: "900", marginBottom: 6 },
  dagensForklaring: { color: uiColor.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: uiSpacing.md },
  dagensBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: uiColor.primary, borderRadius: uiRadius.md, paddingVertical: 11, alignSelf: "flex-start", paddingHorizontal: uiSpacing.lg,
  },
  dagensBtnTxt: { color: uiColor.primaryText, fontSize: 13, fontWeight: "900" },

  // Kvoter
  kvoteKort:       { marginHorizontal: uiSpacing.xl, marginBottom: uiSpacing.lg, padding: uiSpacing.lg },
  kvoteHeaderRad:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: uiSpacing.md + 2 },
  kvoteKortTittel: { color: uiColor.textPrimary, fontSize: 15, fontWeight: "900" },
  kvoteEditKnapp:  { flexDirection: "row", alignItems: "center", gap: 5 },
  kvoteEditTxt:    { color: uiColor.primary, fontSize: 12, fontWeight: "700" },
  kvoteRad:        { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: uiSpacing.sm + 2 },
  kvoteDyr:        { color: uiColor.textSecondary, fontSize: 13, fontWeight: "700", width: 130 },
  kvoteBarWrap:    { flex: 1, height: 6, backgroundColor: uiColor.background, borderRadius: 3, overflow: "hidden" },
  kvoteBar:        { height: "100%", borderRadius: 3 },
  kvoteTall:       { color: uiColor.textMuted, fontSize: 12, fontWeight: "800", width: 40, textAlign: "right" },
  kvoteTallOver:   { color: uiColor.danger },
  kvoteTomt:       { paddingVertical: 4 },
  kvoteTomtTekst:  { color: uiColor.textMuted, fontSize: 13, lineHeight: 19 },
  kvoteUkobletNote: { color: uiColor.warning, fontSize: 12, lineHeight: 17, marginTop: 4 },

  sumRad:    { flexDirection: "row", gap: 8, paddingHorizontal: uiSpacing.xl, marginBottom: uiSpacing.lg },
  sumKort:   { flex: 1, padding: uiSpacing.md + 2, alignItems: "center" },
  sumVerdi:  { color: uiColor.textPrimary, fontSize: 20, fontWeight: "900" },
  sumLabel:  { color: uiColor.textFaint, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 4 },

  liste: { paddingHorizontal: uiSpacing.xl, paddingBottom: 140, gap: 10 },

  tomtKort:    { alignItems: "center", paddingVertical: 60 },
  tomtEmoji:   { fontSize: 48, marginBottom: uiSpacing.lg },
  tomtTittel:  { color: uiColor.textPrimary, fontSize: 18, fontWeight: "800", marginBottom: uiSpacing.sm },
  tomtSub:     { color: uiColor.textMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },

  kort:       { padding: uiSpacing.lg },
  kortTop:    { flexDirection: "row", alignItems: "flex-start", gap: uiSpacing.md },
  kortEmojiBoks: { width: 44, height: 44, borderRadius: uiRadius.md, backgroundColor: uiColor.surfaceHover, alignItems: "center", justifyContent: "center" },
  kortEmoji:  { fontSize: 22 },
  kortInfo:   { flex: 1 },
  kortDyr:    { color: uiColor.textPrimary, fontSize: 16, fontWeight: "800" },
  kortMeta:   { color: uiColor.textSecondary, fontSize: 13, marginTop: 2 },
  kortDato:   { color: uiColor.textFaint, fontSize: 12, marginTop: 4 },
  ikonKnapp:  { padding: 6 },
  kortKommentar: { color: uiColor.textMuted, fontSize: 13, marginTop: uiSpacing.sm + 2, lineHeight: 18 },
});

const m = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet:    { backgroundColor: uiColor.surface, borderTopLeftRadius: uiRadius.xl + 6, borderTopRightRadius: uiRadius.xl + 6, paddingHorizontal: uiSpacing.xxl - 6, paddingBottom: 40, paddingTop: uiSpacing.md + 2, maxHeight: "90%" },
  handle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: uiColor.border, alignSelf: "center", marginBottom: uiSpacing.xl },
  tittel:   { color: uiColor.textPrimary, fontSize: 20, fontWeight: "900", marginBottom: uiSpacing.xl },
  label:    { color: uiColor.textMuted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: uiSpacing.sm },
  input:    { backgroundColor: uiColor.background, borderRadius: uiRadius.md, borderWidth: 1, borderColor: uiColor.border, color: uiColor.textPrimary, fontSize: 15, paddingHorizontal: uiSpacing.lg, paddingVertical: 13, marginBottom: uiSpacing.lg + 2 },
  inputTall: { height: 90, textAlignVertical: "top", paddingTop: 13 },
  knappeRad: { flexDirection: "row", gap: 10, marginTop: 4 },
  avbrytKnapp: { flex: 1, borderRadius: uiRadius.md, borderWidth: 1, borderColor: uiColor.border, paddingVertical: 15, alignItems: "center" },
  avbrytTxt:   { color: uiColor.textSecondary, fontSize: 15, fontWeight: "700" },
  lagreKnapp:  { flex: 2, borderRadius: uiRadius.md, backgroundColor: uiColor.primary, paddingVertical: 15, alignItems: "center" },
  lagreKnappDis: { opacity: 0.5 },
  lagreTxt:    { color: uiColor.primaryText, fontSize: 15, fontWeight: "800" },
});

const styles = StyleSheet.create({
  chipRow:       { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: uiSpacing.md + 2 },
  chip:          { paddingHorizontal: uiSpacing.md + 2, paddingVertical: 9, borderRadius: uiRadius.pill, backgroundColor: uiColor.background, borderWidth: 1, borderColor: uiColor.border },
  chipActive:    { backgroundColor: uiColor.surfaceHover, borderColor: uiColor.primary },
  chipTxt:       { color: uiColor.textSecondary, fontSize: 13, fontWeight: "700" },
  chipTxtActive: { color: uiColor.primarySoft, fontWeight: "800" },
});

const kq = StyleSheet.create({
  artBlokk: { marginBottom: uiSpacing.xl },
  artTittel: { color: uiColor.textPrimary, fontSize: 15, fontWeight: "800", marginBottom: uiSpacing.sm },
  rad:    { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: uiSpacing.sm },
  navnInput: { flex: 1, color: uiColor.textPrimary, fontSize: 14, fontWeight: "700", backgroundColor: uiColor.background, borderRadius: uiRadius.sm, borderWidth: 1, borderColor: uiColor.border, paddingHorizontal: uiSpacing.sm + 2, paddingVertical: 8 },
  teller: { flexDirection: "row", alignItems: "center", gap: 8 },
  btn:    { width: 30, height: 30, borderRadius: uiRadius.sm - 2, backgroundColor: uiColor.surfaceHover, borderWidth: 1, borderColor: uiColor.border, alignItems: "center", justifyContent: "center" },
  btnPlus: { backgroundColor: uiColor.primary, borderColor: uiColor.primary },
  antall: { color: uiColor.textPrimary, fontSize: 15, fontWeight: "900", minWidth: 22, textAlign: "center" },
  fjernBtn: { padding: 4 },
  nyRad: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  nyNavnInput: { flex: 1, color: uiColor.textPrimary, fontSize: 13, backgroundColor: uiColor.background, borderRadius: uiRadius.sm, borderWidth: 1, borderColor: uiColor.border, paddingHorizontal: uiSpacing.sm + 2, paddingVertical: 8 },
  nyMaksInput: { width: 60, color: uiColor.textPrimary, fontSize: 13, backgroundColor: uiColor.background, borderRadius: uiRadius.sm, borderWidth: 1, borderColor: uiColor.border, paddingHorizontal: uiSpacing.sm, paddingVertical: 8, textAlign: "center" },
  leggTilBtn: { width: 34, height: 34, borderRadius: uiRadius.sm, backgroundColor: uiColor.primary, alignItems: "center", justifyContent: "center" },
});
