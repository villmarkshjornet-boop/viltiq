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
  /**
   * BUG 4 (V1.5): utvidet fra `() => void` til å også bære koordinaten
   * (samme `{nativeEvent:{coordinate}}`-form som onLongPress over) —
   * nødvendig for jaktområde-tegning (hvert trykk legger til et polygon-
   * hjørne på DET trykte punktet). Rent additivt: eksisterende handlere som
   * ignorerer argumentet (f.eks. `onPress={() => {...}}` i kart.tsx) er
   * fortsatt fullt gyldige — ingen eksisterende kallsted er endret av dette.
   * Native (react-native-maps, se MapView.tsx) har ALLEREDE koordinaten i
   * sitt eget onPress-event; det var kun web/Leaflet-siden som manglet den.
   */
  onPress?: (e: LongPressEvent) => void;
  /**
   * V1.2.2: fyres når brukeren er FERDIG å panorere/zoome (ikke per pixel
   * under selve draget) — native (react-native-maps) har dette innebygget,
   * web (Leaflet) fyrer den fra "moveend"/"zoomend", se LeafletMapImpl.tsx.
   * Dette er kartets EGEN region — kart.tsx bruker den til å la
   * analyseområdet følge kartet i stedet for å være låst til userLocation.
   */
  onRegionChangeComplete?: (region: Region) => void;
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
   * Leaflet.heat sin intensitets-normaliseringsdivisor (web-only — se
   * LeafletMapImpl.tsx sin Heatmap): alpha for ett punkt ≈ weight/max. Default
   * 1.0 (Leaflet.heat sin egen standard, UENDRET for hovedkartets bruk) er
   * kalibrert mot vekter som nærmer seg 1.0 (sterke ferske observasjoner).
   * Et rent miljøbasert cold-start-vektbånd ligger typisk mye lavere
   * (~0.35–0.6 selv etter heatmapRender.ts sin gammaløft), og blir da nesten
   * usynlig ved max=1.0 (målt: toppunkt-alpha ≈34/255 — se Hjem-oppdraget
   * "Home Intelligence: Cold Start" §7). En LAVERE `max` her booster kun
   * DENNE spesifikke kartinstansens visuelle intensitet — endrer ALDRI selve
   * scoren/vekten (den samme absolutte heatmapRender.ts-kurven brukes
   * uansett), kun hvor tett Leaflet.heat sin egen alpha-skala sitter.
   */
  max?: number;
  /**
   * Redesign-oppdraget: eksplisitt gradient-prop slik at NATIVE (react-
   * native-maps sin Heatmap, som ellers faller tilbake til bibliotekets
   * EGEN standardgradient) faktisk kan få den samme fargeskalaen som web.
   * LeafletMapImpl sin Heatmap bruker også denne proppen (bygger sitt
   * Leaflet.heat-gradientkart fra den) i stedet for å hardkode sin egen kopi
   * fra HEATMAP_GRADIENT — begge plattformer leser dermed samme kilde via
   * samme kontrakt. Default (hvis ikke sendt inn): HEATMAP_GRADIENT.
   */
  gradient?: { colors: string[]; startPoints: number[]; colorMapSize: number };
  /**
   * Web-only (Leaflet.heat): Leaflet.heat DEMPER hvert punkts vekt med en
   * zoom-avhengig faktor `1 / 2^(maxZoom - gjeldendeZoom)` (se
   * leaflet.heat/src/HeatLayer.js `_redraw`) — jo lenger kartets FAKTISKE
   * zoom er unna `maxZoom`-opsjonen, jo svakere blir heatmapet, UANSETT
   * `weight` eller `max`. Hovedkartet (kart.tsx) opererer nær sin
   * analysezoom (nær standardverdien 17) og merker det ikke. MiniMapPreview
   * er derimot LÅST (react-leaflet oppdaterer ikke zoom etter mount) til et
   * mye lavere zoomnivå for å vise et lite område — uten denne proppen ble
   * hele heatmapet dempet 4–30× avhengig av hvor langt unna den anbefalte
   * sonen tilfeldigvis lå, UAVHENGIG av selve scoren. Sett lik laveste
   * forventede zoom for kallstedet for å nulle ut denne dempingen helt
   * (v=1). Default 17 (Leaflet.heat sin egen standard, uendret for
   * hovedkartet der proppen ikke sendes inn). Ingen native-ekvivalent.
   */
  maxZoom?: number;
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
 *
 * V1.3 (§L, "punktmarkører i stedet for sannsynlighetssoner"): `startPoints`
 * flyttet tidligere/tettere sammen ([0, 0.15, 0.4, 0.6, 0.8, 1] →
 * [0, 0.10, 0.32, 0.55, 0.78, 1]) — samme 6 fargestopp, samme monotone
 * gul→oransje→rød-progresjon og samme heltransparente 0.0-endepunkt (§7:
 * lav/neglisjerbar score skal fortsatt være usynlig), men et middels
 * renderWeight (etter heatmapRender.ts sin gammaløft) når nå fargebåndet
 * merkbart tidligere. Kombinert med den økte punkt-radiusen i
 * LeafletMapImpl.tsx/kart.tsx (§K/§L) gir dette et heatmap som leser som en
 * sammenhengende varm SONE i stedet for en liten mettet prikk omgitt av
 * nesten-transparent — IKKE en endring av hvilken RAW score som teller som
 * "sterk" (den absolutte gammakurven i heatmapRender.ts er urørt).
 */
export const HEATMAP_GRADIENT = {
  colors: ["#00000000", "#EAB30855", "#EAB308CC", "#FB923CE0", "#F87171F0", "#DC2626FF"],
  startPoints: [0.0, 0.10, 0.32, 0.55, 0.78, 1.0],
  colorMapSize: 256,
} as const;
