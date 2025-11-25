// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCcFt8qf5yJ9P2PsLIs6W5WbMRG_HFTUgY",
  authDomain: "korfbal-analyzer.firebaseapp.com",
  projectId: "korfbal-analyzer",
  storageBucket: "korfbal-analyzer.firebasestorage.app",
  messagingSenderId: "736309041103",
  appId: "1:736309041103:web:5fc00457cac87e1728a4ba",
  measurementId: "G-04RY2HRK2C"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const analytics = getAnalytics(app);

function getFirebase() {
  return { app, auth, db, storage, analytics };
}

export { app, auth, db, storage, analytics, getFirebase };