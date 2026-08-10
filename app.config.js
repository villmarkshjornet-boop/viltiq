// Utvider app.json (som forblir statisk og urørt — se den filen for
// grunnkonfigurasjonen) med felt som må settes dynamisk fra miljøvariabler:
// Google Maps API-nøkler (native react-native-maps krever dette utenfor
// Expo Go), og permission-plugins for expo-location/expo-notifications med
// norske beskrivelsestekster (mangler i dag, se docs/DEPLOYMENT.md).
//
// Alt her er tilleggsverdier — ingenting i app.json sin eksisterende
// konfigurasjon overskrives eller endres.
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
      config: {
        ...config.ios?.config,
        ...(iosMapsApiKey ? { googleMapsApiKey: iosMapsApiKey } : {}),
      },
      infoPlist: {
        ...config.ios?.infoPlist,
        NSLocationWhenInUseUsageDescription:
          "ViltIQ bruker posisjonen din til å vise observasjoner i nærheten og registrere hvor du ser dyr og spor.",
      },
    },
  };
};
