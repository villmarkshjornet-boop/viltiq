// Rådyr — se docs/ENGINE_RESEARCH.md punkt 3 (habitat i kulturlandskap,
// HIGH evidens — den best funderte enkeltfaktoren i hele det økologiske
// laget).
//
// V1.1-REVISJON: oppdatert etter en egen research-runde mot primærlitteratur
// (Mysterud/Bjørnsen/Østbye 1997, Bjar et al. 1991, Torres et al. 2011,
// Kjøstvedt et al. 1998, Bonnot et al. 2013/2020, Pagon et al. 2017 m.fl. —
// se agentrapporten i motor-oppdraget for full kildeliste). Kun EVIDENCE-felt
// og enkelte STRENGTH-verdier er justert der en konkret ny kilde nå finnes.

import type { SpeciesEcologyProfile } from "./types";

export const RADYR_ECOLOGY_PROFILE: SpeciesEcologyProfile = {
  species: "radyr",

  // BIOLOGISK GRUNNLAG: kulturlandskap-funnet er bekreftet og styrket
  // (Kjøstvedt et al. 1998, Lier: rådyr beiter aktivt på jordbruksvekster
  // om vinteren pga. høyere Na/Mg/Ca/K/protein-innhold enn naturlig beite).
  // MEN: Bonnot et al. (2013), 94 rådyr, Frankrike — over 80 % sannsynlighet
  // for at en skog-posisjon er registrert PÅ DAGTID, uansett kjønn/alder;
  // rådyr bruker overveiende åpen mark/jordbruksareal om NATTEN. Samme
  // strukturelle begrensning som hjort/elg: dagens tall representerer best
  // et NATT-mønster, mens rådyrjakt i Norge foregår i dagslys. En egen
  // døgnakse er en strukturell utvidelse, bevisst utsatt til V1.2.
  // STATUS: evidensgrad uendret HIGH (habitat-retningen er godt fundert),
  // men den kjente døgn-mismatchen er nå eksplisitt dokumentert her.
  habitatSuitability: {
    evidence: "HIGH",
    default: {
      skog: 0.6,
      myr: 0.5,
      jordbruk: 0.85,
      apent: 0.55,
      vann: 0.35,
      bebygd: 0.35,
      ukjent: 0.5,
    },
  },

  // BIOLOGISK GRUNNLAG: Mysterud, Bjørnsen & Østbye (1997), Telemark — norsk,
  // artsspesifikk, fagfellevurdert primærkilde av SAMME forfatter som
  // hjort-profilens hovedkilde. Tallfester en kritisk snødybde på ~50 cm;
  // dokumenterer nedtrekk i høyde OG økt bruk av gammelskog (snøskjerming
  // under kronedekket) med økende snø. Den forrige runmes påstand om at
  // "ingen direkte rådyr-kilde ble funnet" var rett og slett uriktig — dette
  // er den enkeltstående viktigste korrigeringen i V1.1-revisjonen av rådyr.
  // MOTOR-REPRESENTASJON: strength hevet fra 0.3 til 0.6 — lavere enn
  // hjortens 0.9 (rådyr trekker kortere/mindre enn hjort, se
  // springGreenupElevation under), men ikke lenger svak/forsiktig.
  // STATUS: evidensgrad hevet LOW -> HIGH.
  winterSnowElevation: { evidence: "HIGH", strength: 0.6 },

  // BIOLOGISK GRUNNLAG: Mysterud et al. (2012), direkte sympatrisk
  // sammenligning i Norge — KUN 27 % av rådyr trekker, mot 94 % av hjort i
  // samme landskap, og "forage maturation"-hypotesen (grønnskudd-jaging) ble
  // KUN støttet for hjort. Rådyrs vår-oppflytning (der den skjer) tolkes
  // bedre som en retur etter snøsmelting enn aktiv beitemodning-sporing —
  // rådyr er en "concentrate selector" (browser) som vinner mindre på å
  // følge grønnskuddbølgen enn hjortens grasbeiting gjør.
  // MOTOR-REPRESENTASJON: uendret. Fristelsen til å heve denne "for
  // konsistens" med hjort ble bevisst avvist — kildene sier eksplisitt at
  // mekanismen IKKE gjelder rådyr på samme måte.
  // STATUS: evidensgrad uendret LOW — nå et bekreftet fravær av effekt,
  // ikke lenger bare et ufunnet spørsmål.
  springGreenupElevation: { evidence: "LOW", strength: 0.2 },

  // BIOLOGISK GRUNNLAG: Torres et al. (2011), SØ-Norge, direkte artssammen-
  // lignende studie: andel bebygd areal innen 1000 m påvirket ELG negativt,
  // men IKKE rådyr i samme landskap. Rådyr bor gjerne tett på hus/vei
  // (habitatnivå), men Passoni et al. (2021, 95 GPS-baner) fant sterk
  // unngåelse av å KRYSSE vei (β=-1,38) — en bevegelses-/barriereeffekt, en
  // annen mekanisme enn egnethetsgradienten roadSensitivity modellerer.
  // MOTOR-REPRESENTASJON: strength uendret (0.15, lavest av de tre artene) —
  // nå positivt dokumentert i stedet for kun avledet fra habitatfunnet.
  // STATUS: evidensgrad hevet MEDIUM -> HIGH (direkte norsk artssammenlignende kilde).
  roadSensitivity: { evidence: "HIGH", strength: 0.15 },

  // BIOLOGISK GRUNNLAG: Mysterud et al. (1997) fant at KANTEN mellom
  // middelaldrende bestand og hogstflater ble foretrukket, mens begge
  // habitattypene HVER FOR SEG ble unngått om vinteren — en ren kanteffekt
  // som ikke kan forklares av noen tilstøtende habitatklasse alene. Torres
  // et al. (2011) og Kjøstvedt et al. (1998) støtter opp under jord-/
  // skogkant som selve mekanismen bak rådyrs suksess i kulturlandskap.
  // MOTOR-REPRESENTASJON: strength uendret (0.35, høyest av de tre artene —
  // fortsatt riktig, siden kanteffekten her er den best kildebelagte av alle
  // tre artenes edgeAffinity).
  // STATUS: evidensgrad hevet LOW -> MEDIUM (tre norske artsspesifikke kilder).
  edgeAffinity: { evidence: "MEDIUM", strength: 0.35 },

  // BIOLOGISK GRUNNLAG: EN TREDJE, uavhengig research-runde fant FORTSATT
  // ingen støtte for vindretning som atferdsdrivende faktor hos rådyr heller
  // — kun jaktblogger, som spriker seg imellom. Vindstyrke har en reell,
  // men FORTEGNSUSTABIL effekt på jaktutbytte (Baur et al. 2021: negativ om
  // sommeren, positiv om vinteren) — mest sannsynlig en jeger-effekt, ikke
  // en dyre-atferdseffekt, og derfor ikke brukbar som motorvekt.
  // MOTOR-REPRESENTASJON: strength senket fra 0.1 til 0.08, samme begrunnelse
  // og samme nivå som hjort/elg — ren fysisk le/eksponeringsfaktor.
  // STATUS: LOW evidens bekreftet en tredje gang, styrke ytterligere senket.
  windExposureSensitivity: { evidence: "LOW", strength: 0.08 },

  // BIOLOGISK GRUNNLAG: Bonnot et al. (2020), 431 GPS-rådyr i 12 europeiske
  // bestander — den til nå STØRSTE kilden i hele det økologiske laget.
  // Bekrefter en robust bimodal daggry/skumring-topp, men også at grad av
  // dagaktivitet reduseres med en faktor 1,37 der jakttrykk er høyt — samme
  // undertrykkingsmønster som er dokumentert for hjort/elg.
  // MOTOR-REPRESENTASJON: strength uendret (0.4) — samme forsiktighet og
  // samme strukturelle begrunnelse (jaktsesong-akse mangler, bevisst utsatt)
  // som hjort/elg.
  // STATUS: evidensgrad uendret MEDIUM (bevisst ikke hevet, se hjort/elg for
  // identisk resonnement).
  crepuscularActivity: { evidence: "MEDIUM", strength: 0.4 },

  // BIOLOGISK GRUNNLAG: V1.3 (§F) — separat fra crepuscularActivity over.
  // Bonnot et al. (2020, samme kilde som crepuscularActivity) dokumenterer at
  // graden av DAGaktivitet reduseres med en faktor 1,37 der jakttrykk er
  // høyt — samme retning (mer natt/skumring, mindre ren dagaktivitet under
  // press) og samme betingede (jakttrykk-avhengige) mekanisme som hos hjort.
  // Rådyrs grunnmønster er samtidig beskrevet som robust BIMODALT (daggry/
  // skumring), ikke sterkt nattaktivt i utgangspunktet.
  // MOTOR-REPRESENTASJON: strength=0.2 — litt lavere enn hjort (0.25), siden
  // rådyrs dokumenterte forskyvning er mot skumring/daggry (dekket av
  // crepuscularActivity) minst like mye som mot ren natt, og fordi den
  // observerte 1,37-faktoren er BETINGET av jakttrykk som modellen ikke har
  // en egen akse for.
  // STATUS: MEDIUM evidens (samme indirekte/betingede grunnlag som hjort).
  timeOfDayActivity: { evidence: "MEDIUM", strength: 0.2 },

  // BIOLOGISK GRUNNLAG: Pagon et al. (2017), telemetri på rådyrbukk, Italia:
  // aktivitetsnivået i brunstperioden (jul-aug) var LAVERE enn i territorie-
  // etableringsperioden (mar-apr), ikke høyere — stikk motsatt av hjort/elg.
  // Mekanismen er artsforskjellen: rådyrbukken er RESSURS-TERRITORIELL og
  // har allerede etablert og avgrenset territoriet sitt om våren; brunst
  // krever da ikke økt forflytning, i motsetning til hjortens/elgens
  // haremsamlende bevegelsesmønster.
  // MOTOR-REPRESENTASJON: movementBoost uendret (0) — ikke lenger et fravær
  // av kunnskap, men et POSITIVT resultat (ingen mobilitetsøkning, snarere
  // svak nedgang). months fylt inn (juli-august) som ren dokumentasjon —
  // med movementBoost=0 har dette ingen effekt på isRutActive (se
  // suitability.ts), kun informasjonsverdi.
  // STATUS: evidensgrad hevet LOW -> MEDIUM.
  rutBehavior: { evidence: "MEDIUM", movementBoost: 0, months: [7, 8] },

  // BIOLOGISK GRUNNLAG: V1.3 (§G) — som for hjort/elg: INGEN norsk,
  // artsspesifikk primærkilde funnet for nedbør og rådyratferd. Ren fysisk
  // plausibilitet, ikke en bekreftet effekt.
  // MOTOR-REPRESENTASJON: strength=0.15 — konservativ placeholder, samme
  // nivå og begrunnelse som hjort/elg (ingen kilde skiller artene fra
  // hverandre på dette punktet, så ulik styrke ville vært ren gjetning).
  // STATUS: LOW evidens.
  precipitationSensitivity: { evidence: "LOW", strength: 0.15 },
};
