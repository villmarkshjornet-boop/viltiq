// Delte geometri-/kartberegninger. Tidligere kopiert med små variasjoner i
// app/index.tsx, app/kart.tsx og app/kamera/[id].tsx — samlet her som eneste
// kilde til sannhet slik at f.eks. en retningsberegning ikke kan gå ut av sync
// mellom skjermene.

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Avstand mellom to punkter i meter (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return EARTH_RADIUS_M * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

/** Kompassretning (0–360°, 0 = nord) fra punkt `from` til punkt `to`. */
export function calcBearing(from: LatLng, to: LatLng): number {
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLon = toRad(to.longitude - from.longitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Flytt et punkt `distM` meter i retning `bearingDeg` (0 = nord). */
export function movePoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distM: number
): LatLng {
  const ang = toRad(bearingDeg);
  return {
    latitude:
      lat + ((distM / EARTH_RADIUS_M) * (180 / Math.PI)) * Math.cos(ang),
    longitude:
      lng +
      (((distM / EARTH_RADIUS_M) * (180 / Math.PI)) * Math.sin(ang)) /
        Math.cos(toRad(lat)),
  };
}

/** Kompassdirection som norsk forkortelse ("N", "NØ", ...). */
export function vindRetningLabel(grader: number): string {
  const dirs = ["N", "NØ", "Ø", "SØ", "S", "SV", "V", "NV"];
  return dirs[Math.round(grader / 45) % 8];
}

const RETNING_FULLE_NAVN: Record<string, string> = {
  N: "Nord", NØ: "Nordøst", Ø: "Øst", SØ: "Sørøst", S: "Sør", SV: "Sørvest", V: "Vest", NV: "Nordvest",
};

/**
 * Fullt norsk retningsnavn ("Nordvest") fra en kompassgrad — samme mapping
 * som Hjem-skjermens lokale RETNING_NAVN (app/index.tsx), delt hit slik at
 * andre skjermer (Kart) kan gjenbruke samme "X for deg"-språk uten å
 * duplisere tabellen. vindRetningLabel() over gir fortsatt kun forkortelsen,
 * uendret, for eksisterende bruk (forklaringstekst, korridor-retning).
 */
export function retningNavn(grader: number): string {
  return RETNING_FULLE_NAVN[vindRetningLabel(grader)];
}

/** "ca. 620 m" / "ca. 1,2 km" — delt avstandsformattering (samme mønster som Hjem-skjermens lokale avstandLabel). */
export function avstandLabel(meter: number): string {
  if (meter < 1000) return `ca. ${Math.round(meter / 10) * 10} m`;
  return `ca. ${(meter / 1000).toFixed(1).replace(".", ",")} km`;
}

/**
 * Anonymiser en posisjon med et tilfeldig avvik innenfor en sirkel med gitt
 * radius i meter (jevnt fordelt over arealet, ikke bare langs aksene).
 * Standard ±200 m i tråd med personvernerklæringen.
 */
export function anonymiserPosisjon(
  lat: number,
  lon: number,
  radiusM = 200
): LatLng {
  const r = radiusM * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;
  return movePoint(lat, lon, (theta * 180) / Math.PI, r);
}

/**
 * Konveks skrog (Andrew's monotone chain) rundt et sett punkter — V1.3
 * (§K/§L i motoroppdraget): brukt til å tegne den FAKTISKE geografiske
 * utstrekningen til en sone (grid.ts sin extractZones()) i stedet for en
 * kunstig sirkel rundt senteret. Projiserer til et lokalt meter-plan (rundt
 * punktenes eget tyngdepunkt) før selve skroget beregnes, siden lat/lon
 * IKKE er en jevn meter-skala (spesielt langs breddegrad ved norske
 * breddegrader) — uten dette ville skroget vært svakt forvridd. Returnerer
 * punktene i den ORIGINALE lat/lon-formen, klar for polygon-rendering.
 * Under 3 punkter har intet meningsfullt "skrog" — returneres uendret.
 */
export function convexHull(points: readonly LatLng[]): LatLng[] {
  if (points.length < 3) return [...points];

  const metersPerDegLat = 111320;
  const avgLat = points.reduce((sum, p) => sum + p.latitude, 0) / points.length;
  const metersPerDegLon = metersPerDegLat * Math.cos((avgLat * Math.PI) / 180) || 1;
  const avgLon = points.reduce((sum, p) => sum + p.longitude, 0) / points.length;

  const xy = points.map((p) => ({
    x: (p.longitude - avgLon) * metersPerDegLon,
    y: (p.latitude - avgLat) * metersPerDegLat,
    original: p,
  }));

  const sorted = [...xy].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: (typeof xy)[number], a: (typeof xy)[number], b: (typeof xy)[number]) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: typeof xy = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: typeof xy = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper].map((p) => p.original);
}

/**
 * Konturspor rundt UNIONEN av kvadratiske rutenett-celler — V1.3 (§21/§22,
 * zone-hull-audit): erstatter convexHull() som PRIMÆR footprint-algoritme
 * for extractZones() sine soner (se grid.ts). Årsak (bekreftet med reelle
 * tall, se .e2e-scratch/diag-zone-hull-audit.mjs): sonens KLYNGING (den
 * kjede-relative flood-fillen i grid.ts) knytter kun genuint NÆRE celler
 * sammen (verifisert: aldri lengre enn adjacencyThreshold), men resultatet
 * kan likevel bli en reelt IKKE-KONVEKS form — to tette klynger forbundet av
 * en smal "bro", en hesteskoform osv. Et EKTE konveks skrog fyller da igjen
 * hele det konkave tomrommet, og kan visuelt påstå at vann/lav-score-terreng
 * midt imellom er del av "anbefalt sone" — bekreftet empirisk: opptil 1,8×
 * arealet til de faktisk krevde cellene, med snitt av titalls udiskutable
 * vann-celler liggende inni skroget.
 *
 * Løsningen utnytter at cellene kommer fra et REGULÆRT rutenett
 * (buildGridCells i grid.ts): hver celle avrundes til nærmeste rad/kolonne i
 * et delt lokalt meter-plan (samme projeksjon som convexHull() under bruker),
 * og konturen spores som ytterkantene til unionen av disse rutene — samme
 * prinsipp som "marching squares"/rasterkontur-sporing i bildebehandling.
 * Returnerer KUN den ytre randen (den løkken med størst areal) — en sone med
 * et reelt "hull" midt inni (mulig, men uvanlig — krever et lavtscoret
 * område helt omsluttet av høytscoret terreng) får ikke det hullet tegnet
 * som en egen ring, men dette er en trygg forenkling: å IKKE tegne et
 * indre hull kan i verste fall overselge noen få kvadratmeter, ALDRI
 * kilometervis av terreng slik det opprinnelige konveks-skrog-problemet gjorde.
 *
 * Faller tilbake til convexHull() for under 3 celler (intet meningsfullt
 * rutenett-polygon der — samme grense som convexHull() selv bruker) og som
 * et rent sikkerhetsnett hvis konturen mot formodning skulle bli tom.
 */
export function gridBoundaryPolygon(points: readonly LatLng[], cellSizeMeters: number): LatLng[] {
  if (points.length < 3 || cellSizeMeters <= 0) return convexHull(points);

  const metersPerDegLat = 111320;
  const avgLat = points.reduce((sum, p) => sum + p.latitude, 0) / points.length;
  const metersPerDegLon = metersPerDegLat * Math.cos((avgLat * Math.PI) / 180) || 1;
  const avgLon = points.reduce((sum, p) => sum + p.longitude, 0) / points.length;

  // Rad/kolonne for hver celle i det DELTE lokale meter-planet (ikke
  // per-punkt) — avgjørende for at to naboceller alltid beregner NØYAKTIG
  // samme delte hjørne, uansett brøkdels-forskjeller i breddegrad.
  const claimed = new Set<string>();
  for (const p of points) {
    const x = (p.longitude - avgLon) * metersPerDegLon;
    const y = (p.latitude - avgLat) * metersPerDegLat;
    claimed.add(`${Math.round(y / cellSizeMeters)},${Math.round(x / cellSizeMeters)}`);
  }

  // Hjørner som HALV-CELLE HELTALL (2×rad±1, 2×kolonne±1) — eksakt
  // heltallsaritmetikk, ingen flyttallsavrunding, så to nabocellers delte
  // hjørne alltid får identisk nøkkel (kritisk for sammensying under).
  type Corner = readonly [number, number]; // [halvKolonne, halvRad]
  type Edge = readonly [Corner, Corner];
  const edges: Edge[] = [];
  for (const key of claimed) {
    const sep = key.indexOf(",");
    const row = Number(key.slice(0, sep));
    const col = Number(key.slice(sep + 1));
    const NW: Corner = [2 * col - 1, 2 * row + 1];
    const NE: Corner = [2 * col + 1, 2 * row + 1];
    const SE: Corner = [2 * col + 1, 2 * row - 1];
    const SW: Corner = [2 * col - 1, 2 * row - 1];
    if (!claimed.has(`${row + 1},${col}`)) edges.push([NW, NE]); // nordkant
    if (!claimed.has(`${row},${col + 1}`)) edges.push([NE, SE]); // østkant
    if (!claimed.has(`${row - 1},${col}`)) edges.push([SE, SW]); // sørkant
    if (!claimed.has(`${row},${col - 1}`)) edges.push([SW, NW]); // vestkant
  }
  if (edges.length === 0) return convexHull(points);

  const cornerKey = (c: Corner) => `${c[0]},${c[1]}`;
  const touching = new Map<string, number[]>();
  edges.forEach((edge, idx) => {
    for (const corner of edge) {
      const key = cornerKey(corner);
      const list = touching.get(key);
      if (list) list.push(idx);
      else touching.set(key, [idx]);
    }
  });

  // Sy sammen kantene til lukkede løkker ved å følge delte hjørner — hvert
  // rutenett-hjørne har alltid et PARTALL kanter (0, 2, eller unntaksvis 4
  // ved en ren diagonal-celle-berøring), så denne grådige "første ledige
  // kant"-fremgangsmåten går alltid i mål uten "blindveier".
  const used = new Array(edges.length).fill(false);
  const loops: Corner[][] = [];
  for (let start = 0; start < edges.length; start++) {
    if (used[start]) continue;
    const loop: Corner[] = [];
    let currentCorner = edges[start][0];
    let currentEdge = start;
    const startKey = cornerKey(currentCorner);
    for (let steps = 0; steps <= edges.length; steps++) {
      used[currentEdge] = true;
      loop.push(currentCorner);
      const edge = edges[currentEdge];
      currentCorner = cornerKey(edge[0]) === cornerKey(currentCorner) ? edge[1] : edge[0];
      if (cornerKey(currentCorner) === startKey) break;
      const candidates = touching.get(cornerKey(currentCorner)) ?? [];
      const nextEdge = candidates.find((idx) => !used[idx]);
      if (nextEdge == null) break; // skal ikke skje, se kommentaren over — rent sikkerhetsnett
      currentEdge = nextEdge;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  if (loops.length === 0) return convexHull(points);

  const shoelace = (loop: Corner[]): number => {
    let area = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(area) / 2;
  };
  loops.sort((a, b) => shoelace(b) - shoelace(a));
  const outer = loops[0];

  // Fjern kollineære mellompunkter (f.eks. den midterste av tre naboceller
  // langs samme rette kant) — ren FORENKLING (identisk geometrisk form,
  // færre punkter), ikke en endring av selve konturen. Eksakt heltalls
  // kryssprodukt, så ingen flyttallsusikkerhet i "rett linje"-sjekken.
  const simplified: Corner[] = [];
  const m = outer.length;
  for (let i = 0; i < m; i++) {
    const prev = outer[(i - 1 + m) % m];
    const cur = outer[i];
    const next = outer[(i + 1) % m];
    const cross = (cur[0] - prev[0]) * (next[1] - prev[1]) - (cur[1] - prev[1]) * (next[0] - prev[0]);
    if (cross !== 0) simplified.push(cur);
  }
  const finalLoop = simplified.length >= 3 ? simplified : outer;

  return finalLoop.map(([halfCol, halfRow]) => ({
    latitude: avgLat + ((halfRow / 2) * cellSizeMeters) / metersPerDegLat,
    longitude: avgLon + ((halfCol / 2) * cellSizeMeters) / metersPerDegLon,
  }));
}

/**
 * Punkt-i-polygon (even-odd ray casting, Franklins PNPOLY). Fungerer korrekt
 * på rå lat/lon uten meter-projeksjon — "er punktet innenfor?" er en topologisk
 * egenskap som ikke endres av hvilken (konsistent) koordinat-mapping polygonet
 * og testpunktet begge er uttrykt i, i motsetning til f.eks. arealberegning.
 *
 * Grensetilfeller (polygon-hjørne, polygon-kant, duplikat-/null-lengde-kant)
 * gir et DETERMINISTISK, men ikke nødvendigvis "intuitivt definert" svar —
 * se geo.test.ts for hvilket svar algoritmen faktisk gir i disse tilfellene.
 * Under 3 punkter er intet meningsfullt polygon — returnerer alltid `false`.
 */
export function isPointInPolygon(point: LatLng, polygon: readonly LatLng[]): boolean {
  if (polygon.length < 3) return false;
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].longitude;
    const yi = polygon[i].latitude;
    const xj = polygon[j].longitude;
    const yj = polygon[j].latitude;
    const crosses = yi !== yj && y >= Math.min(yi, yj) && y < Math.max(yi, yj) && x < xi + ((y - yi) / (yj - yi)) * (xj - xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function segmentsCross(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): boolean {
  const orient = (a: LatLng, b: LatLng, c: LatLng) =>
    (b.longitude - a.longitude) * (c.latitude - a.latitude) - (b.latitude - a.latitude) * (c.longitude - a.longitude);
  const o1 = orient(p1, p2, p3);
  const o2 = orient(p1, p2, p4);
  const o3 = orient(p3, p4, p1);
  const o4 = orient(p3, p4, p2);
  // Streng tegn-ulikhet med vilje: kolineære/berørende kanter (o==0) telles
  // ALDRI som en kryssing her — et jaktområde-polygon der to kanter akkurat
  // berører hverandre i et punkt (uten å skjære) er fortsatt et gyldig,
  // ikke-selvskjærende polygon. Se isSimplePolygon() sin doc for hvorfor
  // dette er riktig for denne brukssammenhengen (brukertegnet område), ikke
  // en generell robust polygon-kryssing-algoritme for alle formål.
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

/**
 * Sjekker om et brukertegnet polygon er "enkelt" (ikke-selvskjærende) —
 * forutsetningen isPointInPolygon() over stilltiende krever for å gi et
 * meningsfullt svar (en "bowtie"-form har ingen entydig inni/utenfor).
 * Ment brukt ved TEGNING (avvis et nytt hjørne som ville krysset en
 * eksisterende kant), ikke som en generell polygon-rettelse — denne
 * funksjonen klassifiserer, den reparerer ikke et ugyldig polygon.
 */
export function isSimplePolygon(polygon: readonly LatLng[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a1 = polygon[i];
    const a2 = polygon[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      const b1 = polygon[j];
      const b2 = polygon[(j + 1) % n];
      if (segmentsCross(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

/**
 * Minste sirkel (tyngdepunkt + lengste avstand til et hjørne) som omslutter
 * et polygon — IKKE den matematisk minimale omsluttende sirkelen (det ville
 * kreve Welzls algoritme), men god nok for et lite, brukertegnet jaktområde:
 * brukes KUN til å utlede en `AreaOfInterest`-sirkel (center+radius) for
 * `buildGridCells()` i grid.ts, som allerede forventer akkurat denne formen
 * og selv legger på ytterligere margin — se engine.ts sin bruk av dette.
 */
export function boundingCircle(polygon: readonly LatLng[]): { center: LatLng; radiusMeters: number } {
  if (polygon.length === 0) return { center: { latitude: 0, longitude: 0 }, radiusMeters: 0 };
  const center: LatLng = {
    latitude: polygon.reduce((sum, p) => sum + p.latitude, 0) / polygon.length,
    longitude: polygon.reduce((sum, p) => sum + p.longitude, 0) / polygon.length,
  };
  const radiusMeters = polygon.reduce((max, p) => Math.max(max, distanceMeters(center, p)), 0);
  return { center, radiusMeters };
}

/** Sektor (kakestykke) rundt et senterpunkt — brukt til å vise kamera-/dyreretning i kart. */
export function buildSector(
  center: LatLng,
  radiusM: number,
  bearingDeg: number,
  spanDeg = 110,
  steps = 24
): LatLng[] {
  const coords: LatLng[] = [center];
  const start = bearingDeg - spanDeg / 2;
  for (let i = 0; i <= steps; i++) {
    coords.push(movePoint(center.latitude, center.longitude, start + (i / steps) * spanDeg, radiusM));
  }
  coords.push(center);
  return coords;
}
