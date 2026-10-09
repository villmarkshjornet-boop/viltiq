// Native (iOS/Android) — tynn wrapper rundt det ekte react-native-maps.
// Metro velger denne filen automatisk for native-plattformer og faller
// tilbake til MapView.web.tsx på web (platform-spesifikk filnavn-oppløsning).
//
// Wrapper (ikke ren videreeksport) kun for å kunne dele én felles, utvidet
// prop-kontrakt med web-varianten — `showPropertyBoundaries` er et web-only
// felt (Kartverket/Geonorge-matrikkelkart, se MapView.web.tsx) som ikke
// finnes i react-native-maps. Native ignorerer det stille i stedet for at
// app/kart.tsx må platform-forgrene selve JSX-en. Alt annet sendes uendret
// videre til det ekte MapView — null endring i native oppførsel.
import { forwardRef } from "react";
import RNMapView, { Circle, Heatmap as RNHeatmap, Marker, Polygon, PROVIDER_GOOGLE } from "react-native-maps";
import type { LongPressEvent, MapViewProps } from "react-native-maps";
export { HEATMAP_GRADIENT } from "./MapView.types";
import type { HeatmapProps } from "./MapView.types";

type Props = MapViewProps & {
  showPropertyBoundaries?: boolean;
};

const MapView = forwardRef<RNMapView, Props>(function MapView(
  { showPropertyBoundaries: _showPropertyBoundaries, ...rest },
  ref
) {
  return <RNMapView ref={ref} {...rest} />;
});

export default MapView;
export { Circle, Marker, Polygon, PROVIDER_GOOGLE };

// Samme wrapper-prinsipp som MapView over: `max` er et Leaflet.heat-
// spesifikt web-only felt (se MapView.types.ts sin HeatmapProps) uten
// ekvivalent i react-native-maps sin egen Heatmap — strippes stille i stedet
// for at kalleren (MiniMapPreview.tsx) må platform-forgrene selve JSX-en.
// Null endring i native oppførsel for eksisterende kall (radius/opacity/
// gradient/points videreføres uendret).
export function Heatmap({ max: _max, ...rest }: HeatmapProps) {
  return <RNHeatmap {...rest} />;
}
export type { LongPressEvent };
// Typen en `useRef<MapViewHandle>()` faktisk peker på — RNMapView-instansen
// selv på native (samme type begge web- og native-varianten eksporterer
// under samme navn, se MapView.web.tsx).
export type MapViewHandle = RNMapView;
