import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebaseClient";
import { doc, getDoc } from "firebase/firestore";
import FieldHeatmap from "../components/FieldHeatmap";

const ZONES = [
  "Linksvoor", "Voor (midden)", "Rechtsvoor",
  "Linkerzij", "Korfzone", "Rechterzij",
  "Linksachter", "Achter (midden)", "Rechtsachter"
];

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function PlayerProfile() {
  const { playerName } = useParams();
  const decodedName = decodeURIComponent(playerName || "");

  const { teams = [], matches = [], clips = [] } = useAppData() || {};
  const { currentUser } = useAuth();

  const [userClubId, setUserClubId] = useState("");

  useEffect(() => {
    if (!currentUser) {
      setUserClubId("");
      return;
    }

    let cancelled = false;

    async function loadUserClub() {
      try {
        const ref = doc(db, "users", currentUser.uid);
        const snap = await getDoc(ref);
        if (!cancelled && snap.exists()) {
          const data = snap.data() || {};
          setUserClubId(data.clubId || "");
        }
      } catch (e) {
        console.error("[PlayerProfile] Fout bij laden clubId:", e);
        setUserClubId("");
      }
    }

    loadUserClub();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const matchesForClub = useMemo(() => {
    if (!userClubId) return matches;
    return matches.filter((m) => !m.clubId || m.clubId === userClubId);
  }, [matches, userClubId]);

  const clipsForClub = useMemo(() => {
    if (!userClubId) return clips;
    return clips.filter((c) => !c.clubId || c.clubId === userClubId);
  }, [clips, userClubId]);

  const enriched = useMemo(() => {
    return clipsForClub.map((c) => {
      const match = matchesForClub.find((m) => m.id === c.matchId) || {};
      const home = teams.find((t) => t.id === match.homeTeamId);
      const away = teams.find((t) => t.id === match.awayTeamId);

      const allTeamsWithPlayers = teams || [];
      let player = null;
      let playerTeamName = null;
      for (const t of allTeamsWithPlayers) {
        const inPlayers = (t.players || []).find((p) => p.id === c.playerId);
        const inSubs = !inPlayers ? (t.subs || []).find((p) => p.id === c.playerId) : null;
        player = inPlayers || inSubs || player;
        if (player) {
          playerTeamName = t.name || null;
          break;
        }
      }

      const datePart = match.date || "Onbekende datum";
      const homeName = home?.name || match.homeTeamId || "Onbekend";
      const awayName = away?.name || match.awayTeamId || "Onbekend";

      return {
        ...c,
        team: playerTeamName || homeName || awayName || "Onbekend",
        player: player?.name || "Onbekend",
        matchName: `${datePart} — ${homeName} vs ${awayName}`,
      };
    });
  }, [clipsForClub, teams, matchesForClub]);

  const playerClips = useMemo(() => {
    if (!decodedName) return [];
    return enriched.filter((c) => c.player === decodedName);
  }, [enriched, decodedName]);

  const playerTeams = useMemo(() => {
    const set = new Set();
    playerClips.forEach((c) => {
      if (c.team) set.add(c.team);
    });
    return Array.from(set);
  }, [playerClips]);

  const stats = useMemo(() => {
    const shots = playerClips.filter((c) => c.actionType === "schot");
    const goals = shots.filter((c) => c.result === "goal");
    const misses = shots.filter((c) => c.result === "miss");

    const chanceShots = playerClips.filter((c) => [
      "doorloopbal",
      "kleine_kans",
      "strafworp",
      "vrije_bal",
    ].includes(c.actionType));
    const chanceGoals = chanceShots.filter((c) => c.result === "goal");

    const reboundsAttack = playerClips.filter((c) => c.actionType === "rebound_win").length;
    const reboundsDefense = playerClips.filter((c) => c.actionType === "rebound_verdediging").length;
    const totalRebounds = reboundsAttack + reboundsDefense;

    return {
      totalShots: shots.length,
      goals: goals.length,
      misses: misses.length,
      fg: shots.length ? Math.round((goals.length / shots.length) * 100) : 0,
      chanceAttempts: chanceShots.length,
      chanceGoals: chanceGoals.length,
      chanceFg: chanceShots.length ? Math.round((chanceGoals.length / chanceShots.length) * 100) : 0,
      reboundsAttack,
      reboundsDefense,
      totalRebounds,
      assists: playerClips.filter((c) => c.actionType === "assist").length,
      turnovers: playerClips.filter((c) => c.actionType === "balverlies").length,
      interceptions: playerClips.filter((c) => ["onderschepping", "overname"].includes(c.actionType)).length,
      fouls: playerClips.filter((c) => c.actionType === "overtreding").length,
      matchesCount: new Set(playerClips.map((c) => c.matchId)).size,
    };
  }, [playerClips]);

  const shotchart = useMemo(() => {
    const map = {};
    ZONES.forEach((z) => {
      map[z] = { goal: 0, miss: 0, pct: 0 };
    });

    playerClips.forEach((c) => {
      if (c.actionType === "schot" && map[c.zone]) {
        if (c.result === "goal") map[c.zone].goal += 1;
        if (c.result === "miss") map[c.zone].miss += 1;
      }
    });

    ZONES.forEach((z) => {
      const total = map[z].goal + map[z].miss;
      map[z].pct = total ? Math.round((map[z].goal / total) * 100) : 0;
    });

    return map;
  }, [playerClips]);

  const topStrongZones = useMemo(() => {
    const entries = ZONES.map((z) => ({ zone: z, ...shotchart[z] }));
    const filtered = entries.filter((e) => e.goal + e.miss >= 5);
    return [...filtered].sort((a, b) => b.pct - a.pct).slice(0, 3);
  }, [shotchart]);

  const topWeakZones = useMemo(() => {
    const entries = ZONES.map((z) => ({ zone: z, ...shotchart[z] }));
    const filtered = entries.filter((e) => e.goal + e.miss >= 5);
    return [...filtered].sort((a, b) => a.pct - b.pct).slice(0, 3);
  }, [shotchart]);

  const fieldHeatmapPoints = useMemo(() => {
    if (!playerClips.length) return [];

    const zoneCenters = ZONES.reduce((acc, z, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      acc[z] = {
        x: (col + 0.5) / 3,
        y: (row + 0.5) / 3,
      };
      return acc;
    }, {});

    return playerClips.map((c) => {
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
  }, [playerClips]);

  const recentClips = useMemo(() => {
    return [...playerClips]
      .sort((a, b) => {
        const ha = a.half || 1;
        const hb = b.half || 1;
        if (a.matchId !== b.matchId) return (a.matchId || "").localeCompare(b.matchId || "");
        if (ha !== hb) return ha - hb;
        return (a.time || 0) - (b.time || 0);
      })
      .slice(0, 20);
  }, [playerClips]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h2 className="text-2xl font-semibold">Spelerprofiel</h2>
          <div className="text-xl font-semibold mt-1">{decodedName || "Onbekende speler"}</div>
          {playerTeams.length > 0 && (
            <div className="text-sm text-neutral-400 mt-1">
              Teams: {playerTeams.join(", ")}
            </div>
          )}
          <div className="text-xs text-neutral-500 mt-1">
            Wedstrijden met clips: {stats.matchesCount}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Goals" value={stats.goals} color="#FF6124" />
        <StatCard title="Schoten" value={stats.totalShots} />
        <StatCard title="Raak% schoten" value={`${stats.fg}%`} color="#FF6124" />
        <StatCard title="Kansen (pogingen)" value={stats.chanceAttempts} />
        <StatCard title="Kansen raak" value={stats.chanceGoals} color="#22c55e" />
        <StatCard title="Raak% kansen" value={`${stats.chanceFg}%`} color="#22c55e" />
        <StatCard title="Rebounds aanv." value={stats.reboundsAttack} />
        <StatCard title="Rebounds verd." value={stats.reboundsDefense} />
        <StatCard title="Assists" value={stats.assists} />
        <StatCard title="Balverlies" value={stats.turnovers} />
        <StatCard title="Ondersch./Overnames" value={stats.interceptions} />
        <StatCard title="Overtredingen" value={stats.fouls} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-lg font-semibold">Topzones</h3>
          <ZoneList title="Sterkste zones" zones={topStrongZones} />
          <ZoneList title="Zwakste zones" zones={topWeakZones} />
        </div>
        <div className="md:col-span-2">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
            <h3 className="text-lg font-semibold mb-3">Veld-heatmap</h3>
            <FieldHeatmap points={fieldHeatmapPoints} maxWidth="max-w-3xl" />
          </div>
        </div>
      </div>

      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 mt-4 overflow-x-auto">
        <h3 className="text-lg font-semibold mb-3">Laatste acties</h3>
        {recentClips.length === 0 ? (
          <div className="text-sm text-neutral-400">Nog geen clips voor deze speler.</div>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="text-neutral-400">
              <tr className="border-b border-neutral-800">
                <th className="text-left py-2 pr-3">Wedstrijd</th>
                <th className="text-center px-3">Tijd</th>
                <th className="text-center px-3">Helft</th>
                <th className="text-center px-3">Actie</th>
                <th className="text-center px-3">Resultaat</th>
                <th className="text-center px-3">Zone</th>
              </tr>
            </thead>
            <tbody>
              {recentClips.map((c) => (
                <tr key={c.id} className="border-t border-neutral-800">
                  <td className="py-2 pr-3 whitespace-nowrap text-neutral-200">{c.matchName}</td>
                  <td className="text-center px-3">{fmt(c.time || 0)}</td>
                  <td className="text-center px-3">{c.half || 1}</td>
                  <td className="text-center px-3 text-neutral-200">{c.actionType}</td>
                  <td className="text-center px-3 text-neutral-200">{c.result || ""}</td>
                  <td className="text-center px-3 text-neutral-200">{c.zone || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, color }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-center">
      <div className="text-neutral-400 text-sm">{title}</div>
      <div className="text-2xl mt-1 font-semibold" style={{ color: color || "white" }}>{value}</div>
    </div>
  );
}

function ZoneList({ title, zones }) {
  if (!zones.length) {
    return (
      <div>
        <div className="text-sm font-semibold mb-2">{title}</div>
        <div className="text-xs text-neutral-500">Nog onvoldoende data.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-sm font-semibold mb-2">{title}</div>
      <div className="space-y-1">
        {zones.map((z) => (
          <div key={z.zone} className="flex items-center justify-between text-xs">
            <span className="text-neutral-200">{z.zone}</span>
            <span className="text-neutral-400">
              {z.goal}/{z.goal + z.miss} ({z.pct}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
