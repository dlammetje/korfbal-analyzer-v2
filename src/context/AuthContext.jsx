import { createContext, useContext, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendEmailVerification as sendEmailVerificationFirebase,
  sendPasswordResetEmail as sendPasswordResetEmailFirebase,
  updateEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import { auth } from "../lib/firebaseClient";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Functie om een nieuw account aan te maken
  const signup = async (email, password, displayName) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      
      // Update het profiel met de weergavenaam
      if (displayName) {
        await updateProfile(userCredential.user, { displayName });
      }
      
      // Stuur verificatie-e-mail
      await sendEmailVerificationFirebase(userCredential.user);
      
      return userCredential.user;
    } catch (error) {
      console.error("Fout bij aanmaken account:", error);
      throw error;
    }
  };

  // Functie om het e-mailadres van de huidige gebruiker te wijzigen
  const changeEmail = async (currentPassword, newEmail) => {
    try {
      if (!auth.currentUser) {
        throw new Error("Geen gebruiker ingelogd");
      }
      if (!currentPassword || !newEmail) {
        throw new Error("Vul zowel je huidige wachtwoord als een nieuw e-mailadres in.");
      }

      // Re-authenticate met huidig wachtwoord
      const credential = EmailAuthProvider.credential(
        auth.currentUser.email,
        currentPassword
      );
      await reauthenticateWithCredential(auth.currentUser, credential);

      // E-mailadres bij Firebase Auth updaten
      await updateEmail(auth.currentUser, newEmail);

      // Local state laten aansluiten; onAuthStateChanged pakt dit normaal ook op
      setCurrentUser({ ...auth.currentUser });
      return true;
    } catch (error) {
      console.error("E-mailadres wijzigen mislukt:", error);
      throw error;
    }
  };

  // Functie om in te loggen
  const login = async (email, password) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (error) {
      console.error("Inloggen mislukt:", error);
      throw error;
    }
  };

  // Functie om uit te loggen
  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Uitloggen mislukt:", error);
      throw error;
    }
  };

  // Functie om verificatie-e-mail te versturen
  const sendVerificationEmail = async () => {
    try {
      if (!auth.currentUser) {
        throw new Error("Geen gebruiker ingelogd");
      }
      await sendEmailVerificationFirebase(auth.currentUser);
    } catch (error) {
      console.error("Verzenden verificatie-e-mail mislukt:", error);
      throw error;
    }
  };

  // Functie om wachtwoordreset-e-mail te versturen
  const resetPassword = async (email) => {
    try {
      await sendPasswordResetEmailFirebase(auth, email);
    } catch (error) {
      console.error("Verzenden wachtwoordreset mislukt:", error);
      throw error;
    }
  };

  // Luister naar veranderingen in de authenticatiestatus
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });

    // Cleanup functie
    return () => unsubscribe();
  }, []);

  const value = {
    currentUser,
    signup,
    login,
    logout,
    sendVerificationEmail,
    resetPassword,
    changeEmail,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export default AuthContext;
