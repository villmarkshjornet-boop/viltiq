// Elg — se docs/ENGINE_RESEARCH.md punkt 2 (vårtrekk/høyde, MEDIUM evidens,
// regionalt datagrunnlag fra Nord-Trøndelag).
//
// V1.1-REVISJON: oppdatert etter en egen research-runde mot primærlitteratur
// (Bjørneraas et al. 2011, Rolandsen et al. 2011, Eldegard et al. 2012,
// Neumann et al. 2012/2018, NINA Rapport 2416 m.fl. — se agentrapporten i
// motor-oppdraget for full kildeliste). Kun EVIDENCE-feltet og enkelte
// STRENGTH-verdier er justert der en konkret, artsspesifikk, fortrinnsvis
// norsk kilde nå finnes — ingen ny biologi er "funnet på" (§14).

import type { SpeciesEcologyProfile } from "./types";

export const ELG_ECOLOGY_PROFILE: SpeciesEcologyProfile = {
  species: "elg",

  // BIOLOGISK GRUNNLAG: Bjørneraas et al. (2011), sentral-Norge, er en
  // direkte, norsk, artsspesifikk GPS-studie som viser at elg foretrekker
  // UNG skog (<40 år) og kulturmark om NATTEN, og eldre/tettere skog om
  // DAGEN — samt gammelskog (>80 år) om vinteren pga. lavere snødybde under
  // tett kronedekke. Samme strukturelle begrensning som for hjort: dagens
  // habitatSuitability har ingen døgn- eller skogalder-akse.
  // MOTOR-REPRESENTASJON: verdiene under uendret — en reell, norsk kilde
  // finnes nå for RETNINGEN (skog generelt gunstig), men ikke for de
  // manglende dimensjonene (skogalder, døgntid). Bevisst UTSATT til V1.2,
  // samme begrunnelse som hjort.
  // STATUS: evidensgrad hevet LOW -> MEDIUM (reell norsk kilde, men dekker
  // ikke hele modellens detaljnivå).
  habitatSuitability: {
    evidence: "MEDIUM",
    default: {
      skog: 0.85,
      myr: 0.55,
      jordbruk: 0.5,
      apent: 0.4,
      vann: 0.4,
      bebygd: 0.1,
      ukjent: 0.5,
    },
  },

  // BIOLOGISK GRUNNLAG: snø — ikke bare kulde — er dokumentert som den
  // egentlige DRIVEREN bak elgens sesongtrekk og vinterhabitatvalg
  // (Rolandsen et al. 2011: dobling i elg-relaterte trafikkpåkjørsler mellom
  // lav- og høysnø-år, KUN i snørike fylker; Singh et al. 2012: snødybde er
  // hoveddriveren for andelen trekkdyr langs en svensk breddegradsgradient).
  // Tidligere begrunnelse ("elg er mer vintertolerant enn hjort") forveksler
  // KULDETOLERANSE med SNØTOLERANSE — de er ikke det samme, og snø er
  // fortsatt en sterk driver for elg spesifikt.
  // MOTOR-REPRESENTASJON: strength hevet fra 0.25 til 0.5 — fortsatt lavere
  // enn hjortens 0.9 (elg tåler ren kulde bedre), men ikke lenger neglisjerbar.
  // STATUS: evidensgrad hevet LOW -> MEDIUM (norsk/svensk, men snødybde vs.
  // snøkvalitet er fortsatt et dokumentert usikkerhetsmoment i litteraturen).
  winterSnowElevation: { evidence: "MEDIUM", strength: 0.5 },

  // docs punkt 2 — MEDIUM: regional NINA-kilde (Nord-Trøndelag), nå styrket
  // av Oppland-data (NINA Rapport 2416: 86% trekkdyr) og av et konkret
  // høydeestimat (Mysterud/Rolandsen: ~100-150 moh forskjell sommer/vinter)
  // og en 13-dagers gjennomsnittlig trekkvarighet — fortsatt regionalt, ikke
  // landsdekkende, og retningen kan reverseres i enkelte områder (Oppland:
  // vinterområdet ligger HØYERE, ikke lavere, pga. snøfattig furuskog).
  // MOTOR-REPRESENTASJON: strength uendret (0.6) — den regionale
  // usikkerheten (inkl. mulig retningsreversering) taler mot å styrke videre.
  // STATUS: evidensgrad uendret MEDIUM.
  springGreenupElevation: { evidence: "MEDIUM", strength: 0.6 },

  // BIOLOGISK GRUNNLAG: Eldegard et al. (2012) er en direkte, norsk,
  // fagfellevurdert, elg-spesifikk kilde: elg avveier beitekvalitet mot
  // veiavstand i en gradert, ikke absolutt, unngåelse. Bartzke et al. (2015,
  // NINA) legger til korridor-/barriereeffekter for kraftlinjer/veier/elver.
  // MOTOR-REPRESENTASJON: strength uendret (0.4) — litteraturen bekrefter
  // FORMEN (gradient) motoren allerede bruker, men gir ikke et tall.
  // STATUS: evidensgrad hevet LOW -> HIGH (direkte norsk elg-spesifikk kilde).
  roadSensitivity: { evidence: "HIGH", strength: 0.4 },

  // BIOLOGISK GRUNNLAG: mekanismen (mat/dekning-grensesone) er godt
  // etablert i litteraturen (Bjørneraas 2011, Borowik 2024), men ingen
  // skandinavisk kvantifisert avstandsfunksjon for elg ble funnet — samme
  // konklusjon som forrige runde.
  // MOTOR-REPRESENTASJON: uendret.
  // STATUS: evidensgrad uendret LOW.
  edgeAffinity: { evidence: "LOW", strength: 0.25 },

  // BIOLOGISK GRUNNLAG: EN ANDRE, uavhengig research-runde fant FORTSATT
  // ingen støtte for vindretning som atferdsdrivende faktor — samme
  // konklusjon og samme begrunnelse som hjort (se hjort.ts).
  // MOTOR-REPRESENTASJON: strength senket fra 0.15 til 0.08, beholdt som ren
  // fysisk terrengeksponeringsfaktor, ikke fjernet.
  // STATUS: LOW evidens bekreftet, styrke ytterligere senket.
  windExposureSensitivity: { evidence: "LOW", strength: 0.08 },

  // BIOLOGISK GRUNNLAG: Bjørneraas et al. (2011) og Ditmer et al. (2018) gir
  // nå en artsspesifikk (norsk for Bjørneraas) kilde på skumrings-/
  // demringstopp for elg — tidligere var dette kun generelt prinsipp.
  // MOTOR-REPRESENTASJON: strength uendret (0.35) — samme forsiktighet som
  // hjort, siden effekten også her er dokumentert svak/lett overstyrt.
  // STATUS: evidensgrad uendret MEDIUM (bevisst ikke hevet ytterligere).
  crepuscularActivity: { evidence: "MEDIUM", strength: 0.35 },

  // BIOLOGISK GRUNNLAG: V1.3 (§F) — Bjørneraas et al. (2011) dokumenterer at
  // elg bruker ULIK HABITAT om natten (ung skog/kulturmark) vs. dagen
  // (eldre/tettere skog), men dette er en SELEKSJONS-forskjell (HVOR),
  // ikke en dokumentert forskjell i totalt AKTIVITETSNIVÅ (HVOR MYE) mellom
  // dag og natt — en annen mekanisme enn den denne faktoren modellerer.
  // Ingen kilde ble funnet som kvantifiserer en ren dag/natt-
  // aktivitetsnivåforskjell for elg spesifikt (i motsetning til hjort/rådyr,
  // der jakttrykk-kildene i det minste indirekte antyder en retning).
  // MOTOR-REPRESENTASJON: strength=0.1 — bevisst lavere enn hjort (0.25) og
  // rådyr (0.2), en konservativ placeholder som IKKE later som
  // habitatseleksjons-funnet sier noe om aktivitetsNIVÅ.
  // STATUS: LOW evidens — ingen direkte kilde for akkurat denne mekanismen.
  timeOfDayActivity: { evidence: "LOW", strength: 0.1 },

  // BIOLOGISK GRUNNLAG: Neumann et al. (2018), 172 GPS-elg i Sverige,
  // dokumenterer ØKT hannmobilitet fra midt-september til tidlig oktober,
  // eksplisitt tilskrevet brunst (ikke jaktforstyrrelse) — samme brunstvindu
  // som hjort. Tidligere docs-punkt 4 fant ingen bekreftet bevegelseseffekt
  // for elg; det er nå delvis motbevist for hannindivider spesifikt.
  // MOTOR-REPRESENTASJON: movementBoost hevet fra 0 til 0.3 — bevisst LAVERE
  // enn hjortens 0.6, siden funnet er hannspesifikt og kjønn normalt ikke er
  // kjent for en gitt observasjon (samme forsiktighetsprinsipp som
  // hjort-profilens egen §K-merknad).
  // STATUS: evidensgrad hevet LOW -> MEDIUM.
  rutBehavior: { evidence: "MEDIUM", movementBoost: 0.3, months: [9, 10] },

  // BIOLOGISK GRUNNLAG: V1.3 (§G) — som for hjort/rådyr: INGEN norsk/svensk,
  // artsspesifikk primærkilde funnet for nedbør og elgatferd. Ren fysisk
  // plausibilitet (punkt 9 i docs nevner tørke/nedbør KUN via beitekvalitet
  // over sesonger, ikke en kortsiktig nedbør-responskurve).
  // MOTOR-REPRESENTASJON: strength=0.15 — konservativ placeholder, samme
  // nivå som hjort/rådyr.
  // STATUS: LOW evidens.
  precipitationSensitivity: { evidence: "LOW", strength: 0.15 },
};
