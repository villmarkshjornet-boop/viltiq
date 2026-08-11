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
