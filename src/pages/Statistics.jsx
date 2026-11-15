import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAppData } from "../context/AppDataContext";
import FieldHeatmap from "../components/FieldHeatmap";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebaseClient";
import { doc, getDoc } from "firebase/firestore";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend } from "recharts";
import { Flame } from "lucide-react";

const ZONES = [
  "Linksvoor", "Voor (midden)", "Rechtsvoor",
  "Linkerzij", "Korfzone", "Rechterzij",
  "Linksachter", "Achter (midden)", "Rechtsachter"
];

// Zone-indeling van het veld (rij = verticaal, y=0 is boven zoals in MatchDetail)
const ZONE_GRID = [
  ["Linksachter", "Achter (midden)", "Rechtsachter"],
  ["Linkerzij", "Korfzone", "Rechterzij"],
  ["Linksvoor", "Voor (midden)", "Rechtsvoor"],
];

const ACTION_FILTER_OPTIONS = [
  "schot_3m", "schot_6m", "schot_9m",
  "rebound_win", "rebound_lose",
  "rebound_def_win", "rebound_def_lose",
  "balverlies", "verdedigd", "onderschepping", "overtreding",
  "tegen_schot_3m", "tegen_schot_6m", "tegen_schot_9m",
];

const RESULT_OPTIONS = [
  "all",
  { value: "goal", label: "Raak" },
  { value: "miss", label: "Mis" },
  { value: "opp_goal", label: "Tegendoelpunt" },
  { value: "opp_miss", label: "Tegen gemist" },
];

// "YYYY-MM-DD" → "DD-MM-YYYY" voor weergave
function formatMatchDate(date) {
  if (!date || typeof date !== "string") return "Onbekende datum";
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Clip is van de tegenstander (flag, result of tegen_-actie)
function isOppClip(c) {
  return (
    !!c.opponentGoal ||
    c.result === "opp_goal" ||
    c.result === "opp_miss" ||
    (typeof c.actionType === "string" && c.actionType.startsWith("tegen_"))
  );
}

// Positie op de 50-minuten tijdlijn (helft 2 begint op 25)
function clipMinute(c) {
  const half = c.half === 2 ? 2 : 1;
  return (half === 2 ? 25 : 0) + Math.min(25, Math.max(0, (c.time || 0) / 60));
}

// Eigen kans-acties (schoten + legacy kans-typen)
function isChanceAction(c) {
  return (
    typeof c.actionType === "string" &&
    (c.actionType.startsWith("schot") ||
      ["doorloopbal", "kleine_kans", "strafworp", "vrije_bal"].includes(c.actionType))
  );
}

// Tijdstip op de 50-min-as → "1e helft m:ss" of "2e helft m:ss"
function fmtPeriod(minute) {
  const total = Math.round(minute * 60);
  if (minute <= 25) return `1e helft ${fmt(total)}`;
  return `2e helft ${fmt(total - 25 * 60)}`;
}

export function formatActionLabel(actionId) {
  if (!actionId) return "—";
  const map = {
    schot_3m: "Schot <3m",
    schot_6m: "Schot <6m",
    schot_9m: "Schot <9m",
    schot: "Schot",
    rebound_win: "Rebound (win)",
    rebound_lose: "Rebound (Verlies)",
    balverlies: "Balverlies",
    tegen_schot_3m: "Tegenstander Schot <3m",
    tegen_schot_6m: "Tegenstander Schot <6m",
    tegen_schot_9m: "Tegenstander Schot <9m",
    tegen_schot: "Tegenstander Schot",
    rebound_def_win: "Rebound verd. (win)",
    rebound_def_lose: "Rebound verd. (Verlies)",
    verdedigd: "Verdedigd",
    onderschepping: "Onderschepping",
    overname: "Overname",
    overtreding: "Overtreding",
    assist: "Assist",
    doorloopbal: "Doorloopbal",
    kleine_kans: "Kleine Kans",
    vrije_bal: "Vrije Bal",
    strafworp: "Strafworp",
  };
  return map[actionId] || actionId.replaceAll("_", " ");
}

export default function Statistics() {
  const { teams = [], matches = [], clips = [], substitutions = [], clipSequences = [] } = useAppData() || {};
  const { currentUser } = useAuth();

  const [userClubId, setUserClubId] = useState("");

  const [selectedTeam, setSelectedTeam] = useState("all");
  const [selectedPlayer, setSelectedPlayer] = useState("all");
  const [selectedZone, setSelectedZone] = useState("all");
  const [selectedAction, setSelectedAction] = useState("all");
  const [selectedHalf, setSelectedHalf] = useState("all");
  const [selectedResult, setSelectedResult] = useState("all");
  const [selectedMatch, setSelectedMatch] = useState("all");
  const [selectedSeason, setSelectedSeason] = useState("all");

  // Modus: eigen stats (voor) of tegenstander (tegen)
  const [statsMode, setStatsMode] = useState("for"); // "for" | "against"

  // Vergelijking Speler A vs Speler B (+ optioneel C)
  const [comparePlayerA, setComparePlayerA] = useState("");
  const [comparePlayerB, setComparePlayerB] = useState("");
  const [comparePlayerC, setComparePlayerC] = useState("");
  const [showCompareC, setShowCompareC] = useState(false);

  // Vergelijking Wedstrijd A vs Wedstrijd B (+ optioneel C)
  const [compareMatchA, setCompareMatchA] = useState("");
  const [compareMatchB, setCompareMatchB] = useState("");
  const [compareMatchC, setCompareMatchC] = useState("");
  const [showCompareMatchC, setShowCompareMatchC] = useState(false);

  const [selectedSequenceId, setSelectedSequenceId] = useState("");
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const videoRef = useRef(null);

  // Afstandsfilter voor het schoten-per-zone paneel
  const [shotDistance, setShotDistance] = useState("all");

  // Metriek voor het kansenverloop-paneel
  const [timelineMetric, setTimelineMetric] = useState("chances");

  // Toon alle spelers in "Schotkeuze per speler" (standaard max 10)
  const [showAllShotPlayers, setShowAllShotPlayers] = useState(false);

  // Bars laten groeien vanaf breedte 0 zodra het paneel mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Laad clubId van de ingelogde gebruiker zodat statistieken per club gefilterd kunnen worden
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
        console.error("[Statistics] Fout bij laden clubId:", e);
        setUserClubId("");
      }
    }

    loadUserClub();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const allSeasons = useMemo(() => {
    return (teams || []).flatMap((t) =>
      (t.seasons || []).map((s) => ({ ...s, teamId: t.id, teamName: t.name }))
    );
  }, [teams]);

  const matchesForClub = useMemo(() => {
    if (!userClubId) return matches;
    return matches.filter((m) => !m.clubId || m.clubId === userClubId);
  }, [matches, userClubId]);

  const matchesForSeason = useMemo(() => {
    if (selectedSeason === "all") return matchesForClub;
    return matchesForClub.filter((m) => m.seasonId === selectedSeason || m.seasonName === selectedSeason);
  }, [matchesForClub, selectedSeason]);

  // Nieuwste wedstrijd eerst; wedstrijden zonder datum onderaan
  const sortedMatchesForSeason = useMemo(() => {
    return [...matchesForSeason].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [matchesForSeason]);

  // Alleen wedstrijden van het geselecteerde team (thuis of uit)
  const matchesForSelectedTeam = useMemo(() => {
    if (selectedTeam === "all") return sortedMatchesForSeason;
    return sortedMatchesForSeason.filter((m) => {
      const homeName = teams.find((t) => t.id === m.homeTeamId)?.name || m.homeTeamId;
      const awayName = teams.find((t) => t.id === m.awayTeamId)?.name || m.awayTeamId;
      return homeName === selectedTeam || awayName === selectedTeam;
    });
  }, [sortedMatchesForSeason, selectedTeam, teams]);

  const subsForSeason = useMemo(() => {
    if (!matchesForSeason.length) return [];
    const matchIds = new Set(matchesForSeason.map((m) => m.id));
    return substitutions.filter((s) => matchIds.has(s.matchId));
  }, [substitutions, matchesForSeason]);

  const clipsForClub = useMemo(() => {
    if (!userClubId) return clips;
    return clips.filter((c) => !c.clubId || c.clubId === userClubId);
  }, [clips, userClubId]);

  const clipsForSeason = useMemo(() => {
    const seasonMatchIds = selectedSeason === "all" ? null : new Set(matchesForSeason.map((m) => m.id));
    return clipsForClub.filter((c) => {
      if (!seasonMatchIds) return true;
      return seasonMatchIds.has(c.matchId);
    });
  }, [clipsForClub, matchesForSeason, selectedSeason]);

  const enriched = useMemo(() => {
    // Gebruik clips binnen de club en het geselecteerde seizoen.
    return clipsForSeason.map(c => {
      const match = matchesForSeason.find(m => m.id === c.matchId) || {};
      const home = teams.find(t => t.id === match.homeTeamId);
      const away = teams.find(t => t.id === match.awayTeamId);
      const allTeamsWithPlayers = teams || [];

      // Zoek speler en bijbehorend team op basis van playerId
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

      const datePart = formatMatchDate(match.date);
      const homeName = home?.name || match.homeTeamId || "Onbekend";
      const awayName = away?.name || match.awayTeamId || "Onbekend";

      return {
        ...c,
        // Team gebaseerd op de speler; als dat onbekend is, val terug op home/away
        team: playerTeamName || homeName || awayName || "Onbekend",
        player: player?.name || "Onbekend",
        matchName: `${datePart} — ${homeName} vs ${awayName}`,
      };
    });
  }, [clipsForSeason, teams, matchesForSeason]);

  const enrichedById = useMemo(() => {
    const map = {};
    enriched.forEach((c) => {
      if (c.id) map[c.id] = c;
    });
    return map;
  }, [enriched]);

  const filtered = useMemo(() => {
    return enriched.filter(c => {
      if (c.actionType === "sequence_moment") return false;
      if (selectedTeam !== "all" && c.team !== selectedTeam) return false;
      if (selectedPlayer !== "all" && c.player !== selectedPlayer) return false;
      if (selectedZone !== "all" && c.zone !== selectedZone) return false;
      if (selectedAction !== "all" && c.actionType !== selectedAction) return false;
      if (selectedHalf !== "all" && String(c.half) !== selectedHalf) return false;
      if (selectedResult !== "all" && c.result !== selectedResult) return false;
      if (selectedMatch !== "all" && c.matchId !== selectedMatch) return false;
      return true;
    });
  }, [enriched, selectedTeam, selectedPlayer, selectedZone, selectedAction, selectedHalf, selectedResult, selectedMatch]);

  // Clips die daadwerkelijk voor de hoofdstatistieken gebruikt worden,
  // afhankelijk van de gekozen modus (voor: eigen, tegen: opponent-clips)
  const statsClips = useMemo(() => {
    if (statsMode === "against") {
      // Tegenmodus: alle tegengoal-clips, ook oudere varianten
      return filtered.filter((c) => {
        const isOppFlag = !!c.opponentGoal;
        const isOppResult = c.result === "opp_goal";
        const isOppAction = typeof c.actionType === "string" && c.actionType.startsWith("tegen_");
        return isOppFlag || isOppResult || isOppAction;
      });
    }

    // Standaard: eigen acties, dus opponent-clips uitsluiten
    return filtered.filter((c) => {
      const isOppFlag = !!c.opponentGoal;
      const isOppResult = c.result === "opp_goal";
      const isOppAction = typeof c.actionType === "string" && c.actionType.startsWith("tegen_");
      return !(isOppFlag || isOppResult || isOppAction);
    });
  }, [filtered, statsMode]);

  const playerStats = useMemo(() => {
    const isShot = (c) => typeof c.actionType === "string" && (
      c.actionType.startsWith("schot") ||
      c.actionType.startsWith("tegen_schot") ||
      c.actionType === "schot" ||
      c.actionType === "tegen_schot"
    );
    const isChanceAction = (c) => [
      "doorloopbal",
      "kleine_kans",
      "strafworp",
      "vrije_bal",
      "tegen_doorloopbal",
      "tegen_kleine_kans",
      "tegen_strafworp",
      "tegen_vrije_bal",
    ].includes(c.actionType);
    const isGoal = (c) => c.result === "goal" || c.result === "opp_goal";
    const isMiss = (c) => c.result === "miss" || c.result === "opp_miss";

    const shots = statsClips.filter(isShot);
    const goals = shots.filter(isGoal);
    const misses = shots.filter(isMiss);

    const chanceShots = statsClips.filter(isChanceAction);
    const chanceGoals = chanceShots.filter(isGoal);

    const totalCombinedAttempts = shots.length + chanceShots.length;
    const totalCombinedGoals = goals.length + chanceGoals.length;

    const countByType = (actions) => {
      const list = statsClips.filter((c) => actions.includes(c.actionType));
      const goalsType = list.filter(isGoal);
      const missesType = list.filter(isMiss);
      return {
        attempts: list.length,
        goals: goalsType.length,
        misses: missesType.length,
        fg: list.length ? Math.round((goalsType.length / list.length) * 100) : 0,
      };
    };

    const schot3m = countByType(["schot_3m", "tegen_schot_3m"]);
    const schot6m = countByType(["schot_6m", "tegen_schot_6m"]);
    const schot9m = countByType(["schot_9m", "tegen_schot_9m"]);
    const doorloop = countByType(["doorloopbal", "tegen_doorloopbal"]);
    const kleine = countByType(["kleine_kans", "tegen_kleine_kans"]);
    const vrijeBal = countByType(["vrije_bal", "tegen_vrije_bal"]);
    const strafworp = countByType(["strafworp", "tegen_strafworp"]);

    const reboundsAttackWin = statsClips.filter(c => c.actionType === "rebound_win").length;
    const reboundsAttackLose = statsClips.filter(c => c.actionType === "rebound_lose").length;
    const totalReboundsAttack = reboundsAttackWin + reboundsAttackLose;

    const reboundsDefenseWin = statsClips.filter(c => ["rebound_verdediging", "rebound_def_win"].includes(c.actionType)).length;
    const reboundsDefenseLose = statsClips.filter(c => c.actionType === "rebound_def_lose").length;
    const totalReboundsDefense = reboundsDefenseWin + reboundsDefenseLose;

    return {
      totalShots: shots.length,
      goals: goals.length,
      misses: misses.length,
      fg: shots.length ? Math.round((goals.length / shots.length) * 100) : 0,
      missPct: shots.length ? Math.round((misses.length / shots.length) * 100) : 0,
      chanceAttempts: chanceShots.length,
      chanceGoals: chanceGoals.length,
      chanceFg: chanceShots.length ? Math.round((chanceGoals.length / chanceShots.length) * 100) : 0,
      totalCombinedAttempts,
      totalCombinedGoals,
      totalCombinedFg: totalCombinedAttempts
        ? Math.round((totalCombinedGoals / totalCombinedAttempts) * 100)
        : 0,
      assists: statsClips.filter(c => c.actionType === "assist").length,
      turnovers: statsClips.filter(c => c.actionType === "balverlies").length,
      fouls: statsClips.filter(c => c.actionType === "overtreding").length,
      defensiveDeflections: statsClips.filter(c => c.actionType === "verdedigd").length,
      interceptions: statsClips.filter(c => ["onderschepping","overname"].includes(c.actionType)).length,
      schot3m,
      schot6m,
      schot9m,
      doorloop,
      kleine,
      vrijeBal,
      strafworp,
      reboundsAttack: reboundsAttackWin,
      reboundsDefense: reboundsDefenseWin,
      reboundsAttackTotal: totalReboundsAttack,
      reboundsDefenseTotal: totalReboundsDefense,
      totalRebounds: totalReboundsAttack + totalReboundsDefense,
      reboundAttackPct: totalReboundsAttack ? Math.round((reboundsAttackWin / totalReboundsAttack) * 100) : 0,
      reboundDefensePct: totalReboundsDefense ? Math.round((reboundsDefenseWin / totalReboundsDefense) * 100) : 0,
    };
  }, [statsClips]);

  // Schot-clips voor het schoten-per-zone paneel (volgt hoofdfilters + Voor/Tegen)
  const shotClips = useMemo(() => {
    return statsClips.filter((c) => {
      if (typeof c.actionType !== "string") return false;
      const isShot = c.actionType.startsWith("schot") || c.actionType.startsWith("tegen_schot");
      if (!isShot) return false;
      if (shotDistance !== "all" && c.actionType !== shotDistance && c.actionType !== `tegen_${shotDistance}`) return false;
      return true;
    });
  }, [statsClips, shotDistance]);

  const zoneShotStats = useMemo(() => {
    const stats = {};
    ZONE_GRID.flat().forEach((z) => {
      stats[z] = { attempts: 0, goals: 0, misses: 0, fg: 0 };
    });

    shotClips.forEach((c) => {
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

      if (c.result === "goal" || c.result === "opp_goal") {
        stats[zone].attempts += 1;
        stats[zone].goals += 1;
      } else if (c.result === "miss" || c.result === "opp_miss") {
        stats[zone].attempts += 1;
        stats[zone].misses += 1;
      }
    });

    ZONE_GRID.flat().forEach((z) => {
      const s = stats[z];
      s.fg = s.attempts ? Math.round((s.goals / s.attempts) * 100) : 0;
    });

    return stats;
  }, [shotClips]);

  const zoneOverlay = ZONE_GRID.flatMap((row, r) =>
    row.map((zone, c) => ({ zone, row: r, col: c, ...zoneShotStats[zone] }))
  );

  // Kansenverloop: cumulatieve kansen/doelpunten over de wedstrijdtijd.
  // Alleen afhankelijk van wedstrijd/seizoen/team-scope, niet van Voor/Tegen of de overige filters.
  const timeline = useMemo(() => {
    const scopeMatchIds =
      selectedMatch !== "all"
        ? null
        : new Set(matchesForSelectedTeam.map((m) => m.id));

    const base = enriched.filter((c) => {
      if (c.actionType === "sequence_moment") return false;
      if (scopeMatchIds) return scopeMatchIds.has(c.matchId);
      return c.matchId === selectedMatch;
    });

    const events = [];
    base.forEach((c) => {
      const opp = isOppClip(c);
      const ownChance = !opp && isChanceAction(c);
      if (!opp && !ownChance) return;
      const goal = opp
        ? c.result === "opp_goal" || c.result === "goal"
        : c.result === "goal";
      const x = clipMinute(c);
      events.push({ opp, goal, x });
    });

    const matchIds = new Set(base.map((c) => c.matchId).filter(Boolean));
    const n = Math.max(1, matchIds.size);
    const averaged = selectedMatch === "all" && n > 1;
    const divisor = averaged ? n : 1;
    const useGoals = timelineMetric === "goals";
    const round1 = (v) => Math.round(v * 10) / 10;

    const data = [];
    // Elke 15 seconden een meetpunt voor een gedetailleerd verloop
    for (let i = 0; i <= 200; i++) {
      const m = i / 4;
      let own = 0;
      let opp = 0;
      for (const e of events) {
        if (e.x > m) continue;
        if (useGoals && !e.goal) continue;
        if (e.opp) opp += 1;
        else own += 1;
      }
      data.push({ minute: m, own: round1(own / divisor), opp: round1(opp / divisor) });
    }

    // Lijnnamen: bij één geselecteerde wedstrijd de teamnamen gebruiken
    let ownName = "Eigen team";
    let oppName = "Tegenstander";
    if (selectedMatch !== "all") {
      const match = matches.find((m) => m.id === selectedMatch);
      if (match) {
        const homeName = teams.find((t) => t.id === match.homeTeamId)?.name || match.homeTeamId;
        const awayName = teams.find((t) => t.id === match.awayTeamId)?.name || match.awayTeamId;
        if (selectedTeam !== "all") {
          ownName = selectedTeam;
          oppName = homeName === selectedTeam ? awayName : homeName;
        } else {
          const counts = {};
          base.forEach((c) => {
            if (isOppClip(c) || !c.team) return;
            counts[c.team] = (counts[c.team] || 0) + 1;
          });
          const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
          if (top && top[0] && top[0] !== "Onbekend") {
            ownName = top[0];
            oppName = homeName === ownName ? awayName : homeName;
          }
        }
      }
    }

    return {
      data,
      ownName,
      oppName,
      n,
      averaged,
      hasEvents: events.length > 0,
    };
  }, [enriched, selectedMatch, matchesForSelectedTeam, teams, matches, timelineMetric, selectedTeam]);

  // Verdeling van eigen schoten per afstand per speler (volgt de hoofdfilters)
  const shotChoice = useMemo(() => {
    const byPlayer = {};
    filtered.forEach((c) => {
      if (isOppClip(c)) return;
      if (typeof c.actionType !== "string" || !c.actionType.startsWith("schot")) return;
      const name = c.player;
      if (!name || name === "Onbekend") return;

      const bucket =
        c.actionType === "schot_3m" ? "schot_3m"
        : c.actionType === "schot_6m" ? "schot_6m"
        : c.actionType === "schot_9m" ? "schot_9m"
        : "other";

      if (!byPlayer[name]) {
        byPlayer[name] = {
          player: name,
          buckets: {
            schot_3m: { attempts: 0, goals: 0 },
            schot_6m: { attempts: 0, goals: 0 },
            schot_9m: { attempts: 0, goals: 0 },
            other: { attempts: 0, goals: 0 },
          },
          total: 0,
          totalGoals: 0,
        };
      }
      const p = byPlayer[name];
      p.buckets[bucket].attempts += 1;
      p.total += 1;
      if (c.result === "goal") {
        p.buckets[bucket].goals += 1;
        p.totalGoals += 1;
      }
    });

    return Object.values(byPlayer)
      .map((p) => {
        const share3 = p.total ? p.buckets.schot_3m.attempts / p.total : 0;
        const share9 = p.total ? p.buckets.schot_9m.attempts / p.total : 0;
        let profile = "—";
        if (p.total >= 5) {
          if (share3 >= 0.6) profile = "Dichtbij-scorer";
          else if (share9 >= 0.4) profile = "Afstandschutter";
          else profile = "Allround";
        }
        return { ...p, profile };
      })
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  // Langste doelpunt-droogtes en beste reeksen (zelfde scope als het kansenverloop)
  const teamStreaks = useMemo(() => {
    const scopeMatchIds =
      selectedMatch !== "all"
        ? new Set([selectedMatch])
        : new Set(matchesForSelectedTeam.map((m) => m.id));

    const base = enriched.filter(
      (c) => c.actionType !== "sequence_moment" && scopeMatchIds.has(c.matchId)
    );

    const clipsByMatch = {};
    base.forEach((c) => {
      if (!c.matchId) return;
      if (!clipsByMatch[c.matchId]) clipsByMatch[c.matchId] = [];
      clipsByMatch[c.matchId].push(c);
    });

    // Bepaalt welk team "wij" zijn in deze wedstrijd (zoals de lijnnamen in timeline)
    function ownSideName(match, matchClips) {
      const homeName =
        teams.find((t) => t.id === match.homeTeamId)?.name || match.homeTeamId;
      const awayName =
        teams.find((t) => t.id === match.awayTeamId)?.name || match.awayTeamId;
      if (selectedTeam !== "all") {
        return {
          own: selectedTeam,
          opp: homeName === selectedTeam ? awayName : homeName,
        };
      }
      const counts = {};
      matchClips.forEach((c) => {
        if (isOppClip(c) || !c.team) return;
        counts[c.team] = (counts[c.team] || 0) + 1;
      });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      const own = top && top[0] && top[0] !== "Onbekend" ? top[0] : homeName;
      return { own, opp: homeName === own ? awayName : homeName };
    }

    let droogteEigen = null;
    let droogteTegen = null;
    let runEigen = null;
    let runTegen = null;

    Object.entries(clipsByMatch).forEach(([matchId, list]) => {
      const match = matches.find((m) => m.id === matchId);
      if (!match) return;
      const sides = ownSideName(match, list);
      const matchLabel = `${formatMatchDate(match.date)} vs ${sides.opp}`;

      const ownGoals = list
        .filter((c) => !isOppClip(c) && isChanceAction(c) && c.result === "goal")
        .map(clipMinute)
        .sort((a, b) => a - b);
      const oppGoals = list
        .filter(
          (c) =>
            isOppClip(c) &&
            (c.result === "opp_goal" || c.result === "goal")
        )
        .map(clipMinute)
        .sort((a, b) => a - b);

      // Langste droogte: grootste gat tussen opeenvolgende doelpunten (incl. 0 en 50)
      function longestDrought(goals) {
        const pts = [0, ...goals, 50];
        let best = null;
        for (let i = 1; i < pts.length; i++) {
          const dur = pts[i] - pts[i - 1];
          if (!best || dur > best.duration) {
            best = { duration: dur, from: pts[i - 1], to: pts[i], matchId, matchLabel };
          }
        }
        return best;
      }

      // Alleen meetellen als die kant in deze wedstrijd ook getagd is
      const hasOwnTags = list.some((c) => !isOppClip(c) && isChanceAction(c));
      const hasOppTags = list.some((c) => isOppClip(c));
      const dOwn = hasOwnTags ? longestDrought(ownGoals) : null;
      if (dOwn && (!droogteEigen || dOwn.duration > droogteEigen.duration)) droogteEigen = dOwn;
      const dOpp = hasOppTags ? longestDrought(oppGoals) : null;
      if (dOpp && (!droogteTegen || dOpp.duration > droogteTegen.duration)) droogteTegen = dOpp;

      // Beste run: langste reeks doelpunten zonder tegendoelpunt ertussen
      const merged = [
        ...ownGoals.map((t) => ({ t, own: true })),
        ...oppGoals.map((t) => ({ t, own: false })),
      ].sort((a, b) => a.t - b.t);

      let curOwn = null;
      let curOpp = null;
      merged.forEach((e) => {
        if (e.own) {
          curOpp = null;
          if (!curOwn) curOwn = { n: 0, from: e.t, to: e.t, matchId, matchLabel };
          curOwn.n += 1;
          curOwn.to = e.t;
          if (!runEigen || curOwn.n > runEigen.n) runEigen = { ...curOwn };
        } else {
          curOwn = null;
          if (!curOpp) curOpp = { n: 0, from: e.t, to: e.t, matchId, matchLabel };
          curOpp.n += 1;
          curOpp.to = e.t;
          if (!runTegen || curOpp.n > runTegen.n) runTegen = { ...curOpp };
        }
      });
    });

    return { droogteEigen, droogteTegen, runEigen, runTegen, hasData: base.length > 0 };
  }, [enriched, selectedMatch, matchesForSelectedTeam, matches, teams, selectedTeam]);

  // Raak/mis-reeksen per speler op basis van eigen schoten (chronologisch)
  const playerStreaks = useMemo(() => {
    const dateOf = (c) => matches.find((m) => m.id === c.matchId)?.date || "";

    const shots = filtered
      .filter(
        (c) =>
          !isOppClip(c) &&
          typeof c.actionType === "string" &&
          c.actionType.startsWith("schot") &&
          c.player &&
          c.player !== "Onbekend"
      )
      .sort((a, b) => {
        const d = dateOf(a).localeCompare(dateOf(b));
        if (d !== 0) return d;
        return clipMinute(a) - clipMinute(b);
      });

    const byPlayer = {};
    shots.forEach((c) => {
      const name = c.player;
      if (!byPlayer[name]) {
        byPlayer[name] = { player: name, shots: 0, hit: 0, miss: 0, cur: null };
      }
      const p = byPlayer[name];
      p.shots += 1;
      const type = c.result === "goal" ? "goal" : c.result === "miss" ? "miss" : null;
      if (!type) return;
      if (!p.cur || p.cur.type !== type) p.cur = { type, n: 0 };
      p.cur.n += 1;
      if (type === "goal" && p.cur.n > p.hit) p.hit = p.cur.n;
      if (type === "miss" && p.cur.n > p.miss) p.miss = p.cur.n;
    });

    return Object.values(byPlayer)
      .filter((p) => p.shots >= 3)
      .sort((a, b) => b.hit - a.hit || b.shots - a.shots)
      .slice(0, 8);
  }, [filtered, matches]);

  const playersForTeamName = (name) =>
    [...new Set(
      teams
        .filter((t) => name === "all" || t.name === name)
        .flatMap((t) => [...(t.players || []), ...(t.subs || [])])
        .map((p) => p.name)
    )];
  const allPlayers = playersForTeamName(selectedTeam);
  const allTeams = [...new Set(teams.map(t => t.name))];

  // Per-speler statistieken op basis van de huidige filters
  const perPlayerStats = useMemo(() => {
    const teamFilter = selectedTeam !== "all" ? selectedTeam : null;

    const base = filtered.filter((c) => {
      const hasPlayer = c.player && c.player !== "Onbekend";
      if (!hasPlayer) return false;
      if (teamFilter && c.team !== teamFilter) return false;
      return true;
    });

    const byPlayer = {};

    const ensure = (name) => {
      const key = name || "Onbekend";
      if (!byPlayer[key]) {
        byPlayer[key] = {
          player: key,
          shotAttempts: 0,
          shotGoals: 0,
          chanceAttempts: 0,
          chanceGoals: 0,
          rebAttack: 0,
          rebDefense: 0,
          turnovers: 0,
          interceptions: 0,
          fouls: 0,
          switches: 0,
        };
      }
      return byPlayer[key];
    };

    base.forEach((c) => {
      const row = ensure(c.player || "Onbekend");

      // Schoten
      if (typeof c.actionType === "string" && (c.actionType.startsWith("schot") || c.actionType === "schot")) {
        row.shotAttempts += 1;
        if (c.result === "goal") row.shotGoals += 1;
      }

      // Kansen
      if (["doorloopbal", "kleine_kans", "strafworp", "vrije_bal"].includes(c.actionType)) {
        row.chanceAttempts += 1;
        if (c.result === "goal") row.chanceGoals += 1;
      }

      // Rebounds
      if (c.actionType === "rebound_win") row.rebAttack += 1;
      if (["rebound_verdediging", "rebound_def_win"].includes(c.actionType)) row.rebDefense += 1;

      // Balverlies
      if (c.actionType === "balverlies") row.turnovers += 1;

      // Ondersch./overname
      if (["onderschepping", "overname"].includes(c.actionType)) row.interceptions += 1;

      // Overtredingen
      if (c.actionType === "overtreding") row.fouls += 1;
    });

    // Wisselmomenten per speler (als uit of in), met dezelfde filters voor club/team/match/helft/speler
    const teamFilterName = teamFilter;
    const playerFilter = selectedPlayer !== "all" ? selectedPlayer : null;
    const halfFilter = selectedHalf !== "all" ? selectedHalf : null;
    const matchFilterId = selectedMatch !== "all" ? selectedMatch : null;

    // Helper om van playerId naar { name, teamName } te gaan
    const playerMetaById = new Map();
    teams.forEach((t) => {
      const all = [...(t.players || []), ...(t.subs || [])];
      all.forEach((p) => {
        if (!p?.id) return;
        playerMetaById.set(p.id, { name: p.name || "Onbekend", teamName: t.name || null });
      });
    });

    subsForSeason.forEach((s) => {
      if (matchFilterId && s.matchId !== matchFilterId) return;
      if (halfFilter && String(s.half || "") !== halfFilter) return;

      ["outPlayer", "inPlayer"].forEach((field) => {
        const pid = s[field];
        if (!pid) return;
        const meta = playerMetaById.get(pid);
        if (!meta) return;

        if (teamFilterName && meta.teamName && meta.teamName !== teamFilterName) return;
        if (playerFilter && meta.name !== playerFilter) return;

        const row = ensure(meta.name || "Onbekend");
        row.switches += 1;
      });
    });

    const rows = Object.values(byPlayer).sort((a, b) => a.player.localeCompare(b.player));

    const total = rows.reduce(
      (acc, r) => ({
        player: "Totaal",
        shotAttempts: acc.shotAttempts + r.shotAttempts,
        shotGoals: acc.shotGoals + r.shotGoals,
        chanceAttempts: acc.chanceAttempts + r.chanceAttempts,
        chanceGoals: acc.chanceGoals + r.chanceGoals,
        rebAttack: acc.rebAttack + r.rebAttack,
        rebDefense: acc.rebDefense + r.rebDefense,
        turnovers: acc.turnovers + r.turnovers,
        interceptions: acc.interceptions + r.interceptions,
        fouls: acc.fouls + r.fouls,
        switches: acc.switches + (r.switches || 0),
      }),
      {
        player: "Totaal",
        shotAttempts: 0,
        shotGoals: 0,
        chanceAttempts: 0,
        chanceGoals: 0,
        rebAttack: 0,
        rebDefense: 0,
        turnovers: 0,
        interceptions: 0,
        fouls: 0,
        switches: 0,
      }
    );

    return { rows, total };
  }, [filtered, selectedTeam, subsForSeason, teams, matchesForSeason, selectedPlayer, selectedHalf, selectedMatch]);

  // Hulp: zoek stats voor een specifieke spelernaam binnen de perPlayerStats.rows
  const compareRows = useMemo(() => {
    const rows = perPlayerStats.rows || [];
    const findRow = (name) => rows.find((r) => r.player === name) || null;
    return {
      a: comparePlayerA ? findRow(comparePlayerA) : null,
      b: comparePlayerB ? findRow(comparePlayerB) : null,
      c: showCompareC && comparePlayerC ? findRow(comparePlayerC) : null,
    };
  }, [perPlayerStats, comparePlayerA, comparePlayerB, comparePlayerC, showCompareC]);

  // Per-wedstrijd statistieken (gebaseerd op dezelfde gefilterde clips)
  const perMatchStats = useMemo(() => {
    const byMatch = {};

    const ensure = (name) => {
      const key = name || "Onbekende wedstrijd";
      if (!byMatch[key]) {
        byMatch[key] = {
          matchName: key,
          shotAttempts: 0,
          shotGoals: 0,
          chanceAttempts: 0,
          chanceGoals: 0,
          rebAttack: 0,
          rebDefense: 0,
          turnovers: 0,
          interceptions: 0,
          fouls: 0,
        };
      }
      return byMatch[key];
    };

    statsClips.forEach((c) => {
      const row = ensure(c.matchName || "Onbekende wedstrijd");

      // Schoten
      if (typeof c.actionType === "string" && (c.actionType.startsWith("schot") || c.actionType === "schot")) {
        row.shotAttempts += 1;
        if (c.result === "goal") row.shotGoals += 1;
      }

      // Overige kansen
      if (["doorloopbal", "kleine_kans", "strafworp", "vrije_bal"].includes(c.actionType)) {
        row.chanceAttempts += 1;
        if (c.result === "goal") row.chanceGoals += 1;
      }

      // Rebounds
      if (c.actionType === "rebound_win") row.rebAttack += 1;
      if (["rebound_verdediging", "rebound_def_win"].includes(c.actionType)) row.rebDefense += 1;

      // Balverlies
      if (c.actionType === "balverlies") row.turnovers += 1;

      // Ondersch./overname
      if (["onderschepping", "overname"].includes(c.actionType)) row.interceptions += 1;

      // Overtredingen
      if (c.actionType === "overtreding") row.fouls += 1;
    });

    return byMatch;
  }, [statsClips]);

  const compareMatches = useMemo(() => {
    const a = compareMatchA ? perMatchStats[compareMatchA] || null : null;
    const b = compareMatchB ? perMatchStats[compareMatchB] || null : null;
    const c = showCompareMatchC && compareMatchC ? perMatchStats[compareMatchC] || null : null;
    return { a, b, c };
  }, [perMatchStats, compareMatchA, compareMatchB, compareMatchC, showCompareMatchC]);

  const fieldHeatmapPoints = useMemo(() => {
    if (!shotClips.length) return [];

    // fallback posities per zone (ZONE_GRID: y=0 is boven)
    const zoneCenters = ZONE_GRID.reduce((acc, row, r) => {
      row.forEach((z, c) => {
        acc[z] = {
          x: (c + 0.5) / 3,
          y: (r + 0.5) / 3,
        };
      });
      return acc;
    }, {});

    return shotClips.map((c) => {
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
  }, [shotClips]);

  const sequenceOptions = useMemo(
    () => clipSequences.map((s) => ({ id: s.id, name: s.name || "(naamloos)", matchId: s.matchId })),
    [clipSequences]
  );

  const currentSequenceMatch = useMemo(() => {
    if (!selectedSequenceId) return null;
    const meta = sequenceOptions.find((s) => s.id === selectedSequenceId);
    if (!meta) return null;
    return matches.find((m) => m.id === meta.matchId) || null;
  }, [selectedSequenceId, sequenceOptions, matches]);

  const sequenceClips = useMemo(() => {
    if (!selectedSequenceId) return [];
    const list = clips.filter((c) => c.sequenceId === selectedSequenceId);
    return [...list].sort((a, b) => {
      const ha = a.half || 1;
      const hb = b.half || 1;
      if (ha !== hb) return ha - hb;
      return (a.time || 0) - (b.time || 0);
    });
  }, [clips, selectedSequenceId]);

  const currentSeqClip = sequenceClips[playlistIndex] || null;

  function playCurrentSeqClip() {
    if (!videoRef.current || !currentSeqClip) return;
    const start = Math.max(0, (currentSeqClip.time || 0) - 4);
    videoRef.current.currentTime = start;
    videoRef.current.play();
  }

  function goToNextClip() {
    if (!sequenceClips.length) return;
    setPlaylistIndex((idx) => {
      const next = Math.min(sequenceClips.length - 1, idx + 1);
      return next;
    });
  }

  function goToPrevClip() {
    if (!sequenceClips.length) return;
    setPlaylistIndex((idx) => Math.max(0, idx - 1));
  }

  return (
    <div className="p-6 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <h2 className="text-2xl font-semibold">Statistieken</h2>
        <button
          onClick={() => {
            // Exporteer alle gefilterde clips met zo compleet mogelijke info
            const header = [
              "id",
              "match",
              "team",
              "player",
              "actionType",
              "result",
              "half",
              "time_sec",
              "time_mmss",
              "zone",
              "x",
              "y",
              "sequenceId",
              "phase",
              "homeTeamId",
              "awayTeamId",
              "homeScore",
              "awayScore",
              "seasonId",
              "seasonName",
            ];

            const rows = [header].concat(
              filtered.map((c) => [
                c.id || "",
                c.matchName || "",
                c.team || "",
                c.player || "",
                c.actionType || "",
                c.result || "",
                c.half ?? "",
                c.time ?? "",
                fmt(c.time ?? 0),
                c.zone || "",
                typeof c.x === "number" ? c.x.toFixed(3) : "",
                typeof c.y === "number" ? c.y.toFixed(3) : "",
                c.sequenceId || "",
              ])
            );
            const csv = rows.map(r => r.join(",")).join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "stats_export.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="bg-[#FF6124] text-white px-4 py-2 rounded-xl text-sm font-medium self-start sm:self-auto"
        >
          Exporteer CSV
        </button>
      </div>

      <div className="bg-[#FF6124]/10 border border-[#FF6124]/40 p-4 rounded-2xl shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
        <h3 className="text-sm font-semibold text-[#FF6124] mb-3 tracking-wide">Filters</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          <Filter
            label="Team"
            value={selectedTeam}
            setter={(v) => { setSelectedTeam(v); setSelectedMatch("all"); setSelectedPlayer("all"); setSelectedSeason("all"); }}
            options={["all", ...allTeams]}
          />
          <Filter
            label="Wedstrijd"
            value={selectedMatch}
            setter={setSelectedMatch}
            options={[
              "all",
              ...matchesForSelectedTeam.map((m) => {
                const home = teams.find((t) => t.id === m.homeTeamId);
                const away = teams.find((t) => t.id === m.awayTeamId);
                const homeName = home?.name || m.homeTeamId;
                const awayName = away?.name || m.awayTeamId;
                return { value: m.id, label: `${formatMatchDate(m.date)} — ${homeName} vs ${awayName}` };
              }),
            ]}
          />
          <Filter
            label="Seizoen"
            value={selectedSeason}
            setter={(v) => { setSelectedSeason(v); setSelectedMatch("all"); setSelectedPlayer("all"); }}
            options={[
              "all",
              ...(selectedTeam === "all" ? allSeasons : allSeasons.filter((s) => s.teamName === selectedTeam)).map((s) => ({ value: s.id, label: `${s.teamName ? `${s.teamName} · ` : ""}${s.name} · ${s.part === "zaal" ? "Zaal" : s.part === "veld_voorjaar" ? "Veld voorjaar" : "Veld najaar"}` })),
            ]}
          />
          <Filter label="Speler" value={selectedPlayer} setter={setSelectedPlayer} options={["all", ...allPlayers]} />
          <Filter
            label="Actie"
            value={selectedAction}
            setter={setSelectedAction}
            options={["all", ...ACTION_FILTER_OPTIONS.map((a) => ({ value: a, label: formatActionLabel(a) }))]}
          />
          <Filter label="Zone" value={selectedZone} setter={setSelectedZone} options={["all", ...ZONES]} />
          <Filter label="Helft" value={selectedHalf} setter={setSelectedHalf} options={["all", "1", "2"]} />
          <Filter label="Resultaat" value={selectedResult} setter={setSelectedResult} options={RESULT_OPTIONS} />
        </div>
        <div className="mt-4 flex justify-end">
          <div className="inline-flex rounded-2xl border border-neutral-700 bg-neutral-900 overflow-hidden text-sm shadow-sm">
            <button
              type="button"
              onClick={() => setStatsMode("for")}
              className={`px-4 py-2 font-semibold tracking-wide uppercase ${
                statsMode === "for"
                  ? "bg-[#FF6124] text-white"
                  : "text-neutral-200 hover:bg-neutral-800"
              }`}
            >
              Voor
            </button>
            <button
              type="button"
              onClick={() => setStatsMode("against")}
              className={`px-4 py-2 font-semibold tracking-wide uppercase border-l border-neutral-700 ${
                statsMode === "against"
                  ? "bg-[#FF6124] text-white"
                  : "text-neutral-200 hover:bg-neutral-800"
              }`}
            >
              Tegen
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <ShotDistanceCard
          title={statsMode === "for" ? "Schot <3m" : "Tegen Schot <3m"}
          data={playerStats.schot3m}
        />
        <ShotDistanceCard
          title={statsMode === "for" ? "Schot <6m" : "Tegen Schot <6m"}
          data={playerStats.schot6m}
        />
        <ShotDistanceCard
          title={statsMode === "for" ? "Schot <9m" : "Tegen Schot <9m"}
          data={playerStats.schot9m}
        />
        <ShotDistanceCard
          title={statsMode === "for" ? "Totaal schoten" : "Totaal tegenschoten"}
          data={{
            attempts: playerStats.totalShots,
            goals: playerStats.goals,
            misses: playerStats.misses,
            fg: playerStats.fg,
          }}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {statsMode === "for" ? (
          <>
            <StatCard title="Balverlies" value={playerStats.turnovers} />
            <StatCard
              title="Rebound aanval"
              value={`${playerStats.reboundsAttack}/${playerStats.reboundsAttackTotal} (${playerStats.reboundAttackPct}%)`}
            />
            <StatCard
              title="Rebound verdediging"
              value={`${playerStats.reboundsDefense}/${playerStats.reboundsDefenseTotal} (${playerStats.reboundDefensePct}%)`}
            />
            <StatCard title="Onderscheppingen" value={playerStats.interceptions} />
            <StatCard title="Verdedigd" value={playerStats.defensiveDeflections} />
            <StatCard title="Overtredingen" value={playerStats.fouls} />
          </>
        ) : (
          <StatCard title="Totaal acties tegen" value={statsClips.length} />
        )}
      </div>

      {/* Schoten per zone: heatmap + zonekaarten in één paneel */}
      <div className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Schoten per zone</h3>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: "all", label: "Alle" },
              { id: "schot_3m", label: "<3m" },
              { id: "schot_6m", label: "<6m" },
              { id: "schot_9m", label: "<9m" },
            ].map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setShotDistance(d.id)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  shotDistance === d.id
                    ? "bg-[#FF6124] text-white"
                    : "bg-neutral-900 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {d.label}
              </button>
            ))}
            <span className="ml-2 flex items-center gap-3 text-[11px] text-neutral-400">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Raak
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Mis
              </span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3">
            <FieldHeatmap points={fieldHeatmapPoints} maxWidth="max-w-3xl" zoneOverlay={zoneOverlay} />
          </div>

          <div className="lg:col-span-2">
            <div className="grid grid-cols-3 gap-2">
              {ZONE_GRID.flat().map((zone) => {
                const s = zoneShotStats[zone];
                return (
                  <div
                    key={zone}
                    className="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-2.5 text-center"
                  >
                    <div className="text-[11px] text-neutral-400 truncate" title={zone}>
                      {zone}
                    </div>
                    <div className="text-xl font-semibold text-[#FF6124] mt-0.5">
                      {s.attempts ? `${s.fg}%` : "—"}
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      {s.goals}/{s.attempts}
                    </div>
                    <div className="flex items-center justify-center gap-2 text-[11px]">
                      <span className="text-green-400">Raak {s.goals}</span>
                      <span className="text-red-400">Mis {s.misses}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-neutral-950/70 overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full"
                        style={{ width: `${s.attempts ? s.fg : 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Schotkeuze per speler: verdeling van eigen schoten per afstand */}
      <div className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Schotkeuze per speler</h3>
            <p className="text-xs text-neutral-500">
              Verdeling van schoten per afstand (huidige filters)
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-neutral-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#FF6124] inline-block" /> &lt;3m
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#fbbf24] inline-block" /> &lt;6m
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#60a5fa] inline-block" /> &lt;9m
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#737373] inline-block" /> Overig
            </span>
          </div>
        </div>

        {shotChoice.length === 0 ? (
          <div className="text-sm text-neutral-500 py-6 text-center">
            Nog geen schoten voor deze selectie.
          </div>
        ) : (
          <>
            {(showAllShotPlayers ? shotChoice : shotChoice.slice(0, 10)).map((p) => {
              const segments = [
                { key: "schot_3m", label: "<3m", color: "#FF6124" },
                { key: "schot_6m", label: "<6m", color: "#fbbf24" },
                { key: "schot_9m", label: "<9m", color: "#60a5fa" },
                { key: "other", label: "Overig", color: "#737373" },
              ];
              return (
                <div
                  key={p.player}
                  className="grid grid-cols-12 items-center gap-3 py-2 border-b border-neutral-700/40 last:border-0"
                >
                  <div className="col-span-12 sm:col-span-3 flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-white truncate">{p.player}</span>
                    <span className="rounded-md bg-neutral-900 px-1.5 py-0.5 text-[10px] text-neutral-400 whitespace-nowrap">
                      {p.profile}
                    </span>
                  </div>
                  <div className="col-span-12 sm:col-span-6">
                    <div className="h-6 rounded-lg overflow-hidden flex bg-neutral-950/70">
                      {segments.map((s) => {
                        const b = p.buckets[s.key];
                        const share = p.total ? b.attempts / p.total : 0;
                        if (!share) return null;
                        const pct = b.attempts ? Math.round((b.goals / b.attempts) * 100) : 0;
                        return (
                          <div
                            key={s.key}
                            title={`${s.label}: ${b.attempts} schoten, ${b.goals} raak (${pct}%)`}
                            className="h-full flex items-center justify-center transition-[width] duration-700 ease-out"
                            style={{
                              width: `${mounted ? share * 100 : 0}%`,
                              backgroundColor: s.color,
                            }}
                          >
                            {share >= 0.12 && (
                              <span className="text-[11px] font-semibold text-black/80">
                                {b.attempts}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="col-span-12 sm:col-span-3 text-left sm:text-right">
                    <div className="text-xs text-neutral-300">{p.total} schoten</div>
                    <div className="text-[11px] text-neutral-500">
                      {["schot_3m", "schot_6m", "schot_9m"]
                        .map((k, i) => {
                          const b = p.buckets[k];
                          const label = ["<3m", "<6m", "<9m"][i];
                          return `${label} ${b.attempts ? `${Math.round((b.goals / b.attempts) * 100)}%` : "—"}`;
                        })
                        .join(" · ")}
                    </div>
                  </div>
                </div>
              );
            })}
            {shotChoice.length > 10 && (
              <button
                type="button"
                onClick={() => setShowAllShotPlayers((v) => !v)}
                className="text-xs text-[#FF6124] hover:underline mt-1"
              >
                {showAllShotPlayers
                  ? "Toon minder"
                  : `Toon alle spelers (${shotChoice.length})`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Kansenverloop over de wedstrijdtijd */}
      <div className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Kansenverloop</h3>
            <p className="text-xs text-neutral-500">
              {timeline.averaged
                ? `Gemiddeld per wedstrijd (${timeline.n} wedstrijden)`
                : "Cumulatief gedurende de wedstrijd"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[
              { id: "chances", label: "Kansen" },
              { id: "goals", label: "Doelpunten" },
            ].map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setTimelineMetric(d.id)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  timelineMetric === d.id
                    ? "bg-[#FF6124] text-white"
                    : "bg-neutral-900 text-neutral-300 hover:bg-neutral-700"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {timeline.hasEvents ? (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={timeline.data} margin={{ top: 24, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#404040" strokeDasharray="3 3" />
                <XAxis
                  dataKey="minute"
                  type="number"
                  domain={[0, 50]}
                  ticks={[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]}
                  tickFormatter={(v) => (v === 25 ? "25 | 0" : v <= 25 ? v : v - 25)}
                  tick={{ fill: "#a3a3a3", fontSize: 12 }}
                  stroke="#404040"
                />
                <YAxis
                  allowDecimals={timeline.averaged}
                  tick={{ fill: "#a3a3a3", fontSize: 12 }}
                  stroke="#404040"
                  label={{
                    value: timelineMetric === "goals" ? "Doelpunten" : "Kansen",
                    angle: -90,
                    position: "insideLeft",
                    fill: "#a3a3a3",
                    fontSize: 12,
                  }}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#171717", border: "1px solid #404040", color: "#fff" }}
                  labelFormatter={(v) => {
                    const inHalf = v <= 25 ? v : v - 25;
                    const mm = Math.floor(inHalf);
                    const ss = String(Math.round((inHalf - mm) * 60)).padStart(2, "0");
                    return `${v <= 25 ? "1e" : "2e"} helft ${mm}:${ss}`;
                  }}
                />
                <Legend verticalAlign="top" />
                <ReferenceLine
                  x={25}
                  stroke="#e5e5e5"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  label={{ value: "Rust", position: "insideTopRight", offset: 8, fill: "#e5e5e5", fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="own"
                  name={timeline.ownName}
                  stroke="#FF6124"
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="opp"
                  name={timeline.oppName}
                  stroke="#60a5fa"
                  strokeWidth={2.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex text-xs text-neutral-400">
              <div className="flex-1 text-center border-r border-neutral-800">
                1e helft (0–25 min)
              </div>
              <div className="flex-1 text-center">2e helft (0–25 min)</div>
            </div>
          </>
        ) : (
          <div className="text-sm text-neutral-500 py-6 text-center">
            Nog geen tags voor deze selectie.
          </div>
        )}
      </div>

      {/* Reeksen & droogtes: langste periodes zonder doelpunt en beste runs */}
      <div className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Reeksen &amp; droogtes</h3>
          <p className="text-xs text-neutral-500">
            Op basis van wedstrijd/seizoen/team-selectie (los van de overige filters)
          </p>
        </div>

        {!teamStreaks.hasData ? (
          <div className="text-sm text-neutral-500 py-6 text-center">
            Nog geen tags voor deze selectie.
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StreakCard
              label="Langste droogte (eigen)"
              value={
                teamStreaks.droogteEigen
                  ? fmt(teamStreaks.droogteEigen.duration * 60)
                  : "—"
              }
              valueClass="text-red-400"
              sub={teamStreaks.droogteEigen}
              showMatch={selectedMatch === "all"}
            />
            <StreakCard
              label="Langste periode zonder tegengoal"
              value={
                teamStreaks.droogteTegen
                  ? fmt(teamStreaks.droogteTegen.duration * 60)
                  : "—"
              }
              valueClass="text-green-400"
              sub={teamStreaks.droogteTegen}
              showMatch={selectedMatch === "all"}
            />
            <StreakCard
              label="Beste run (eigen)"
              value={teamStreaks.runEigen ? `${teamStreaks.runEigen.n}-0` : "—"}
              valueClass="text-[#FF6124]"
              sub={teamStreaks.runEigen}
              showMatch={selectedMatch === "all"}
            />
            <StreakCard
              label="Beste run tegenstander"
              value={teamStreaks.runTegen ? `0-${teamStreaks.runTegen.n}` : "—"}
              valueClass="text-[#60a5fa]"
              sub={teamStreaks.runTegen}
              showMatch={selectedMatch === "all"}
            />
          </div>
        )}

        {playerStreaks.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500 border-b border-neutral-700/60">
                  <th className="py-2 pr-3">Speler</th>
                  <th className="py-2 pr-3 text-green-400">Langste reeks raak</th>
                  <th className="py-2 pr-3 text-red-400">Langste reeks mis</th>
                  <th className="py-2">Huidige reeks</th>
                </tr>
              </thead>
              <tbody>
                {playerStreaks.map((p) => (
                  <tr key={p.player} className="border-b border-neutral-800 last:border-0">
                    <td className="py-2 pr-3 text-neutral-100 font-medium">{p.player}</td>
                    <td className="py-2 pr-3 text-green-400">{p.hit || "—"}</td>
                    <td className="py-2 pr-3 text-red-400">{p.miss || "—"}</td>
                    <td className="py-2">
                      {p.cur ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                            p.cur.type === "goal"
                              ? "bg-green-500/15 text-green-400"
                              : "bg-red-500/15 text-red-400"
                          }`}
                        >
                          <Flame size={11} />
                          {p.cur.n}× {p.cur.type === "goal" ? "raak" : "mis"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-speler overzichtstabel voor de huidige selectie */}
      <PlayerStatsTable rows={perPlayerStats.rows} total={perPlayerStats.total} />

      {/* Speler A vs Speler B (+ C) vergelijking */}
      <div className="bg-[#FF6124]/10 border border-[#FF6124]/40 rounded-2xl p-4 space-y-3 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
        <h3 className="text-lg font-semibold text-[#FF6124] tracking-wide">Vergelijk spelers</h3>
        <p className="text-xs text-neutral-400">
          Kies twee of drie spelers om hun kernstatistieken naast elkaar te zien. De vergelijking gebruikt dezelfde filters als hierboven (team, wedstrijd, acties, enz.).
        </p>
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
          <div className="flex-1">
            <label className="text-xs text-neutral-400 block mb-1">Speler A</label>
            <select
              value={comparePlayerA}
              onChange={(e) => setComparePlayerA(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded-xl text-sm w-full"
            >
              <option value="">(kies speler)</option>
              {perPlayerStats.rows.map((r) => (
                <option key={r.player} value={r.player}>
                  {r.player}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs text-neutral-400 block mb-1">Speler B</label>
            <select
              value={comparePlayerB}
              onChange={(e) => setComparePlayerB(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded-xl text-sm w-full"
            >
              <option value="">(kies speler)</option>
              {perPlayerStats.rows.map((r) => (
                <option key={r.player} value={r.player}>
                  {r.player}
                </option>
              ))}
            </select>
          </div>
          {showCompareC && (
            <div className="flex-1">
              <label className="text-xs text-neutral-400 block mb-1">Speler C</label>
              <select
                value={comparePlayerC}
                onChange={(e) => setComparePlayerC(e.target.value)}
                className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded-xl text-sm w-full"
              >
                <option value="">(kies speler)</option>
                {perPlayerStats.rows.map((r) => (
                  <option key={r.player} value={r.player}>
                    {r.player}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-end">
            {!showCompareC && (
              <button
                type="button"
                className="mt-5 inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#FF6124] text-white text-lg"
                onClick={() => setShowCompareC(true)}
              >
                +
              </button>
            )}
            {showCompareC && (
              <button
                type="button"
                className="mt-5 inline-flex items-center justify-center w-9 h-9 rounded-full bg-neutral-800 border border-neutral-600 text-neutral-300"
                onClick={() => {
                  setShowCompareC(false);
                  setComparePlayerC("");
                }}
                title="Verwijder Speler C"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {(compareRows.a || compareRows.b) && (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-neutral-400">
                <tr className="border-b border-neutral-800">
                  <th className="text-left py-2 pr-3">KPI</th>
                  <th className="text-center px-3">Speler A{compareRows.a ? ` (${compareRows.a.player})` : ""}</th>
                  <th className="text-center px-3">Speler B{compareRows.b ? ` (${compareRows.b.player})` : ""}</th>
                  {showCompareC && (
                    <th className="text-center px-3">Speler C{compareRows.c ? ` (${compareRows.c.player})` : ""}</th>
                  )}
                </tr>

                {/* Alles samen: schoten + overige kansen */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Totaal kansen (raak/pogingen, FG%)</td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareRows.a;
                      if (!r) return "-";
                      const att = (r.shotAttempts || 0) + (r.chanceAttempts || 0);
                      const goals = (r.shotGoals || 0) + (r.chanceGoals || 0);
                      const pct = att ? Math.round((goals / att) * 100) : 0;
                      return `${goals}/${att} (${pct}%)`;
                    })()}
                  </td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareRows.b;
                      if (!r) return "-";
                      const att = (r.shotAttempts || 0) + (r.chanceAttempts || 0);
                      const goals = (r.shotGoals || 0) + (r.chanceGoals || 0);
                      const pct = att ? Math.round((goals / att) * 100) : 0;
                      return `${goals}/${att} (${pct}%)`;
                    })()}
                  </td>
                  {showCompareC && (
                    <td className="text-center px-3 text-neutral-100">
                      {(() => {
                        const r = compareRows.c;
                        if (!r) return "-";
                        const att = (r.shotAttempts || 0) + (r.chanceAttempts || 0);
                        const goals = (r.shotGoals || 0) + (r.chanceGoals || 0);
                        const pct = att ? Math.round((goals / att) * 100) : 0;
                        return `${goals}/${att} (${pct}%)`;
                      })()}
                    </td>
                  )}
                </tr>
              </thead>
              <tbody>
                {/* Schoten */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Schoten (raak/pogingen, FG%)</td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareRows.a;
                      if (!r) return "-";
                      const att = r.shotAttempts || 0;
                      const goals = r.shotGoals || 0;
                      const pct = att ? Math.round((goals / att) * 100) : 0;
                      return `${goals}/${att} (${pct}%)`;
                    })()}
                  </td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareRows.b;
                      if (!r) return "-";
                      const att = r.shotAttempts || 0;
                      const goals = r.shotGoals || 0;
                      const pct = att ? Math.round((goals / att) * 100) : 0;
                      return `${goals}/${att} (${pct}%)`;
                    })()}
                  </td>
                  {showCompareC && (
                    <td className="text-center px-3 text-neutral-100">
                      {(() => {
                        const r = compareRows.c;
                        if (!r) return "-";
                        const att = r.shotAttempts || 0;
                        const goals = r.shotGoals || 0;
                        const pct = att ? Math.round((goals / att) * 100) : 0;
                        return `${goals}/${att} (${pct}%)`;
                      })()}
                    </td>
                  )}
                </tr>

                {/* Overige kansen */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Overige kansen (raak/pogingen, FG%)</td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareRows.a;
                      if (!r) return "-";
                      const att = r.chanceAttempts || 0;
                      const goals = r.chanceGoals || 0;
                      const pct = att ? Math.round((goals / att) * 100) : 0;
                      return `${goals}/${att} (${pct}%)`;
                    })()}
                  </td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareRows.b;
                      if (!r) return "-";
                      const att = r.chanceAttempts || 0;
                      const goals = r.chanceGoals || 0;
                      const pct = att ? Math.round((goals / att) * 100) : 0;
                      return `${goals}/${att} (${pct}%)`;
                    })()}
                  </td>
                  {showCompareC && (
                    <td className="text-center px-3 text-neutral-100">
                      {(() => {
                        const r = compareRows.c;
                        if (!r) return "-";
                        const att = r.chanceAttempts || 0;
                        const goals = r.chanceGoals || 0;
                        const pct = att ? Math.round((goals / att) * 100) : 0;
                        return `${goals}/${att} (${pct}%)`;
                      })()}
                    </td>
                  )}
                </tr>

                {/* Rebounds */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Rebounds (aanval/verd.)</td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareRows.a;
                      if (!r) return "-";
                      return `${r.rebAttack || 0} / ${r.rebDefense || 0}`;
                    })()}
                  </td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareRows.b;
                      if (!r) return "-";
                      return `${r.rebAttack || 0} / ${r.rebDefense || 0}`;
                    })()}
                  </td>
                  {showCompareC && (
                    <td className="text-center px-3 text-neutral-100">
                      {(() => {
                        const r = compareRows.c;
                        if (!r) return "-";
                        return `${r.rebAttack || 0} / ${r.rebDefense || 0}`;
                      })()}
                    </td>
                  )}
                </tr>

                {/* Balverlies */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Balverlies</td>
                  <td className="text-center px-3 text-neutral-100">{compareRows.a ? compareRows.a.turnovers || 0 : "-"}</td>
                  <td className="text-center px-3 text-neutral-100">{compareRows.b ? compareRows.b.turnovers || 0 : "-"}</td>
                  {showCompareC && (
                    <td className="text-center px-3 text-neutral-100">{compareRows.c ? compareRows.c.turnovers || 0 : "-"}</td>
                  )}
                </tr>

                {/* Ondersch./Overnames */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Ondersch./Overnames</td>
                  <td className="text-center px-3 text-neutral-100">{compareRows.a ? compareRows.a.interceptions || 0 : "-"}</td>
                  <td className="text-center px-3 text-neutral-100">{compareRows.b ? compareRows.b.interceptions || 0 : "-"}</td>
                  {showCompareC && (
                    <td className="text-center px-3 text-neutral-100">{compareRows.c ? compareRows.c.interceptions || 0 : "-"}</td>
                  )}
                </tr>

                {/* Overtredingen */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Overtredingen</td>
                  <td className="text-center px-3 text-neutral-100">{compareRows.a ? compareRows.a.fouls || 0 : "-"}</td>
                  <td className="text-center px-3 text-neutral-100">{compareRows.b ? compareRows.b.fouls || 0 : "-"}</td>
                  {showCompareC && (
                    <td className="text-center px-3 text-neutral-100">{compareRows.c ? compareRows.c.fouls || 0 : "-"}</td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Vergelijk wedstrijden A vs B (+ C) */}
      <div className="bg-[#FF6124]/10 border border-[#FF6124]/40 rounded-2xl p-4 space-y-3 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
        <h3 className="text-lg font-semibold text-[#FF6124] tracking-wide">Vergelijk wedstrijden</h3>
        <p className="text-xs text-neutral-400">
          Kies twee of drie wedstrijden om hun kernstatistieken naast elkaar te zien. De vergelijking gebruikt dezelfde filters als hierboven (team, speler, acties, enz.), maar negeert de "Wedstrijd"-filter.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
          <div className="flex-1">
            <label className="text-xs text-neutral-400 block mb-1">Wedstrijd A</label>
            <select
              value={compareMatchA}
              onChange={(e) => setCompareMatchA(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded-xl text-sm w-full"
            >
              <option value="">(kies wedstrijd)</option>
              {[...new Set(filtered.map((c) => c.matchName).filter(Boolean))].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs text-neutral-400 block mb-1">Wedstrijd B</label>
            <select
              value={compareMatchB}
              onChange={(e) => setCompareMatchB(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded-xl text-sm w-full"
            >
              <option value="">(kies wedstrijd)</option>
              {[...new Set(filtered.map((c) => c.matchName).filter(Boolean))].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          {showCompareMatchC && (
            <div className="flex-1">
              <label className="text-xs text-neutral-400 block mb-1">Wedstrijd C</label>
              <select
                value={compareMatchC}
                onChange={(e) => setCompareMatchC(e.target.value)}
                className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded-xl text-sm w-full"
              >
                <option value="">(kies wedstrijd)</option>
                {[...new Set(filtered.map((c) => c.matchName).filter(Boolean))].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-end">
            {!showCompareMatchC && (
              <button
                type="button"
                className="mt-5 inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#FF6124] text-white text-lg"
                onClick={() => setShowCompareMatchC(true)}
              >
                +
              </button>
            )}
            {showCompareMatchC && (
              <button
                type="button"
                className="mt-5 inline-flex items-center justify-center w-9 h-9 rounded-full bg-neutral-800 border border-neutral-600 text-neutral-300"
                onClick={() => {
                  setShowCompareMatchC(false);
                  setCompareMatchC("");
                }}
                title="Verwijder Wedstrijd C"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {(compareMatches.a || compareMatches.b) && (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="text-neutral-400">
                <tr className="border-b border-neutral-800">
                  <th className="text-left py-2 pr-3">KPI</th>
                  <th className="text-center px-3">Wedstrijd A{compareMatches.a ? ` (${compareMatches.a.matchName})` : ""}</th>
                  <th className="text-center px-3">Wedstrijd B{compareMatches.b ? ` (${compareMatches.b.matchName})` : ""}</th>
                  {showCompareMatchC && (
                    <th className="text-center px-3">Wedstrijd C{compareMatches.c ? ` (${compareMatches.c.matchName})` : ""}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {/* Schoten */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Schoten (raak/pogingen, FG%)</td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareMatches.a;
                      if (!r) return "-";
                      const att = r.shotAttempts || 0;
                      const goals = r.shotGoals || 0;
                      const pct = att ? Math.round((goals / att) * 100) : 0;
                      return `${goals}/${att} (${pct}%)`;
                    })()}
                  </td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareMatches.b;
                      if (!r) return "-";
                      const att = r.shotAttempts || 0;
                      const goals = r.shotGoals || 0;
                      const pct = att ? Math.round((goals / att) * 100) : 0;
                      return `${goals}/${att} (${pct}%)`;
                    })()}
                  </td>
                  {showCompareMatchC && (
                    <td className="text-center px-3 text-neutral-100">
                      {(() => {
                        const r = compareMatches.c;
                        if (!r) return "-";
                        const att = r.shotAttempts || 0;
                        const goals = r.shotGoals || 0;
                        const pct = att ? Math.round((goals / att) * 100) : 0;
                        return `${goals}/${att} (${pct}%)`;
                      })()}
                    </td>
                  )}
                </tr>

                {/* Overige kansen */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Overige kansen (raak/pogingen, FG%)</td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareMatches.a;
                      if (!r) return "-";
                      const att = r.chanceAttempts || 0;
                      const goals = r.chanceGoals || 0;
                      const pct = att ? Math.round((goals / att) * 100) : 0;
                      return `${goals}/${att} (${pct}%)`;
                    })()}
                  </td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareMatches.b;
                      if (!r) return "-";
                      const att = r.chanceAttempts || 0;
                      const goals = r.chanceGoals || 0;
                      const pct = att ? Math.round((goals / att) * 100) : 0;
                      return `${goals}/${att} (${pct}%)`;
                    })()}
                  </td>
                  {showCompareMatchC && (
                    <td className="text-center px-3 text-neutral-100">
                      {(() => {
                        const r = compareMatches.c;
                        if (!r) return "-";
                        const att = r.chanceAttempts || 0;
                        const goals = r.chanceGoals || 0;
                        const pct = att ? Math.round((goals / att) * 100) : 0;
                        return `${goals}/${att} (${pct}%)`;
                      })()}
                    </td>
                  )}
                </tr>

                {/* Rebounds */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Rebounds (aanval/verd.)</td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareMatches.a;
                      if (!r) return "-";
                      return `${r.rebAttack || 0} / ${r.rebDefense || 0}`;
                    })()}
                  </td>
                  <td className="text-center px-3 text-neutral-100">
                    {(() => {
                      const r = compareMatches.b;
                      if (!r) return "-";
                      return `${r.rebAttack || 0} / ${r.rebDefense || 0}`;
                    })()}
                  </td>
                  {showCompareMatchC && (
                    <td className="text-center px-3 text-neutral-100">
                      {(() => {
                        const r = compareMatches.c;
                        if (!r) return "-";
                        return `${r.rebAttack || 0} / ${r.rebDefense || 0}`;
                      })()}
                    </td>
                  )}
                </tr>

                {/* Balverlies */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Balverlies</td>
                  <td className="text-center px-3 text-neutral-100">{compareMatches.a ? compareMatches.a.turnovers || 0 : "-"}</td>
                  <td className="text-center px-3 text-neutral-100">{compareMatches.b ? compareMatches.b.turnovers || 0 : "-"}</td>
                  {showCompareMatchC && (
                    <td className="text-center px-3 text-neutral-100">{compareMatches.c ? compareMatches.c.turnovers || 0 : "-"}</td>
                  )}
                </tr>

                {/* Ondersch./Overnames */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Ondersch./Overnames</td>
                  <td className="text-center px-3 text-neutral-100">{compareMatches.a ? compareMatches.a.interceptions || 0 : "-"}</td>
                  <td className="text-center px-3 text-neutral-100">{compareMatches.b ? compareMatches.b.interceptions || 0 : "-"}</td>
                  {showCompareMatchC && (
                    <td className="text-center px-3 text-neutral-100">{compareMatches.c ? compareMatches.c.interceptions || 0 : "-"}</td>
                  )}
                </tr>

                {/* Overtredingen */}
                <tr className="border-t border-neutral-800">
                  <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">Overtredingen</td>
                  <td className="text-center px-3 text-neutral-100">{compareMatches.a ? compareMatches.a.fouls || 0 : "-"}</td>
                  <td className="text-center px-3 text-neutral-100">{compareMatches.b ? compareMatches.b.fouls || 0 : "-"}</td>
                  {showCompareMatchC && (
                    <td className="text-center px-3 text-neutral-100">{compareMatches.c ? compareMatches.c.fouls || 0 : "-"}</td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

function CompareRow({ label, a, b, render }) {
  return (
    <tr className="border-t border-neutral-800">
      <td className="py-2 pr-3 text-neutral-200 whitespace-nowrap">{label}</td>
      <td className="text-center px-3 text-neutral-100">{render(a)}</td>
      <td className="text-center px-3 text-neutral-100">{render(b)}</td>
    </tr>
  );
}

function Filter({ label, value, setter, options }) {
  const normalized = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : { value: o.value || o, label: o.label || o.value || o }
  );
  return (
    <div>
      <label className="text-xs text-neutral-400 block mb-1">{label}</label>
      <select value={value} onChange={e => setter(e.target.value)}
        className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded-xl text-sm w-full">
        {normalized.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
    </div>
  );
}

function ShotDistanceCard({ title, data, accent }) {
  const attempts = data?.attempts || 0;
  const goals = data?.goals || 0;
  const misses = data?.misses || 0;
  const fg = data?.fg || 0;
  return (
    <div className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-xl p-4">
      <div className="text-neutral-400 text-sm">{title}</div>
      <div className="text-2xl mt-1 font-semibold" style={{ color: accent || "#FF6124" }}>
        {attempts ? `${fg}%` : "—"}
      </div>
      <div className="text-[11px] text-neutral-500">afronding</div>
      <div className="mt-2 text-xs text-neutral-400">{attempts} pogingen</div>
      <div className="mt-1 flex items-center gap-3 text-sm">
        <span className="text-green-400">Raak {goals}</span>
        <span className="text-red-400">Mis {misses}</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-neutral-950/70 overflow-hidden">
        <div className="h-full bg-green-500 rounded-full" style={{ width: `${attempts ? fg : 0}%` }} />
      </div>
    </div>
  );
}

function StreakCard({ label, value, valueClass, sub, showMatch }) {
  return (
    <div className="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-3">
      <div className="text-[11px] text-neutral-400">{label}</div>
      <div className={`text-2xl font-bold mt-0.5 ${valueClass || "text-white"}`}>{value}</div>
      <div className="text-[11px] text-neutral-500 mt-0.5">
        {sub ? `${fmtPeriod(sub.from)} → ${fmtPeriod(sub.to)}` : ""}
      </div>
      {sub && showMatch && (
        <div className="text-[10px] text-neutral-600 truncate">{sub.matchLabel}</div>
      )}
    </div>
  );
}

function StatCard({ title, value, color }) {
  return (
    <div className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-xl p-4 text-center">
      <div className="text-neutral-400 text-sm">{title}</div>
      <div className="text-2xl mt-1 font-semibold" style={{ color: color || "white" }}>{value}</div>
    </div>
  );
}

function PlayerStatsTable({ rows, total }) {
  const allRows = [...rows, total];

  const pct = (made, att) => (att ? Math.round((made / att) * 100) : 0);

  return (
    <div className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 mt-4 overflow-x-auto">
      <h3 className="text-lg font-semibold mb-3">Spelerstatistieken</h3>
      <table className="min-w-full text-xs">
        <thead className="text-neutral-400">
          <tr className="border-b border-neutral-800">
            <th className="text-left py-2 pr-3">Speler</th>
            <th className="text-center px-3">Schoten</th>
            <th className="text-center px-3">Alles samen</th>
            <th className="text-center px-3">Kansen</th>
            <th className="text-center px-3">Reb. aanv.</th>
            <th className="text-center px-3">Reb. verd.</th>
            <th className="text-center px-3">Balverlies</th>
            <th className="text-center px-3">Ondersch./Overn.</th>
            <th className="text-center px-3">Overtredingen</th>
            <th className="text-center px-3">Wissels</th>
          </tr>
        </thead>
        <tbody>
          {allRows.map((r, idx) => {
            const isTotal = r.player === "Totaal";
            const shotPct = pct(r.shotGoals, r.shotAttempts);
            const chancePct = pct(r.chanceGoals, r.chanceAttempts);
            const combinedAttempts = r.combinedAttempts || (r.shotAttempts || 0) + (r.chanceAttempts || 0);
            const combinedGoals = r.combinedGoals || (r.shotGoals || 0) + (r.chanceGoals || 0);
            const combinedPct = pct(combinedGoals, combinedAttempts);

            return (
              <tr
                key={idx}
                className={`${idx !== 0 ? "border-t border-neutral-800" : ""} ${
                  isTotal ? "font-semibold bg-neutral-900/50" : ""
                }`}
              >
                <td className="py-2 pr-3 whitespace-nowrap text-neutral-200">{r.player}</td>

                {/* Schoten */}
                <td className="text-center px-3">
                  {r.shotAttempts ? (
                    <div className="space-y-0.5">
                      <div>
                        <span className="text-green-500">{r.shotGoals}</span>
                        <span className="text-neutral-400"> / {r.shotAttempts}</span>
                      </div>
                      <div className={shotPct >= 50 ? "text-green-500" : "text-red-500"}>
                        {shotPct}%
                      </div>
                    </div>
                  ) : (
                    <span className="text-neutral-500">0 / 0</span>
                  )}
                </td>

                {/* Alles samen (schoten + kansen) */}
                <td className="text-center px-3">
                  {combinedAttempts ? (
                    <div className="space-y-0.5">
                      <div>
                        <span className="text-green-500">{combinedGoals}</span>
                        <span className="text-neutral-400"> / {combinedAttempts}</span>
                      </div>
                      <div className={combinedPct >= 50 ? "text-green-500" : "text-red-500"}>
                        {combinedPct}%
                      </div>
                    </div>
                  ) : (
                    <span className="text-neutral-500">0 / 0</span>
                  )}
                </td>

                {/* Kansen */}
                <td className="text-center px-3">
                  {r.chanceAttempts ? (
                    <div className="space-y-0.5">
                      <div>
                        <span className="text-green-500">{r.chanceGoals}</span>
                        <span className="text-neutral-400"> / {r.chanceAttempts}</span>
                      </div>
                      <div className={chancePct >= 50 ? "text-green-500" : "text-red-500"}>
                        {chancePct}%
                      </div>
                    </div>
                  ) : (
                    <span className="text-neutral-500">0 / 0</span>
                  )}
                </td>

                {/* Rebounds */}
                <td className="text-center px-3 text-neutral-200">{r.rebAttack || 0}</td>
                <td className="text-center px-3 text-neutral-200">{r.rebDefense || 0}</td>

                {/* Balverlies */}
                <td className="text-center px-3 text-red-400">{r.turnovers || 0}</td>

                {/* Ondersch./Overnames */}
                <td className="text-center px-3 text-emerald-400">{r.interceptions || 0}</td>

                {/* Overtredingen */}
                <td className="text-center px-3 text-yellow-400">{r.fouls || 0}</td>

                {/* Wissels */}
                <td className="text-center px-3 text-neutral-200">{r.switches || 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}