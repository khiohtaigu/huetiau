import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBn5e9HkBiAvu8MJEc2ANGGF6szgMuUjfc",
    authDomain: "huetiau.firebaseapp.com",
    projectId: "huetiau",
    storageBucket: "huetiau.firebasestorage.app",
    messagingSenderId: "75689546336",
    appId: "1:75689546336:web:930bdd5a17ef1f977c2905",
    measurementId: "G-JP9X9LSWXJ"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();