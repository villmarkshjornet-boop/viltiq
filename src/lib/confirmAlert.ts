import { Alert, Platform } from "react-native";

type AlertKnapp = {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
};

/**
 * STEG 5 §3: react-native-web sin Alert.alert er en fullstendig no-op (se
 * node_modules/react-native-web/dist/exports/Alert/index.js — funksjonen
 * gjør bokstavelig talt ingenting). Det gjorde ALLE bekreftelses- og
 * feilmeldingsdialoger usynlige og virkningsløse på web, inkludert selve
 * "Slett"-bekreftelsen for observasjoner/fellinger — oppdaget først da §3
 * krevde en EKTE, kjørt ende-til-ende-verifisering av sletting i stedet for
 * kodeinspeksjon (kodeinspeksjon alene ville sett en helt normal
 * Alert.alert-kall og godkjent den).
 *
 * visAlert() er en tynn, plattformbevisst erstatning: på native er
 * oppførselen UENDRET (delegerer rett til Alert.alert). På web brukes
 * window.confirm (for bekreft/avbryt-valg) eller window.alert (for rene
 * infomeldinger med kun én knapp), slik at de samme knappene faktisk gjør
 * noe. Ingen ny UI, ingen nytt designspråk — kun at handlingen som allerede
 * var kodet faktisk skjer.
 */
export function visAlert(tittel: string, melding = "", knapper?: AlertKnapp[]): void {
  if (Platform.OS !== "web") {
    Alert.alert(tittel, melding, knapper as Parameters<typeof Alert.alert>[2]);
    return;
  }

  const tekst = melding ? `${tittel}\n\n${melding}` : tittel;

  if (!knapper || knapper.length <= 1) {
    window.alert(tekst);
    knapper?.[0]?.onPress?.();
    return;
  }

  const bekreftet = window.confirm(tekst);
  const valgt = bekreftet
    ? knapper.find((k) => k.style !== "cancel") ?? knapper[knapper.length - 1]
    : knapper.find((k) => k.style === "cancel");
  valgt?.onPress?.();
}
