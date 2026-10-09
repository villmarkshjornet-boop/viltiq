// Hjort — best utviklede økologiprofil (§15: første prioritet). Se
// docs/ENGINE_RESEARCH.md punkt 1 (snø/høyde), 3 (habitat — delt med rådyr
// sitt kulturlandskap-funn, men hjort er mer skogtilknyttet), 4 (brunst),
// 5 (vei). Tallene er kalibrert etter dokumentert RETNING, ikke presise
// forskningsverdier — se hver kildehenvisning for styrke.
//
// V1.1-REVISJON: oppdatert etter en egen research-runde mot primærlitteratur
// (Mysterud/Meisingset/Rivrud/Loe-programmet, Godvik 2009, Sigrist 2022,
// Meisingset 2013/2022 m.fl. — se agentrapporten i motor-oppdraget for full
// kildeliste). Kun EVIDENCE-feltet og STRENGTH-verdier er justert der en
// konkret, artsspesifikk, fortrinnsvis norsk kilde nå finnes — ingen ny
// biologi er "funnet på" (§14). Eksakte styrke-tall er fortsatt en
// ENGINE-kalibrering, ikke noe litteraturen selv oppgir.

import type { SpeciesEcologyProfile } from "./types";

export const HJORT_ECOLOGY_PROFILE: SpeciesEcologyProfile = {
  species: "hjort",

  // BIOLOGISK GRUNNLAG: forsker-dokumentert habitatpreferanse er sterkt
  // DØGNAVHENGIG hos hjort (skog/dekning om dagen, innmark/åpent om natten —
  // Godvik et al. 2009, 62 GPS-hjort i Norge; Hjermann et al. 2025). Dagens
  // modell har ingen tid-på-døgnet-akse i habitatSuitability (kun `default`/
  // `bySeason`), så tallene under representerer best en DAGTID-vurdering.
  // MOTOR-REPRESENTASJON: å innføre en egen døgnakse er en strukturell
  // utvidelse (ny dimensjon i SpeciesEcologyProfile) — bevisst UTSATT til en
  // senere versjon (V1.2) fremfor å hastes inn nå, se §1 i motor-oppdraget.
  // STATUS: verdiene under uendret, kun dokumentert som en kjent forenkling.
  habitatSuitability: {
    evidence: "MEDIUM",
    default: {
      skog: 0.8,
      myr: 0.4,
      jordbruk: 0.6,
      apent: 0.5,
      vann: 0.3,
      bebygd: 0.15,
      ukjent: 0.5,
    },
  },

  // BIOLOGISK GRUNNLAG: NINA/Rivrud et al. (2019, Proc R Soc B) og Rivrud et
  // al. (2010, J Anim Ecol) dokumenterer direkte at snø/lav relativ høyde er
  // sterkt fordelaktig for hjort om vinteren, med en METTENDE (ikke lineær)
  // respons — effekten flater ut når snøen først er borte.
  // MOTOR-REPRESENTASJON: strength=0.9 uendret (allerede godt fundert).
  // STATUS: HIGH evidens bekreftet av en ANDRE, uavhengig research-runde.
  winterSnowElevation: { evidence: "HIGH", strength: 0.9 },

  // BIOLOGISK GRUNNLAG: hjort er det BEST dokumenterte delvis-trekkende
  // hjorteviltet i Norge for nettopp denne mekanismen (Mysterud et al. 2011:
  // 38-100% trekkdyr i sju regioner; Mysterud et al. 2017: 221 moh
  // stasjonære vs. 403 moh trekkdyr sine sommerområder; Hjermann et al. 2025,
  // 16 år/297 individer: 5 dagers forsinket grønnskudd -> ~1,2 dagers
  // forsinket vårtrekk). docs/ENGINE_RESEARCH.md punkt 2 begrenset tidligere
  // denne mekanismen til KUN elg — det er ikke lenger dekkende.
  // MOTOR-REPRESENTASJON: hevet fra 0.2 til 0.5 — fortsatt lavere enn
  // vinterfaktorens 0.9, siden vårtrekket her er mer individuelt variabelt og
  // gradvis (april-juni) enn den skarpere vinterresponsen.
  // STATUS: evidensgrad hevet LOW -> HIGH. Selve styrketallet (0.5) er en
  // forsiktig ENGINE-kalibrering, ikke hentet fra litteraturen.
  springGreenupElevation: { evidence: "HIGH", strength: 0.5 },

  // BIOLOGISK GRUNNLAG: Meisingset et al. (2013), 67 GPS-hjort i Norge: unngår
  // vei KUN lokalt og KUN på dagtid, veistørrelse har liten betydning, hjort
  // krysser i snitt 2 ganger/dag (mest nattetid) og bruker skogsnære
  // krysningspunkter nær innmark aktivt til beite. Dette er en direkte,
  // norsk, artsspesifikk primærkilde — tidligere docs-punkt 5 bygde på en
  // sekundær oppsummering som antydet en bredere/sterkere unngåelseseffekt.
  // MOTOR-REPRESENTASJON: strength senket fra 0.5 til 0.3 — dagens modell har
  // ingen døgnavhengig akse (se habitatSuitability over), så en glatt,
  // svakere gradient er en tryggere tilnærming enn en sterk, tid-uavhengig
  // straff som ville overvurdert effekten på nattobservasjoner.
  // STATUS: evidensgrad hevet MEDIUM -> HIGH (primærkilde), styrke senket.
  roadSensitivity: { evidence: "HIGH", strength: 0.3 },

  // BIOLOGISK GRUNNLAG: Sigrist et al. (2022, Sveits) kvantifiserer en reell,
  // signifikant kantsone-/solinnstrålings-koeffisient for hjort — mer enn det
  // tidligere kun-forvaltningsbaserte grunnlaget (Skogkurs-hefte). Ingen
  // meter-skala-avstandsfunksjon finnes fortsatt.
  // MOTOR-REPRESENTASJON: strength uendret (0.3) — kun evidensgraden endret.
  // STATUS: evidensgrad hevet LOW -> MEDIUM.
  edgeAffinity: { evidence: "MEDIUM", strength: 0.3 },

  // BIOLOGISK GRUNNLAG: EN ANDRE, uavhengig research-runde fant FORTSATT
  // ingen støtte for vindretning som atferdsdrivende faktor hos hjortevilt
  // (nærmeste sammenlignbare test, Webb et al. 2010 på hjortedyr, er
  // praktisk talt et nullresultat). docs/ENGINE_RESEARCH.md punkt 7 satte
  // selv en eksplisitt betingelse for fjerning/nedvekting: "vurder å fjerne
  // den helt hvis fremtidig research fortsatt ikke finner støtte" — den
  // betingelsen er nå oppfylt to ganger.
  // MOTOR-REPRESENTASJON: strength senket fra 0.15 til 0.08 — beholdt som en
  // ren FYSISK terreng-eksponeringsfaktor (le/eksponert), IKKE fjernet helt,
  // siden selve den fysiske le-effekten (ikke en atferdspåstand) fortsatt er
  // en rimelig, om enn svært svak, antagelse.
  // STATUS: LOW evidens bekreftet (ikke oppgradert), styrke ytterligere senket.
  windExposureSensitivity: { evidence: "LOW", strength: 0.08 },

  // BIOLOGISK GRUNNLAG: Ensing et al. (2014) og flere nyere studier bekrefter
  // en artsspesifikk (ikke bare generell) skumrings-/demringstopp hos
  // hjortevilt, men karakteriserer den samtidig som SVAK og lyshetsstyrt,
  // ikke en fast indre klokke — og sterkt UNDERTRYKT av jakttrykk i
  // jaktsesongen (Peters 2025, Boer-Cueva 2026, Eggers 2026: hjort blir MER
  // nattaktiv og MINDRE skumringstopp-preget når jakt pågår).
  // MOTOR-REPRESENTASJON: strength uendret (0.4) — en jaktsesong-avhengig
  // modifikator ville krevd en ny inputdimensjon (om jakt pågår i området),
  // bevisst UTSATT (samme strukturelle begrunnelse som habitat over).
  // STATUS: evidensgrad uendret MEDIUM (bevisst IKKE hevet til HIGH — den
  // dokumenterte jaktsesong-avhengigheten gjør en enkel statisk bonus mindre
  // presis akkurat i hovedjaktperioden, som er nå IKKE styrket ytterligere).
  crepuscularActivity: { evidence: "MEDIUM", strength: 0.4 },

  // BIOLOGISK GRUNNLAG: V1.3 (§F) — separat fra crepuscularActivity over.
  // Ingen kilde kvantifiserer en ren dag/natt-AKTIVITETSNIVÅ-forskjell for
  // hjort uavhengig av jakttrykk. DERIMOT dokumenterer de SAMME kildene som
  // crepuscularActivity over (Peters 2025, Boer-Cueva 2026, Eggers 2026) at
  // hjort blir MER nattaktiv når jakt pågår — en retning, ikke et tall, og
  // eksplisitt BETINGET av jaktforstyrrelse (som motoren ikke har en egen
  // inputdimensjon for, se crepuscularActivity-kommentaren).
  // MOTOR-REPRESENTASJON: strength=0.25 — en forsiktig, artsspesifikk
  // ENGINE-kalibrering som anvender den dokumenterte RETNINGEN (mer natt-
  // aktivitet) året rundt, IKKE bare i jaktsesongen (samme forenkling som
  // resten av modellen mangler en jakttrykk-akse for). Lavere enn
  // crepuscularActivity sin styrke (0.4), siden dette er et svakere fundert,
  // avledet signal, ikke en direkte målt kurve.
  // STATUS: MEDIUM evidens (indirekte, avledet fra jakttrykk-spesifikke
  // kilder — IKKE en ren, ubetinget dag/natt-kilde).
  timeOfDayActivity: { evidence: "MEDIUM", strength: 0.25 },

  // BIOLOGISK GRUNNLAG: Langvatn et al. (2004, 10 073 obduserte hjort) og
  // Mysterud et al. (2008) er store, norske, fagfellevurderte primærkilder på
  // brunsttidspunkt (oktober-tyngdepunkt) og økt hannmobilitet — en klar
  // oppgradering fra tidligere sekundære forvaltningskilder. Samme
  // research-runde fant at JAKTSTART (1. september), ikke bare brunst, er en
  // like sterk driver av høsttrekk — en egen faktor, bevisst IKKE modellert
  // her (§14: ikke finn på mer enn kildene faktisk viser at motoren kan skille).
  // MOTOR-REPRESENTASJON: movementBoost/months uendret (0.6, [9,10]) — ingen
  // nytt tall å hente fra litteraturen, kun sterkere grunnlag for det som
  // allerede var modellert.
  // STATUS: evidensgrad hevet MEDIUM -> HIGH.
  rutBehavior: { evidence: "HIGH", movementBoost: 0.6, months: [9, 10] },

  // BIOLOGISK GRUNNLAG: V1.3 (§G) — INGEN norsk, artsspesifikk primærkilde
  // funnet for nedbør og hjorteatferd i denne research-runden (samme
  // konklusjon som vind, punkt 7 i docs). Kun en ren fysisk plausibilitet
  // (redusert bevegelse/beiting i kraftig nedbør er en rimelig, men
  // UBEKREFTET antagelse for norsk hjort spesifikt).
  // MOTOR-REPRESENTASJON: strength=0.15 — konservativ placeholder, IKKE
  // forskningsbelagt utover den generelle fysiske plausibiliteten. Samme
  // nivå som windExposureSensitivity, samme begrunnelse.
  // STATUS: LOW evidens — ingen kilde å oppgradere fra.
  precipitationSensitivity: { evidence: "LOW", strength: 0.15 },
};
