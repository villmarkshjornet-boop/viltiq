import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
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
 *
 * Feltrapport (fysisk iOS-enhet, V1.3): et kamera satt ned midt i en økt
 * manglet FORTSATT ikonet med et enkelt 600ms-vindu — sannsynlig fordi
 * `closePinPanel()` (skjemaet lukkes idet lagringen går gjennom) utløser en
 * egen layout-omveltning SAMTIDIG som markøren mountes, som i verste fall kan
 * skyve selve layout-ferdigstillelsen forbi ett enkelt tidsvindu.
 *
 * Feltrapport (fysisk enhet, V1.3, senere runde): etter at markør-INNHOLDET
 * ble bekreftet synlig igjen (react-native-maps oppgradert til 1.29.11, se
 * app/kart.tsx), var INGEN markør — verken kamera eller hotspot, altså
 * uavhengig av innhold — trykkbar lenger. Mistanke: når
 * `tracksViewChanges` settler på `false` (over), kan selve
 * BERØRINGS-/hit-test-området fryse på en geometri som ble beregnet FØR et
 * senere, reelt layout-oppdatering — en snapshot kan se visuelt korrekt ut
 * uten at det underliggende trykk-området fulgte med. Siden dette kun kan
 * bekreftes på fysisk enhet (web bruker en helt annen rendering-vei), er
 * `tracksViewChanges` nå satt PERMANENT `true` for alle markører som en
 * ren, utvetydig test: dyrere (ett nytt snapshot per re-render), men
 * fjerner "settling"-tidsvinduet som variabel fullstendig i stedet for å
 * gjette på enda et tidspunkt.
 */
/**
 * Feltrapport (fysisk enhet, V1.3): på iOS + Google Maps-provider er
 * `Marker` sin egen `stopPropagation`-prop IKKE støttet (kun Apple Maps,
 * se react-native-maps sin egen type-dokumentasjon) — et trykk på en
 * markør kan derfor ALLEREDE nå rekke å bli videresendt til kartets EGNE
 * (helt separate, native) trykk-gjenkjenner, som i app/kart.tsx sin
 * `<MapView onPress={...}>` bl.a. nullstiller `selectedCamera` igjen rett
 * etter at en markør nettopp satte den. Modulnivå (ikke React-state) med
 * vilje: dette er ren, synkron bokføring delt på tvers av ALLE
 * markør-instanser, ikke noe som skal trigge re-render. `wasMarkerJustPressed`
 * lar kart.tsx sin egen `<MapView onPress>` ignorere seg selv kort tid etter
 * et ekte markørtrykk, i stedet for blindt å anta at markøren "vant".
 */
let lastMarkerPressAt = 0;
export function wasMarkerJustPressed(windowMs = 400): boolean {
  return Date.now() - lastMarkerPressAt < windowMs;
}

export function StableMarker({ onPress, ...rest }: ComponentProps<typeof MapMarker>) {
  return (
    <MapMarker
      {...rest}
      tracksViewChanges
      onPress={(e) => {
        lastMarkerPressAt = Date.now();
        onPress?.(e);
      }}
    />
  );
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
    // `collapsable={false}`: samme react-native-maps-snapshot-hardening som
    // app/kart.tsx sin kameramarkør nå bruker — `wrap` har ingen egen synlig
    // stil (kun alignItems), og RN sin view-flattening-optimalisering kan i
    // prinsippet fjerne den som egen native node før react-native-maps får
    // tatt et bilde av den. Sentralt her (ikke bare på kamera-markøren)
    // fordi ALLE markørtyper i appen (observasjon/spor/annet/party/
    // best-zone/candidate) bruker nettopp denne komponenten.
    <View style={styles.wrap} collapsable={false}>
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
