import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebaseClient";
import { doc, getDoc } from "firebase/firestore";

export default function LiveEntry() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { ready, matches, teams } = useAppData() || {};

  const [preferredTeamId, setPreferredTeamId] = useState("");
  const [userClubId, setUserClubId] = useState("");

  // Laad voorkeurs-team en clubId van de gebruiker, net als in Matches.jsx
  useEffect(() => {
    if (!currentUser) {
      setPreferredTeamId("");
      setUserClubId("");
      return;
    }

    let cancelled = false;

    async function loadPreferredTeamAndClub() {
      try {
        const ref = doc(db, "users", currentUser.uid);
        const snap = await getDoc(ref);
        if (!cancelled && snap.exists()) {
          const data = snap.data() || {};
          if (data.preferredTeamId) {
            setPreferredTeamId(data.preferredTeamId);
          } else {
            setPreferredTeamId("");
          }

          if (data.clubId) {
            setUserClubId(data.clubId);
          } else {
            setUserClubId("");
          }
        }
      } catch (e) {
        console.error("[LiveEntry] Fout bij laden voorkeurs-team:", e);
        setPreferredTeamId("");
        setUserClubId("");
      }
    }

    loadPreferredTeamAndClub();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const visibleMatches = useMemo(() => {
    if (!Array.isArray(matches)) return [];

    const matchesForClub = userClubId
      ? matches.filter((m) => !m.clubId || m.clubId === userClubId)
      : matches;

    if (!preferredTeamId) return matchesForClub;
    return matchesForClub.filter(
      (m) => m.homeTeamId === preferredTeamId || m.awayTeamId === preferredTeamId
    );
  }, [matches, preferredTeamId, userClubId]);

  const sortedMatches = useMemo(() => {
    if (!visibleMatches.length) return [];
    return [...visibleMatches].sort((a, b) => {
      const da = a.date || "";
      const db = b.date || "";
      return db.localeCompare(da);
    });
  }, [visibleMatches]);

  if (!ready) {
    return <div className="p-6 text-neutral-400">Laden…</div>;
  }

  if (!sortedMatches.length) {
    return (
      <div className="p-6 text-neutral-400">
        <h2 className="text-xl font-semibold mb-2">Live</h2>
        <p>Er zijn nog geen wedstrijden aangemaakt. Maak eerst een wedstrijd aan onder "Wedstrijden".</p>
      </div>
    );
  }

  const formatTeamName = (id) => {
    const t = teams?.find((x) => x.id === id);
    if (t?.name) return t.name;
    if (typeof id === "string" && id.trim()) return id;
    return "Onbekend team";
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-2xl font-semibold">Live</h2>
          <p className="text-neutral-400 text-sm">Kies een wedstrijd om live te taggen.</p>
        </div>
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl divide-y divide-neutral-800 overflow-hidden">
        {sortedMatches.map((m) => (
          <button
            key={m.id}
            onClick={() => navigate(`/live/${m.id}`)}
            className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-neutral-800 text-sm"
          >
            <div>
              <div className="font-medium text-neutral-100">
                {formatTeamName(m.homeTeamId)} vs {formatTeamName(m.awayTeamId)}
              </div>
              <div className="text-xs text-neutral-400">
                {m.date || "onbekende datum"} · {m.location || "onbekende locatie"}
              </div>
            </div>
            <div className="text-xs text-[#FF6124] font-medium">Live taggen →</div>
          </button>
        ))}
      </div>
    </div>
  );
}
