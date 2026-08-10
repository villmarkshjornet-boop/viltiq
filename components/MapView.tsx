// Native (iOS/Android) — ren videreeksport av det ekte react-native-maps.
// Metro velger denne filen automatisk for native-plattformer og faller
// tilbake til MapView.web.tsx på web (platform-spesifikk filnavn-oppløsning).
// Ingen endring i oppførsel for native — se MapView.web.tsx for hvorfor
// denne indirect'en finnes i det hele tatt (react-native-maps kan ikke
// bunt'es for web i det hele tatt, se kommentar der).
export { default, Circle, Marker, Polygon, PROVIDER_GOOGLE } from "react-native-maps";
export type { LongPressEvent } from "react-native-maps";
