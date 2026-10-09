import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState, type ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Marker as MapMarker } from "@/components/MapView";
import { color } from "@/src/design/tokens";

/**
 * Diagnose-funn (se samtale): et kamera registrert MIDT i en aktiv økt (ikke
 * del av det opprinnelige datasettet ved kart-mount) dukket aldri opp på
 * kartet, selv om registreringen selv lyktes. Årsak: `tracksViewChanges={false}`
 * satt til `false` FRA FØRSTE RENDER kan fange en native-markør i et blankt/
 * 0×0-snapshot dersom SDK-en tar det aller første bildet før egendefinert
 * View-innhold (MarkerBadge) faktisk har fått layoutet seg — og siden ingen
 * ny snapshot noensinne skjer etterpå, blir markøren PERMANENT usynlig. Kjent
 * react-native-maps/iOS-Fabric-kvirk (bekreftet i samtalens research).
 * Erstatning for `<Marker tracksViewChanges={false}>`: start `true` (la SDK-en
 * ta et korrekt bilde av det faktisk ferdiglayoutede innholdet), flipp til
 * `false` en kort stund etterpå (stabil ytelse for markører som uansett ikke
 * endrer utseende over tid — samme sluttilstand som før, bare trygg ankomst).
 */
const TRACKS_VIEW_CHANGES_SETTLE_MS = 600;

export function StableMarker(props: ComponentProps<typeof MapMarker>) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracksViewChanges(false), TRACKS_VIEW_CHANGES_SETTLE_MS);
    return () => clearTimeout(t);
  }, []);
  return <MapMarker {...props} tracksViewChanges={tracksViewChanges} />;
}

/**
 * Redesign-oppdraget §22/§23: ÉN konsistent ViltIQ-markørspråk på kartet i
 * stedet for 8 separate, hardkodede bubble/pil-trioer (moose/obs/spor/annet/
 * kamera/hotspot/party/valgt-pin). Fargen er den PRIMÆRE skilleren mellom
 * typer, med et ikon/emoji som sekundær bekreftelse — ikke fem urelaterte
 * visuelle språk.
 *
 * Bevisst IKKE bygget med react-native-svg — en sirkel (borderRadius) + en
 * CSS-border-trekant gjengis like skarpt som SVG på både native og web (via
 * LeafletMapImpl sin renderToStaticMarkup), og er allerede det etablerte,
 * velprøvde mønsteret i denne appen. react-native-svg er lagt til for annet
 * arbeid i redesignen (kartets svake konturtekstur, §7) — å bruke det her
 * også ville bare vært ekstra kompleksitet uten synlig gevinst.
 */
export type MarkerKind =
  | "observation"
  | "spor"
  | "annet"
  | "kamera"
  | "party"
  | "best-zone"
  | "candidate";

type Size = "sm" | "md" | "lg";

const KIND_COLOR: Record<MarkerKind, string> = {
  observation: color.primary,
  spor: color.warning,
  annet: color.textMuted,
  kamera: color.info,
  party: color.confidenceMiddels,
  "best-zone": color.levelHøy,
  candidate: color.textSecondary,
};

const SIZE_PX: Record<Size, number> = { sm: 28, md: 34, lg: 46 };

type MarkerBadgeProps = {
  kind: MarkerKind;
  size?: Size;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Artsemoji e.g. — har forrang over `icon` når begge er satt. */
  emoji?: string;
  /** Overstyrer kind-standardfargen (f.eks. Rev-observasjon får en varmere tone enn resten av dyra). */
  accentColor?: string;
};

/** Pin-stil markør: sirkel-boble + liten pekende hale. Brukt for observasjon/spor/annet/kamera/party/beste-sone/kandidat. */
export function MarkerBadge({ kind, size = "md", icon, emoji, accentColor }: MarkerBadgeProps) {
  const c = accentColor ?? KIND_COLOR[kind];
  const px = SIZE_PX[size];
  const tailSize = Math.round(px * 0.24);

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.bubble,
          {
            width: px,
            height: px,
            borderRadius: px / 2,
            borderColor: c,
            backgroundColor: kind === "candidate" ? "transparent" : color.surfaceElevated,
            borderStyle: kind === "candidate" ? "dashed" : "solid",
          },
        ]}
      >
        {emoji ? (
          <Text style={{ fontSize: Math.round(px * 0.5) }}>{emoji}</Text>
        ) : icon ? (
          <Ionicons name={icon} size={Math.round(px * 0.42)} color={c} />
        ) : null}
      </View>
      <View
        style={[
          styles.tail,
          {
            borderLeftWidth: tailSize,
            borderRightWidth: tailSize,
            borderTopWidth: tailSize * 1.5,
            borderTopColor: c,
          },
        ]}
      />
    </View>
  );
}

type MarkerRingProps = {
  /** "hotspot" = fylt, halvtransparent — et TRYKKBART område. "own-position" = tynn presisjonsring rundt et fast senterpunkt, ikke trykkbar. */
  variant: "hotspot" | "own-position";
  color?: string;
  size?: number;
};

/**
 * Ring i stedet for pin — bevisst brukt der en pin ville løyet om presisjon
 * (§7/§19): hotspot er et OMRÅDE, egen posisjon er et ANSLAG, ikke et
 * eksakt punkt. Touch-arealet er alltid minTouchTarget selv når den
 * visuelle ringen er mindre (håndteres av kalleren sin Marker-wrapper).
 */
export function MarkerRing({ variant, color: c, size }: MarkerRingProps) {
  if (variant === "own-position") {
    const ringSize = size ?? 40;
    const dotColor = c ?? color.primary;
    return (
      <View style={[styles.ownPosRing, { width: ringSize, height: ringSize, borderRadius: ringSize / 2, borderColor: dotColor + "3D" }]}>
        <View style={[styles.ownPosDot, { backgroundColor: dotColor }]} />
      </View>
    );
  }
  const ringSize = size ?? 26;
  const ringColor = c ?? color.levelHøy;
  return (
    <View
      style={[
        styles.hotspotRing,
        {
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderColor: ringColor,
          backgroundColor: ringColor + "2E",
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
  bubble: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  tail: {
    width: 0,
    height: 0,
    borderStyle: "solid",
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },

  ownPosRing: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 8,
  },
  ownPosDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: color.textPrimary,
  },

  hotspotRing: {
    borderWidth: 3,
  },
});
