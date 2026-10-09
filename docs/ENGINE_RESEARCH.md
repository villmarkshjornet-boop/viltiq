# ViltIQ Engine — Kildegrunnlag for økologiske priors

Dette dokumentet er kildegrunnlaget for det økologiske laget i ViltIQ Engine
(`src/engine/ecology/`). Det følger malen fra oppdraget: for hver faktor
oppgis art, hva forskningen faktisk viser, kilde, geografisk relevans, styrke
på evidens, hvordan ViltIQ bruker den, og eventuelle begrensninger.

**Metode**: Funnene under kommer fra en avgrenset research-runde (nettsøk mot
NINA, Hjorteviltportalen, NJFF, NMBU-oppgaver, offentlige forvaltnings-
dokumenter, utført 2026-08-11) — IKKE et systematisk litteratursøk. Dette er
en første, forsvarlig modell, ikke en uttømmende kunnskapsoppsummering.
Der søket ikke ga treff, står det eksplisitt at ingen kilde ble funnet — det
brukes ALDRI som begrunnelse for å likevel innføre en sterk regel.

**Evidensstyrke, slik den brukes i kodekommentarer og `ecology/*.ts`:**
- **HIGH** — Direkte, artsspesifikk, norsk (fortrinnsvis NINA) kilde funnet i denne runden.
- **MEDIUM** — Konsistent på tvers av flere kilder, men enten regionalt begrenset, ikke primærforskning, eller en velkjent, bredt akseptert økologisk hovedregel for hjortedyr som ikke ble bekreftet med en spesifikk norsk kilde i denne runden.
- **LOW** — Generelt akseptert prinsipp uten funnet kildedekning i denne runden, ELLER kun indirekte/sekundær omtale.
- **INGEN STØTTE FUNNET** — Søkt eksplisitt etter, ingen relevant treff. Brukes IKKE som en regel, kun dokumentert som fravær.

---

## 1. Snø og vinterhøyde — Hjort

**Hva forskningen viser**: Hjort er dårlig tilpasset harde vintre sammenlignet
med elg og villrein. Store snømengder og lange vintre er en begrensende
faktor for hjortens utbredelse og overlevelse. Klima påvirker hjemmeområdets
størrelse direkte — hjort bruker mindre områder når snøen er dyp eller
temperaturen er lavere enn normalt om vinteren. Utbredelsen styres i stor
grad av klimatiske forhold; snøfattige kystnære områder er mer attraktive
enn snørike innlandsområder.

**Kilde**: [NINA — Hjortedyr](https://www.nina.no/hjortedyr)

**Geografisk relevans**: Norge (direkte).

**Styrke på evidens**: HIGH.

**Hvordan ViltIQ bruker den**: Vinterprofilen for hjort gir økt suitability
til celler med lavere relativ høyde OG lavere snødybde, og reduserer
suitability i høytliggende/snørike celler — men KUN i vintersesongen (se
interaksjonsprinsippet i seksjon "Interaksjoner" under).

**Begrensninger**: Sier noe om HABITATVALG/hjemmeområde-krymping, ikke en
presis terskelverdi for "moh". ViltIQ bruker derfor RELATIV høyde i
lokalt landskap, ikke en fast moh-grense (se §C i oppdraget — 500 moh kan
være dalbunn ett sted og høyfjell et annet).

---

## 2. Vårtrekk og høydegradient — Elg

**Hva forskningen viser**: Elg i deler av Nord-Trøndelag har et registrert
vårtrekk med start i gjennomsnitt 7. mai, men med tydelige regionale
forskjeller: tidligst i lavereliggende områder (Steinkjer, Inderøy,
Namdalseid, Namsos — snitt 29. april), senest i høyereliggende områder
(Røyrvik, Lierne). Trekket er koblet til snøsmelting og fremvekst av ny
vegetasjon ("green-up") — sen snøsmelting/sen vår tvinger elgku til å leve
for lenge på vinterens magre kvistfôr.

**Kilde**: Regional NINA/forvaltningsdata om elg i Nord-Trøndelag (funnet via
[forskning.no-relatert søk](https://www.forskning.no); primærkilde er en
regional overvåkingsrapport, ikke en landsdekkende studie).

**Geografisk relevans**: REGIONALT (Nord-Trøndelag). Kan IKKE uten videre
generaliseres til hele Norge — brukes derfor som et retningsprinsipp
(høyereliggende områder blir attraktive SENERE om våren enn lavereliggende),
ikke en fast dato.

**Styrke på evidens**: MEDIUM (konsistent prinsipp, men regionalt datagrunnlag).

**Hvordan ViltIQ bruker den**: I sesongen "vårtrekk" forskyves elgens
suitability-kurve gradvis oppover i relativ høyde etter hvert som sesongen
skrider frem, i stedet for at all høyde blir likestilt momentant 1. mai.

**Begrensninger**: Ingen data om at hjort/rådyr følger samme mønster i
samme grad — brukes derfor foreløpig BARE for elg.

---

## 3. Habitat i kulturlandskap — Rådyr

**Hva forskningen viser**: Rådyr trives best i kratt og ungskog, skogkanter
eller myrlendt terreng med busker/småskog, og lever ofte tett på mennesker i
kulturlandskap. Hogstflater og dyrket mark gir mer beite; infrastruktur gir
snøfrie ferdselsårer om vinteren. Bukker er sterkt territorielle fra vår til
sommer, men mer tolerante/samlet om vinteren når ressurstilgangen er dårligere.

**Kilde**: [NINA — "Rådyret i kulturlandskapet", sluttrapport](https://brage.nina.no/nina-xmlui/handle/11250/2595970)

**Geografisk relevans**: Norge (direkte).

**Styrke på evidens**: HIGH.

**Hvordan ViltIQ bruker den**: Rådyr-profilens habitat-suitability vekter
skogkant/ungskog/kulturlandskap/åkerkant høyt, åpent grasmark middels, tett
gammelskog og høyfjell lavt.

**Begrensninger**: Sier lite om ren sommerhabitatbruk i produktiv barskog
uten kantsoner — vektet nøytralt der data mangler, ikke negativt.

---

## 4. Brunst og fotoperiode — Hjort

**Hva forskningen viser**: Brunsten starter mot slutten av september.
Kortere dager (redusert fotoperiode) og lavere temperatur påvirker
hormonutviklingen (bl.a. testosteron), og hannhjort søker aktivt til
hunndyrenes områder og blir mer aggressive mot hverandre. I brunstens mest
intense fase bruker voksne hanner all tid og energi på å samle og forsvare
harem, med kraftig økt rastløshet og mobilitet i terrenget. Pga. sterkt
redusert fôrinntak og høy aktivitet kan hanner tape 20–30 % av
maksimalvekten i brunstperioden.

**Kilde**: [Hjortevilt.no — Hjort](https://hjortevilt.no/artsfakta/hjort),
[Hjortesenteret — Fakta om hjort](https://hjortesenteret.no/fakta-om-hjort/)

**Geografisk relevans**: Norge (direkte, men kildene er forvaltnings-
/formidlingskilder, ikke publiserte primærstudier).

**Styrke på evidens**: MEDIUM (samstemte kilder, men ikke primær NINA-forskning).

**Hvordan ViltIQ bruker den**: Hjort får en EGEN sesongprofil ("brunst",
ca. sen september–oktober) med høyere `movementWeight`/`corridorWeight` (økt
mobilitet er selve kjernefunnet) og en habitat-forskyvning mot områder med
kjent hunndyr-tetthet DERSOM data finnes — uten det, ingen retningsforskyvning,
kun økt vekt på fersk bevegelse.

**Begrensninger**: Kjønn er sjelden kjent i observasjonsdata. Motoren bruker
IKKE en påstått "hunndyr-tetthet" den ikke har grunnlag for — se §K i
oppdraget: "Hvis kjønn ikke er kjent, skal motoren ikke late som det er kjent."

---

## 5. Avstand til vei/bebyggelse — Hjort (generaliserbart forsiktig)

**Hva forskningen viser**: Hjort viser unngåelsesatferd mot mennesker, med
preferanse for åpne områder som øker med avstand fra vei og avtar med
avstand til skog. Kritisk terskelverdi for veitetthet og habitatstørrelse er
ART- OG LANDSKAPSAVHENGIG.

**Kilde**: Sammendrag fra søk mot NMBU-/Bioforsk-relatert materiale (se
[NMBU-masteroppgave om hjort på innmark](https://static02.nmbu.no/mina/studier/moppgaver/2012-Skjarli.pdf)
for beslektet habitatbruk-materiale); selve vei-avstand-funnet er hentet fra
et sekundært sammendrag, ikke direkte fra primærkilden.

**Geografisk relevans**: Norge, men eksplisitt landskapsavhengig i kilden selv.

**Styrke på evidens**: MEDIUM (retningen er trolig riktig — unngåelse — men
terskelverdien er ikke tallfestet i det jeg fant).

**Hvordan ViltIQ bruker den**: Veiavstand brukes som en GRADIENT (økende
suitability med økende avstand til vei, med avtagende marginaleffekt), IKKE
en hard eksklusjonssone — nøyaktig slik oppdraget krever i §P. Samme
gradient-form brukes foreløpig for rådyr og elg i mangel av artsspesifikke
tall, men med LAVERE vekt for rådyr (som selv ifølge kilde 3 lever tett på
mennesker) — se `roadSensitivity` per art i `ecology/*.ts`.

**Begrensninger**: Ingen kvantifisert terskel funnet. ViltIQ bruker en
konservativ, svak gradient — se `EngineConfig.ecology` for faktisk vekt.

---

## 6. Kantsoner (skogkant, vann-/myrkant)

**Hva forskningen viser**: Kantsoner i jordbrukslandskap og langs
vann/vassdrag er anerkjent som verdifulle for hjortevilt, i tillegg til skog
og myr. Norsk skogforvaltning legger vekt på å bevare kantsoner mot
myr/vann. Jeg fant IKKE en kilde som tallfester en konkret avstandseffekt
(f.eks. "suitability faller med X % per Y meter fra kant") for hjort, rådyr
eller elg spesifikt.

**Kilde**: [Skogkurs — Forvaltning av kantsoner mot myr, vann og vassdrag](https://skogkurs.no/wp-content/uploads/Digitalt-Forvaltning-av-kantsoner-temahefte_Skogkurs.pdf) (generell forvaltningsanbefaling, ikke artsspesifikk kvantifisering)

**Geografisk relevans**: Norge.

**Styrke på evidens**: LOW (prinsippet er anerkjent, men uten tallfestet effektstørrelse i det jeg fant).

**Hvordan ViltIQ bruker den**: En SVAK positiv bonus for celler nær en
habitat-overgang (f.eks. skog↔åpent), gitt lav vekt nettopp fordi evidensen
er svak — se `edgeAffinityWeight` (lav standardverdi, dokumentert som LOW).

**Begrensninger**: Kan justeres/fjernes uten videre når/hvis bedre kildedata finnes.

---

## 7. Vind og lukt — ALLE arter

**Hva forskningen viser**: Søket ga INGEN direkte forskningstreff på
sammenhengen mellom vindretning/-styrke og hjorteviltets bevegelses- eller
hvileplassvalg. Kun generelle forvaltningsdokumenter uten relevans for
temaet dukket opp.

**Kilde**: INGEN STØTTE FUNNET.

**Geografisk relevans**: N/A.

**Styrke på evidens**: LOW / ingen direkte kildedekning.

**Hvordan ViltIQ bruker den**: ViltIQ implementerer BEVISST IKKE en
atferdsregel av typen "dyret går mot vinden" (ren jaktfolklore uten
dokumentert grunnlag, eksplisitt frarådet i oppdraget §G). Det ENESTE
vind-signalet som brukes er en nøytral, rent fysisk/terrengbasert
eksponeringsvekt (le-side vs. værutsatt side, utledet fra helning/aspekt —
ikke fra en påstand om dyreatferd), gitt MINIMAL vekt nettopp fordi den
biologiske komponenten er udokumentert. Se `windExposureWeight` (lav
standardverdi).

**Begrensninger**: Dette er den svakest funderte faktoren i hele det
økologiske laget. Vurder å fjerne den helt hvis fremtidig research fortsatt
ikke finner støtte.

---

## 8. Lysforhold / skumringsaktivitet — ALLE arter

**Hva forskningen viser**: Søket fant KUN generell døgnrytme-forskning
(mennesker/mus), ikke en artsspesifikk norsk kilde på hjorteviltets
skumringsaktivitet. Skumringsaktivitet (crepuscular activity) hos
hjortedyr er imidlertid en svært bredt akseptert grunnregel i internasjonal
viltbiologi — men dette er IKKE bekreftet med en spesifikk kilde i denne
research-runden, og skal derfor behandles som lavere sikkerhet enn f.eks.
punkt 1 og 3 over, selv om prinsippet i seg selv er ukontroversielt.

**Kilde**: Ingen artsspesifikk kilde funnet i denne runden. Soloppgang/
solnedgang/skumringstider selv er beregnet astronomisk (deterministisk,
ikke en forskningskilde, se `environment/daylight.ts`).

**Geografisk relevans**: N/A (astronomisk beregning er alltid geografisk/
datokorrekt; den BIOLOGISKE påstanden om aktivitetsnivå er generell).

**Styrke på evidens**: MEDIUM (astronomisk beregning: ikke aktuelt/sikker;
den biologiske "mer aktiv i skumring"-regelen: LOW i denne kildegjennomgangen).

**Hvordan ViltIQ bruker den**: Gir en MODEST aktivitetsvekt-bonus i
skumringsvinduene (soloppgang/solnedgang ± ca. 1 time), IKKE en påstand om
posisjon — påvirker kun `temporalActivityWeight`, ikke hvor sonene plasseres.

**Begrensninger**: Vekten er bevisst holdt lav og skal ikke tolkes som
sterkt dokumentert artsspesifikk kunnskap.

---

## 9. Temperatur — artsforskjeller

**Hva forskningen viser**: For hjort er det dokumentert (se punkt 1) at
mildere klima/mindre kulde er gunstig — hjort er en art som "vinner" på et
varmere klima fordi snø/kulde er en begrensende faktor. For elg fant jeg en
indirekte kilde om at en tørkesommer (høy temperatur, lite nedbør)
forringet matfatet for elg i Sør-Norge — dette peker i retning av at elg
IKKE nødvendigvis foretrekker varme, men indirekte (via redusert
beitekvalitet), ikke via en direkte temperaturrespons-kurve. Jeg fant INGEN
direkte, kvantifisert temperaturresponskurve for noen av de tre artene.

**Kilde**: [NINA — Hjortedyr](https://www.nina.no/hjortedyr) (hjort);
[forskning.no — Tørkesommer ødela matfatet for elgen i Sør-Norge](https://www.forskning.no/jakt-og-fangst-naturressursforvaltning-nibio/torkesommer-odela-matfatet-for-elgen-i-sor-norge/1333432) (elg, indirekte).

**Geografisk relevans**: Norge.

**Styrke på evidens**: LOW–MEDIUM (retning for hjort er rimelig godt
underbygget via vinter/snø-koblingen; elg og rådyr er svakt underbygget og
delvis utledet, ikke direkte funnet).

**Hvordan ViltIQ bruker den**: Temperatur brukes IKKE som en global
"kaldt=bra/varmt=dårlig"-regel (eksplisitt forbudt i §E). Den eneste
direkte bruken er som DEL av vinterens snø/høyde-interaksjon for hjort
(punkt 1). En egen, isolert temperatur-suitability-kurve er IKKE
implementert for rådyr/elg i v1 — dokumentert her som en tydelig
kunnskapshull, ikke gjettet inn.

**Begrensninger**: Dette er svakere fundert enn de fleste andre faktorene.
Se seksjon "Ikke implementert" nedenfor.

---

## 10. Sesong — generell periodisering

**Hva forskningen viser**: Ingen egen kilde ble søkt spesifikt opp for
selve periodiseringen (den følger naturlig av punktene over: vinter — punkt 1,
vårtrekk — punkt 2, brunst — punkt 4). Årstidene i seg selv (kalendermåned)
er ikke en forskningspåstand, kun en praktisk inndeling.

**Styrke på evidens**: N/A (strukturell, ikke en forskningspåstand).

**Hvordan ViltIQ bruker den**: Sesonginndelingen er praktisk, ikke
"biologisk bevist": vinter (des–mar), vårtrekk (apr–mai), sommer (jun–aug),
brunst (sep–okt, kun hjort får egen atferdsprofil her), senhøst/tidlig
vinter-overgang (nov). Se `ecology/types.ts`.

---

## Ikke implementert i v1 (dokumentert, ikke gjettet)

Disse faktorene fra oppdraget er BEVISST IKKE implementert som egne
signaler i denne runden, fordi jeg ikke fant kildegrunnlag sterkt nok til å
gi dem en selvstendig vekt uten at det ville vært en gjetning presentert som
forskning:

- **Matressurs-proxyer** (§N) utover den grove habitatklassifiseringen fra
  AR5 (jordbruksareal/ungskog teller allerede positivt via habitat-
  suitability). En egen "beitekvalitet"-modell er ikke bygget.
- **Vann/myr som selvstendig positivt/negativt signal per art** (§O) — AR5
  klassifiserer vann/myr som habitattype, men ingen artsspesifikk
  vann-nærhet-effekt er lagt til utover det.
- **Detaljert terrengbrudd/dalbunn/rygg-klassifisering** (§Q) — kun
  relativ høyde og enkel helning (fra elevation-sampling) er brukt; en full
  terreng-klassifisering er IKKE bygget.

Disse kan legges til senere dersom fremtidig research gir bedre grunnlag —
se sluttrapportens seksjon N (Neste signaler).

---

## V1.1-tillegg (2026-08-17): artskalibrering mot primærlitteratur

Motor V1.1 (§11–§16 i motor-oppdraget) krevde en ny, dypere research-runde
per art — denne gangen prioritert mot fagfellevurdert primærlitteratur
(Mysterud/Meisingset/Rivrud/Loe-programmet for hjort, Bjørneraas/Rolandsen/
Eldegard for elg, NINA for rådyr) fremfor forvaltnings-/sekundærkilder.
Dette avsnittet oppsummerer HVA som endret seg i `ecology/hjort.ts` og
`ecology/elg.ts` og HVORFOR — se hver fils egen kildekommentar for full
sitatliste og BIOLOGISK GRUNNLAG / MOTOR-REPRESENTASJON / STATUS-oppdeling
per faktor (§14-malen). Ingen ny biologi er "funnet på" — kun EVIDENCE-felt
og enkelte STRENGTH-verdier er justert der en konkret ny kilde nå finnes.

### Hjort — de viktigste endringene

- **Vårtrekk/høyde** (`springGreenupElevation`): evidens hevet LOW → HIGH,
  strength hevet 0.2 → 0.5. Forrige runde begrenset denne mekanismen til
  elg alene; hjort er faktisk det BEST GPS-dokumenterte delvis-trekkende
  hjorteviltet i Norge (Mysterud et al. 2011: 38–100 % trekkdyr i sju
  regioner; Hjermann et al. 2025: kvantifisert grønnskudd→trekk-sammenheng
  over 16 år). Dette var runde 1s klareste feilvurdering av evidensgrad.
- **Vei** (`roadSensitivity`): evidens hevet MEDIUM → HIGH (nå en direkte
  norsk primærkilde, Meisingset et al. 2013, ikke en sekundær oppsummering),
  men strength SENKET 0.5 → 0.3 — kilden viser en klart svakere, kun
  dagtidsavhengig unngåelse enn tidligere antatt (hjort krysser vei ~2
  ganger/dag, mest nattetid).
- **Vind** (`windExposureSensitivity`): strength senket 0.15 → 0.08. En
  ANDRE, uavhengig research-runde fant fortsatt ingen støtte for
  vindretning som atferdsfaktor — punkt 7 sin egen betingelse for nedvekting
  ("hvis fremtidig research fortsatt ikke finner støtte") er nå oppfylt to
  ganger. Beholdt som ren fysisk le/eksponering-faktor, ikke fjernet.
- **Kantsone** (`edgeAffinity`): evidens hevet LOW → MEDIUM (Sigrist et al.
  2022 gir nå en reell kvantifisert koeffisient, om enn ikke en meterskala).
- **Brunst** (`rutBehavior`): evidens hevet MEDIUM → HIGH (Langvatn et al.
  2004, 10 073 obduserte dyr; Mysterud et al. 2008) — samme tall (0.6,
  sep–okt) som før, nå på et vesentlig sterkere kildegrunnlag.
- **Ny, dokumentert (ikke implementert) begrensning**: habitatpreferansen er
  reelt DØGNAVHENGIG hos hjort (skog om dagen, innmark/åpent om natten —
  Godvik et al. 2009, 62 GPS-hjort i Norge). Dagens `habitatSuitability` har
  ingen døgn-akse og representerer derfor best en dagtidsvurdering — en
  strukturell utvidelse, bevisst utsatt til V1.2.

### Elg — de viktigste endringene

- **Vinter/snø** (`winterSnowElevation`): evidens hevet LOW → MEDIUM,
  strength hevet 0.25 → 0.5. Forrige runmes begrunnelse ("elg tåler kulde
  bedre enn hjort") forvekslet kuldetoleranse med SNØtoleranse — snødybde er
  selve driveren bak elgens sesongtrekk (Rolandsen et al. 2011: dobling i
  elg-påkjørsler mellom lav-/høysnø-år, kun i snørike fylker).
- **Vei** (`roadSensitivity`): evidens hevet LOW → HIGH — Eldegard et al.
  (2012) er en direkte norsk, elg-spesifikk kilde (forrige runde fant ingen
  slik kilde i det hele tatt). Strength uendret (0.4).
- **Habitat**: evidens hevet LOW → MEDIUM (Bjørneraas et al. 2011, norsk
  GPS-studie) — samme døgnavhengighets-begrensning som hjort, samme
  strukturelle utsettelse til V1.2.
- **Vind**: strength senket 0.15 → 0.08, samme begrunnelse/kilder som hjort.
- **Brunst** (`rutBehavior`): movementBoost hevet 0 → 0.3 (evidens LOW →
  MEDIUM). Neumann et al. (2018), 172 GPS-elg i Sverige, dokumenterer økt
  HANNmobilitet i brunstperioden — bevisst satt lavere enn hjortens 0.6
  siden funnet er hannspesifikt og kjønn normalt ikke er kjent per
  observasjon.

### Rådyr — de viktigste endringene

- **Vinter/snø** (`winterSnowElevation`): evidens hevet LOW → HIGH, strength
  hevet 0.3 → 0.6 — den enkeltstående viktigste korrigeringen i hele V1.1-
  revisjonen. Tidligere kommentar hevdet "ingen direkte rådyr-kilde funnet"
  — det var faktisk feil: Mysterud, Bjørnsen & Østbye (1997), Telemark, er
  en norsk, artsspesifikk, fagfellevurdert primærkilde (samme forfatter som
  hjort-grunnlaget) som tallfester en kritisk snødybde på ~50 cm og
  dokumenterer nedtrekk i høyde + økt gammelskogsbruk med økende snø.
- **Vårtrekk/høyde** (`springGreenupElevation`): UENDRET (LOW/0.2) —
  bevisst IKKE hevet "for konsistens" med hjort. Mysterud et al. (2012),
  direkte sympatrisk sammenligning i Norge: kun 27 % av rådyr trekker mot
  94 % av hjort i samme landskap, og grønnskudd-jaging ("forage maturation")
  ble kun støttet for hjort. Dette er nå et BEKREFTET fravær av effekt for
  rådyr, ikke lenger bare et ufunnet spørsmål.
- **Vei** (`roadSensitivity`): evidens hevet MEDIUM → HIGH — Torres et al.
  (2011, SØ-Norge) sammenligner rådyr og elg direkte i samme landskap:
  bebyggelse innen 1000 m påvirker elg negativt, men ikke rådyr. Strength
  uendret (0.15, lavest av de tre artene) — nå positivt dokumentert.
- **Kantsone** (`edgeAffinity`): evidens hevet LOW → MEDIUM (tre norske
  kilder: Mysterud et al. 1997, Torres et al. 2011, Kjøstvedt et al. 1998).
  Strength uendret (0.35, høyest av de tre artene).
- **Vind**: strength senket 0.1 → 0.08, samme begrunnelse som hjort/elg —
  en TREDJE uavhengig research-runde fant fortsatt ingen støtte for
  vindretning.
- **Brunst** (`rutBehavior`): evidens hevet LOW → MEDIUM, months dokumentert
  ([7,8]). Pagon et al. (2017) fant at rådyrbukkens aktivitet i brunst-
  perioden (jul–aug) er LAVERE enn i territorieetableringen (mar–apr) —
  stikk motsatt fortegn av hjort/elg, fordi rådyrbukken er ressurs-
  territoriell (territoriet er allerede etablert) fremfor haremsamlende.
  movementBoost forblir bevisst 0.
- **Habitat**: evidens uendret HIGH, men samme døgn-mismatch som hjort/elg
  er nå dokumentert — Bonnot et al. (2013, 94 rådyr, Frankrike): >80 %
  sannsynlighet for at en skog-posisjon er registrert PÅ DAGTID; jordbruks-
  arealet (`jordbruk: 0.85`) representerer i praksis et NATT-mønster.

**Ikke endret i `ecology/radyr.ts`, men dokumentert som et sterkt
kildebelagt funn** i `species/profiles.ts` sin kommentar: rådyrs
`timeHalfLifeHours` (4 timer) er i dag KORTEST av de tre artene, begrunnet
med at et lite hjemmeområde gjør en observasjon raskere "utdatert". Bjar et
al. (1991, SØ-Norge) fant at 58 % av rådyr holdt seg året rundt innenfor
2 km fra vinterområdet, med sterk flerårig territorietrofasthet — et
STEDBUNDET dyr taler for at en observasjon forblir gyldig LENGER, ikke
kortere. Dette er en kjerneparameter i observasjons-decayen (ikke det
økologiske prior-laget), og bevisst IKKE endret i denne runden — en
egen, målrettet kalibreringsrunde med egen testdekning anbefales.

### Uendret / bevisst IKKE endret

- **Tid på døgnet** (`crepuscularActivity`, alle tre arter): evidensgrad
  UENDRET til tross for at nyere, mer artsspesifikke kilder ble funnet
  (Ensing 2014, Bjørneraas 2011) — fordi samme kilder samtidig dokumenterer
  at effekten er svak, lyshetsstyrt og sterkt undertrykt av jakttrykk i
  nettopp jaktsesongen. En jaktsesong-avhengig modifikator er en strukturell
  utvidelse, bevisst utsatt til V1.2 fremfor å styrke en statisk bonus som
  forskningen selv sier blir MINDRE presis når den trengs mest.
- **Sesonggrense/vintersnø-metning, elevasjonsgulv (300 m)**: uendret —
  kvantifiseringsagentens tester (`ecology/quantification.test.ts`)
  bekrefter at den eksisterende metnings-/gulv-oppførselen allerede er
  forsiktig kalibrert, se der for tallene.
