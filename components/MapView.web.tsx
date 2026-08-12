// Web-fallback/-implementasjon for react-native-maps, med et ekte Leaflet-
// kart (Kartverket/Geonorge WMTS/WMS) i stedet for placeholder-teksten som
// var her tidligere.
//
// VIKTIG arkitekturdetalj: Leaflet berører `window` i det modulen lastes,
// noe som krasjer Node under Expo Router sin statiske pre-rendering av
// /kart og /kamera/[id] (`ReferenceError: window is not defined` —
// verifisert direkte, ikke en antagelse). Derfor importerer DENNE filen
// ALDRI "leaflet"/"react-leaflet" statisk — selve implementasjonen ligger i
// components/LeafletMapImpl.tsx, som kun lastes via en dynamisk import()
// inni useEffect (kjører aldri under SSR/statisk rendering, kun i en ekte
// nettleser, etter hydrering). Denne filen er en tynn, SSR-trygg proxy som
// viser en enkel "Laster kart..."-tilstand mens den ekte implementasjonen
// lastes (vanligvis under ett sekund).
//
// app/kart.tsx og app/kamera/[id].tsx bruker <MapView>/<Marker>/<Circle>/
// <Polygon> helt uendret — ingen forretningslogikk er duplisert eller
// flyttet hit, kun kart-rendering. Se docs/DEPLOYMENT.md for research-
// notater om Kartverket/Geonorge sine tjenester (lisens, tilgjengelighet).
import { forwardRef, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import type {
    CircleProps,
    HeatmapProps,
    MapViewHandle,
    MapViewProps,
    MarkerProps,
    PolygonProps,
} from "./MapView.types";

export type {
    CircleProps,
    HeatmapProps,
    LatLng,
    LongPressEvent,
    MapType,
    MapViewHandle,
    MapViewProps,
    MarkerProps,
    PolygonProps,
    Region,
    WeightedLatLng,
} from "./MapView.types";
export { HEATMAP_GRADIENT } from "./MapView.types";

export const PROVIDER_GOOGLE = "google"; // kun for API-kompatibilitet, ubrukt på web

type LeafletImplModule = typeof import("./LeafletMapImpl");

let implPromise: Promise<LeafletImplModule> | null = null;
let cachedImpl: LeafletImplModule | null = null;

function loadImpl(): Promise<LeafletImplModule> {
  if (!implPromise) {
    implPromise = import("./LeafletMapImpl").then((mod) => {
      cachedImpl = mod;
      return mod;
    });
  }
  return implPromise;
}

/** Deler én lastet Leaflet-implementasjon mellom MapView/Marker/Circle/Polygon. */
function useLeafletImpl(): LeafletImplModule | null {
  const [impl, setImpl] = useState<LeafletImplModule | null>(cachedImpl);

  useEffect(() => {
    if (impl) return;
    let aktiv = true;
    loadImpl().then((mod) => {
      if (aktiv) setImpl(mod);
    });
    return () => {
      aktiv = false;
    };
  }, [impl]);

  return impl;
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(props, ref) {
  const impl = useLeafletImpl();

  if (!impl) {
    return (
      <View style={[styles.loading, StyleSheet.flatten(props.style)]}>
        <ActivityIndicator size="large" color="#2CC36B" />
      </View>
    );
  }

  return <impl.LeafletMapView ref={ref} {...props} />;
});

export default MapView;

export function Marker(props: MarkerProps) {
  const impl = useLeafletImpl();
  if (!impl) return null;
  return <impl.Marker {...props} />;
}

export function Circle(props: CircleProps) {
  const impl = useLeafletImpl();
  if (!impl) return null;
  return <impl.Circle {...props} />;
}

export function Polygon(props: PolygonProps) {
  const impl = useLeafletImpl();
  if (!impl) return null;
  return <impl.Polygon {...props} />;
}

export function Heatmap(props: HeatmapProps) {
  const impl = useLeafletImpl();
  if (!impl) return null;
  return <impl.Heatmap {...props} />;
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0B1610",
  },
});
