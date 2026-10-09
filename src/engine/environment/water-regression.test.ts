import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("../../testSupport/nodeEsmTestLoader.mjs", import.meta.url);

const { isPointInPolygon, coastlineSide, determineWaterStatusFromOsm, EMPTY_WATER_FEATURES } = await import("./water");
const { resolveSpatialValidity } = await import("./resolve");
const { runEcologicalEngine } = await import("../engine");
const { extractZones } = await import("../grid");
const { DEFAULT_ENGINE_CONFIG } = await import("../config");
const { UKJENT_DYNAMIC_FEATURES, UKJENT_STATIC_FEATURES } = await import("./types");

// V1.2.2-REGRESJONSMATRISE (Kristiansand — hotspot havnet i åpen sjø/fjord).
// ROTÅRSAK: V1.2.1 avgjorde spatial validity fra det GROVE habitat-
// prøvegridet (500 m-1,2 km avstand mellom prøvepunkter, resolve.ts) — en
// vannkanal SMALERE enn prøvepunktavstanden kunne dermed lande HELT mellom
// to prøvepunkter og bli feilklassifisert som land, ren INFORMASJONSTAP, ikke
// noe en strengere terskel kunne fikset.
//
// Denne filen låser fast HELE scenariomatrisen fra V1.2.2-oppdraget i ÉN
// samlet regresjonsfil (water.ts sine egne enhetstester dekker den
// grunnleggende geometrien isolert — se water.test.ts — denne filen bygger
// videre med et bredere sett scenarioer + krysskoblingen mot
// resolveSpatialValidity()/extractZones()). Kjøres HELT OFFLINE — ingen kall
// til fetchWaterFeaturesNear() eller andre nettverksfunksjoner noe sted her.

const METERS_PER_DEG_LAT = 111320;

// ===========================================================================
// §1: Åpent hav — punkt langt fra land, midt i en stor sammenhengende
// vannflate, skal ALDRI kunne feiltolkes som land uansett hvor "stor" flaten er.
// ===========================================================================

test("§1: åpent hav — punkt godt inni en stor, åpen vannflate er 'water'", () => {
  const openSeaPolygon = [
    { latitude: 60.0, longitude: 10.0 },
    { latitude: 60.0, longitude: 10.3 },
    { latitude: 60.2, longitude: 10.3 },
    { latitude: 60.2, longitude: 10.0 },
  ];
  const water = { waterPolygons: [openSeaPolygon], coastlineSegments: [] };
  const farFromAnyLand = { latitude: 60.1, longitude: 10.15 }; // midt i flaten, langt fra alle fire kantene
  assert.equal(determineWaterStatusFromOsm(farFromAnyLand, water, 1000), "water");
});

// ===========================================================================
// §2: Bred fjord (~2 km) — samme mekanisme som det smale sundet i §3/§8
// (water.test.ts), men med en bredde stor nok til at et grovt habitat-
// prøvegrid (500 m-1,2 km) i praksis OGSÅ ville klart det (Molde-testen,
// jf. resolve.ts sin filkommentar). Tar med for å vise at den nye,
// uavhengige mekanismen ikke bare dekker det TIDLIGERE svake tilfellet, men
// fortsatt gir korrekt svar på det tilfellet som allerede fungerte.
// ===========================================================================

test("§2: bred fjord (~2 km) — midtfjords er vann, begge fjordsider er land", () => {
  const halfWidthMeters = 1000; // 2 km total bredde
  const offsetDeg = halfWidthMeters / METERS_PER_DEG_LAT;
  const north = [
    { latitude: 60.0 + offsetDeg, longitude: 9.9 },
    { latitude: 60.0 + offsetDeg, longitude: 10.1 },
  ]; // østover -> land nord, vann sør
  const south = [
    { latitude: 60.0 - offsetDeg, longitude: 10.1 },
    { latitude: 60.0 - offsetDeg, longitude: 9.9 },
  ]; // vestover -> land sør, vann nord
  const water = { waterPolygons: [], coastlineSegments: [north, south] };
  const maxDist = 1500;

  const midFjord = { latitude: 60.0, longitude: 10.0 };
  assert.equal(determineWaterStatusFromOsm(midFjord, water, maxDist), "water", "midt i en 2 km bred fjord skal være vann");

  const northShoreLand = { latitude: 60.0 + offsetDeg + 50 / METERS_PER_DEG_LAT, longitude: 10.0 };
  assert.equal(determineWaterStatusFromOsm(northShoreLand, water, maxDist), "land", "nordsiden av fjorden skal være land");

  const southShoreLand = { latitude: 60.0 - offsetDeg - 50 / METERS_PER_DEG_LAT, longitude: 10.0 };
  assert.equal(determineWaterStatusFromOsm(southShoreLand, water, maxDist), "land", "sørsiden av fjorden skal være land");
});

// ===========================================================================
// §3: Smalt sund (60 m) — samme mønster som §8 i water.test.ts (100 m), men
// med en ANNEN bredde. Beviser at korrektheten ikke er avhengig av ett
// bestemt "magisk" breddetall — mekanismen er ren lokal geometri
// (kryssprodukt/avstand-til-segment), ikke en terskel kalibrert mot 100 m.
// ===========================================================================

test("§3: smalt sund (60 m bredt, annen bredde enn §8 i water.test.ts) klassifiseres korrekt som vann midt i sundet", () => {
  const offsetDeg = 30 / METERS_PER_DEG_LAT; // 30 m til hver side => 60 m sund
  const north = [
    { latitude: 60.0 + offsetDeg, longitude: 9.9 },
    { latitude: 60.0 + offsetDeg, longitude: 10.1 },
  ];
  const south = [
    { latitude: 60.0 - offsetDeg, longitude: 10.1 },
    { latitude: 60.0 - offsetDeg, longitude: 9.9 },
  ];
  const water = { waterPolygons: [], coastlineSegments: [north, south] };

  const midSund = { latitude: 60.0, longitude: 10.0 };
  assert.equal(determineWaterStatusFromOsm(midSund, water, 200), "water", "midt i et 60 m sund skal klassifiseres som vann");
});

// ===========================================================================
// §4: Øy — water.ts har ingen egen "land-polygon"-representasjon (kun
// waterPolygons + coastlineSegments), så en øy må modelleres som en LUKKET
// kystlinjering rundt øya, der ØYAS SENTRUM må resolve til "land" via
// coastlineSide og punkter utenfor ringen til "water".
//
// OSM-konvensjonen (se water.ts sin filkommentar): i linjens tegneretning
// ligger LAND til VENSTRE. For en LUKKET ring i standard (longitude=x-øst,
// latitude=y-nord)-planet ligger polygonets INDRE til venstre for hvert
// segment når ringen traverseres MOTKLOKKES (CCW — vinkelen øker
// 0° -> 90° -> 180° -> 270°, akkurat som enhetssirkelen). En øy sin
// kystlinje traversert CCW gir derfor riktig "land INNI ringen".
//
// Ringen under går ØST -> NORD -> VEST -> SØR -> (tilbake til ØST), som er
// nøyaktig CCW-rekkefølgen. Verifisert for hånd for segmentet øst->nord med
// sentrum i origo (lokalt xy, radius r, øst=(r,0), nord=(0,r)):
//   cross = (bx-ax)(py-ay) - (by-ay)(px-ax)
// Sentrum (p=(0,0)):
//   cross = (0-r)(0-0) - (r-0)(0-r) = 0 - (-r²) = r² > 0 => "land" (riktig).
// Et punkt godt utenfor, rett øst (p=(2r,0)):
//   cross = (0-r)(0-0) - (r-0)(2r-r) = 0 - r² = -r² < 0 => "water" (riktig).
// ===========================================================================

test("§4: øy — lukket kystlinjering rundt en liten øy gir 'land' i sentrum og 'water' utenfor ringen", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((center.latitude * Math.PI) / 180);
  const radiusMeters = 40; // liten øy — diameter ~80 m, godt under en typisk scoring-celle (~150 m)

  const east = { latitude: center.latitude, longitude: center.longitude + radiusMeters / metersPerDegLon };
  const north = { latitude: center.latitude + radiusMeters / METERS_PER_DEG_LAT, longitude: center.longitude };
  const west = { latitude: center.latitude, longitude: center.longitude - radiusMeters / metersPerDegLon };
  const south = { latitude: center.latitude - radiusMeters / METERS_PER_DEG_LAT, longitude: center.longitude };
  const ring = [east, north, west, south, east]; // CCW, eksplisitt lukket (siste punkt = første)
  const water = { waterPolygons: [], coastlineSegments: [ring] };

  assert.equal(determineWaterStatusFromOsm(center, water, 200), "land", "sentrum av øya skal være land");

  const wellOutsideEast = { latitude: center.latitude, longitude: center.longitude + (radiusMeters * 3) / metersPerDegLon };
  assert.equal(determineWaterStatusFromOsm(wellOutsideEast, water, 200), "water", "godt utenfor ringen (øst) skal være vann");

  const wellOutsideNorth = { latitude: center.latitude + (radiusMeters * 3) / METERS_PER_DEG_LAT, longitude: center.longitude };
  assert.equal(determineWaterStatusFromOsm(wellOutsideNorth, water, 200), "water", "godt utenfor ringen (nord) skal være vann");
});

// ===========================================================================
// §5: Halvøy — et nes omgitt av vann på tre sider (nord/øst/sør), festet til
// fastlandet i vest. Vestkanten er BEVISST IKKE med i kystlinje-datasettet
// (akkurat som OSM ikke tagger noen grense inn i fastlandet) — beviser at
// "nærmeste segment vinner"-oppførselen (jf. water.test.ts) fortsatt gir
// korrekt svar når et punkt kan ha nærmeste kystlinje i flere ulike retninger.
// ===========================================================================

test("§5: halvøy — nes omgitt av vann på tre sider, korrekt klassifisering fra flere retninger via nærmeste segment", () => {
  const sw = { latitude: 59.995, longitude: 9.9 };
  const se = { latitude: 59.995, longitude: 10.05 };
  const ne = { latitude: 60.005, longitude: 10.05 };
  const nw = { latitude: 60.005, longitude: 9.9 };
  // SV->SØ (sørkant, østover => land nord), SØ->NØ (nestupp, nordover =>
  // land vest), NØ->NV (nordkant, vestover => land sør). Vestkanten (NV->SV,
  // inn i fastlandet) er utelatt — ekte kystlinje, ikke en fiktiv grense.
  const coastline = [sw, se, ne, nw];
  const water = { waterPolygons: [], coastlineSegments: [coastline] };
  const maxDist = 2000;

  const tip = { latitude: 60.0, longitude: 10.03 }; // inni halvøyen, nær tuppen
  assert.equal(determineWaterStatusFromOsm(tip, water, maxDist), "land", "punkt inni halvøyen skal være land");

  const northWater = { latitude: 60.02, longitude: 10.0 };
  assert.equal(determineWaterStatusFromOsm(northWater, water, maxDist), "water", "vann nord for halvøyen");

  const southWater = { latitude: 59.98, longitude: 10.0 };
  assert.equal(determineWaterStatusFromOsm(southWater, water, maxDist), "water", "vann sør for halvøyen");

  const eastWater = { latitude: 60.0, longitude: 10.08 }; // øst for nestuppen, åpent vann
  assert.equal(determineWaterStatusFromOsm(eastWater, water, maxDist), "water", "åpent vann øst for nestuppen");
});

// ===========================================================================
// §6: Kystlinje — generell grenseverdi-oppførsel. `coastlineSide` returnerer
// `null` (ikke en gjettet side) hvis nærmeste kystlinjesegment er lenger unna
// enn `maxDistanceMeters` — grensetesten under bekrefter den EKSAKTE
// `>`-sammenligningen (resolve.ts: bestDist > maxDistanceMeters). Et par
// centimeters sikkerhetsmargin brukes for å unngå at flyttallsavrunding i
// selve avstandsberegningen (60+offsetDeg regnes ut FØR multiplikasjonen)
// tilfeldig havner på feil side av en bit-eksakt grense — geografisk
// betydningsløst i denne skalaen, men gjør testen deterministisk.
// ===========================================================================

test("§6: kystlinje — punkt praktisk talt PÅ maxDistanceMeters gir fortsatt et svar (inklusiv grense), punkt like forbi gir null", () => {
  const coastline = [
    [
      { latitude: 60.0, longitude: 9.9 },
      { latitude: 60.0, longitude: 10.1 },
    ],
  ];
  const targetDistanceMeters = 800;
  const offsetDeg = targetDistanceMeters / METERS_PER_DEG_LAT;
  const point = { latitude: 60.0 + offsetDeg, longitude: 10.0 }; // ~800 m nord for kystlinjen

  const sideOnBoundary = coastlineSide(point, coastline, targetDistanceMeters + 0.01);
  assert.notEqual(sideOnBoundary, null, "en maxDistanceMeters praktisk talt lik selve avstanden skal fortsatt gi svar, ikke null");
  assert.equal(sideOnBoundary, "land");

  const sideJustBeyond = coastlineSide(point, coastline, targetDistanceMeters - 0.01);
  assert.equal(sideJustBeyond, null, "en maxDistanceMeters like under den faktiske avstanden skal gi null, ikke et gjettet svar");
});

test("§6: kystlinje — punkt noen få meter fra kystlinjen på hver side klassifiseres korrekt (fin-skala presisjon, ikke bare kilometerskala)", () => {
  const coastline = [
    [
      { latitude: 60.0, longitude: 9.9 },
      { latitude: 60.0, longitude: 10.1 },
    ],
  ];
  const fewMetersNorth = { latitude: 60.0 + 3 / METERS_PER_DEG_LAT, longitude: 10.0 };
  const fewMetersSouth = { latitude: 60.0 - 3 / METERS_PER_DEG_LAT, longitude: 10.0 };
  assert.equal(coastlineSide(fewMetersNorth, coastline, 100), "land", "3 m nord for kystlinjen skal fortsatt være land");
  assert.equal(coastlineSide(fewMetersSouth, coastline, 100), "water", "3 m sør for kystlinjen skal fortsatt være vann");
});

// ===========================================================================
// §7: Uregelmessig (L-formet, IKKE konveks) innsjø — beviser at
// `isPointInPolygon`s even-odd ray-casting ikke er avhengig av konveksitet.
// Et punkt i den "utskårne" innhakket (som ville ligget INNI polygonets
// konvekse hull/bounding box, men er GEOMETRISK UTENFOR selve L-formen) må
// klassifiseres som utenfor — en feilaktig konveks-tilnærming (f.eks. en
// bounding-box-sjekk) ville feilaktig sagt "inni".
// ===========================================================================

test("§7: L-formet (ikke-konveks) innsjø — punkt i det utskårne innhakket er UTENFOR, selv om det ligger inni polygonets bounding box", () => {
  // L-form: union av et vertikalt armstykke (lat 60.00-60.02, lon 10.00-10.01)
  // og et horisontalt armstykke (lat 60.00-60.01, lon 10.00-10.02) — hakket
  // som mangler er lat 60.01-60.02 x lon 10.01-10.02 (øvre høyre hjørne).
  const lShapedLake = [
    { latitude: 60.0, longitude: 10.0 },
    { latitude: 60.02, longitude: 10.0 },
    { latitude: 60.02, longitude: 10.01 },
    { latitude: 60.01, longitude: 10.01 },
    { latitude: 60.01, longitude: 10.02 },
    { latitude: 60.0, longitude: 10.02 },
  ];

  const insideVerticalArm = { latitude: 60.015, longitude: 10.005 };
  assert.equal(isPointInPolygon(insideVerticalArm, lShapedLake), true, "punkt i den vertikale armen skal være inni");

  const insideHorizontalArm = { latitude: 60.005, longitude: 10.015 };
  assert.equal(isPointInPolygon(insideHorizontalArm, lShapedLake), true, "punkt i den horisontale armen skal være inni");

  const inTheNotch = { latitude: 60.015, longitude: 10.015 };
  assert.equal(
    isPointInPolygon(inTheNotch, lShapedLake),
    false,
    "punkt i det utskårne hjørnet (inni bounding box, men utenfor selve L-formen) skal være UTENFOR — beviser at ray-casting følger den faktiske konturen, ikke et konveks hull"
  );
});

// ===========================================================================
// §8: Liten innsjø — mindre enn en typisk scoring-celle (~150 m). Punkt-i-
// polygon-testen er EKSAKT (geometrisk), ikke avstandsbasert, så den skal
// virke identisk uansett hvor liten innsjøen er — denne testen dokumenterer
// nettopp det faktum, ikke en spesialbehandling for små flater.
// ===========================================================================

test("§8: liten innsjø (30 m x 30 m, langt under en 150 m scoring-celle) — punkt-i-polygon er eksakt selv på denne skalaen", () => {
  const center = { latitude: 60.0, longitude: 10.0 };
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((center.latitude * Math.PI) / 180);
  const halfWidthMeters = 15; // 30 m x 30 m innsjø
  const offsetLat = halfWidthMeters / METERS_PER_DEG_LAT;
  const offsetLon = halfWidthMeters / metersPerDegLon;
  const smallLake = [
    { latitude: center.latitude - offsetLat, longitude: center.longitude - offsetLon },
    { latitude: center.latitude - offsetLat, longitude: center.longitude + offsetLon },
    { latitude: center.latitude + offsetLat, longitude: center.longitude + offsetLon },
    { latitude: center.latitude + offsetLat, longitude: center.longitude - offsetLon },
  ];

  assert.equal(isPointInPolygon(center, smallLake), true, "sentrum av den lille innsjøen skal være inni");

  const stillInside = { latitude: center.latitude + 5 / METERS_PER_DEG_LAT, longitude: center.longitude };
  assert.equal(isPointInPolygon(stillInside, smallLake), true, "5 m fra sentrum, fortsatt godt innenfor 15 m halvbredden, skal være inni");

  const closeButOutside = { latitude: center.latitude + 100 / METERS_PER_DEG_LAT, longitude: center.longitude };
  assert.equal(
    isPointInPolygon(closeButOutside, smallLake),
    false,
    "100 m unna (nær på scoring-gridets skala, men langt utenfor denne 30 m innsjøen) skal være UTENFOR — ingen avstandsterskel involvert, kun eksakt geometri"
  );
});

// ===========================================================================
// §9: Land på begge sider av vann (sund mellom to landmasser) — utvider
// smalt-sund-mønsteret (§3/§8 i water.test.ts) med en EKSPLISITT sjekk av at
// BEGGE strandsonene resolver til "land", ikke bare at selve sundet blir
// "water". Roten til V1.2.1-bugen var nettopp at et sund kunne "forsvinne"
// mellom to habitat-prøvepunkter som begge landet på land — denne testen
// bekrefter at den nye mekanismen ser BÅDE vannet OG landet på begge sider
// riktig, samtidig, fra samme datasett.
// ===========================================================================

test("§9: sund mellom to landmasser (200 m) — begge strender er land, selve sundet er vann", () => {
  const halfWidthMeters = 100; // 200 m sund
  const offsetDeg = halfWidthMeters / METERS_PER_DEG_LAT;
  const north = [
    { latitude: 60.0 + offsetDeg, longitude: 9.9 },
    { latitude: 60.0 + offsetDeg, longitude: 10.1 },
  ];
  const south = [
    { latitude: 60.0 - offsetDeg, longitude: 10.1 },
    { latitude: 60.0 - offsetDeg, longitude: 9.9 },
  ];
  const water = { waterPolygons: [], coastlineSegments: [north, south] };
  const maxDist = 300;

  const midSund = { latitude: 60.0, longitude: 10.0 };
  assert.equal(determineWaterStatusFromOsm(midSund, water, maxDist), "water", "selve sundet skal være vann");

  const northShore = { latitude: 60.0 + offsetDeg + 60 / METERS_PER_DEG_LAT, longitude: 10.0 };
  assert.equal(determineWaterStatusFromOsm(northShore, water, maxDist), "land", "landmassen nord for sundet skal være land");

  const southShore = { latitude: 60.0 - offsetDeg - 60 / METERS_PER_DEG_LAT, longitude: 10.0 };
  assert.equal(determineWaterStatusFromOsm(southShore, water, maxDist), "land", "landmassen sør for sundet skal være land");
});

// ===========================================================================
// §10-11: resolveSpatialValidity — de to RETNINGENE habitat-prøvegridet kan
// ta feil på, og at OSM-signalet (osmStatus) er AUTORITATIVT i BEGGE
// retninger, ikke bare den ene. §10 (habitat sier LAND, virkeligheten/OSM sier
// VANN) er den EKSAKTE Kristiansand-rotårsaken (se resolve.ts sin
// filkommentar) — habitatgridet klassifiserte et punkt midt i en smal
// vannkanal som "skog" fordi nærmeste prøvepunkt (500 m-1,2 km unna) selv lå
// på land, og ingen vann-prøve fantes nær nok til å utløse forsiktighets-
// regelen. §11 er speilbildet: habitat-prøvegridet sa "vann" (typisk fordi
// nearest-neighbor "arvet" en fjern vannprøve inn i et område som i
// virkeligheten er land) — dette ble EMPIRISK observert og verifisert live
// mot ekte NIBIO-/OSM-data under V1.2.2-utviklingen (en punktprøve nær
// Kristiansand der NIBIO nearest-neighbor ga "vann", men både det faktiske
// terrenget og OSM sin kystlinjegeometri viste land). Denne testen låser
// fast resultatet av den verifikasjonen som en ren enhetstest, uten å hente
// noe data på nytt.
// ===========================================================================

test("§10: habitat-prøvegridet sier LAND ('skog', ingen vannprøve i nærheten), men OSM sier VANN — OSM vinner (Kristiansand-rotårsaken)", () => {
  assert.equal(
    resolveSpatialValidity("skog", null, 500, "water"),
    "water",
    "habitat-prøvegrid-regelen alene ville her gitt 'valid_land' (jf. spatialValidity.test.ts) — OSM skal overstyre til 'water'"
  );
});

test("§11: habitat-prøvegridet sier VANN ('vann', nærmeste prøve er selv vann), men OSM sier LAND — OSM vinner (speilbildet, empirisk verifisert live under V1.2.2)", () => {
  assert.equal(
    resolveSpatialValidity("vann", null, 500, "land"),
    "valid_land",
    "habitat-prøvegrid-regelen alene ville her gitt 'water' UBETINGET (nearest-neighbor-habitat er selv 'vann') — OSM skal likevel overstyre til 'valid_land'"
  );
});

// ===========================================================================
// §12: Ukjent miljødata — fravær av bevis skal ALDRI tolkes som "water"
// (ville stille hele soner urettmessig), men heller ikke stille tolkes som
// en trygg "valid_land"-antakelse. "unknown" er en tredje, eksplisitt
// tilstand som IKKE ekskluderes av extractZones()/buildHeatmapPoints() sitt
// water/invalid-filter (grid.ts: `validity !== "water" && validity !== "invalid"`)
// — denne seksjonen tester både den rene regelen og den fulle konsekvensen.
// ===========================================================================

test("§12: determineWaterStatusFromOsm uten noen vann-/kystlinjedata i det hele tatt gir 'unknown' — ALDRI 'water' by default", () => {
  const status = determineWaterStatusFromOsm({ latitude: 60.0, longitude: 10.0 }, EMPTY_WATER_FEATURES, 1000);
  assert.equal(status, "unknown");
});

test("§12: resolveSpatialValidity uten habitat-bevis OG uten OSM-bevis gir 'unknown', ALDRI en gjetning på 'valid_land' eller 'water'", () => {
  assert.equal(resolveSpatialValidity("ukjent", null, 500, "unknown"), "unknown");
});

test("§12: extractZones() sitt filter slipper 'unknown'-celler gjennom — kun 'water'/'invalid' ekskluderes fra sone-kandidatpoolen", () => {
  const cfg = DEFAULT_ENGINE_CONFIG;
  const breakdown = { recency: 0, repetition: 0, cameraDirection: 0, movementDirection: 0, cameraDiversity: 0, corridor: 0, ecology: 5 };
  const base = { latitude: 60.0, longitude: 10.0 };
  const cellSizeMeters = 150;

  const cells: { center: { latitude: number; longitude: number }; score: number; breakdown: typeof breakdown; validity: "unknown" }[] = [];
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      cells.push({
        center: {
          latitude: base.latitude + (r * cellSizeMeters) / METERS_PER_DEG_LAT,
          longitude: base.longitude + (c * cellSizeMeters) / METERS_PER_DEG_LAT,
        },
        score: 5, // godt over minZoneScore-terskelen (DEFAULT_ENGINE_CONFIG: raw-terskel ≈ 0.5)
        breakdown,
        validity: "unknown",
      });
    }
  }

  const zones = extractZones(cells, cellSizeMeters, 450, cfg);
  assert.ok(zones.length >= 1, "en sammenhengende klynge av 'unknown'-celler over score-terskelen skal danne minst én sone — 'unknown' er IKKE ekvivalent med 'invalid'");
});

const DYR_FOR_SPECIES: Record<"hjort" | "radyr" | "elg", string> = { hjort: "Hjort", radyr: "Rådyr", elg: "Elg" };

for (const species of ["hjort", "radyr", "elg"] as const) {
  test(`§12 [${species}]: full motorkjøring der HELE miljølaget mangler (spatialValidity='unknown' overalt) gir likevel soner`, () => {
    const center = { latitude: 60.0, longitude: 10.0 };
    // Konstant "ingen miljødata i det hele tatt"-resolver — hvert eneste
    // punkt i gridet får UKJENT_STATIC_FEATURES (habitat "ukjent",
    // spatialValidity "unknown"), akkurat som om environment/resolve.ts sitt
    // NIBIO/OSM-oppslag hadde feilet fullstendig for hele analyseområdet.
    const environment = () => ({ static: UKJENT_STATIC_FEATURES, dynamic: UKJENT_DYNAMIC_FEATURES });

    const now = Date.now();
    const observations = [
      {
        id: "o1", userId: "u1", jaktlagId: "", dyr: DYR_FOR_SPECIES[species], type: "Sett", kommentar: "",
        tid: new Date(now).toISOString(), latitude: center.latitude, longitude: center.longitude, geohash: "u4",
        retning: null, antall: 3, observationSource: "camera", cameraId: "cam1", cameraDirectionDegrees: null,
        sporType: null, kjonn: null, alder: null,
      },
    ];

    const result = runEcologicalEngine(observations as never, species, {
      now, areaCenter: center, areaRadiusMeters: 2000, environment, debug: true,
    });

    assert.ok(result.zones.length >= 1, `${species}: forventet minst 1 sone selv med 'unknown' spatialValidity i HELE analyseområdet`);
    assert.ok((result.debug?.unknownValidityCells ?? 0) > 0, `${species}: debug skal rapportere unknown-celler`);
    assert.equal(
      result.debug?.unknownValidityCells,
      result.debug?.gridCellCount,
      `${species}: ALLE celler skal være 'unknown' i dette scenarioet (ingen skal ha blitt validert som water/valid_land uten noe miljølag)`
    );
  });
}
