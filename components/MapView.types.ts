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
  /**
   * Redesign-oppdraget: eksplisitt gradient-prop slik at NATIVE (react-
   * native-maps sin Heatmap, som ellers faller tilbake til bibliotekets
   * EGEN standardgradient) faktisk kan få den samme fargeskalaen som web
   * (LeafletMapImpl bruker HEATMAP_GRADIENT direkte og trenger ikke denne
   * proppen, men tar imot den for en konsistent kontrakt). Default:
   * HEATMAP_GRADIENT.
   */
  gradient?: { colors: string[]; startPoints: number[]; colorMapSize: number };
};

/**
 * Delt fargeskala for ViltIQs sannsynlighets-heatmap — svak → gul → oransje
 * → rød → intens rød. Brukt av BÅDE react-native-maps sin Heatmap (Android/
 * iOS) og Leaflet.heat (web) slik at kartet ser likt ut uansett plattform.
 *
 * Redesign-oppdraget §5/§6: grønn skal ALDRI bety "høy sannsynlighet" —
 * grønn er merkevare/handling/aktiv, ikke motorens heat-skala. Skalaen
 * startet tidligere på en gjennomsiktig grønn (#4ADE8099), som brøt akkurat
 * dette skillet — byttet til en dempet, lav-alpha GUL i stedet, slik at
 * hele skalaen er monotont varm (gul→oransje→rød) uten noe grønt innslag.
 */
export const HEATMAP_GRADIENT = {
  colors: ["#00000000", "#EAB30855", "#EAB308CC", "#FB923CE0", "#F87171F0", "#DC2626FF"],
  startPoints: [0.0, 0.15, 0.4, 0.6, 0.8, 1.0],
  colorMapSize: 256,
} as const;
