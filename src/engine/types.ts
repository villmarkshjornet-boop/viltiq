// ViltIQ Engine v1 — motor-uavhengig domenemodell.
//
// Disse typene er bevisst FRIKOBLET fra src/types/observation.ts (som følger
// Firestore-formen). normalize.ts er eneste sted som oversetter mellom de to
// — motorens egne beregninger (signals/grid/reinforcement/confidence/
// explain) skal aldri måtte vite noe om hvordan ViltIQ lagrer data.

import type { LatLng } from "@/src/lib/geo";

export type { LatLng };

/** Intern artstype. Ukjente/uprioriterte arter (f.eks. "Rev") mappes til "annet". */
export type Species = "hjort" | "radyr" | "elg" | "annet";

export const PRIORITERTE_ARTER: readonly Species[] = ["hjort", "radyr", "elg"];

/** Hvor en observasjon kommer fra. */
export type EngineSource = "camera" | "manual" | "track";

/**
 * Én normalisert hendelse motoren kan resonnere over. Kun observasjoner med
 * kjent posisjon og gyldig tidspunkt blir til en EngineObservation — se
 * normalize.ts for hvilke rådata som filtreres bort og hvorfor.
 */
export type EngineObservation = {
  id: string;
  species: Species;
  /** Epoketid i millisekunder — motorens eneste interne tidsrepresentasjon. */
  timestamp: number;
  position: LatLng;
  source: EngineSource;
  /** Dyrets sannsynlige bevegelsesretning (0–360, 0=nord), IKKE det samme som cameraDirectionDeg. */
  movementDirectionDeg: number | null;
  /** Retningen kameraet peker (0–360). Kun satt når source === "camera". */
  cameraDirectionDeg: number | null;
  /** Antall dyr i observasjonen (alltid >= 1). */
  count: number;
  sex: string | null;
  age: string | null;
  /** Sportype (Fotspor/Avføring/...) — kun satt når source === "track". */
  trackType: string | null;
  cameraId: string | null;
  jaktlagId: string;
  /**
   * GPS-nøyaktighet i meter på registreringstidspunktet, FØR personvern-
   * anonymisering (anonymiserPosisjon). Rent diagnostisk/kvalitetssignal per
   * nå — brukes IKKE i scoring (se grid.ts/signals.ts).
   */
  accuracyMeters?: number;
  /**
   * Hvor "ferskt" et spor/tegn SÅ UT da jegeren fant det — kun satt når
   * source === "track". Dette er ET ANNET begrep enn observasjonens ALDER
   * (timestamp), som motorens vanlige tidsvekting (timeWeight) allerede
   * håndterer. Se trackFreshnessAgeOffsetHours i signals.ts for hvordan de to
   * kombineres.
   */
  trackFreshness?: "fresh" | "days" | "old";
  /**
   * Grov 0–1 fullstendighetsheuristikk (har retning? har art? rimelig antall?)
   * — brukt som et svakt signal, IKKE en påstand om at observasjonen er sann.
   */
  dataQuality: number;
};

export type ConfidenceLevel = "lav" | "middels" | "høy";
export type ActivityLevel = "Lav" | "Moderat" | "Høy" | "Svært høy";

/**
 * Hva slags grunnlag sonens score/forklaring faktisk hviler på (V1.1 §31) —
 * skiller "generell/miljøbasert vurdering" fra "lokal evidens" for UI og
 * forklaring. Utledet DETERMINISTISK fra signalBreakdown, ikke en egen
 * separat beregning:
 * - "environment_only": ingen bidragsytende observasjoner i sonen.
 * - "local_dominant": lokale signaler utgjør klart mesteparten av rå-scoren.
 * - "environment_plus_local": begge bidrar merkbart.
 */
export type PredictionMode = "environment_only" | "environment_plus_local" | "local_dominant";

/**
 * Navngitt oppdeling av hva som bidro til en sones score — grunnlaget for
 * både den deterministiske forklaringen (explain.ts) og debug-inspektøren.
 * Alle verdier er rå, ikke-normaliserte bidrag (samme enhet som zone.score).
 */
export type EngineSignalBreakdown = {
  /** Bidrag fra tidsvekting (ferske observasjoner teller mest). */
  recency: number;
  /** Bidrag fra antall/repeterte observasjoner i området. */
  repetition: number;
  /** Bidrag fra kameraets retningsbias (foran > bak). */
  cameraDirection: number;
  /** Bidrag fra dyrets faktiske bevegelsesretning (sterkere enn kamerabias). */
  movementDirection: number;
  /** Bonus for at flere UAVHENGIGE kamera støtter samme område. */
  cameraDiversity: number;
  /** Bonus fra en registrert bevegelseskorridor (spatiotemporal reinforcement, FLERE observasjoner). */
  corridor: number;
  /** Bidrag fra økologisk suitability (høyde/snø/habitat/vei/kant/vind) — 0 når motoren kjøres uten miljødata. */
  ecology: number;
  /**
   * V1.3 (§H): additiv "forventet posisjon"-bidrag fra ÉN observasjons egen
   * `movementDirectionDeg` + alder, projisert et artsavhengig stykke FORAN
   * observasjonen (bredere/svakere jo eldre observasjonen er) — BEVISST
   * SEPARAT fra `movementDirection` over (som kun er en retnings-VEKTING av
   * det symmetriske fotavtrykket rundt selve observasjonspunktet, ikke en
   * forskjøvet forventet posisjon). 0/fraværende når retning mangler — se
   * movement.ts. Valgfri (ikke i eldre, allerede eksisterende breakdown-
   * literaler/tester) — les alltid som `?? 0`.
   */
  movementProjection?: number;
  /**
   * V1.3 (§J): eksplisitt bonus når FLERE observasjoner gjensidig støtter
   * samme område (f.eks. én observasjon peker mot et sted en SENERE
   * observasjon faktisk ligger) — en NAVNGITT versjon av et signal som før
   * V1.3 var usynlig "bakt inn" i den vanlige summeringen av bidrag. Sier
   * ALDRI noe om at det er samme individ, kun at uavhengige signaler peker
   * samme vei — se evidenceFusion.ts. Valgfri, les alltid som `?? 0`.
   */
  evidenceDensity?: number;
};

/**
 * V1.2 §25: per-faktor økologisk nedbrytning for en sone — eksponert for
 * explainability/debug-formål, IKKE bare det aggregerte
 * `signalBreakdown.ecology`-tallet (som er summen, uten å si HVILKE
 * faktorer som faktisk bidro). Strukturelt lik ecology/suitability.ts sin
 * SuitabilityBreakdown (bevisst IKKE importert derfra — denne filen skal
 * forbli fri for interne motor-avhengigheter, se filkommentaren øverst),
 * men samme faktiske tall fra samme beregning — ingen egen UI-versjon med
 * andre regler. `undefined` når motoren kjørte uten miljødata (ren
 * runEngine, ikke runEcologicalEngine).
 */
export type EnvironmentBreakdown = {
  habitat: number;
  winterSnowElevation: number;
  springGreenup: number;
  road: number;
  edge: number;
  windExposure: number;
  /** V1.3 (§F): dag/natt-basisnivå UTOVER den eksisterende skumring/demring-bonusen (crepuscularActivity) — se ecology/suitability.ts. Valgfri, les som `?? 1` (multiplikativ, nøytral=1). */
  timeOfDay?: number;
  /** V1.3 (§G): nedbør-relatert justering, atskilt fra den eksisterende vindeksponerings-faktoren. Valgfri, les som `?? 1`. */
  precipitation?: number;
};

/**
 * V1.3 (§Q i motoroppdraget): status for ÉN ekstern miljødatakilde for
 * DENNE motorkjøringen. BEVISST forskjellig fra en manglende/null VERDI —
 * `signal = 0` og `signal unavailable` er ikke det samme (§Q: en feilet
 * vei-oppslag skal ALDRI tolkes som "ingen vei i nærheten"). Se
 * environment/resolve.ts for hvordan hver kilde faktisk rapporterer dette.
 * - "available": hentet vellykket, fersk.
 * - "unavailable": forsøkt hentet, men mislyktes (nettverksfeil, tomt svar).
 * - "stale": hentet fra cache utover normal fersk-levetid (kun dynamiske
 *   kilder som vær har en meningsfull "stale" — statiske kilder som høyde
 *   endrer seg ikke, og bruker derfor aldri denne verdien).
 * - "fallback": ingen resolver i det hele tatt ble brukt (ren `runEngine`).
 */
export type DataSourceStatus = "available" | "unavailable" | "stale" | "fallback";

/** V1.3 (§Q): samlet datakvalitetsstatus for ÉN motorkjøring — én status per ekstern miljøkilde. */
export type EngineDataQuality = {
  elevation: DataSourceStatus;
  habitat: DataSourceStatus;
  roads: DataSourceStatus;
  water: DataSourceStatus;
  weather: DataSourceStatus;
};

/**
 * V1.3 (§K/§L): den FAKTISKE, sammenhengende geografiske utstrekningen til
 * en sone — cellene extractZones() faktisk klassifiserte som del av denne
 * sonen (se grid.ts sin claimedZoneIndex, innført i V1.2.2s fragmenterings-
 * fiks og nå gjenbrukt her i stedet for en ny, parallell utregning), IKKE en
 * kunstig sirkel rundt `center`. `hull` er et forenklet konvekst skrog av
 * `cells`, egnet for polygon-rendering — presentasjonslaget skal bruke
 * `hull`, ikke regne ut sitt eget.
 */
export type ZoneFootprint = {
  cells: LatLng[];
  hull: LatLng[];
};

/**
 * V1.3 (§O): en deterministisk, strukturert anbefaling for ÉN sone — bygget
 * FRA de samme tallene explain.ts sin buildZoneExplanation() allerede
 * regner ut (samme Støtter/Begrenser-klassifisering, se explain.ts), kun i
 * strukturert (ikke ferdig-sammenslått streng-)form for UI-et. Se explain.ts
 * sin buildZoneRecommendation().
 */
/**
 * V1.3: ETT sammenhengende klokkeslett-vindu med reelt forhøyet skumrings-/
 * demringsaktivitet for én art, utledet fra ekte sunrise/sunsetMs (se
 * environment/dynamic.ts) og artens EGEN crepuscularActivity.strength
 * (ecology/profiles.ts) — se explain.ts sin computeRecommendedTimeWindow().
 * "dawn" = vindu rundt soloppgang, "dusk" = vindu rundt solnedgang.
 */
export type RecommendedTimeWindow = {
  type: "dawn" | "dusk";
  startMs: number;
  endMs: number;
};

export type ZoneRecommendation = {
  zoneId: string;
  species: Species;
  /** 1-basert rangering blant sonene i SAMME EngineResult (1 = best). */
  rank: number;
  score: number;
  confidence: number;
  /** §P: ALDRI en prosent-sannsynlighet — samme etikett som ActivityLevel. */
  probabilityLabel: ActivityLevel;
  positiveReasons: string[];
  negativeReasons: string[];
  summary: string;
  /** §R: "Datagrunnlag: Lavt/Middels/Godt" — utledet fra confidence + observasjonsalder + evt. dataQuality, IKKE en ny separat måling. */
  dataFreshness: "lav" | "middels" | "god";
  evidenceCount: number;
  /**
   * V1.3: "Beste tidspunkt"-vinduer for DENNE sonens art — se
   * RecommendedTimeWindow over. TOMT array (aldri oppdiktet) når arten
   * ikke har noen dokumentert skumringseffekt (f.eks. "annet"/Rev) eller
   * motoren kjørte uten værdata — UI skal da vise en nøytral
   * "Ingen tydelig tidsvindu"-tekst i stedet for et fabrikkert klokkeslett.
   */
  recommendedTimeWindows: RecommendedTimeWindow[];
};

export type PredictionZone = {
  id: string;
  species: Species;
  center: LatLng;
  radiusMeters: number;
  /** 0–100, skalert visningsscore. IKKE en sannsynlighet. */
  score: number;
  level: ActivityLevel;
  /** 0–1, hvor mye datagrunnlag som støtter sonen — uavhengig av score. */
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  observationCount: number;
  distinctCameraCount: number;
  /** Alder på nyeste bidragsytende observasjon, i minutter. */
  newestObservationAgeMinutes: number;
  /** 2–4 korte, deterministisk genererte punkter — se explain.ts. */
  dominantSignals: string[];
  /** Én kort, menneskelig setning bygget deterministisk fra signalene. */
  explanation: string;
  signalBreakdown: EngineSignalBreakdown;
  /** Se PredictionMode — "environment_only" når observationCount er 0. */
  predictionMode: PredictionMode;
  /** Se EnvironmentBreakdown — undefined når motoren kjørte uten miljødata. */
  environmentBreakdown?: EnvironmentBreakdown;
  /** V1.3 §K/§L — se ZoneFootprint. Undefined kun hvis sonen av en eller annen grunn ikke har noen klargjorte celler (bør ikke skje i praksis). */
  footprint?: ZoneFootprint;
  /** V1.3 §M/§N — 1-basert rangering blant sonene i SAMME EngineResult (settes av engine.ts ETTER sortering, samme rekkefølge som zones[]). */
  rank?: number;
  /** V1.3 §N/§O — se ZoneRecommendation. Bygget av engine.ts fra SAMME Støtter/Begrenser-grunner som explanation/dominantSignals over, ikke en ny beregning. */
  recommendation?: ZoneRecommendation;
};

export type EngineDebugCell = {
  center: LatLng;
  score: number;
  breakdown: EngineSignalBreakdown;
  /** "unknown" når motoren kjørte uten miljødata — se environment/types.ts sin SpatialValidity. */
  validity: "valid_land" | "water" | "invalid" | "unknown";
};

export type EngineDebugCorridor = {
  point: LatLng;
  bearingDeg: number;
  strength: number;
  contributingIds: string[];
};

/** Persentiler over RÅ (ikke skalert 0–100) celle-score for hele gridet — V1.2.1 §21-instrumentering. */
export type EngineDebugScoreStats = {
  min: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
};

export type EngineDebugInfo = {
  totalObservationsInput: number;
  totalObservationsAfterNormalize: number;
  gridCellCount: number;
  cellSizeMeters: number;
  /** Antall gridceller per SpatialValidity — V1.2.1 §21. "water"/"invalid" telles sammen med resten, men kan aldri bli en sone-topp/heatmap-kandidat (se grid.ts). */
  validLandCells: number;
  waterCells: number;
  unknownValidityCells: number;
  /** undefined kun dersom gridet er tomt (ingen celler i det hele tatt). */
  scoreStats?: EngineDebugScoreStats;
  /** De 10 høyest scorede rutene, uavhengig av om de ble til en sone. */
  topCells: EngineDebugCell[];
  corridors: EngineDebugCorridor[];
};

/** Ett vektet punkt i det interne scoring-gridet — grunnlaget for et ekte gradient-heatmap (ikke bare sonesentrene). */
export type HeatmapPoint = { latitude: number; longitude: number; weight: number };

export type EngineResult = {
  engineVersion: string;
  /** Versjon av DEFAULT_ENGINE_CONFIG-verdiene brukt til å produsere dette resultatet — se config.ts sin CONFIG_VERSION. */
  configVersion: string;
  species: Species;
  /** Epoketid (ms) da resultatet ble generert. */
  generatedAt: number;
  zones: PredictionZone[];
  /** Overordnet confidence — hentet fra beste sone, eller lav hvis ingen soner. */
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  /** Én kort oppsummeringssetning for hele resultatet. */
  summary: string;
  /** De viktigste signalene på tvers av resultatet (speiler beste sone). */
  signals: string[];
  observationsConsidered: number;
  /**
   * Vektede punkter (0–1) fra HELE scoring-gridet, ikke bare klyngede soner —
   * grunnlaget for et faktisk gradient-heatmap-lag på kartet. Samme
   * underliggende score som zones, bare ikke terskel-/klyngefiltrert.
   * Tak-begrenset og svake celler filtrert bort, se engine.ts.
   */
  heatmapPoints: HeatmapPoint[];
  debug?: EngineDebugInfo;
  /** V1.3 §Q — undefined for ren runEngine (ingen miljøresolver i det hele tatt ble brukt, se DataSourceStatus sin "fallback"). */
  dataQuality?: EngineDataQuality;
  /**
   * BUG 4 (V1.5) — kun satt når et gyldig (≥3 punkter) `huntAreaPolygon` ble
   * gitt til runEngine/runEcologicalEngine. `matchedCellCount` er antall
   * ALLEREDE SCOREDE ruter (uavhengig av om de nådde sone-terskelen) som
   * falt innenfor polygonet. `matchedCellCount === 0` betyr IKKE "ingen
   * dyreaktivitet" — det betyr at polygonet var for lite/tynt relativt til
   * `cellSizeMeters` (som skalerer opp automatisk for store områder, se
   * grid.ts sin buildGridCells) til at NOEN rutesenter traff det i det hele
   * tatt. UI-laget MÅ skille disse to tilfellene eksplisitt — ellers ser en
   * geometrisk uløselig oppløsning identisk ut som "ingen funn".
   */
  huntArea?: { matchedCellCount: number; cellSizeMeters: number };
};
