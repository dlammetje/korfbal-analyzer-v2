import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebaseClient";
import { doc, getDoc } from "firebase/firestore";
import { Trophy, Users, Activity, PlaySquare, BarChart2 } from "lucide-react";
import FieldHeatmap from "../components/FieldHeatmap";

const ZONES = [
  "Linksvoor","Voor (midden)","Rechtsvoor",
  "Linkerzij","Korfzone","Rechterzij",
  "Linksachter","Achter (midden)","Rechtsachter"
];

function formatTeamName(teamId, teams) {
  if (!teamId) return "Onbekend team";
  if (!Array.isArray(teams)) {
    if (typeof teamId === "string" && teamId.trim()) {
      if (/^[A-Za-z0-9]{16,}$/.test(teamId)) return "Onbekend team";
      return teamId;
    }
    return "Onbekend team";
  }
  const team = teams.find((t) => t.id === teamId);
  if (team?.name) return team.name;
  if (typeof teamId === "string" && teamId.trim()) {
    if (/^[A-Za-z0-9]{16,}$/.test(teamId)) return "Onbekend team";
    return teamId;
  }
  return "Onbekend team";
}

export default function Dashboard() {
  const { teams, matches, clips } = useAppData();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // Voorkeurs-team (voor gefilterde view). Als leeg: club-brede cijfers.
  const [preferredTeamId, setPreferredTeamId] = useState("");
  const [userClubId, setUserClubId] = useState("");

  useEffect(() => {
    if (!currentUser) {
      setPreferredTeamId("");
      setUserClubId("");
      return;
    }

    let cancelled = false;

    async function loadUserProfile() {
      try {
        const ref = doc(db, "users", currentUser.uid);
        const snap = await getDoc(ref);
        if (!cancelled && snap.exists()) {
          const data = snap.data() || {};
          setPreferredTeamId(data.preferredTeamId || "");
          setUserClubId(data.clubId || "");
        }
      } catch (e) {
        console.error("[Dashboard] Fout bij laden gebruikersprofiel:", e);
        if (!cancelled) {
          setPreferredTeamId("");
          setUserClubId("");
        }
      }
    }

    loadUserProfile();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // Basis-filter: beperk matches/clips tot clubId (indien bekend)
  const matchesForClub = useMemo(() => {
    if (!userClubId) return matches;
    return matches.filter((m) => !m.clubId || m.clubId === userClubId);
  }, [matches, userClubId]);

  const clipsForClub = useMemo(() => {
    if (!userClubId) return clips;
    return clips.filter((c) => !c.clubId || c.clubId === userClubId);
  }, [clips, userClubId]);

  // Clips zonder sequenties, optioneel gefilterd op voorkeurs-team
  const baseClips = useMemo(() => {
    const nonSeq = clipsForClub.filter((c) => !c.sequenceId);

    if (!preferredTeamId) return nonSeq;

    const matchIds = matches
      .filter((m) => m.homeTeamId === preferredTeamId || m.awayTeamId === preferredTeamId)
      .map((m) => m.id);

    const idSet = new Set(matchIds);
    return nonSeq.filter((c) => idSet.has(c.matchId));
  }, [clipsForClub, matchesForClub, preferredTeamId]);

  // --- KPI’S ---
  const totalTeams = teams.length;

  const matchesForView = useMemo(() => {
    if (!preferredTeamId) return matchesForClub;
    return matchesForClub.filter(
      (m) => m.homeTeamId === preferredTeamId || m.awayTeamId === preferredTeamId
    );
  }, [matchesForClub, preferredTeamId]);

  const totalMatches = matchesForView.length;
  const totalClips = baseClips.length;

  // Goals for/against
  const goalStats = useMemo(() => {
    let gf = 0,
      ga = 0;

    const ourIds = new Set(
      preferredTeamId ? [preferredTeamId] : teams.map((t) => t.id)
    );

    matchesForClub.forEach((m) => {
      const homeScore = Number(m.homeScore || 0);
      const awayScore = Number(m.awayScore || 0);

      const homeIsOurs = ourIds.has(m.homeTeamId);
      const awayIsOurs = ourIds.has(m.awayTeamId);

      // Als beide teams van ons zijn (club-onderlinge), sla deze wedstrijd over in goalsaldo
      if (homeIsOurs && awayIsOurs) return;

      if (homeIsOurs) {
        gf += homeScore;
        ga += awayScore;
      } else if (awayIsOurs) {
        gf += awayScore;
        ga += homeScore;
      }
    });
    return { gf, ga };
  }, [matchesForClub, teams, preferredTeamId]);

  // FG% (schotefficiency)
  const fg = useMemo(() => {
    const shots = baseClips.filter(c => c.actionType === "schot");
    if (!shots.length) return 0;
    const goals = shots.filter(s => s.result === "goal").length;
    return Math.round((goals / shots.length) * 100);
  }, [baseClips]);

  // Heatmap data
  const heatmap = useMemo(() => {
    const result = {};
    ZONES.forEach(z => (result[z] = 0));
    baseClips.forEach(c => {
      if (c.zone && result.hasOwnProperty(c.zone)) result[c.zone]++;
    });
    return result;
  }, [baseClips]);

  // Puntjes voor het nieuwe veld: gebruik x/y als beschikbaar, anders zone-centers
  const heatmapPoints = useMemo(() => {
    const zoneCenters = ZONES.reduce((acc, z, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      acc[z] = {
        x: (col + 0.5) / 3,
        y: (row + 0.5) / 3,
      };
      return acc;
    }, {});

    return baseClips.map((c) => {
      const fallback = c.zone && zoneCenters[c.zone] ? zoneCenters[c.zone] : { x: 0.5, y: 0.5 };
      const x = typeof c.x === "number" ? c.x : fallback.x;
      const y = typeof c.y === "number" ? c.y : fallback.y;
      return {
        id: c.id,
        x,
        y,
        actionType: c.actionType,
        result: c.result,
      };
    });
  }, [baseClips]);

  // Recente wedstrijden
  const recentMatches = [...matchesForView]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 4);

  // Speler van de week: beste schutter in de meest recente wedstrijd op basis van FG%
  const playerOfTheWeek = useMemo(() => {
    if (!matchesForClub.length || !baseClips.length || !teams.length) return null;

    // Filter wedstrijden op voorkeurs-team indien ingesteld
    const matchPool = preferredTeamId
      ? matchesForClub.filter(
          (m) => m.homeTeamId === preferredTeamId || m.awayTeamId === preferredTeamId
        )
      : matchesForClub;

    const sorted = [...matchPool]
      .filter((m) => m.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    // Zoek de meest recente wedstrijd WAAR schoten voor zijn getagd
    let latestWithShots = null;
    for (const m of sorted) {
      const shotsForMatch = baseClips.filter(
        (c) => c.matchId === m.id && c.actionType === "schot"
      );
      if (shotsForMatch.length) {
        latestWithShots = { match: m, clips: shotsForMatch };
        break;
      }
    }

    if (!latestWithShots) return null;

    const latest = latestWithShots.match;
    const matchClips = latestWithShots.clips;

    // Bouw spelerslijst met team-informatie
    const allPlayers = teams.flatMap((t) => {
      const base = (t.players || []).map((p) => ({ ...p, teamName: t.name, teamId: t.id }));
      const subs = (t.subs || []).map((p) => ({ ...p, teamName: t.name, teamId: t.id }));
      return [...base, ...subs];
    });

    const byPlayer = {};

    matchClips.forEach((c) => {
      const pid = c.playerId || "";
      if (!pid) return;
      const player = allPlayers.find((p) => p.id === pid);
      if (!player) return;

      // Als voorkeurs-team is ingesteld: alleen spelers uit dat team
      if (preferredTeamId && player.teamId !== preferredTeamId) return;

      if (!byPlayer[pid]) {
        byPlayer[pid] = { attempts: 0, goals: 0 };
      }
      byPlayer[pid].attempts += 1;
      if (c.result === "goal") byPlayer[pid].goals += 1;
    });

    const entries = Object.entries(byPlayer)
      .filter(([, v]) => v.attempts > 0)
      .map(([playerId, v]) => ({
        playerId,
        attempts: v.attempts,
        goals: v.goals,
        fg: v.attempts ? (v.goals / v.attempts) * 100 : 0,
      }));

    if (!entries.length) return null;

    entries.sort((a, b) => {
      if (b.fg !== a.fg) return b.fg - a.fg;
      return b.attempts - a.attempts;
    });

    const best = entries[0];

    const player = allPlayers.find((p) => p.id === best.playerId);
    if (!player) return null;

    return {
      name: player.name || "Onbekend",
      team: player.teamName || "",
      goals: best.goals,
      attempts: best.attempts,
      fg: Math.round(best.fg),
      match: latest,
    };
  }, [matchesForClub, baseClips, teams, preferredTeamId]);

  return (
    <div className="space-y-8">

      {/* HEADER */}
      <h2 className="text-3xl font-bold">Dashboard</h2>

      {/* SPELER VAN DE WEEK */}
      {playerOfTheWeek && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-[#FF6124]/20 text-[#FF6124]">
              <Trophy size={24} />
            </div>
            <div>
              <div className="text-xs text-neutral-400 uppercase tracking-wide">Speler van de week</div>
              <div className="text-lg font-semibold text-white">{playerOfTheWeek.name}</div>
              <div className="text-xs text-neutral-400 mt-0.5">
                {playerOfTheWeek.team && <span>{playerOfTheWeek.team} · </span>}
                Laatste wedstrijd: {new Date(playerOfTheWeek.match.date).toLocaleDateString("nl-NL")}
              </div>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="text-neutral-300">
              Schoten: <span className="text-green-400">{playerOfTheWeek.goals}</span>
              <span className="text-neutral-400"> / {playerOfTheWeek.attempts}</span>
            </div>
            <div className="text-sm font-semibold mt-1 text-green-400">
              {playerOfTheWeek.fg}% raak
            </div>
          </div>
        </div>
      )}

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        <KpiCard 
          icon={<Users size={26} />} 
          label="Teams" 
          value={totalTeams} 
        />

        <KpiCard 
          icon={<PlaySquare size={26} />} 
          label="Wedstrijden" 
          value={totalMatches} 
        />

        <KpiCard 
          icon={<Activity size={26} />} 
          label="Clips" 
          value={totalClips} 
        />

        <KpiCard 
          icon={<Trophy size={26} />} 
          label="FG%" 
          value={`${fg}%`} 
        />
      </div>

      {/* GOALS FOR / AGAINST */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <TeamStat label="Goals For" value={goalStats.gf} color="text-green-400" />
        <TeamStat label="Goals Against" value={goalStats.ga} color="text-red-400" />
      </div>

      {/* RECENT MATCHES TABLE */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
        <h3 className="text-lg font-semibold mb-3">Recente Wedstrijden</h3>

        {recentMatches.length === 0 ? (
          <div className="text-neutral-500 text-sm">Nog geen wedstrijden geregistreerd.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-neutral-400 border-b border-neutral-700">
              <tr>
                <th className="py-2 text-left">Datum</th>
                <th className="text-left">Wedstrijd</th>
                <th className="text-left">Uitslag</th>
                <th className="text-left">Clips</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recentMatches.map(m => {
                const home = formatTeamName(m.homeTeamId, teams);
                const away = formatTeamName(m.awayTeamId, teams);
                const clipCount = baseClips.filter(c => c.matchId === m.id).length;

                return (
                  <tr key={m.id} className="border-b border-neutral-800 hover:bg-neutral-800/40">
                    <td className="py-2">
                      {new Date(m.date).toLocaleDateString("nl-NL")}
                    </td>
                    <td>{home} vs {away}</td>
                    <td>{m.homeScore} - {m.awayScore}</td>
                    <td>{clipCount}</td>
                    <td className="text-right">
                      <button
                        onClick={() => navigate(`/matches/${m.id}`)}
                        className="px-3 py-1 text-xs border border-neutral-600 rounded-lg hover:border-[#FF6124] hover:text-[#FF6124]"
                      >
                        Bekijken
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* HEATMAP VELD */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
        <h3 className="text-lg font-semibold mb-4">Heatmap – Acties op het veld</h3>
        <FieldHeatmap points={heatmapPoints} />
      </div>

      {/* QUICK ACTIONS */}
      <div className="flex flex-wrap gap-3">
        <QuickButton label="Nieuwe wedstrijd" onClick={() => navigate("/matches")} />
        <QuickButton label="Teams beheren" onClick={() => navigate("/teams")} />
        <QuickButton label="Statistieken" onClick={() => navigate("/statistics")} />
      </div>
    </div>
  );
}

/* COMPONENTS BELOW */

function KpiCard({ icon, label, value }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex items-center gap-3 hover:bg-neutral-800 transition">
      <div className="p-3 rounded-xl bg-[#FF6124]/20 text-[#FF6124]">{icon}</div>
      <div>
        <div className="text-neutral-400 text-xs">{label}</div>
        <div className="text-xl font-bold text-white">{value}</div>
      </div>
    </div>
  );
}

function TeamStat({ label, value, color }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 text-center">
      <div className="text-neutral-400 text-xs">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function QuickButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-xl bg-[#FF6124] text-white hover:opacity-90 text-sm"
    >
      {label}
    </button>
  );
}