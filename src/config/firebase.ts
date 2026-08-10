import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBaZ2g_EjZ3SlTbey8xibjxBaMkaMC-VuM",
  authDomain: "viltiq.firebaseapp.com",
  projectId: "viltiq",
  storageBucket: "viltiq.firebasestorage.app",
  messagingSenderId: "441063877843",
  appId: "1:441063877843:web:183af8fda83fb8bb833826",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);