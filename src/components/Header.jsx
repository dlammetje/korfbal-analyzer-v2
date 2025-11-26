import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebaseClient";
import { doc, getDoc } from "firebase/firestore";

export default function Header() {
  const { currentUser, logout } = useAuth();
  const [showVerificationBanner, setShowVerificationBanner] = useState(false);
  const [clubWebsite, setClubWebsite] = useState("");

  useEffect(() => {
    if (currentUser && !currentUser.emailVerified) {
      setShowVerificationBanner(true);
    } else {
      setShowVerificationBanner(false);
    }
  }, [currentUser]);

  // Lees optioneel de clubwebsite uit het gebruikersprofiel
  useEffect(() => {
    let cancelled = false;
    async function loadClubWebsite() {
      if (!currentUser || !currentUser.uid) {
        setClubWebsite("");
        return;
      }
      try {
        const ref = doc(db, "users", currentUser.uid);
        const snap = await getDoc(ref);
        if (!cancelled && snap.exists()) {
          const data = snap.data() || {};
          setClubWebsite(data.clubWebsite || "");
        }
      } catch (e) {
        console.error("[Header] Fout bij laden clubWebsite:", e);
      }
    }

    loadClubWebsite();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  async function handleLogout() {
    try {
      await logout();
    } catch (error) {
      console.error("Uitloggen mislukt", error);
    }
  }

  return (
    <>
      {showVerificationBanner && (
        <div className="bg-yellow-600 text-white text-center py-1 px-4">
          <div className="container mx-auto flex justify-between items-center">
            <span>Gelieve je e-mailadres te verifiëren om alle functies te kunnen gebruiken.</span>
            <Link
              to="/verify-email"
              className="ml-4 text-white underline hover:text-gray-200"
            >
              Verstuur opnieuw
            </Link>
          </div>
        </div>
      )}
      <header className="bg-neutral-900 border-b border-neutral-800">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex-shrink-0 flex items-center">
              {clubWebsite ? (
                <a
                  href={clubWebsite}
                  target="_blank"
                  rel="noreferrer"
                  className="text-white font-bold text-xl hover:text-[#FF6124] transition-colors"
                >
                  Sparta (N)/Djops
                </a>
              ) : (
                <Link to="/" className="text-white font-bold text-xl">
                  Sparta (N)/Djops
                </Link>
              )}
            </div>
            <div className="flex items-center space-x-4">
              {currentUser ? (
                <div className="flex items-center space-x-4">
                  <span className="text-gray-300">
                    {currentUser.displayName || currentUser.email}
                  </span>
                  <button
                    onClick={handleLogout}
                    className="px-4 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                  >
                    Uitloggen
                  </button>
                </div>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="px-4 py-2 text-sm text-neutral-200 bg-neutral-800 rounded-xl hover:bg-neutral-700"
                  >
                    Inloggen
                  </Link>
                  <Link
                    to="/signup"
                    className="btn btn-primary text-sm px-4 py-2"
                  >
                    Registreren
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  );
}