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
