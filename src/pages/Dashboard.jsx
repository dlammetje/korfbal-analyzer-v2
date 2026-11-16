import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebaseClient";
import { doc, getDoc } from "firebase/firestore";
import { Trophy, Target, TrendingUp, Calendar, ChevronRight, Flame, Play, Star } from "lucide-react";
import FieldHeatmap from "../components/FieldHeatmap";
import ClipPlayerModal from "../components/ClipPlayerModal";
import { formatActionLabel } from "./MatchDetail";

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Telt op van 0 naar target met easeOutCubic (respecteert prefers-reduced-motion)
function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(target);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setValue(target);
      return;
    }

    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

function AnimatedNumber({ value, suffix = "", prefix = "" }) {
  const v = useCountUp(Number(value) || 0);
  return (
    <>
      {prefix}
      {v}
      {suffix}
    </>
  );
}

// Zone-indeling van het veld (rij = verticaal, y=0 is boven zoals in MatchDetail)
const ZONE_GRID = [
  ["Linksachter", "Achter (midden)", "Rechtsachter"],
  ["Linkerzij", "Korfzone", "Rechterzij"],
  ["Linksvoor", "Voor (midden)", "Rechtsvoor"],
];

// "YYYY-MM-DD" → "DD-MM-YYYY" voor weergave
function formatMatchDate(date) {
  if (!date || typeof date !== "string") return "Onbekende datum";
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

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

const isOpp = (c) =>
  !!c.opponentGoal ||
  c.result === "opp_goal" ||
  c.result === "opp_miss" ||
  (typeof c.actionType === "string" && c.actionType.startsWith("tegen_"));

const isOwnShot = (c) =>
  !isOpp(c) && typeof c.actionType === "string" && c.actionType.startsWith("schot");

export default function Dashboard() {
  const { teams, matches, clips } = useAppData();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // Voorkeurs-team (voor gefilterde view). Als leeg: club-brede cijfers.
  const [preferredTeamId, setPreferredTeamId] = useState("");
  const [userClubId, setUserClubId] = useState("");

  // Bars animeren vanaf breedte 0 zodra de pagina mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Geselecteerde favoriete clip voor de afspeel-modal
  const [activeFavorite, setActiveFavorite] = useState(null);

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
    const nonSeq = clipsForClub.filter(
      (c) => !c.sequenceId && c.actionType !== "sequence_moment"
    );

    if (!preferredTeamId) return nonSeq;

    const matchIds = matchesForClub
      .filter((m) => m.homeTeamId === preferredTeamId || m.awayTeamId === preferredTeamId)
      .map((m) => m.id);

    const idSet = new Set(matchIds);
    return nonSeq.filter((c) => idSet.has(c.matchId));
  }, [clipsForClub, matchesForClub, preferredTeamId]);

  const matchesForView = useMemo(() => {
    if (!preferredTeamId) return matchesForClub;
    return matchesForClub.filter(
      (m) => m.homeTeamId === preferredTeamId || m.awayTeamId === preferredTeamId
    );
  }, [matchesForClub, preferredTeamId]);

  // Van welke kant spelen "wij" in deze wedstrijd?
  const ourIds = useMemo(
    () => new Set(preferredTeamId ? [preferredTeamId] : teams.map((t) => t.id)),
    [teams, preferredTeamId]
  );

  function ourSide(m) {
    const homeOurs = ourIds.has(m.homeTeamId);
    const awayOurs = ourIds.has(m.awayTeamId);
    if (homeOurs && !awayOurs) return "home";
    if (awayOurs && !homeOurs) return "away";
    return null;
  }

  // Gespeelde wedstrijden: vandaag of eerder (of zonder datum), nieuwste eerst
  const playedMatches = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return matchesForView
      .filter((m) => ourSide(m) !== null && (!m.date || m.date <= today))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchesForView, ourIds]);

  function resultOf(m) {
    const side = ourSide(m);
    if (!side) return null;
    const us = side === "home" ? Number(m.homeScore || 0) : Number(m.awayScore || 0);
    const them = side === "home" ? Number(m.awayScore || 0) : Number(m.homeScore || 0);
    if (us > them) return "W";
    if (us < them) return "V";
    return "G";
  }

  const totalClips = baseClips.length;

  // Goals for/against + seizoensrecord
  const goalStats = useMemo(() => {
    let gf = 0,
      ga = 0,
      w = 0,
      g = 0,
      v = 0;

    playedMatches.forEach((m) => {
      const side = ourSide(m);
      const us = side === "home" ? Number(m.homeScore || 0) : Number(m.awayScore || 0);
      const them = side === "home" ? Number(m.awayScore || 0) : Number(m.homeScore || 0);
      gf += us;
      ga += them;
      const r = resultOf(m);
      if (r === "W") w += 1;
      else if (r === "G") g += 1;
      else if (r === "V") v += 1;
    });

    return { gf, ga, w, g, v };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playedMatches, ourIds]);

  const record = { w: goalStats.w, g: goalStats.g, v: goalStats.v };
  const played = record.w + record.g + record.v;
  const winPct = played ? Math.round((record.w / played) * 100) : 0;
  const goalDiff = goalStats.gf - goalStats.ga;

  // Eigen schoten + afronding (ook per afstand)
  const shotStats = useMemo(() => {
    const shots = baseClips.filter(isOwnShot);
    const byDistance = {};
    ["schot_3m", "schot_6m", "schot_9m"].forEach((id) => {
      const list = shots.filter((c) => c.actionType === id);
      const goals = list.filter((c) => c.result === "goal").length;
      const misses = list.filter((c) => c.result === "miss").length;
      byDistance[id] = {
        attempts: list.length,
        goals,
        misses,
        fg: list.length ? Math.round((goals / list.length) * 100) : 0,
      };
    });
    const goals = shots.filter((c) => c.result === "goal").length;
    const misses = shots.filter((c) => c.result === "miss").length;
    return {
      attempts: shots.length,
      goals,
      misses,
      fg: shots.length ? Math.round((goals / shots.length) * 100) : 0,
      byDistance,
    };
  }, [baseClips]);

  // Puntjes voor het veld: eigen schoten, x/y als beschikbaar anders zone-centers
  const heatmapPoints = useMemo(() => {
    const zoneCenters = ZONE_GRID.reduce((acc, row, r) => {
      row.forEach((z, c) => {
        acc[z] = { x: (c + 0.5) / 3, y: (r + 0.5) / 3 };
      });
      return acc;
    }, {});

    return baseClips.filter(isOwnShot).map((c) => {
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

  // Afronding per zone voor de overlay op het veld
  const zoneOverlay = useMemo(() => {
    const stats = {};
    ZONE_GRID.flat().forEach((z) => {
      stats[z] = { attempts: 0, goals: 0, misses: 0, fg: 0 };
    });

    baseClips.filter(isOwnShot).forEach((c) => {
      let zone = stats[c.zone] ? c.zone : null;
      if (
        !zone &&
        typeof c.x === "number" && typeof c.y === "number" &&
        c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1
      ) {
        const col = Math.min(2, Math.max(0, Math.floor(c.x * 3)));
        const row = Math.min(2, Math.max(0, Math.floor(c.y * 3)));
        zone = ZONE_GRID[row][col];
      }
      if (!zone) return;
      if (c.result === "goal") {
        stats[zone].attempts += 1;
        stats[zone].goals += 1;
      } else if (c.result === "miss") {
        stats[zone].attempts += 1;
        stats[zone].misses += 1;
      }
    });

    ZONE_GRID.flat().forEach((z) => {
      const s = stats[z];
      s.fg = s.attempts ? Math.round((s.goals / s.attempts) * 100) : 0;
    });

    return ZONE_GRID.flatMap((row, r) =>
      row.map((zone, c) => ({ zone, row: r, col: c, ...stats[zone] }))
    );
  }, [baseClips]);

  // Recente wedstrijden (gespeeld, nieuwste eerst)
  const recentMatches = playedMatches.slice(0, 5);

  // Vorm: laatste 5 gespeelde wedstrijden, oud → nieuw
  const recentForm = playedMatches.slice(0, 5).map(resultOf).reverse();

  // Alle spelers van alle teams (met team-info) voor lookups
  const allPlayers = useMemo(() => {
    return teams.flatMap((t) => {
      const base = (t.players || []).map((p) => ({ ...p, teamName: t.name, teamId: t.id }));
      const subs = (t.subs || []).map((p) => ({ ...p, teamName: t.name, teamId: t.id }));
      return [...base, ...subs];
    });
  }, [teams]);

  // Speler van de week: beste afmaker in de meest recente wedstrijd op basis van FG%
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

    // Zoek de meest recente wedstrijd WAAR eigen schoten voor zijn getagd
    let latestWithShots = null;
    for (const m of sorted) {
      const shotsForMatch = baseClips.filter(
        (c) => c.matchId === m.id && isOwnShot(c)
      );
      if (shotsForMatch.length) {
        latestWithShots = { match: m, clips: shotsForMatch };
        break;
      }
    }

    if (!latestWithShots) return null;

    const latest = latestWithShots.match;
    const matchClips = latestWithShots.clips;

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

    const name = player.name || "Onbekend";
    const initials = name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase())
      .slice(0, 2)
      .join("");

    return {
      name,
      team: player.teamName || "",
      goals: best.goals,
      attempts: best.attempts,
      fg: Math.round(best.fg),
      match: latest,
      avatarUrl: player.avatarUrl || "",
      initials,
    };
  }, [matchesForClub, baseClips, teams, preferredTeamId, allPlayers]);

  // Topschutters: meeste eigen goals (bij gelijk: hoogste afronding%)
  const topScorers = useMemo(() => {
    const byPlayer = {};
    baseClips.filter(isOwnShot).forEach((c) => {
      const pid = c.playerId || "";
      if (!pid) return;
      const player = allPlayers.find((p) => p.id === pid);
      if (!player) return;
      if (preferredTeamId && player.teamId !== preferredTeamId) return;
      if (!byPlayer[pid]) byPlayer[pid] = { name: player.name || "Onbekend", attempts: 0, goals: 0 };
      byPlayer[pid].attempts += 1;
      if (c.result === "goal") byPlayer[pid].goals += 1;
    });

    return Object.values(byPlayer)
      .filter((p) => p.goals > 0)
      .map((p) => ({ ...p, fg: Math.round((p.goals / p.attempts) * 100) }))
      .sort((a, b) => (b.goals !== a.goals ? b.goals - a.goals : b.fg - a.fg))
      .slice(0, 5);
  }, [baseClips, allPlayers, preferredTeamId]);

  // Favoriete clips (ster in MatchDetail), nieuwste eerst
  const favoriteClips = useMemo(() => {
    const ts = (c) =>
      c.createdAt && typeof c.createdAt.seconds === "number"
        ? c.createdAt.seconds
        : typeof c.createdAt === "number"
        ? c.createdAt
        : null;
    const matchDate = (c) =>
      matches.find((m) => m.id === c.matchId)?.date || "";
    return baseClips
      .filter((c) => c.favorite)
      .sort((a, b) => {
        const ta = ts(a);
        const tb = ts(b);
        if (ta !== null || tb !== null) return (tb ?? -Infinity) - (ta ?? -Infinity);
        return matchDate(b).localeCompare(matchDate(a));
      })
      .slice(0, 8);
  }, [baseClips, matches]);

  const preferredTeam = preferredTeamId
    ? teams.find((t) => t.id === preferredTeamId) || null
    : null;

  return (
    <div className="space-y-6">

      {/* HERO */}
      <div
        className="rounded-2xl p-6 bg-gradient-to-br from-[#FF6124]/30 via-neutral-800/80 to-neutral-900 border border-[#FF6124]/30 shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-up"
        style={{ animationDelay: "0ms" }}
      >
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-[#FF6124]">
            Dashboard
          </div>
          <h2 className="text-3xl font-bold text-white mt-1">
            {preferredTeam?.name || "Alle teams"}
          </h2>
          <p className="text-sm text-neutral-300 mt-1">
            Seizoensrecord: W {record.w} · G {record.g} · V {record.v}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={() => navigate("/matches")}
            className="px-4 py-2 rounded-xl bg-[#FF6124] text-white text-sm font-medium hover:opacity-90"
          >
            Nieuwe wedstrijd
          </button>
          <button
            onClick={() => navigate("/teams")}
            className="px-4 py-2 rounded-xl bg-neutral-900/80 border border-neutral-700 text-neutral-200 text-sm hover:border-[#FF6124]/60"
          >
            Teams beheren
          </button>
          <button
            onClick={() => navigate("/statistics")}
            className="px-4 py-2 rounded-xl bg-neutral-900/80 border border-neutral-700 text-neutral-200 text-sm hover:border-[#FF6124]/60"
          >
            Statistieken
          </button>
        </div>
      </div>

      {/* KPI RIJ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-up" style={{ animationDelay: "70ms" }}>
        <KpiCard
          icon={<Calendar size={22} />}
          label="Wedstrijden"
          value={<AnimatedNumber value={playedMatches.length} />}
          sub={`${totalClips} tags`}
        />
        <KpiCard
          icon={<TrendingUp size={22} />}
          label="Record"
          value={`${record.w}-${record.g}-${record.v}`}
          sub={
            <>
              <AnimatedNumber value={winPct} suffix="%" /> winst
            </>
          }
        />
        <KpiCard
          icon={<Flame size={22} />}
          label="Doelsaldo"
          value={
            <AnimatedNumber
              value={Math.abs(goalDiff)}
              prefix={goalDiff >= 0 ? "+" : "−"}
            />
          }
          valueClass={goalDiff >= 0 ? "text-green-400" : "text-red-400"}
          sub={`${goalStats.gf} voor · ${goalStats.ga} tegen`}
        />
        <KpiCard
          icon={<Target size={22} />}
          label="Afronding"
          value={shotStats.attempts ? <AnimatedNumber value={shotStats.fg} suffix="%" /> : "—"}
          sub={`${shotStats.goals}/${shotStats.attempts} schoten`}
          barPct={shotStats.fg}
          mounted={mounted}
        />
      </div>

      {/* VORM */}
      <div
        className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 animate-fade-up"
        style={{ animationDelay: "140ms" }}
      >
        <h3 className="text-sm font-semibold text-neutral-200 mb-3">Vorm (laatste 5)</h3>
        {recentForm.length ? (
          <div className="flex items-center gap-2">
            {recentForm.map((r, i) => {
              const playedM = playedMatches.slice(0, 5).reverse()[i];
              const home = playedM ? formatTeamName(playedM.homeTeamId, teams) : "";
              const away = playedM ? formatTeamName(playedM.awayTeamId, teams) : "";
              return (
                <div
                  key={i}
                  title={playedM ? `${formatMatchDate(playedM.date)} ${home} ${playedM.homeScore} - ${playedM.awayScore} ${away}` : ""}
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                    r === "W" ? "bg-green-500" : r === "G" ? "bg-neutral-500" : "bg-red-500"
                  }`}
                >
                  {r}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-neutral-500">Nog geen gespeelde wedstrijden.</div>
        )}
      </div>

      {/* SPELER VAN DE WEEK + AFSTAND/TOPSCHUTTERS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-fade-up" style={{ animationDelay: "210ms" }}>
        {/* Speler van de week */}
        <div className="lg:col-span-1 bg-gradient-to-br from-[#FF6124]/20 to-neutral-900 border border-[#FF6124]/30 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#FF6124] mb-3">
            <Trophy size={14} /> Speler van de week
          </div>
          {playerOfTheWeek ? (
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden bg-neutral-800 flex items-center justify-center text-lg font-semibold text-neutral-200 ring-2 ring-[#FF6124] shrink-0">
                {playerOfTheWeek.avatarUrl ? (
                  <img
                    src={playerOfTheWeek.avatarUrl}
                    alt={playerOfTheWeek.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{playerOfTheWeek.initials || "?"}</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold text-white truncate">
                  {playerOfTheWeek.name}
                </div>
                <div className="text-xs text-neutral-400">
                  {playerOfTheWeek.team && <span>{playerOfTheWeek.team} · </span>}
                  {formatMatchDate(playerOfTheWeek.match?.date)}
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[#FF6124]">
                    <AnimatedNumber value={playerOfTheWeek.fg} suffix="%" />
                  </span>
                  <span className="text-xs text-neutral-300">
                    {playerOfTheWeek.goals}/{playerOfTheWeek.attempts} raak
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-neutral-500">Nog geen schoten getagd.</div>
          )}
        </div>

        {/* Afronding per afstand + topschutters */}
        <div className="lg:col-span-2 bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-neutral-200 mb-2">Afronding per afstand</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "schot_3m", label: ">3m" },
                { id: "schot_6m", label: ">6m" },
                { id: "schot_9m", label: ">9m" },
              ].map((d) => {
                const s = shotStats.byDistance[d.id];
                return (
                  <div key={d.id} className="bg-neutral-900/80 border border-neutral-800 rounded-xl p-3">
                    <div className="text-[11px] text-neutral-400">Schot {d.label}</div>
                    <div className="text-xl font-semibold text-[#FF6124] mt-0.5">
                      {s.attempts ? <AnimatedNumber value={s.fg} suffix="%" /> : "—"}
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      {s.goals}/{s.attempts}
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-green-400">Raak {s.goals}</span>
                      <span className="text-red-400">Mis {s.misses}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-neutral-950/70 overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-[width] duration-700 ease-out"
                        style={{ width: `${mounted && s.attempts ? s.fg : 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-neutral-200 mb-2">Topschutters</h3>
            {topScorers.length ? (
              <div className="space-y-1.5">
                {topScorers.map((p, i) => (
                  <div
                    key={p.name}
                    className="bg-neutral-900/80 rounded-xl px-3 py-2 flex items-center gap-3"
                  >
                    <span className="w-5 text-center text-xs font-bold text-[#FF6124]">
                      {i + 1}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-sm text-neutral-100">
                      {p.name}
                    </span>
                    <div className="w-28 h-1.5 rounded-full bg-neutral-950/70 overflow-hidden hidden sm:block">
                      <div
                        className="h-full bg-[#FF6124] rounded-full transition-[width] duration-700 ease-out"
                        style={{ width: `${mounted ? Math.round((p.goals / topScorers[0].goals) * 100) : 0}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-white w-6 text-right">
                      <AnimatedNumber value={p.goals} />
                    </span>
                    <span className="text-[11px] text-neutral-400 w-10 text-right">
                      {p.fg}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-neutral-500">Nog geen doelpunten getagd.</div>
            )}
          </div>
        </div>
      </div>

      {/* RECENTE WEDSTRIJDEN */}
      <div
        className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 animate-fade-up"
        style={{ animationDelay: "280ms" }}
      >
        <h3 className="text-sm font-semibold text-neutral-200 mb-3">Recente wedstrijden</h3>
        {recentMatches.length === 0 ? (
          <div className="text-neutral-500 text-sm">Nog geen wedstrijden geregistreerd.</div>
        ) : (
          <div className="space-y-2">
            {recentMatches.map((m) => {
              const r = resultOf(m);
              const home = formatTeamName(m.homeTeamId, teams);
              const away = formatTeamName(m.awayTeamId, teams);
              const clipCount = baseClips.filter((c) => c.matchId === m.id).length;
              return (
                <div
                  key={m.id}
                  onClick={() => navigate(`/matches/${m.id}`)}
                  className="bg-neutral-900/80 rounded-xl p-3 flex items-center gap-3 hover:bg-neutral-900 cursor-pointer transition-all duration-200 hover:-translate-y-0.5"
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 ${
                      r === "W" ? "bg-green-500" : r === "G" ? "bg-neutral-500" : "bg-red-500"
                    }`}
                  >
                    {r}
                  </div>
                  <span className="text-xs text-neutral-400 w-20 shrink-0">
                    {formatMatchDate(m.date)}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-sm text-neutral-100">
                    {home} vs {away}
                  </span>
                  <span className="text-sm font-bold text-white whitespace-nowrap">
                    {m.homeScore} - {m.awayScore}
                  </span>
                  <span className="text-[11px] text-neutral-500 whitespace-nowrap hidden sm:inline">
                    {clipCount} clips
                  </span>
                  <ChevronRight size={16} className="text-neutral-500 shrink-0" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* FAVORIETE CLIPS */}
      <div
        className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 animate-fade-up"
        style={{ animationDelay: "350ms" }}
      >
        <h3 className="text-sm font-semibold text-neutral-200 mb-3 flex items-center gap-2">
          <Star size={15} className="fill-[#FF6124] text-[#FF6124]" />
          Favoriete clips
        </h3>
        {favoriteClips.length === 0 ? (
          <div className="text-xs text-neutral-500">
            Nog geen favoriete clips. Markeer clips met een ster in een wedstrijd.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {favoriteClips.map((c) => {
              const m = matches.find((x) => x.id === c.matchId);
              const player = allPlayers.find((p) => p.id === c.playerId);
              const playerLabel = player
                ? `${player.number ? `#${player.number} ` : ""}${player.name}`
                : "Onbekend";
              const home = m ? formatTeamName(m.homeTeamId, teams) : "";
              const away = m ? formatTeamName(m.awayTeamId, teams) : "";
              const half = c.half || 1;
              return (
                <div
                  key={c.id}
                  onClick={() => setActiveFavorite(c)}
                  className="bg-neutral-900/80 rounded-xl p-3 border border-neutral-700/50 hover:border-[#FF6124]/60 hover:-translate-y-0.5 transition cursor-pointer"
                >
                  <div className="relative w-full aspect-video rounded-lg bg-neutral-950/80 flex items-center justify-center mb-2">
                    <span className="w-9 h-9 rounded-full bg-[#FF6124] flex items-center justify-center">
                      <Play size={16} className="text-white fill-white ml-0.5" />
                    </span>
                    <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                      {half}e helft · {fmt(c.time || 0)}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-neutral-100 truncate">
                    {formatActionLabel(c.actionType)}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-neutral-400 truncate">{playerLabel}</span>
                    {(c.result === "goal" || c.result === "miss") && (
                      <span
                        className={`ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                          c.result === "goal"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {c.result === "goal" ? "Raak" : "Mis"}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-neutral-500 mt-1 truncate">
                    {m ? `${formatMatchDate(m.date)} ${home} vs ${away}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SCHOTEN OP HET VELD */}
      <div
        className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 animate-fade-up"
        style={{ animationDelay: "420ms" }}
      >
        <h3 className="text-sm font-semibold text-neutral-200 mb-4">Schoten op het veld</h3>
        <FieldHeatmap points={heatmapPoints} maxWidth="max-w-3xl" zoneOverlay={zoneOverlay} />
      </div>

      {/* Favoriete clip modal */}
      {activeFavorite && (
        <ClipPlayerModal
          clip={activeFavorite}
          match={matches.find((x) => x.id === activeFavorite.matchId)}
          playerLabel={(() => {
            const p = allPlayers.find((pl) => pl.id === activeFavorite.playerId);
            return p ? `${p.number ? `#${p.number} ` : ""}${p.name}` : "";
          })()}
          teams={teams}
          onClose={() => setActiveFavorite(null)}
          onOpenMatch={(matchId) => navigate(`/matches/${matchId}`)}
        />
      )}
    </div>
  );
}

// COMPONENTS BELOW

function KpiCard({ icon, label, value, sub, valueClass, barPct, mounted = true }) {
  return (
    <div className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 flex items-start gap-3 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="p-2.5 rounded-xl bg-[#FF6124]/20 text-[#FF6124]">{icon}</div>
      <div className="min-w-0">
        <div className="text-neutral-400 text-xs">{label}</div>
        <div className={`text-2xl font-bold ${valueClass || "text-white"}`}>{value}</div>
        {sub && <div className="text-[11px] text-neutral-400 mt-0.5">{sub}</div>}
        {typeof barPct === "number" && (
          <div className="mt-1.5 h-1.5 w-24 rounded-full bg-neutral-950/70 overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${mounted ? barPct : 0}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
