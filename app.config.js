// Utvider app.json (som forblir statisk og urørt — se den filen for
// grunnkonfigurasjonen) med felt som må settes dynamisk fra miljøvariabler:
// Google Maps API-nøkler (native react-native-maps krever dette utenfor
// Expo Go), og permission-plugins for expo-location/expo-notifications med
// norske beskrivelsestekster (mangler i dag, se docs/DEPLOYMENT.md).
//
// Alt her er tilleggsverdier — ingenting i app.json sin eksisterende
// konfigurasjon overskrives eller endres.
//
// NB — app.json sin `newArchEnabled` ble satt til `false` (V1.3,
// feltrapport fysisk iOS-enhet): ALLE react-native-maps <Marker>
// med egendefinert JSX-innhold (kamera, hotspot-ringer, observasjoner,
// jaktlags-posisjoner, anbefalt jaktpost) var usynlige på enheten, mens
// enklere lag uten egendefinert innhold (Heatmap, Circle, Polygon) fungerte
// normalt — et kjent, dokumentert samspillsproblem mellom
// react-native-maps sin "render JSX-barn som markørikon"-bro og React
// Native sin New Architecture (Fabric). Fire uavhengige forsøk på å endre
// SELVE markør-INNHOLDET (snapshot-timing, eksplisitt størrelse,
// collapsable, identisk struktur som andre markører) endret ingenting,
// nettopp fordi årsaken aldri lå i innholdet — den lå i selve
// arkitektur-broen. Skru IKKE denne tilbake til `true` uten at
// react-native-maps sin Fabric-støtte for egendefinerte markør-barn faktisk
// er bekreftet fungerende på en ekte enhet først.
const fs = require("fs");
const path = require("path");

/** @param {{ config: import('expo/config').ExpoConfig }} args */
module.exports = ({ config }) => {
  const googleServicesFile = path.join(__dirname, "google-services.json");
  const harGoogleServicesFile = fs.existsSync(googleServicesFile);

  const androidMapsApiKey = process.env.GOOGLE_MAPS_API_KEY_ANDROID;
  const iosMapsApiKey = process.env.GOOGLE_MAPS_API_KEY_IOS;

  return {
    ...config,
    extra: {
      ...config.extra,
      // eas init / eas build:configure fyller inn extra.eas.projectId
      // automatisk her ved første kjøring — sett IKKE denne manuelt.
    },
    plugins: [
      ...(config.plugins ?? []),
      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "ViltIQ bruker posisjonen din til å vise observasjoner i nærheten og registrere hvor du ser dyr og spor.",
        },
      ],
      [
        "expo-notifications",
        {
          color: "#2CC36B",
        },
      ],
      // react-native-maps 1.23+ krever sin EGEN config-plugin for å koble
      // inn Google Maps på iOS (skriver `pod 'react-native-maps/Google'` inn
      // i Podfile + GMSApiKey i Info.plist + AppDelegate-oppsett). Det gamle
      // Expo-innebygde feltet `ios.config.googleMapsApiKey` (fjernet under)
      // brukte fortsatt den utdaterte podspec-antakelsen `react-native-google-maps`,
      // som IKKE lenger finnes i biblioteket — ga "No podspec found"-krasj i
      // pod install. Se samtalens research (react-native-maps#5710).
      [
        "react-native-maps",
        iosMapsApiKey ? { iosGoogleMapsApiKey: iosMapsApiKey } : {},
      ],
    ],
    android: {
      ...config.android,
      ...(harGoogleServicesFile ? { googleServicesFile: "./google-services.json" } : {}),
      config: {
        ...config.android?.config,
        ...(androidMapsApiKey
          ? { googleMaps: { apiKey: androidMapsApiKey } }
          : {}),
      },
    },
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        NSLocationWhenInUseUsageDescription:
          "ViltIQ bruker posisjonen din til å vise observasjoner i nærheten og registrere hvor du ser dyr og spor.",
      },
    },
  };
};
