// Den faktiske Leaflet-baserte kartimplementasjonen for web. Denne filen
// importerer "leaflet"/"react-leaflet" på modul-nivå, og Leaflet berører
// `window` idet modulen lastes — det krasjer Node under Expo Router sin
// statiske pre-rendering av /kart og /kamera/[id] (`ReferenceError: window
// is not defined`). Derfor lastes DENNE filen KUN via en dynamisk import()
// fra components/MapView.web.tsx, inni useEffect (kjører aldri under SSR/
// statisk rendering, kun i faktisk nettleser) — se den filen for selve
// lazy-load-mekanismen. Ikke importer denne filen statisk noe sted.
//
// Se docs/DEPLOYMENT.md for research-notater om Kartverket/Geonorge sine
// WMTS/WMS-tjenester (lisens, tilgjengelighet, CORS).
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StyleSheet, Text, View } from "react-native";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Circle as LeafletCircle,
  MapContainer,
  Marker as LeafletMarker,
  Polygon as LeafletPolygon,
  TileLayer,
  useMap,
  useMapEvents,
  WMSTileLayer,
} from "react-leaflet";
import {
  HEATMAP_GRADIENT,
  type CircleProps,
  type HeatmapProps,
  type LongPressEvent,
  type MapType,
  type MapViewHandle,
  type MapViewProps,
  type MarkerProps,
  type PolygonProps,
  type Region,
} from "./MapView.types";

// Leaflet.heat (se node_modules/leaflet.heat/dist/leaflet-heat.js) er et
// gammeldags globalt skript som forventer en bar `L`-variabel i sitt eget
// modul-scope — det gjør IKKE `import L from "leaflet"` selv synlig for.
// Uten denne linjen settes `L.heatLayer` aldri, og Heatmap-komponenten under
// ville kastet en ReferenceError. Bruker `require` (ikke en statisk
// `import`) med VILJE, slik at rekkefølgen garantert er: sett globalen →
// last plugin-skriptet som leser den. Trygt her fordi denne filen (se
// toppkommentaren) uansett kun lastes client-side, aldri under SSR.
(globalThis as unknown as { L?: typeof L }).L = L;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- se begrunnelse over: rekkefølge mot globalThis.L må være garantert, en statisk import kan omorganiseres av verktøy
require("leaflet.heat");

// ─── Kartverket / Geonorge — tjeneste-URLer ─────────────────────────────────
// Verifisert direkte mot GetCapabilities før implementasjon (ikke gjettet):
//  - Topo WMTS:      https://cache.kartverket.no/v1/wmts/1.0.0/WMTSCapabilities.xml
//                     → layer "topo", tileMatrixSet "webmercator" (EPSG:3857),
//                       URL-mal {TileMatrix}/{TileRow}/{TileCol} = Leaflets {z}/{y}/{x}.
//                       Fees/AccessConstraints: "Ingen".
//  - Matrikkel WMS:   https://wms.geonorge.no/skwms1/wms.matrikkel?service=wms&request=getcapabilities
//                     → layer "eiendomsgrense" (kun geometri — ingen eier-
//                       /personopplysninger følger med et WMS GetMap-bilde).
//                       AccessConstraints: "Copyright Statens kartverk".
//  - Ortofoto/flyfoto: IKKE tilgjengelig som åpen tjeneste lenger — Norge i
//    bilder stengte sine åpne WMTS/WMS-tjenester for offentligheten i mars
//    2026 (tilgang er nå forbeholdt Norge digitalt-parter). "Satellitt"-
//    valget viser derfor OpenStreetMap Standard i stedet, med en synlig
//    merknad i kartet — se docs/DEPLOYMENT.md.
const KARTVERKET_TOPO_URL =
  "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png";
const KARTVERKET_ATTRIBUTION = '&copy; <a href="https://www.kartverket.no/">Kartverket</a>';

const OSM_STANDARD_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bidragsytere';

const MATRIKKEL_WMS_URL = "https://wms.geonorge.no/skwms1/wms.matrikkel";
const MATRIKKEL_ATTRIBUTION = "Matrikkelen &copy; Kartverket";

// ─── Region ↔ zoom ──────────────────────────────────────────────────────────

function regionToZoom(region: Region): number {
  const z = Math.log2(360 / Math.max(region.longitudeDelta, 0.0001));
  return Math.min(18, Math.max(3, Math.round(z)));
}

// ─── Stiler (må stå før modul-nivå-konstanter som bruker dem) ──────────────

const badgeStyles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 58, // under navBar i kart.tsx (som er ~44px høy) — ikke overlapp tittelen
    left: "50%",
    transform: [{ translateX: -140 }],
    width: 280,
    backgroundColor: "rgba(8,14,10,0.9)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1E3028",
    paddingVertical: 6,
    paddingHorizontal: 12,
    zIndex: 1000,
  },
  text: { color: "#D1FAE5", fontSize: 11, fontWeight: "700", textAlign: "center" },
});

const userLocStyles = StyleSheet.create({
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(59,130,246,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  dotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#3B82F6",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
});

const userLocationIcon = L.divIcon({
  html: renderToStaticMarkup(
    <View style={userLocStyles.dot}>
      <View style={userLocStyles.dotInner} />
    </View>
  ),
  className: "viltiq-user-location-icon",
  iconSize: [0, 0],
  iconAnchor: [9, 9],
});

const defaultPinIcon = (color: string) =>
  L.divIcon({
    html: renderToStaticMarkup(
      <svg width="26" height="34" viewBox="0 0 26 34" style={{ display: "block" }}>
        <path
          d="M13 0C5.8 0 0 5.8 0 13c0 9.5 13 21 13 21s13-11.5 13-21c0-7.2-5.8-13-13-13z"
          fill={color}
          stroke="#00000055"
          strokeWidth={1}
        />
        <circle cx="13" cy="13" r="5" fill="#ffffff" />
      </svg>
    ),
    className: "viltiq-pin-icon",
    iconSize: [0, 0],
    iconAnchor: [13, 34],
  });

// ─── MapBridge — kobler Leaflet sin imperative map-instans til ref/hendelser ─

/** Leaflet map -> vårt felles Region-format (samme form react-native-maps allerede bruker). */
function currentRegionOf(map: L.Map): Region {
  const center = map.getCenter();
  const bounds = map.getBounds();
  return {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: bounds.getNorth() - bounds.getSouth(),
    longitudeDelta: bounds.getEast() - bounds.getWest(),
  };
}

function MapBridge({
  onReady,
  onLongPress,
  onPress,
  onRegionChangeComplete,
}: {
  onReady: (map: L.Map) => void;
  onLongPress?: (e: LongPressEvent) => void;
  onPress?: (e: LongPressEvent) => void;
  onRegionChangeComplete?: (region: Region) => void;
}) {
  const map = useMap();

  useEffect(() => {
    onReady(map);
  }, [map, onReady]);

  // Krasjfiks (getImageData "source width is 0"): Leaflet cacher sin egen
  // map.getSize() (this._size, se leaflet-src.js) og invaliderer den KUN ved
  // et window-nivå "resize"-event eller et eksplisitt invalidateSize()-kall
  // — IKKE ved container-nivå layoutendringer (modal åpner/lukker seg over
  // kartet, en ScrollView-seksjon som får reell høyde først etter mount,
  // en hidden→visible-fane osv.). Uten dette forblir map._size det den var
  // FØRSTE gang noe leste den — inkludert (0,0) dersom containeren
  // tilfeldigvis ikke var lagt ut med reell størrelse akkurat da. Leaflet.heat
  // sin L.HeatLayer setter canvas.width/height direkte fra map.getSize() ved
  // laget-opprettelse (se Heatmap under) og kaller SIDEN getImageData på det
  // — en cachet (0,0) her er eksakt kilden til
  // "Failed to execute 'getImageData' ... source width is 0".
  //
  // ResizeObserver på selve kart-containeren er den korrekte, generelle
  // fiksen (ikke en Heatmap-spesifikk lapp) — den fanger ENHVER reell
  // størrelsesendring på containeren (uansett årsak) og ber Leaflet lese den
  // på nytt via invalidateSize(), som i sin tur fyrer Leaflets "resize"-event
  // (lyttet på av Heatmap under for å utsette laget-opprettelse til
  // containeren faktisk har fått en reell størrelse). rAF-debounce unngår at
  // vi kaller invalidateSize() flere ganger per layout-"tick" (f.eks. under
  // en kontinuerlig ModalSheet-animasjon).
  useEffect(() => {
    const container = map.getContainer();
    let frame: number | null = null;
    // map.getContainer() forblir en (frakoblet) DOM-node selv ETTER
    // map.remove() — Leaflet nuller den aldri ut (se leaflet-src.js sin
    // Map.remove()), så den er IKKE en pålitelig "er kartet dødt?"-sjekk.
    // Egen mounted-flagg er den robuste måten å hindre at en forsinket
    // ResizeObserver/rAF-callback rører en fjernet map-instans etter unmount.
    let mounted = true;

    const observer = new ResizeObserver(() => {
      if (frame != null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        if (!mounted) return;
        // Krasjfiks (fortsettelse): sjekket TIDLIGERE map.getSize() (Leaflets
        // EGEN cachede — og nettopp DERFOR potensielt utdaterte — verdi) for
        // å avgjøre om invalidateSize() burde kalles. Det er sirkulært: i det
        // ØYEBLIKKET en container går fra skjult (0×0) til synlig (reell
        // størrelse) — akkurat når invalidateSize() faktisk trengs — har
        // map.getSize() ENNÅ IKKE oppdatert seg (det er JO det kallet som
        // oppdaterer den), så den gamle sjekken leste fortsatt (0,0) og
        // hoppet over invalidateSize() nøyaktig når det telte. Container sin
        // FAKTISKE DOM-størrelse (getBoundingClientRect, ikke Leaflets cache)
        // er sannheten som skal styre dette kallet.
        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          map.invalidateSize();
        }
      });
    });
    observer.observe(container);

    return () => {
      mounted = false;
      observer.disconnect();
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [map]);

  useMapEvents({
    click: (e) => onPress?.({ nativeEvent: { coordinate: { latitude: e.latlng.lat, longitude: e.latlng.lng } } }),
    // Leaflet fyrer "contextmenu" både ved høyreklikk (desktop) og ved
    // langtrykk på berøringsskjermer — dette ER web sin ekvivalent til
    // react-native-maps sin onLongPress, ikke en tilnærming.
    contextmenu: (e) => {
      onLongPress?.({
        nativeEvent: {
          coordinate: { latitude: e.latlng.lat, longitude: e.latlng.lng },
        },
      });
    },
    // V1.2.2: "moveend"/"zoomend" fyrer når panorering/zoom-gesten faktisk er
    // FERDIG (ikke per frame under selve draget) — Leaflets egen ekvivalent
    // til react-native-maps sin onRegionChangeComplete, se MapView.types.ts.
    moveend: () => onRegionChangeComplete?.(currentRegionOf(map)),
    zoomend: () => onRegionChangeComplete?.(currentRegionOf(map)),
  });

  return null;
}

function MapTypeBadge({ mapType }: { mapType: MapType }) {
  if (mapType !== "satellite") return null;
  return (
    <View style={badgeStyles.wrap} pointerEvents="none">
      <Text style={badgeStyles.text}>
        Flyfoto er ikke tilgjengelig — viser OSM-kart i stedet
      </Text>
    </View>
  );
}

// ─── MapView ────────────────────────────────────────────────────────────────

export const LeafletMapView = forwardRef<MapViewHandle, MapViewProps>(function LeafletMapView(
  {
    style,
    mapType = "terrain",
    initialRegion,
    showsUserLocation,
    showPropertyBoundaries,
    onLongPress,
    onPress,
    onRegionChangeComplete,
    children,
  },
  ref
) {
  const leafletMapRef = useRef<L.Map | null>(null);
  const [ready, setReady] = useState(false);

  const center: [number, number] = initialRegion
    ? [initialRegion.latitude, initialRegion.longitude]
    : [64.5, 11]; // midt-Norge, brukt kun dersom ingen initialRegion er kjent ennå
  const zoom = initialRegion ? regionToZoom(initialRegion) : 5;

  useImperativeHandle(
    ref,
    () => ({
      animateToRegion: (region, durationMs = 600) => {
        leafletMapRef.current?.flyTo(
          [region.latitude, region.longitude],
          regionToZoom(region),
          { duration: Math.max(durationMs, 0) / 1000 }
        );
      },
    }),
    []
  );

  const flatStyle = StyleSheet.flatten(style) ?? {};

  return (
    <View style={[{ overflow: "hidden" }, flatStyle]}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ width: "100%", height: "100%" }}
        zoomControl={true}
        attributionControl={true}
      >
        <MapBridge
          onReady={(map) => {
            leafletMapRef.current = map;
            setReady(true);
          }}
          onLongPress={onLongPress}
          onPress={onPress}
          onRegionChangeComplete={onRegionChangeComplete}
        />

        {mapType === "satellite" ? (
          <TileLayer url={OSM_STANDARD_URL} attribution={OSM_ATTRIBUTION} maxZoom={19} />
        ) : (
          <TileLayer url={KARTVERKET_TOPO_URL} attribution={KARTVERKET_ATTRIBUTION} maxZoom={18} />
        )}

        {showPropertyBoundaries && (
          <WMSTileLayer
            url={MATRIKKEL_WMS_URL}
            params={{
              layers: "eiendomsgrense",
              format: "image/png",
              transparent: true,
              version: "1.3.0",
            }}
            attribution={MATRIKKEL_ATTRIBUTION}
          />
        )}

        {showsUserLocation && initialRegion && (
          <LeafletMarker
            position={[initialRegion.latitude, initialRegion.longitude]}
            icon={userLocationIcon}
            interactive={false}
          />
        )}

        {ready && children}
      </MapContainer>

      <MapTypeBadge mapType={mapType} />
    </View>
  );
});

// ─── Marker ─────────────────────────────────────────────────────────────────

/**
 * Egendefinerte markør-barn (bobler/piler/emoji) rendres til statisk HTML og
 * plasseres med CSS transform: translate(-50%, -100%) — dvs. alltid
 * bunn-senter-forankret. Dette matcher anchor={{x:0.5,y:1}}, som er den
 * eneste ankerverdien brukt med egendefinerte barn noe sted i appen.
 */
export function Marker({ coordinate, title, pinColor, onPress, children }: MarkerProps) {
  // renderToStaticMarkup selv er billig å kjøre på hver render (liten
  // React-tre → streng) — det vi faktisk vil unngå å gjøre unødvendig ofte
  // er å bygge en NY L.divIcon-instans (Leaflet bytter ut markør-DOM-noden
  // ved hver ny ikon-instans). Derfor beregnes HTML-strengen på hver
  // render, mens selve divIcon-objektet memoiseres på INNHOLDET
  // (html-strengen), ikke bare på om det finnes barn. Uten dette (tidligere
  // `[pinColor, !!children]`) oppdaterte f.eks. ikke kameraets
  // retningspil-rotasjon seg live når kameraet ble redigert — komponenten
  // beholdt sitt første, cachede ikon helt til den ble unmountet/remountet.
  const childrenHtml = children ? renderToStaticMarkup(<>{children}</>) : null;

  const icon = useMemo(() => {
    if (childrenHtml != null) {
      return L.divIcon({
        html: `<div style="transform:translate(-50%,-100%)">${childrenHtml}</div>`,
        className: "viltiq-custom-marker-icon",
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
    }
    return defaultPinIcon(pinColor || "#2CC36B");
  }, [childrenHtml, pinColor]);

  return (
    <LeafletMarker
      position={[coordinate.latitude, coordinate.longitude]}
      icon={icon}
      title={title}
      eventHandlers={onPress ? { click: () => onPress() } : undefined}
    />
  );
}

// ─── Circle ─────────────────────────────────────────────────────────────────

export function Circle({ center, radius, strokeWidth, strokeColor, fillColor }: CircleProps) {
  return (
    <LeafletCircle
      center={[center.latitude, center.longitude]}
      radius={radius}
      pathOptions={{
        color: strokeColor || "transparent",
        weight: strokeWidth ?? 1,
        fillColor: fillColor || "transparent",
        fillOpacity: fillColor ? 1 : 0,
        opacity: strokeColor ? 1 : 0,
      }}
    />
  );
}

// ─── Polygon ────────────────────────────────────────────────────────────────

export function Polygon({ coordinates, strokeWidth, strokeColor, fillColor }: PolygonProps) {
  return (
    <LeafletPolygon
      positions={coordinates.map((c) => [c.latitude, c.longitude] as [number, number])}
      pathOptions={{
        color: strokeColor || "transparent",
        weight: strokeWidth ?? 1,
        fillColor: fillColor || "transparent",
        fillOpacity: fillColor ? 1 : 0,
        opacity: strokeColor ? 1 : 0,
      }}
    />
  );
}

// ─── Heatmap ────────────────────────────────────────────────────────────────
// react-leaflet har ingen offisiell heat-layer-komponent — leaflet.heat er en
// ren Leaflet-plugin (L.heatLayer), så den kobles inn imperativt via
// useMap() i stedet for en deklarativ react-leaflet-komponent, akkurat som
// enhver annen "rå Leaflet"-utvidelse måtte vært gjort.
//
// gradient-proppen leses her (ikke bare på native) slik at kallstedet i
// app/kart.tsx sin gradient FAKTISK styrer web sin fargeskala også — uten
// dette ville web stille bygget sin egen kopi fra HEATMAP_GRADIENT og
// proppen ville vært død kode. Faller tilbake til HEATMAP_GRADIENT direkte
// dersom ingen gradient sendes inn, slik at eksisterende kall uten proppen
// fortsatt fungerer uendret.
function buildGradientMap(gradient: HeatmapProps["gradient"]): Record<number, string> {
  const g = gradient ?? HEATMAP_GRADIENT;
  return Object.fromEntries(g.startPoints.map((stop, i) => [stop, g.colors[i]]));
}

// V1.3 (§K/§L): forholdet blur/radius løftet fra 0.7 til 0.9. Leaflet.heat
// tegner hvert punkt som et radialt "stempel" ut til `radius` piksler, og
// kjører DERETTER en boks-blur over hele resultat-canvaset med bredde
// `blur` piksler — det er DENNE etter-blurren (ikke selve fargeskalaen i
// HEATMAP_GRADIENT) som avgjør om to nærliggende punkters stempler smelter
// visuelt sammen til én flate eller forblir to atskilte "prikker" med en
// synlig kant. Med grid-cellene 150 m fra hverandre (config.ts sin
// cellSizeMeters) og typiske skjerm-pikkel-tettheter ved zoom-nivåene
// brukeren faktisk analyserer et område på, var 0.7×radius for lite til å
// dekke gapet — se BLUR_RATIO-konstanten og radius-økningen i kart.tsx.
const BLUR_RATIO = 0.9;

export function Heatmap({ points, radius = 26, gradient, max = 1, maxZoom = 17 }: HeatmapProps) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);
  const gradientMap = useMemo(() => buildGradientMap(gradient), [gradient]);

  useEffect(() => {
    const heatPoints: L.HeatLatLngTuple[] = points.map((p) => [p.latitude, p.longitude, p.weight]);

    function applyToLayer() {
      if (!layerRef.current) {
        layerRef.current = L.heatLayer(heatPoints, {
          radius,
          // blur/minOpacity har ingen native-ekvivalent (react-native-maps sin
          // Heatmap har ingen slike knapper) — Leaflet.heat og Google Maps sine
          // heatmap-tiles er to ulike underliggende bibliotek, så dette er en
          // tilsiktet, uunngåelig plattformforskjell, ikke en bug.
          blur: radius * BLUR_RATIO,
          maxZoom,
          minOpacity: 0,
          max,
          gradient: gradientMap,
        }).addTo(map);
      } else {
        layerRef.current.setLatLngs(heatPoints);
        layerRef.current.setOptions({ radius, blur: radius * BLUR_RATIO, max, maxZoom, gradient: gradientMap });
      }
    }

    // Krasjfiks (getImageData "source width is 0" — se MapBridge over for
    // full forklaring av HVORFOR containeren kan være 0×0 her): leaflet.heat
    // sin L.HeatLayer.onAdd() -> _reset() -> _redraw() kaller getImageData()
    // SYNKRONT OG UBETINGET (ingen "_animating"-vakt der, i motsetning til
    // dens offentlige redraw()-metode) — og den setter canvas.width/height
    // direkte fra map.getSize() ved laget-opprettelse. Er containeren 0×0
    // akkurat NÅ (rett etter mount/route-bytte, eller rett etter at et
    // modal/sheet har åpnet/lukket seg over kartet), IKKE opprett/oppdater
    // laget ennå — vent på Leaflets eget "resize"-event (fyrt av MapBridge
    // sin ResizeObserver->invalidateSize() så snart containeren FAKTISK får
    // en reell størrelse) og prøv da på nytt.
    //
    // Bruker containerens FAKTISKE DOM-størrelse (getBoundingClientRect),
    // IKKE map.getSize() — samme sirkularitets-fella som MapBridge sin
    // ResizeObserver over: map.getSize() er Leaflets EGEN cache, som
    // nettopp KAN være utdatert akkurat i det containeren har fått/mistet
    // reell størrelse (den oppdateres først NÅR invalidateSize() kalles, så
    // å stole på den HER for å avgjøre "er størrelsen reell nå" er å stole
    // på svaret på spørsmålet man stiller). getBoundingClientRect() er
    // alltid sannheten om hva nettleseren faktisk har lagt ut akkurat nå.
    const rect = map.getContainer().getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      const onResize = () => {
        const r = map.getContainer().getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          map.off("resize", onResize);
          applyToLayer();
        }
      };
      map.on("resize", onResize);
      return () => {
        map.off("resize", onResize);
      };
    }

    applyToLayer();
  }, [points, radius, max, maxZoom, map, gradientMap]);

  useEffect(() => {
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kun opprydding ved unmount, ikke ved hver map-referanseendring
  }, []);

  return null;
}
