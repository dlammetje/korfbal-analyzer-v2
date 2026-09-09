import React, { useState, useEffect } from "react";
import { Link, NavLink } from "react-router-dom";
import { Menu, Settings, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebaseClient";
import { doc, getDoc } from "firebase/firestore";

const navLinks = [
  { to: "/", label: "Dashboard" },
  { to: "/matches", label: "Wedstrijden" },
  { to: "/statistics", label: "Statistieken" },
  { to: "/teams", label: "Teams & Spelers" },
];

export default function Header() {
  const { currentUser, logout } = useAuth();
  const [showVerificationBanner, setShowVerificationBanner] = useState(false);
  const [clubWebsite, setClubWebsite] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

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
      <header className="sticky top-0 z-40 bg-neutral-950/95 border-b border-neutral-800 backdrop-blur">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between min-h-16 items-center gap-3">
            <div className="flex min-w-0 flex-shrink-0 items-center">
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
            {currentUser && (
              <nav className="hidden lg:flex items-center gap-2">
                {navLinks.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.to === "/"}
                    className={({ isActive }) =>
                      `px-3 py-2 rounded-xl text-sm font-medium transition ${
                        isActive
                          ? "bg-[#FF6124] text-white"
                          : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
                      }`
                    }
                  >
                    {link.label}
                  </NavLink>
                ))}
              </nav>
            )}
            <div className="flex items-center gap-2 sm:gap-4">
              {currentUser ? (
                <div className="flex items-center gap-2 sm:gap-4">
                  <span className="hidden sm:inline max-w-48 truncate text-gray-300">
                    {currentUser.displayName || currentUser.email}
                  </span>
                  <NavLink
                    to="/settings"
                    className={({ isActive }) =>
                      `inline-flex items-center justify-center w-10 h-10 rounded-xl text-sm font-medium transition ${
                        isActive
                          ? "bg-[#FF6124] text-white"
                          : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
                      }`
                    }
                    aria-label="Instellingen"
                    title="Instellingen"
                  >
                    <Settings size={20} />
                  </NavLink>
                  <button
                    onClick={handleLogout}
                    className="px-4 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                  >
                    Uitloggen
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuOpen((value) => !value)}
                    className="inline-flex lg:hidden items-center justify-center w-10 h-10 rounded-xl border border-neutral-700 text-neutral-200 hover:border-[#FF6124] hover:text-white"
                    aria-expanded={menuOpen}
                    aria-label="Menu openen"
                  >
                    {menuOpen ? <X size={20} /> : <Menu size={20} />}
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
          {currentUser && menuOpen && (
            <nav className="lg:hidden pb-4 pt-1">
              <div className="grid gap-2 rounded-2xl border border-neutral-800 bg-neutral-900 p-2 shadow-2xl">
                {navLinks.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.to === "/"}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `px-4 py-3 rounded-xl text-base font-medium transition ${
                        isActive
                          ? "bg-[#FF6124] text-white"
                          : "text-neutral-200 hover:bg-neutral-800 hover:text-white"
                      }`
                    }
                  >
                    {link.label}
                  </NavLink>
                ))}
              </div>
            </nav>
          )}
        </div>
      </header>
    </>
  );
}