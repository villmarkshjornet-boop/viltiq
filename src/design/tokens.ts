// ViltIQ Design System v1 — samlet kildesannhet for farger, typografi,
// spacing, radius, elevation og z-index. All UI-kode skal importere herfra
// i stedet for å hardkode hex-verdier/px-tall — se STEG 3-oppdraget §12.
//
// Basert på det som allerede var appens etablerte identitet (mørk grafitt +
// ViltIQ-grønn #2CC36B, brukt konsekvent i de fleste skjermer FØR denne
// filen fantes) — ikke en ny merkevare, en KODIFISERING av det som allerede
// fungerte, pluss retting av det som ikke gjorde det (kamera-skjermen brukte
// en helt annen, generisk fargepalett — se sluttrapportens audit-seksjon).

export const color = {
  // Bakgrunn / overflater — mørkest til lysest
  background: "#060E08",
  surface: "#0B1610",
  surfaceElevated: "#0F1D14",
  surfaceHover: "#132419",
  border: "#192420",
  borderStrong: "#2A4738",

  // Tekst
  textPrimary: "#FFFFFF",
  textSecondary: "#A9B8AE",
  textMuted: "#5C7568",
  textFaint: "#3D5446",

  // Merkevare
  primary: "#2CC36B",
  primaryText: "#04110A", // tekst PÅ primary-bakgrunn
  primarySoft: "#A9F2BF",

  // Status
  success: "#4ADE80",
  warning: "#EAB308",
  danger: "#F87171",
  info: "#60A5FA",

  // Aktivitetsnivå (score-gradient: grønn → gul → oransje → rød)
  levelLav: "#4ADE80",
  levelModerat: "#EAB308",
  levelHøy: "#FB923C",
  levelSværtHøy: "#F87171",

  // Confidence (nøytral blå-grønn skala, bevisst IKKE samme farger som aktivitetsnivå — de er to ulike akser og skal ikke se forvekslbare ut)
  confidenceLav: "#5C7568",
  confidenceMiddels: "#60A5FA",
  confidenceHøy: "#2CC36B",

  // Lag-identitet (Designrapport §02/§anbefaling-2): kart.tsx sine
  // kartlag-knapper/legend-prikker brukte allerede disse fargene
  // KONSEKVENT (samme lilla for motor/heatmap over hele filen, samme cyan
  // for aktive soner osv.) — de manglet bare et navn her. Ingen nye
  // fargevalg, kun en registrering av det som allerede var i praktisk bruk.
  layerMotor: "#A78BFA",
  layerAktiveSoner: "#22D3EE",
  layerAktiveSonerAlt: "#A855F7",
  layerObservasjoner: "#34D399",
  layerSpor: "#FCD34D",
} as const;

/** Aktivitetsnivå → farge. Matcher src/engine sin ActivityLevel-type. */
export function levelColor(level: string): string {
  if (level === "Svært høy") return color.levelSværtHøy;
  if (level === "Høy") return color.levelHøy;
  if (level === "Moderat") return color.levelModerat;
  return color.levelLav;
}

/** Confidence-nivå → farge. Matcher src/engine sin ConfidenceLevel-type. */
export function confidenceColor(level: string): string {
  if (level === "høy") return color.confidenceHøy;
  if (level === "middels") return color.confidenceMiddels;
  return color.confidenceLav;
}

/**
 * Modal/bottom sheet-bakteppe. Én verdi — erstatter tre innbyrdes ulike
 * overlay-opasiteter (0.70/0.72/0.75) som hadde sneket seg inn i
 * jakt/logg/onboarding før dette ble et delt token (Redesign-oppdraget §31).
 */
export const overlay = {
  scrim: "rgba(3,8,5,0.72)",
} as const;

/**
 * Translucent "instrument"-overflater — kartkontroller, bottom-dock — der en
 * helt opak Surface ville sett ut som en grå boks oppå kartet (Redesign-
 * oppdraget §16/§35). Avledet av color.surface/background, ingen ny valør.
 */
export const glass = {
  controlBg: "rgba(8,14,10,0.90)",
  controlBgStrong: "rgba(8,14,10,0.98)",
  controlBorder: "rgba(42,71,56,0.55)",
} as const;

/**
 * Navngitte alpha-suffikser for hex+alpha-strenger (f.eks. color.primary +
 * alpha.soft). Erstatter den tidligere ad hoc-varianten (`c + "20"`,
 * `accentColor + "40"`) i Badge/Toggle med noe som kan gjenbrukes og
 * begrunnes ett sted (Redesign-oppdraget §41).
 */
export const alpha = {
  soft: "33",   // ~20%
  medium: "66", // ~40%
} as const;

/**
 * Svært dempet glød bak hero-kort (Hjem/Jakt), farget etter motorens
 * aktivitetsnivå — ALDRI en heldekket farget boks (§12/§13). Bevisst
 * separate par fra HEATMAP_GRADIENT i components/MapView.types.ts, som er en
 * hel skala for selve kartflaten, ikke et enkeltpunkt-glød bak et kort.
 */
export const heat = {
  glowHigh: ["rgba(251,146,60,0.20)", "rgba(251,146,60,0.00)"] as const,
  glowSevere: ["rgba(248,113,113,0.22)", "rgba(248,113,113,0.00)"] as const,
  glowLow: ["rgba(76,222,128,0.10)", "rgba(76,222,128,0.00)"] as const,
} as const;

/** Varighet (ms) for mikroanimasjoner (§11) — base matcher BottomSheet sin tidligere Animated.timing-varighet, så overgangen til Reanimated ikke endrer følelsen av eksisterende bevegelse. */
export const motion = {
  fast: 120,
  base: 220,
  slow: 360,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  pill: 999,
} as const;

export const typography = {
  eyebrow: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 1.5, textTransform: "uppercase" as const },
  pageTitle: { fontSize: 26, fontWeight: "900" as const, letterSpacing: -0.4 },
  sectionTitle: { fontSize: 16, fontWeight: "900" as const },
  primaryValue: { fontSize: 32, fontWeight: "900" as const, letterSpacing: -0.6 },
  body: { fontSize: 14, fontWeight: "500" as const, lineHeight: 21 },
  bodyStrong: { fontSize: 14, fontWeight: "800" as const },
  metadata: { fontSize: 12, fontWeight: "700" as const },
  /** Ett hakk over pageTitle — forbeholdt ett tall/ord per skjerm som virkelig skal dominere (hero-art på Hjem/Jakt). */
  display: { fontSize: 34, fontWeight: "900" as const, letterSpacing: -0.6 },
  /** Under metadata — statuslinjer (GPS-presisjon, tidsstempel) som skal være lesbare men aldri konkurrere om oppmerksomhet. */
  caption: { fontSize: 11, fontWeight: "600" as const },
  /** Distinkt fra primaryValue — for et rått motor-score-tall (f.eks. "82") plassert VED SIDEN AV kvalitativ tekst, ikke istedenfor den. */
  numericScore: { fontSize: 20, fontWeight: "900" as const, letterSpacing: -0.3 },
} as const;

/**
 * Elevation/shadow — subtilt, ikke gammeldagse harde skygger (§12).
 * Brukes på flytende paneler (bottom sheet, dropdown, engine-panel).
 */
export const elevation = {
  panel: {
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  floating: {
    shadowColor: "#000000",
    shadowOpacity: 0.34,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 18,
  },
} as const;

/**
 * Z-index/stacking-system (§42). Bruk KUN disse navngitte nivåene — aldri
 * vilkårlige tall som 999999 for å "fikse" en overlap. Hvert lag i UI-et skal
 * kunne begrunne hvilket nivå det ligger på ut fra denne listen.
 */
export const zIndex = {
  map: 0,
  mapOverlay: 10, // soner, sektorer, spor tegnet PÅ kartet
  mapControls: 20, // zoom, lagvelger-knapp, filterrad
  panel: 30, // engine summary-panel, side-paneler
  navigation: 40, // topbar, bottom nav/dock
  dropdown: 50,
  bottomSheet: 60,
  modal: 70,
  toast: 80,
} as const;

/** Minimum touch target (§39) — jaktapp brukt utendørs, med hansker, i bevegelse. */
export const minTouchTarget = 44;
