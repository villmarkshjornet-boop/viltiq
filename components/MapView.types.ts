// Delte typer for MapView.web.tsx (SSR-trygg proxy) og LeafletMapImpl.tsx
// (den faktiske Leaflet-implementasjonen, kun lastet client-side — se
// MapView.web.tsx for hvorfor denne splittelsen finnes).

export type LatLng = { latitude: number; longitude: number };

export type Region = LatLng & { latitudeDelta: number; longitudeDelta: number };

export type LongPressEvent = { nativeEvent: { coordinate: LatLng } };

export type MapViewHandle = {
  animateToRegion: (region: Region, durationMs?: number) => void;
};

export type MapType = "terrain" | "satellite" | "standard";

export type MapViewProps = {
  style?: any;
  mapType?: MapType;
  initialRegion?: Region;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  onLongPress?: (e: LongPressEvent) => void;
  onPress?: () => void;
  /** Web-only: vis Geonorge/Kartverket sitt matrikkelkart (eiendomsgrenser) som overlegg. */
  showPropertyBoundaries?: boolean;
  provider?: string; // ignorert på web (kun native/Google-relevant)
  children?: React.ReactNode;
};

export type MarkerProps = {
  coordinate: LatLng;
  anchor?: { x: number; y: number };
  tracksViewChanges?: boolean; // native-only ytelseshint, ignoreres på web
  title?: string;
  description?: string;
  pinColor?: string;
  onPress?: () => void;
  children?: React.ReactNode;
};

export type CircleProps = {
  center: LatLng;
  radius: number; // meter — samme enhet som react-native-maps
  strokeWidth?: number;
  strokeColor?: string;
  fillColor?: string;
};

export type PolygonProps = {
  coordinates: LatLng[];
  strokeWidth?: number;
  strokeColor?: string;
  fillColor?: string;
};

export type WeightedLatLng = LatLng & { weight: number };

export type HeatmapProps = {
  points: WeightedLatLng[];
  /** Radius i "kartpiksler" — samme betydning på begge plattformer, men Leaflet/Google tolker skalaen litt ulikt, se implementasjonene. */
  radius?: number;
  opacity?: number;
};

/**
 * Delt fargeskala for ViltIQs sannsynlighets-heatmap — grønn (lav) → gul →
 * oransje → rød (svært høy), jf. STEG 4-oppdragets §6. Brukt av BÅDE
 * react-native-maps sin Heatmap (Android/iOS) og Leaflet.heat (web) slik at
 * kartet ser likt ut uansett plattform.
 */
export const HEATMAP_GRADIENT = {
  colors: ["#00000000", "#4ADE8099", "#EAB308CC", "#FB923CE0", "#F87171F0", "#DC2626FF"],
  startPoints: [0.0, 0.2, 0.45, 0.65, 0.85, 1.0],
  colorMapSize: 256,
} as const;
