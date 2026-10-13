import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { color as uiColor, elevation as uiElevation, radius as uiRadius, spacing as uiSpacing, zIndex as uiZ } from "@/src/design/tokens";
import Surface from "./Surface";
import Toggle from "./Toggle";

export type Tidsvindu = "nå" | "6t" | "24t";

/**
 * Designrapport §anbefaling-6 ("del opp kart.tsx"): kartlag-panelet er et
 * av de mest selvstendige stykkene av app/kart.tsx — ni kontrollerte
 * boolean-toggles + tidsvindu-valget, ingen egne handlers/refs, ingen
 * entanglement med kamera-/pin-registreringsflyten. Flyttet hit UENDRET
 * (samme props-i/callback-ut-mønster som før, bare som egne props i stedet
 * for direkte lukket over lokal state) — kart.tsx sin egen kompleksitet er
 * nettopp det denne opprydningen skal redusere, ikke flytte rundt på.
 */
export type MapLayersPanelProps = {
  onClose: () => void;

  visPrediksjon: boolean;
  onToggleVisPrediksjon: () => void;
  heatmapPointCount: number;

  tidsvindu: Tidsvindu;
  onChangeTidsvindu: (v: Tidsvindu) => void;

  visAktiveSoner: boolean;
  onToggleVisAktiveSoner: () => void;

  visObservasjoner: boolean;
  onToggleVisObservasjoner: () => void;
  observasjonCount: number;

  visSporAnnet: boolean;
  onToggleVisSporAnnet: () => void;

  visKameraer: boolean;
  onToggleVisKameraer: () => void;
  kameraCount: number;

  visEiendomsgrenser: boolean;
  onToggleVisEiendomsgrenser: () => void;
};

const TIDSVINDU_VALG: readonly Tidsvindu[] = ["nå", "6t", "24t"];

export default function MapLayersPanel({
  onClose,
  visPrediksjon, onToggleVisPrediksjon, heatmapPointCount,
  tidsvindu, onChangeTidsvindu,
  visAktiveSoner, onToggleVisAktiveSoner,
  visObservasjoner, onToggleVisObservasjoner, observasjonCount,
  visSporAnnet, onToggleVisSporAnnet,
  visKameraer, onToggleVisKameraer, kameraCount,
  visEiendomsgrenser, onToggleVisEiendomsgrenser,
}: MapLayersPanelProps) {
  return (
    <Surface variant="elevated" style={[styles.layersPanel, uiElevation.panel]}>
      {/* Feltrapport (fysisk enhet, V1.3): "ingen måte å minimere den på
          igjen" — panelet hadde KUN layers-knappen i kontrollkolonnen som
          lukke-mekanisme, ikke noe synlig på selve kortet. Samme X-mønster
          som HuntPlanPanel/ModalSheet sine andre paneler. */}
      <View style={styles.layersPanelHeader}>
        <Text style={styles.layersPanelTitle}>Kartlag</Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={18} color={uiColor.textSecondary} />
        </Pressable>
      </View>

      <Text style={styles.layersGroupTitle}>ViltIQ</Text>
      {/* Feltrapport (fysisk enhet, V1.3): tallene i parentes er et bevisst,
          midlertidig diagnosevindu — de skiller "data kom aldri frem" (0)
          fra "data finnes, men vises ikke" (>0 uten noe synlig på kartet),
          uten at brukeren trenger konsoll/Mac. Fjernes når kamera-/
          heatmap-rapportene er bekreftet løst. */}
      <Toggle
        label={`Motor (heatmap) · ${heatmapPointCount} pkt`}
        icon="analytics-outline"
        active={visPrediksjon}
        onToggle={onToggleVisPrediksjon}
        accentColor={uiColor.layerMotor}
      />
      {/* Motor-tidsvindu (§18) — hvor langt tilbake motoren ser etter
          signaler. Kompakt 3-valgs segmentkontroll, samme visuelle mønster
          som Topo/Satellitt-toggleItem i kart.tsx. */}
      <View style={styles.tidsvinduRad}>
        {TIDSVINDU_VALG.map((v) => (
          <Pressable
            key={v}
            onPress={() => onChangeTidsvindu(v)}
            style={[styles.tidsvinduBtn, tidsvindu === v && styles.tidsvinduBtnActive]}
          >
            <Text style={[styles.tidsvinduTxt, tidsvindu === v && styles.tidsvinduTxtActive]}>
              {v === "nå" ? "Nå" : `Siste ${v}`}
            </Text>
          </Pressable>
        ))}
      </View>
      <Toggle label="Aktive soner" icon="time-outline" active={visAktiveSoner} onToggle={onToggleVisAktiveSoner} accentColor={uiColor.layerAktiveSoner} />

      <Text style={styles.layersGroupTitle}>Registreringer</Text>
      <Toggle label={`Observasjoner · ${observasjonCount}`} icon="eye-outline" active={visObservasjoner} onToggle={onToggleVisObservasjoner} accentColor={uiColor.layerObservasjoner} />
      <Toggle label="Spor og andre punkter" icon="footsteps-outline" active={visSporAnnet} onToggle={onToggleVisSporAnnet} accentColor={uiColor.warning} />
      <Toggle label={`Kamera · ${kameraCount}`} icon="camera" active={visKameraer} onToggle={onToggleVisKameraer} accentColor={uiColor.info} />
      {/* Feltrapport (fysisk enhet, V1.3): "eiendomsgrenser fungerer ikke,
          kommer ingenting der" — stemmer, men ikke en bug: dette laget
          (Kartverket/Geonorge-matrikkelkart) er KUN implementert for web
          (se components/MapView.web.tsx) — components/MapView.tsx (native)
          stripper `showPropertyBoundaries` stille, med vilje, fordi
          react-native-maps aldri fikk en tilsvarende native implementasjon.
          Å la bryteren stå synlig og ikke-fungerende på native er verre enn
          å skjule den. Ekte native eiendomsgrenser er et eget,
          ikke-trivielt arbeid (ny datakilde/rendering), ikke noe som løses
          som en del av denne opprydningen. */}
      {Platform.OS === "web" && (
        <Toggle label="Eiendomsgrenser" icon="map-outline" active={visEiendomsgrenser} onToggle={onToggleVisEiendomsgrenser} accentColor={uiColor.levelHøy} />
      )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  layersPanel: {
    position: "absolute", right: 14, top: 114,
    width: 240, padding: uiSpacing.lg,
    zIndex: uiZ.panel,
  },
  layersPanelHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: uiSpacing.sm,
  },
  layersPanelTitle: {
    color: uiColor.textPrimary, fontSize: 13, fontWeight: "900",
    textTransform: "uppercase", letterSpacing: 1,
  },
  layersGroupTitle: {
    color: uiColor.textFaint, fontSize: 10, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 0.6,
    marginTop: uiSpacing.sm, marginBottom: 2,
  },
  tidsvinduRad: {
    flexDirection: "row", backgroundColor: uiColor.surface,
    borderRadius: uiRadius.md, padding: 3, gap: 2,
    borderWidth: 1, borderColor: uiColor.border,
    marginTop: uiSpacing.xs, marginBottom: uiSpacing.sm,
  },
  tidsvinduBtn: { flex: 1, paddingVertical: 6, borderRadius: 9, alignItems: "center" },
  tidsvinduBtnActive: { backgroundColor: uiColor.primary },
  tidsvinduTxt: { color: uiColor.textMuted, fontSize: 11, fontWeight: "700" },
  tidsvinduTxtActive: { color: uiColor.primaryText, fontWeight: "900" },
});
