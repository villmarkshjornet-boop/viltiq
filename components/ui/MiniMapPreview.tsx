import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { breadcrumb } from "@/src/lib/debugBreadcrumb";
import MapView, { Heatmap, HEATMAP_GRADIENT, Polygon } from "@/components/MapView";
import type { LatLng, Region } from "@/components/MapView.types";
import { color, radius, spacing, typography } from "@/src/design/tokens";
import { StableMarker } from "@/components/ui/Marker";
import { vindRetningLabel } from "@/src/lib/geo";
import { applyHeatmapRenderWeight } from "@/src/lib/heatmapRender";
import type { HeatmapPoint, PredictionZone } from "@/src/engine";

// Samme skala som kart.tsx sin HEATMAP_POINT_RADIUS (42), men skalert ned for
// dette mye mindre forhåndsvisningskortet (190px høyt) — full 42px ville
// dekket nesten hele kortet i én sammenhengende flate og druknet
// sone-omrisset/badgen. ~60% gir en tydelig, avgrenset varmeglød uten å bli
// et flatt fargelag. NB: kameraet (beregnRegion) er nå fit-bounds-basert og
// kan vise et bredere utsnitt enn tidligere (se beregnRegion) — verifisert
// empirisk (pixel-alpha-sjekk) at heatmapet fortsatt leser som en tydelig
// gradient og ikke drukner ved et videre kamera.
const MINI_HEATMAP_RADIUS = 26;
// Leaflet.heat (web) bruker ikke denne (kun native react-native-maps'
// Heatmap-lag har et eksplisitt opacity-lag) — satt eksplisitt likevel så
// laget ikke arver bibliotekets standard-dempede opacity på native.
const MINI_HEATMAP_OPACITY = 0.85;
// Leaflet.heat sin `max`-normalisering (web) — se MapView.types.ts sin
// HeatmapProps.max-dokumentasjon. Med zoom-dempingen nullet ut (se
// zoomForLongitudeDelta under) topper et rent miljøbasert
// cold-start-vektbånd typisk ut rundt 0.5–0.7 (etter heatmapRender.ts sin
// gammaløft), ikke nær 1.0 som Leaflet.heat sin standard `max` forutsetter.
// 0.7 gir en tydelig varm topp-farge for sterke celler uten å flate ALLE
// celler (også svake) til samme mettede rødtone.
const MINI_HEATMAP_MAX = 0.7;

// DIAGNOSE-KONKLUSJON (se samtale): Å fjerne HELE det native kartet fikset
// krasjet/frysen definitivt — Heatmap/Polygon-mount-rekkefølge, en full
// react-native-maps-oppgradering (1.20.1 → 1.29.2), og korrekt Google Maps-
// plugin-oppsett endret INGENTING på egen hånd. Det isolerer feilen til det
// å ha et LIVE MapView her i det hele tatt, ikke til innholdet i det.
// Ledende hypotese: `pointerEvents="none"` under (satt for å hindre at
// kartet stjeler scroll-gesten fra Hjem sin ScrollView / hero-kortets
// GestureDetector-swipe) er et RN-konsept — det slår IKKE av MapKit/Google
// Maps sine EGNE native gesture-recognizers, som fortsatt henger på selve
// UIView-hierarkiet. Et lite kart i en ScrollView+GestureDetector med
// fortsatt-aktive native gesture-recognizers er en kjent krasjkilde for
// react-native-maps. kart.tsx sitt fullskjermkart har ingen slik konflikt
// (ikke inni en ScrollView/annen gesture-container). Fiks: slå av kartets
// EGNE SDK-gesture-recognizers eksplisitt (scrollEnabled/zoomEnabled/
// rotateEnabled/pitchEnabled), ikke bare RN sin pointerEvents. Denne fiksen
// endret heller INGENTING — fortsatt svart med én gang. Slår derfor
// kartet av igjen her for å kunne teste NESTE hypotese isolert: er dette
// spesifikt MiniMapPreview sin lille, innebygde kontekst, eller krasjer
// react-native-maps rett og slett uansett hvor det brukes på denne
// iOS 26-oppsettet? Test: naviger til /kart (det ekte, fullskjerm-kartet)
// med DENNE builden og se om DET også krasjer.
const DIAGNOSTIC_DISABLE_NATIVE_MAP = true;

type MiniMapMedlem = { uid: string; navn: string; latitude: number; longitude: number };

type MiniMapPreviewProps = {
  userPosition: LatLng;
  zone: PredictionZone | null;
  /** Motorens FULLE skårede flate for denne arten (samme EngineResult.heatmapPoints som Kart tegner) — samme kilde, ikke en egen syntetisk beregning. Faller tilbake til kun sonens footprint-celler når ikke oppgitt. */
  heatmapPoints?: HeatmapPoint[];
  medlemmer: MiniMapMedlem[];
  vindRetning?: number;
  vindHastighet?: number;
  onÅpneKart: () => void;
};

const METERS_PER_DEG_LAT = 111320;
// Faktisk fit-bounds mellom bruker og sone, IKKE bare "midtpunkt + avstand"
// (den forrige modellen ga en kameraramme trangere enn selve motorens
// analyseradius — HJEM_ANALYSE_RADIUS_METER i app/index.tsx er 500m, men et
// nærliggende senter+avstand-vindu bunnet ofte ut på deltaGrader-gulvet
// 0.01, altså et ~1,1 km utsnitt — SMALERE enn heat-skiven, som da fylte
// HELE forhåndsvisningen kant-til-kant og så ut som ett stort rektangel,
// siden man aldri fikk se der scoren faller av mot kanten). Nytt mål: vis
// ~1–3 km terreng-kontekst rundt det relevante området, aldri gate-nivå.
const MIN_SPAN_METERS = 900;
const MAX_SPAN_METERS = 3200;
const PADDING_FACTOR = 1.6;

/** Regionen må dekke BÅDE brukerens posisjon og sonens FAKTISKE utstrekning (hull, ikke bare senterpunktet), med raus padding — ekte fit-bounds, ikke en fast avstandsbasert gjetning. */
function beregnRegion(bruker: LatLng, sone: PredictionZone | null): Region {
  const punkter: LatLng[] = [bruker];
  if (sone) {
    if (sone.footprint?.hull && sone.footprint.hull.length >= 3) punkter.push(...sone.footprint.hull);
    else punkter.push(sone.center);
  }

  const lats = punkter.map((p) => p.latitude);
  const lngs = punkter.map((p) => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const senterLat = (minLat + maxLat) / 2;
  const senterLng = (minLng + maxLng) / 2;

  // Lengdegrad krymper med breddegrad (spesielt merkbart i Norge) — må regnes
  // om til meter i ØST-VEST-retning separat fra nord-sør, ellers blir
  // padding feil ved høye breddegrader.
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((senterLat * Math.PI) / 180) || 1;
  const spennLatM = (maxLat - minLat) * METERS_PER_DEG_LAT;
  const spennLngM = (maxLng - minLng) * metersPerDegLng;
  const spennM = Math.max(spennLatM, spennLngM);

  const spennMedPadding = Math.min(MAX_SPAN_METERS, Math.max(MIN_SPAN_METERS, spennM * PADDING_FACTOR));
  const deltaGrader = spennMedPadding / METERS_PER_DEG_LAT;

  return { latitude: senterLat, longitude: senterLng, latitudeDelta: deltaGrader, longitudeDelta: deltaGrader };
}

// Grov omregning fra breddegrad-delta til faktisk Leaflet-zoomnivå — trengs
// for å nulle ut Leaflet.heat sin zoom-avhengige demping (HeatmapProps.maxZoom,
// se MapView.types.ts) korrekt uansett hvor stort fit-bounds-vinduet endte
// opp med å bli. Trenger ikke pikselperfekt treff, kun riktig størrelsesorden
// — antar en typisk kortbredde (~380px), samme antakelse uansett faktisk
// skjermbredde siden avviket i resulterende zoom-heltall er neglisjerbart.
const ANTATT_KORTBREDDE_PX = 380;
function anslåLeafletZoom(deltaGrader: number): number {
  return Math.round(Math.log2((360 * ANTATT_KORTBREDDE_PX) / 256 / deltaGrader));
}

/**
 * Redesign-oppdraget (Hjem-dashbord): kompakt, IKKE-interaktiv forhåndsvisning
 * av kartet — hele kortet er én trykkflate til /kart (pointerEvents="none" på
 * selve MapView hindrer at et pan-forsøk her stjeler scroll-gesten fra Hjem
 * sin ScrollView). Gjenbruker sonens FAKTISKE footprint (samme celler/skrog
 * som det fulle kartet tegner) — ingen egen, syntetisk heatmap-beregning.
 */
export default function MiniMapPreview({ userPosition, zone, heatmapPoints, medlemmer, vindRetning, vindHastighet, onÅpneKart }: MiniMapPreviewProps) {
  breadcrumb("minimap_function_body_entered");
  const region = useMemo(() => beregnRegion(userPosition, zone), [userPosition, zone]);
  const heatmapMaxZoom = useMemo(() => anslåLeafletZoom(region.latitudeDelta), [region]);

  useEffect(() => {
    breadcrumb("minimap_js_mount_effect_fired");
  }, []);

  const heatmapPunkter = useMemo(
    () =>
      heatmapPoints && heatmapPoints.length > 0
        ? heatmapPoints
        : (zone?.footprint?.cells ?? []).map((c) => ({ ...c, weight: 0.75 })),
    [heatmapPoints, zone]
  );

  // Samme render-transform som kart.tsx sin heatmapRenderPoints — se
  // src/lib/heatmapRender.ts. Motorens rå score (heatmapPunkter, ofte
  // 0.05–0.5) løftes til et synlig fargebånd via den låste gammakurven, UTEN
  // å røre selve motor-vekten. Må aldri reimplementeres lokalt her.
  const heatmapRenderPunkter = useMemo(() => applyHeatmapRenderWeight(heatmapPunkter), [heatmapPunkter]);

  // Diagnose-funnet, RUNDE 2 (se samtale): brødsmule-tidslinjen viste at
  // key-basert tvungen remount av Heatmap (forrige forsøk) IKKE endret noe —
  // krasjet skjedde fortsatt nøyaktig ved environment_resolver_ready, hverken
  // tidligere eller senere. Det avkrefter "prop-oppdatering er problemet".
  // Den faktiske fellesnevneren: `zone` er `null` helt til environmentResolver
  // blir klar (eller observasjoner kommer inn) — så BÅDE Heatmap og Polygon
  // er FRAVÆRENDE ved første mount, og blir lagt til for FØRSTE gang som en
  // inkrementell tilføyelse til et kart som allerede er onMapReady. Det er en
  // annen, mindre utprøvd kodevei i react-native-maps' Fabric-implementasjon
  // enn "alt monteres sammen i én batch" (som onMapReady beviser fungerer).
  // Fiks: Heatmap er nå ALLTID i treet fra første render (tom points-array
  // er trygt), slik at den er del av den samme, bevist stabile initial-
  // batchen i stedet for å dukke opp etterpå. Se tilsvarende fiks for
  // Polygon under.
  // gradient ble tidligere bygget som et helt NYTT objekt (med nye arrays)
  // på HVER render — ødela all identitets-basert diffing i den native laget
  // og la trolig ekstra bensin på den samme ustabiliteten. HEATMAP_GRADIENT
  // er en modul-konstant; kopier den KUN én gang (memoisert), ikke per render.
  const heatmapGradient = useMemo(
    () => ({ ...HEATMAP_GRADIENT, colors: [...HEATMAP_GRADIENT.colors], startPoints: [...HEATMAP_GRADIENT.startPoints] }),
    []
  );

  return (
    <Pressable style={styles.wrap} onPress={onÅpneKart}>
      <View style={styles.mapClip} pointerEvents="none">
        {DIAGNOSTIC_DISABLE_NATIVE_MAP ? (
          <View style={[StyleSheet.absoluteFillObject, styles.diagnosticPlaceholder]}>
            <Text style={styles.diagnosticPlaceholderText}>Kart (diagnose: deaktivert)</Text>
          </View>
        ) : (
          <MapView
            style={StyleSheet.absoluteFillObject}
            initialRegion={region}
            showsUserLocation={false}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            onMapReady={() => breadcrumb("minimap_native_onMapReady")}
          >
            <Heatmap
              points={heatmapRenderPunkter}
              radius={MINI_HEATMAP_RADIUS}
              opacity={MINI_HEATMAP_OPACITY}
              max={MINI_HEATMAP_MAX}
              maxZoom={heatmapMaxZoom}
              gradient={heatmapGradient}
            />
            {/* Polygon er, som Heatmap over, ALLTID i treet fra første render
                (aldri lagt til etterpå) — se diagnose-kommentaren over. Uten en
                ekte sone-hull ennå brukes et degenerert (null-areal) triangel
                på brukerens egen posisjon, som ikke tegner noe synlig, i stedet
                for at selve <Polygon>-elementet mountes inn i etterkant. */}
            <Polygon
              coordinates={
                zone?.footprint?.hull && zone.footprint.hull.length >= 3
                  ? zone.footprint.hull
                  : [userPosition, userPosition, userPosition]
              }
              strokeWidth={2.5}
              strokeColor={color.primary + "E0"}
              fillColor={color.primary + "0A"}
            />
            <StableMarker coordinate={userPosition} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.megPin} />
            </StableMarker>
            {medlemmer.map((m) => (
              <StableMarker key={m.uid} coordinate={{ latitude: m.latitude, longitude: m.longitude }} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.medlemPin}>
                  <Text style={styles.medlemPinTxt}>{(m.navn[0] ?? "?").toUpperCase()}</Text>
                </View>
              </StableMarker>
            ))}
          </MapView>
        )}
      </View>

      {/* Vindkompass-badge */}
      {typeof vindRetning === "number" && (
        <View style={styles.windBadge}>
          <Ionicons
            name="navigate"
            size={13}
            color={color.info}
            style={{ transform: [{ rotate: `${vindRetning}deg` }] }}
          />
          <Text style={styles.windText}>
            {vindRetningLabel(vindRetning)} {typeof vindHastighet === "number" ? `· ${vindHastighet} m/s` : ""}
          </Text>
        </View>
      )}

      {/* Sone-etikett */}
      {zone && (
        <View style={styles.zoneBadge}>
          <View style={styles.zoneDot} />
          <Text style={styles.zoneText}>Anbefalt sone · {Math.round(zone.score)}/100</Text>
        </View>
      )}

      <View style={styles.openBtn}>
        <Ionicons name="expand-outline" size={13} color={color.primaryText} />
        <Text style={styles.openBtnText}>Åpne kart</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 190,
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surfaceElevated,
  },
  mapClip: { ...StyleSheet.absoluteFillObject },
  diagnosticPlaceholder: { alignItems: "center", justifyContent: "center" },
  diagnosticPlaceholderText: { ...typography.caption, color: color.textSecondary },

  megPin: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: color.info, borderWidth: 2, borderColor: "#FFFFFF",
  },
  medlemPin: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: color.surfaceElevated, borderWidth: 1.5, borderColor: color.primary,
    alignItems: "center", justifyContent: "center",
  },
  medlemPinTxt: { fontSize: 10, fontWeight: "900", color: color.primarySoft },

  windBadge: {
    position: "absolute", top: spacing.sm, right: spacing.sm,
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(8,14,10,0.85)", borderRadius: radius.pill,
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderWidth: 1, borderColor: color.border,
  },
  windText: { ...typography.caption, color: color.textSecondary },

  zoneBadge: {
    position: "absolute", top: spacing.sm, left: spacing.sm,
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(8,14,10,0.85)", borderRadius: radius.pill,
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderWidth: 1, borderColor: color.border,
  },
  zoneDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.primary },
  zoneText: { ...typography.caption, color: color.textSecondary },

  openBtn: {
    position: "absolute", bottom: spacing.sm, right: spacing.sm,
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: color.primary, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 7,
  },
  openBtnText: { fontSize: 11, fontWeight: "900", color: color.primaryText },
});
