import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Firebase sin klient-konfigurasjon er IKKE en hemmelighet (sikkerheten
// ligger i Firebase Auth + Firestore-reglene, ikke i å skjule disse
// verdiene) — men den skal likevel ikke være hardkodet i kildekoden, slik
// at ulike miljøer (lokal utvikling, ulike EAS-byggeprofiler, evt. et eget
// dev-Firebase-prosjekt senere) kan peke på ulike Firebase-prosjekter uten
// kodeendring. `EXPO_PUBLIC_`-prefikset gjør at Expo inline'r verdiene ved
// bygg, på web, iOS og Android — se .env.example og docs/DEPLOYMENT.md.
//
// Faller tilbake til det eksisterende viltiq-prosjektets verdier dersom
// ingen .env er satt opp, slik at ingenting endrer seg for noen som ikke
// selv har konfigurert miljøvariabler ennå.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyBaZ2g_EjZ3SlTbey8xibjxBaMkaMC-VuM",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "viltiq.firebaseapp.com",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "viltiq",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "viltiq.firebasestorage.app",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "441063877843",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "1:441063877843:web:183af8fda83fb8bb833826",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
