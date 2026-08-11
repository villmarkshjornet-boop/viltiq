import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth } from "../config/firebase";

export async function registrer(epost: string, passord: string) {
  const cred = await createUserWithEmailAndPassword(auth, epost, passord);
  return cred.user;
}

export async function loggInn(epost: string, passord: string) {
  const cred = await signInWithEmailAndPassword(auth, epost, passord);
  return cred.user;
}

export async function loggUt() {
  await signOut(auth);
}
