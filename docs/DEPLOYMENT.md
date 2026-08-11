# ViltIQ — utviklings-/testoppsett (web, iOS development build, TestFlight-forberedelse)

Dette dokumenterer det som ble satt opp for å kunne teste ViltIQ live i nettleser
og som en ordentlig development build på fysisk iPhone, uten Expo Go.
Android er bevisst ikke prioritert nå (se eget avsnitt).

Alt under "Dette må DU gjøre" krever din egen Expo-/Apple-konto og kan ikke
gjøres herfra — ingen slike innlogginger finnes i dette miljøet.

## 0. Kort status

| Del | Status |
|---|---|
| Web bygger (`expo export -p web`) | ✅ Fungerer nå (var **helt ødelagt** før — se avsnitt 5) |
| EAS-prosjekt koblet til (`extra.eas.projectId`) | ❌ Ikke gjort — krever `eas login` + `eas init` |
| iOS development build-profil (fysisk enhet) | ✅ Konfigurert (`eas.json` → `development-device`) |
| iOS-permissions (lokasjon) | ✅ Lagt til via `app.config.js` |
| Google Maps API-nøkkel (iOS) | ❌ Mangler — kartet vil være blankt/grått på ekte enhet uten denne |
| Push-varsler (APNs-nøkkel) | ❌ Ikke satt opp — krever Apple Developer-konto |
| Firebase | ✅ Uendret, ett prosjekt (`viltiq`), nå env-var-klar |
| Android | ⏸ Utsatt på din forespørsel — grunnleggende profiler finnes fra før |

## 1. Web — EAS Hosting

**Bruk lokalt for å teste før deploy:**
```bash
npx expo start --web
```

**Bygg statisk web-eksport (det EAS Hosting deployer):**
```bash
npx expo export -p web
```
Dette var **helt ødelagt** før denne økten — se avsnitt 5. Fungerer nå og
produserer alle 10 rutene i `dist/`, inkludert `/kart`.

**Deploy til en test-URL (du kjører dette selv — krever `eas login`):**
```bash
npx eas-cli login          # første gang
npx eas-cli init           # kobler prosjektet til EAS — skriver extra.eas.projectId
npx expo export -p web
npx eas-cli deploy
```
`eas deploy` (uten `--prod`) lager en **unik preview-URL** per deploy
(`https://<noe>--viltiq.expo.app` e.l.) — perfekt til "jeg vil ha en test-URL
under utvikling", uten å røre noe produksjonsmiljø. Legg til `--prod` kun når
du eksplisitt vil oppdatere en stabil produksjons-URL — ikke gjort her, og
ikke noe jeg har kjørt.

## 2. iOS Development Build (fysisk iPhone) — din prioritet

`expo-dev-client` er installert. `eas.json` har nå en egen profil for dette
(`development` var kun for Simulator fra før — laget en ny for ekte enhet i
stedet for å endre den eksisterende, i tilfelle noen bruker Simulator-profilen):

```json
"development-device": {
  "extends": "development",
  "ios": { "simulator": false }
}
```

**Bygg (du kjører dette selv):**
```bash
npx eas-cli build --platform ios --profile development-device
```

**Installer på telefonen:** Når bygget er ferdig (EAS bygger i skyen, tar
typisk 10–20 min), får du en lenke/QR-kode i terminalen. Åpne den på
iPhone-en (Safari), trykk "Install". Krever at enheten er registrert som
ad-hoc-enhet hos Apple (se steg 3 under).

**Start dev-serveren og koble til:**
```bash
npx expo start --dev-client
```
Åpne ViltIQ-appen (dev-client-varianten, ikke Expo Go) på telefonen og skann
QR-koden, eller trykk lenken som vises.

## 3. Dette må DU gjøre (Apple/Expo-konto)

Ingen av disse kan gjøres herfra — de krever innlogging jeg ikke har tilgang til.

1. **Expo-konto**: opprett på expo.dev om du ikke har en, kjør `eas login` lokalt.
2. **Apple Developer Program** ($99/år, kreves for både ad-hoc-installasjon på
   ekte enhet og TestFlight): meld deg inn på developer.apple.com om du ikke
   allerede er medlem.
3. **Koble EAS til Apple-kontoen**: `eas build --platform ios ...` spør deg
   interaktivt om Apple-innlogging første gang og håndterer
   certificates/provisioning automatisk (anbefalt — la EAS administrere dette).
4. **Registrer iPhone-en din for ad-hoc-distribusjon**:
   ```bash
   npx eas-cli device:create
   ```
   Dette gir deg en lenke å åpne *på iPhone-en*, som registrerer enhetens
   UDID hos Apple. Gjør dette FØR du kjører `development-device`-bygget,
   ellers kan ikke build'en installeres på enheten.
5. **`eas init`** (se avsnitt 1) — skriver `extra.eas.projectId` automatisk.

## 4. TestFlight (forberedelse — IKKE publisert, som avtalt)

Prosjektet er forberedt, men ingenting er sendt inn:
- `eas.json` sin `production`-profil bygger allerede riktig (`autoIncrement`,
  ikke simulator).
- `eas.json` sin `submit.production` har ingen `ios`-blokk ennå (tomme
  `appleId`/`ascAppId`/`appleTeamId`-felt gjorde `eas init` feile med
  "eas.json is not valid", og ble fjernet — se `git log`). Når du har en
  Apple Developer-konto, kjør `eas submit --platform ios` og la den spørre
  deg interaktivt (den skriver gyldige verdier inn i `eas.json` selv), i
  stedet for å legge inn tomme placeholder-felt på nytt.
- Når du er klar (ikke nå): `eas build --platform ios --profile production`,
  deretter `eas submit --platform ios`.
- App Store Connect-oppføring (skjermbilder, personvernerklæring-lenke,
  eksporterings-samsvar for kryptering) er IKKE satt opp — det er et eget
  steg når dere faktisk skal til TestFlight/App Store, ikke gjort her.

## 5. Web-kart: Kartverket/Geonorge via Leaflet

`app/kart.tsx` og `app/kamera/[id].tsx` importerte opprinnelig
`react-native-maps` direkte. Det biblioteket har **ingen web-implementasjon**
— `npx expo export -p web` **feilet fullstendig** (hele bygget krasjet) inntil
dette ble løst. Begge filene importerer fortsatt kartet via
`components/MapView` i stedet for `"react-native-maps"` direkte:
- `components/MapView.tsx` — tynn wrapper rundt det ekte biblioteket. Metro
  velger denne for iOS/Android. **Ingen endring i native oppførsel** (native
  bruker fortsatt Google-provideren som før).
- `components/MapView.web.tsx` / `components/LeafletMapImpl.tsx` — et ekte
  webkart basert på **Leaflet** og **Kartverket/Geonorge sine åpne WMTS/WMS-
  tjenester** (topografisk kart som bakgrunn, matrikkelkart som valgfritt
  eiendomsgrense-overlegg). Verifisert med en faktisk innlogget nettleser-
  økt (Playwright): alle karfliser lastes fra `cache.kartverket.no`, ingen
  konsollfeil.

**Hvorfor Leaflet** (fremfor MapLibre GL eller OpenLayers): Kartverket/
Geonorge sine tjenester er klassisk WMTS/WMS (ikke vektor-tiles), og
Leaflets `TileLayer`/`WMSTileLayer` støtter dette mønsteret direkte uten
noe limkode. `react-leaflet` sin deklarative JSX-modell
(`<Marker>`/`<Circle>`/`<Polygon>` som barn) matcher nesten 1:1 hvordan
`kart.tsx` allerede brukte react-native-maps, som holdt selve wrapperen
liten. Ingen API-nøkkel/konto kreves noe sted i stacken (i motsetning til
Mapbox GL), konsistent med å bruke åpne norske offentlige data hele veien.
Kartfliser/WMS-bilder lastes via vanlige `<img>`-elementer, ikke
`fetch()+canvas`, så CORS er ikke en blokkering for selve visningen.

**Viktig arkitekturdetalj (SSR)**: Leaflet berører `window` idet modulen
lastes, noe som krasjet Node under Expo Router sin statiske pre-rendering
(`ReferenceError: window is not defined` — verifisert direkte). Løst ved at
`MapView.web.tsx` ALDRI importerer `leaflet`/`react-leaflet` statisk — den
faktiske implementasjonen (`LeafletMapImpl.tsx`) lastes kun via en dynamisk
`import()` inni `useEffect`, som aldri kjører under SSR. Bekreftet i
byggeloggen: `LeafletMapImpl` havner i en egen, separat lastet chunk
(~350 kB), ikke i hovedbunten.

**Tjenester brukt** (verifisert direkte mot GetCapabilities, ikke gjettet):
- **Topo WMTS**: `cache.kartverket.no/v1/wmts/1.0.0/topo/...` — gratis, ingen
  tilgangsbegrensning per capabilities-dokumentet.
- **Matrikkelkart WMS** (eiendomsgrenser): `wms.geonorge.no/skwms1/wms.matrikkel`,
  layer `eiendomsgrense`. Viser KUN grensegeometri — et WMS GetMap-bilde
  inneholder aldri eier-/personopplysninger. `wms.matrikkel.v1` (med
  `.v1`-suffiks) er en ANNEN, autentisert/IP-sperret tjeneste — ikke bruk den.
- **Ortofoto/flyfoto**: **IKKE tilgjengelig som åpen tjeneste lenger.** Norge
  i bilder stengte sine åpne WMTS/WMS-tjenester for offentligheten i mars
  2026 — tilgang er nå forbeholdt Norge digitalt-parter. "Satellitt"-valget
  i kartvelgeren viser derfor OpenStreetMap Standard i stedet, med en synlig
  merknad i kartet om dette. Merk: `tile.openstreetmap.org` sin brukspolicy
  er ikke ment for tyngre produksjonstrafikk — vurder en dedikert leverandør
  (MapTiler, Stadia Maps e.l.) dersom "Satellitt" skal være pålitelig i
  skarp drift, ikke bare til utvikling/test.

## 6. Hva fungerer hvor

| Funksjon | Web | iOS/Android |
|---|---|---|
| Innlogging (Firebase Auth) | ✅ | ✅ |
| Firestore (observasjoner, jaktlag, felling, kvoter) | ✅ | ✅ |
| Kart, grunnlag (Kartverket topo / OSM Standard) | ✅ | ✅ (Google Maps-provider) |
| Kart, eiendomsgrenser (matrikkelkart WMS) | ✅ | ❌ ikke koblet på native i denne omgangen |
| Kart, kameraretning/sektor/varmesoner/prediksjonssoner | ✅ | ✅ |
| GPS/lokasjon (expo-location) | ⚠️ Fungerer via nettleserens Geolocation API, men mindre nøyaktig og krever HTTPS + brukersamtykke i nettleseren | ✅ |
| Push-varsler (expo-notifications) | ❌ Web push er en helt annen mekanisme enn Expo sin mobil-push; ikke satt opp | ✅ (krever APNs-nøkkel for iOS, se avsnitt 3) |
| Haptisk feedback (expo-haptics) | ⚠️ No-op (ingen feil, bare ingen vibrasjon) | ✅ |
| Cloud Functions (push-utsendelse) | N/A (server-side, plattform-uavhengig) | N/A |

**Ikke fjernet noe fra native for å få web til å fungere** — hele
Leaflet-implementasjonen ligger i `.web.tsx`-filer native-buildene aldri ser.

## 7. Firebase — dev/prod-strategi

**I dag: ett Firebase-prosjekt (`viltiq`)** brukes av alt — web, iOS, Android,
og av deg under utvikling. Jeg har **ikke** opprettet noe nytt Firebase-
prosjekt, og har **ikke** kjørt `firebase deploy` mot noe (verken rules,
indexes eller functions) i denne økten — kun lokale konfigurasjonsfiler er endret.

Firebase-konfigurasjonen leses nå fra `EXPO_PUBLIC_FIREBASE_*`-miljøvariabler
(se `.env.example`), med fallback til dagens hardkodede `viltiq`-verdier
dersom ingen `.env` finnes — **null risiko for at eksisterende oppsett slutter
å fungere**.

**Anbefalt struktur når du er klar for et ekte skille (ikke gjort nå):**
1. Opprett et nytt Firebase-prosjekt, f.eks. `viltiq-dev`, i Firebase Console.
2. Kopier `firestore.rules` og `firestore.indexes.json` dit
   (`firebase deploy --only firestore:rules,firestore:indexes --project viltiq-dev`).
3. Sett `viltiq-dev` sine nøkler i en lokal `.env` (aldri commitet).
4. Bruk EAS sine miljøvariabler (`eas env:create`) til å sette de RIKTIGE
   Firebase-nøklene per build-profil — `development`/`preview` → `viltiq-dev`,
   `production` → `viltiq` (det eksisterende prosjektet).
5. Da tester du alltid mot en isolert database under utvikling, uten å
   risikere ekte data i produksjonsprosjektet.

Dette er en anbefaling, ikke noe jeg har utført — det krever at du oppretter
det nye Firebase-prosjektet selv i konsollen.

## 8. Miljøvariabler du må sette opp selv

Se `.env.example` for full liste. Kort versjon:

- **Lokalt (valgfritt akkurat nå)**: kopier `.env.example` → `.env`, la
  Firebase-feltene stå tomme (fallback til eksisterende prosjekt brukes da),
  men fyll inn `GOOGLE_MAPS_API_KEY_IOS` — uten den er kartet blankt på en
  ekte enhet/development build (Expo Go har en delt nøkkel som skjuler dette
  problemet, en egen dev-client-build har det ikke).
- **For EAS Build (skybygg)**: lokale `.env`-filer leses IKKE automatisk av
  `eas build`. Sett variablene via:
  ```bash
  npx eas-cli env:create --scope project --environment development \
    --name GOOGLE_MAPS_API_KEY_IOS --value "DIN_NØKKEL" --visibility sensitive
  ```
  (gjenta for `preview`/`production`-miljøene når aktuelt).

**Hvor får du en Google Maps API-nøkkel?** console.cloud.google.com → nytt
(eller eksisterende) prosjekt → aktiver "Maps SDK for iOS" → lag en API-nøkkel
→ begrens den til iOS-appen din (`no.viltiq.app`). Dette er separat fra
Firebase-prosjektet.

## 9. Hva som fortsatt mangler før offentlig lansering

- EAS-prosjekt faktisk koblet til (`eas init`) — du må gjøre dette.
- Google Maps API-nøkkel (iOS, og senere Android) — du må skaffe denne.
- APNs-nøkkel for push-varsler på iOS — satt opp via `eas credentials`
  interaktivt (krever Apple Developer-konto).
- `google-services.json` fra Firebase Console dersom dere vil ha Android
  push via FCM (ikke prioritert nå, men appen forventer filen på
  `./google-services.json` — se `app.config.js` — hvis den ikke finnes
  hoppes den bare over, ingen feil).
- Faktisk atskilt dev/prod Firebase-prosjekt (se avsnitt 7) — anbefalt, ikke
  gjort.
- App Store Connect-oppføring, skjermbilder, personvernerklæring-lenke for
  TestFlight/App Store — ikke påbegynt.
- Ingen ende-til-ende-test er kjørt av meg på en ekte enhet eller i en ekte
  nettleser mot en levende URL — kun `tsc`, `expo lint`, `node --test`, og
  en vellykket `expo export -p web` er verifisert herfra. Du må selv bekrefte
  at development build faktisk fungerer på din iPhone.
