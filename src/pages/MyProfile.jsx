import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebaseClient";
import { doc, getDoc, setDoc } from "firebase/firestore";
import {
  Trophy, Target, TrendingUp, Calendar, ThumbsUp, Crosshair, RefreshCw,
  Activity, Flame, MapPin, Clock, BarChart2,
} from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import FieldHeatmap from "../components/FieldHeatmap";
import ClipPlayerModal from "../components/ClipPlayerModal";
import { formatActionLabel } from "./MatchDetail";

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

const isShot = (c) =>
  !isOppClip(c) && typeof c.actionType === "string" && c.actionType.startsWith("schot");

// Positie op de 50-minuten tijdlijn (helft 2 begint op 25)
function clipMinute(c) {
  const half = c.half === 2 ? 2 : 1;
  return (half === 2 ? 25 : 0) + Math.min(25, Math.max(0, (c.time || 0) / 60));
}

const fg = (goals, attempts) => (attempts ? Math.round((goals / attempts) * 100) : 0);

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
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
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

export default function MyProfile() {
  const { teams, matches, clips } = useAppData();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [playerId, setPlayerId] = useState("");
  const [userClubId, setUserClubId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTeamId, setPickerTeamId] = useState("");
  const [selectedSeason, setSelectedSeason] = useState("all");
  const [activeClip, setActiveClip] = useState(null);

  // Bars animeren vanaf breedte 0 zodra de pagina mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Lees gekoppelde speler + club uit het gebruikersprofiel
  useEffect(() => {
    if (!currentUser) {
      setPlayerId("");
      setUserClubId("");
      setLoaded(true);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const snap = await getDoc(doc(db, "users", currentUser.uid));
        if (!cancelled && snap.exists()) {
          const data = snap.data() || {};
          setPlayerId(data.playerId || "");
          setUserClubId(data.clubId || "");
        }
      } catch (e) {
        console.error("[MyProfile] Fout bij laden profiel:", e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // Zoek de speler in alle teams (players + subs)
  const me = useMemo(() => {
    if (!playerId) return null;
    for (const t of teams) {
      const p = [...(t.players || []), ...(t.subs || [])].find((x) => x.id === playerId);
      if (p) return { ...p, teamId: t.id, teamName: t.name || "" };
    }
    return null;
  }, [playerId, teams]);
  const myTeam = me ? teams.find((t) => t.id === me.teamId) || null : null;

  async function linkPlayer(id) {
    if (!currentUser) return;
    try {
      await setDoc(doc(db, "users", currentUser.uid), { playerId: id }, { merge: true });
      setPlayerId(id);
      setPickerOpen(false);
    } catch (e) {
      console.error("[MyProfile] Koppelen mislukt:", e);
    }
  }

  // Seizoenen van het team van de speler
  const seasonOptions = useMemo(
    () =>
      (myTeam?.seasons || []).map((s) => ({
        value: s.id,
        label: `${s.name} · ${
          s.part === "zaal" ? "Zaal" : s.part === "veld_voorjaar" ? "Veld voorjaar" : "Veld najaar"
        }`,
      })),
    [myTeam]
  );

  // Club- en seizoens-scope voor matches en clips
  const scopeMatches = useMemo(() => {
    let list = userClubId ? matches.filter((m) => !m.clubId || m.clubId === userClubId) : matches;
    if (selectedSeason !== "all") {
      list = list.filter((m) => m.seasonId === selectedSeason || m.seasonName === selectedSeason);
    }
    return list;
  }, [matches, userClubId, selectedSeason]);

  const scopeClips = useMemo(() => {
    const ids = new Set(scopeMatches.map((m) => m.id));
    return (userClubId ? clips.filter((c) => !c.clubId || c.clubId === userClubId) : clips).filter(
      (c) => !c.sequenceId && c.actionType !== "sequence_moment" && ids.has(c.matchId)
    );
  }, [clips, userClubId, scopeMatches]);

  const myClips = useMemo(
    () => scopeClips.filter((c) => c.playerId === playerId && !isOppClip(c)),
    [scopeClips, playerId]
  );
  const myShots = useMemo(() => myClips.filter(isShot), [myClips]);

  const teamPlayerIds = useMemo(
    () =>
      myTeam
        ? new Set([...(myTeam.players || []), ...(myTeam.subs || [])].map((p) => p.id))
        : new Set(),
    [myTeam]
  );

  // Eigen schoten van alle spelers van hetzelfde team (vergelijkingsbasis)
  const teamShots = useMemo(
    () => scopeClips.filter((c) => isShot(c) && teamPlayerIds.has(c.playerId)),
    [scopeClips, teamPlayerIds]
  );

  // Wedstrijden waarin ik voorkwam (opstelling, vakken of getagde clips)
  const myMatches = useMemo(() => {
    const clipMatchIds = new Set(myClips.map((c) => c.matchId));
    return scopeMatches
      .filter((m) => {
        if (clipMatchIds.has(m.id)) return true;
        const ids = [
          ...(m.players || []),
          ...(m.subs || []),
          ...((m.vakken && m.vakken.vak1) || []),
          ...((m.vakken && m.vakken.vak2) || []),
        ];
        return ids.includes(playerId);
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [scopeMatches, myClips, playerId]);

  const stats = useMemo(() => {
    const byDistance = {};
    ["schot_3m", "schot_6m", "schot_9m"].forEach((id) => {
      const mine = myShots.filter((c) => c.actionType === id);
      const theirs = teamShots.filter((c) => c.actionType === id);
      byDistance[id] = {
        mine: { attempts: mine.length, goals: mine.filter((c) => c.result === "goal").length },
        team: { attempts: theirs.length, goals: theirs.filter((c) => c.result === "goal").length },
      };
    });
    const goals = myShots.filter((c) => c.result === "goal").length;
    const teamGoals = teamShots.filter((c) => c.result === "goal").length;
    return {
      attempts: myShots.length,
      goals,
      fg: fg(goals, myShots.length),
      teamFg: fg(teamGoals, teamShots.length),
      byDistance,
    };
  }, [myShots, teamShots]);

  // Feitjes: leuke/feitelijke observaties uit de data
  const facts = useMemo(() => {
    const out = [];
    if (!myShots.length) return out;
    const matchOf = (id) => scopeMatches.find((m) => m.id === id);
    const oppName = (m) => {
      if (!m) return "";
      const other =
        myTeam && m.homeTeamId === myTeam.id ? m.awayTeamId
        : myTeam && m.awayTeamId === myTeam.id ? m.homeTeamId
        : m.awayTeamId;
      return formatTeamName(other, teams);
    };

    // Favoriete afstand
    const distEntries = ["schot_3m", "schot_6m", "schot_9m"]
      .map((id, i) => ({ label: ["<3m", "<6m", "<9m"][i], n: myShots.filter((c) => c.actionType === id).length }))
      .sort((a, b) => b.n - a.n);
    if (distEntries[0].n > 0) {
      out.push({
        icon: <Crosshair size={18} />,
        title: `Je schiet het vaakst van ${distEntries[0].label}`,
        detail: `${distEntries[0].n} van ${myShots.length} schoten`,
      });
    }

    // Beste wedstrijd (meeste goals, bij gelijk afronding%)
    const perMatch = {};
    myShots.forEach((c) => {
      if (!perMatch[c.matchId]) perMatch[c.matchId] = { goals: 0, attempts: 0 };
      perMatch[c.matchId].attempts += 1;
      if (c.result === "goal") perMatch[c.matchId].goals += 1;
    });
    const best = Object.entries(perMatch)
      .filter(([, v]) => v.goals >= 1)
      .map(([id, v]) => ({ id, ...v, pct: fg(v.goals, v.attempts) }))
      .sort((a, b) => b.goals - a.goals || b.pct - a.pct)[0];
    if (best) {
      const m = matchOf(best.id);
      out.push({
        icon: <Trophy size={18} />,
        title: "Beste wedstrijd",
        detail: `${formatMatchDate(m?.date)} vs ${oppName(m)}: ${best.goals}/${best.attempts} (${best.pct}%)`,
      });
    }

    // Langste reeks raak (chronologisch op wedstrijddatum + tijd)
    const chrono = [...myShots].sort((a, b) => {
      const d = (matchOf(a.matchId)?.date || "").localeCompare(matchOf(b.matchId)?.date || "");
      return d !== 0 ? d : clipMinute(a) - clipMinute(b);
    });
    let cur = 0,
      bestStreak = 0;
    chrono.forEach((c) => {
      cur = c.result === "goal" ? cur + 1 : 0;
      if (cur > bestStreak) bestStreak = cur;
    });
    if (bestStreak >= 3) {
      out.push({
        icon: <Flame size={18} />,
        title: "Langste reeks raak",
        detail: `${bestStreak} op rij raak`,
      });
    }

    // Favoriete zone (meeste schoten)
    const zoneStats = {};
    myShots.forEach((c) => {
      let z = ZONE_GRID.flat().includes(c.zone) ? c.zone : null;
      if (!z && typeof c.x === "number" && typeof c.y === "number" && c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1) {
        z = ZONE_GRID[Math.min(2, Math.floor(c.y * 3))][Math.min(2, Math.floor(c.x * 3))];
      }
      if (!z) return;
      if (!zoneStats[z]) zoneStats[z] = { a: 0, g: 0 };
      zoneStats[z].a += 1;
      if (c.result === "goal") zoneStats[z].g += 1;
    });
    const favZone = Object.entries(zoneStats).sort((a, b) => b[1].a - a[1].a)[0];
    if (favZone) {
      out.push({
        icon: <MapPin size={18} />,
        title: `Favoriete zone: ${favZone[0]}`,
        detail: `${favZone[1].a} schoten · ${fg(favZone[1].g, favZone[1].a)}% raak`,
      });
    }

    // Helften: afronding 1e vs 2e helft
    const h1 = myShots.filter((c) => (c.half || 1) === 1);
    const h2 = myShots.filter((c) => c.half === 2);
    if (h1.length >= 3 && h2.length >= 3) {
      const f1 = fg(h1.filter((c) => c.result === "goal").length, h1.length);
      const f2 = fg(h2.filter((c) => c.result === "goal").length, h2.length);
      if (f1 !== f2) {
        const better = f2 > f1 ? "2e" : "1e";
        out.push({
          icon: <Clock size={18} />,
          title: `In de ${better} helft rond je beter af`,
          detail: `${better === "2e" ? f2 : f1}% vs ${better === "2e" ? f1 : f2}%`,
        });
      }
    }

    // Rebounds
    const rWin = myClips.filter((c) => c.actionType === "rebound_win").length;
    const rLose = myClips.filter((c) => c.actionType === "rebound_lose").length;
    if (rWin + rLose > 0) {
      out.push({
        icon: <RefreshCw size={18} />,
        title: "Rebounds",
        detail: `${rWin} gewonnen · ${rLose} verloren (${Math.round((rWin / (rWin + rLose)) * 100)}% win)`,
      });
    }

    // Balverlies
    const bv = myClips.filter((c) => c.actionType === "balverlies").length;
    if (bv > 0 && myMatches.length > 0) {
      out.push({
        icon: <Activity size={18} />,
        title: "Balverlies",
        detail: `${bv}× totaal · ${(bv / myMatches.length).toFixed(1)} per wedstrijd`,
      });
    }
    return out;
  }, [myShots, myClips, myMatches, scopeMatches, myTeam, teams]);

  // Sterke punten en verbeterpunten (regels op basis van teamvergelijking)
  const insights = useMemo(() => {
    const strong = [];
    const improve = [];
    const labels = { schot_3m: "<3m", schot_6m: "<6m", schot_9m: "<9m" };

    Object.entries(stats.byDistance).forEach(([id, d]) => {
      const myPct = fg(d.mine.goals, d.mine.attempts);
      const teamPct = fg(d.team.goals, d.team.attempts);
      if (d.mine.attempts >= 5 && d.team.attempts > 0) {
        if (myPct >= teamPct + 10) {
          strong.push(`Sterk van ${labels[id]}: ${myPct}% (team ${teamPct}%)`);
        } else if (myPct <= teamPct - 10) {
          improve.push(`Afronding ${labels[id]} kan beter: ${myPct}% (team ${teamPct}%)`);
        }
      }
    });

    const rWin = myClips.filter((c) => c.actionType === "rebound_win").length;
    const rLose = myClips.filter((c) => c.actionType === "rebound_lose").length;
    const rTotal = rWin + rLose;
    if (rTotal >= 5) {
      const rPct = Math.round((rWin / rTotal) * 100);
      if (rPct >= 60) strong.push(`Reboundmachine: ${rPct}% gewonnen`);
      else if (rPct <= 40) improve.push(`Rebounds winnen kan beter: ${rPct}%`);
    }

    const bv = myClips.filter((c) => c.actionType === "balverlies").length;
    if (myMatches.length >= 2) {
      const teamBv = scopeClips.filter(
        (c) => c.actionType === "balverlies" && teamPlayerIds.has(c.playerId) && !isOppClip(c)
      ).length;
      const pairs = new Set(
        scopeClips.filter((c) => teamPlayerIds.has(c.playerId) && !isOppClip(c)).map((c) => `${c.playerId}:${c.matchId}`)
      ).size;
      const teamAvg = pairs ? teamBv / pairs : 0;
      const mine = bv / myMatches.length;
      if (teamAvg > 0) {
        if (mine >= 1.5 * teamAvg) {
          improve.push(`Veel balverlies: ${mine.toFixed(1)} per wedstrijd (team ${teamAvg.toFixed(1)})`);
        } else if (mine <= 0.5 * teamAvg) {
          strong.push(`Zeker in balbezit: ${mine.toFixed(1)} balverlies per wedstrijd`);
        }
      }
    }

    const h1 = myShots.filter((c) => (c.half || 1) === 1);
    const h2 = myShots.filter((c) => c.half === 2);
    if (h1.length >= 3 && h2.length >= 3) {
      const f1 = fg(h1.filter((c) => c.result === "goal").length, h1.length);
      const f2 = fg(h2.filter((c) => c.result === "goal").length, h2.length);
      if (f1 - f2 >= 15) improve.push(`2e helft minder scherp: ${f2}% vs ${f1}% in de 1e helft`);
      else if (f2 - f1 >= 15) improve.push(`1e helft minder scherp: ${f1}% vs ${f2}% in de 2e helft`);
    }

    return { strong: strong.slice(0, 3), improve: improve.slice(0, 3) };
  }, [stats, myClips, myShots, myMatches, scopeClips, teamPlayerIds]);

  // Vorm per wedstrijd: afronding% per gespeelde wedstrijd (laatste 10 met schot)
  const formData = useMemo(() => {
    const withShots = myMatches
      .map((m) => {
        const shots = myShots.filter((c) => c.matchId === m.id);
        if (!shots.length) return null;
        const g = shots.filter((c) => c.result === "goal").length;
        return {
          label: (m.date || "").slice(5).split("-").reverse().join("-"),
          fg: fg(g, shots.length),
          goals: g,
          attempts: shots.length,
        };
      })
      .filter(Boolean);
    return withShots.slice(0, 10).reverse();
  }, [myMatches, myShots]);

  // Punten + zone-overlay voor mijn schoten op het veld
  const { heatmapPoints, zoneOverlay } = useMemo(() => {
    const zoneCenters = ZONE_GRID.reduce((acc, row, r) => {
      row.forEach((z, c) => {
        acc[z] = { x: (c + 0.5) / 3, y: (r + 0.5) / 3 };
      });
      return acc;
    }, {});
    const zoneStats = {};
    ZONE_GRID.flat().forEach((z) => {
      zoneStats[z] = { attempts: 0, goals: 0, fg: 0 };
    });
    const points = myShots.map((c) => {
      let z = ZONE_GRID.flat().includes(c.zone) ? c.zone : null;
      if (!z && typeof c.x === "number" && typeof c.y === "number" && c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1) {
        z = ZONE_GRID[Math.min(2, Math.floor(c.y * 3))][Math.min(2, Math.floor(c.x * 3))];
      }
      if (z && (c.result === "goal" || c.result === "miss")) {
        zoneStats[z].attempts += 1;
        if (c.result === "goal") zoneStats[z].goals += 1;
      }
      const fb = z ? zoneCenters[z] : { x: 0.5, y: 0.5 };
      return {
        id: c.id,
        x: typeof c.x === "number" ? c.x : fb.x,
        y: typeof c.y === "number" ? c.y : fb.y,
        actionType: c.actionType,
        result: c.result,
      };
    });
    ZONE_GRID.flat().forEach((z) => {
      const s = zoneStats[z];
      s.fg = s.attempts ? Math.round((s.goals / s.attempts) * 100) : 0;
    });
    const overlay = ZONE_GRID.flatMap((row, r) =>
      row.map((zone, c) => ({ zone, row: r, col: c, ...zoneStats[zone] }))
    );
    return { heatmapPoints: points, zoneOverlay: overlay };
  }, [myShots]);

  // Laatste 6 eigen clips (nieuwste eerst)
  const recentClips = useMemo(() => {
    const dateOf = (c) => scopeMatches.find((m) => m.id === c.matchId)?.date || "";
    return [...myClips]
      .sort((a, b) => {
        const d = dateOf(b).localeCompare(dateOf(a));
        return d !== 0 ? d : clipMinute(b) - clipMinute(a);
      })
      .slice(0, 6);
  }, [myClips, scopeMatches]);

  const initials = (me?.name || "?")
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase())
    .slice(0, 2)
    .join("");

  const diff = stats.fg - stats.teamFg;

  if (!loaded) return <div className="text-neutral-500 text-sm">Laden…</div>;

  // Koppel-picker als er nog geen speler is gekoppeld
  if (!me) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-6 space-y-4 animate-fade-up">
          <h2 className="text-xl font-bold text-white">Koppel je spelersprofiel</h2>
          <p className="text-sm text-neutral-400">
            Kies hieronder jezelf uit een team om je persoonlijke statistieken te zien.
          </p>
          <select
            value={pickerTeamId}
            onChange={(e) => setPickerTeamId(e.target.value)}
            className="bg-neutral-900/80 border border-neutral-700 px-3 py-2 rounded-xl text-sm w-full"
          >
            <option value="">— kies team —</option>
            {teams
              .filter((t) => (t.players || []).length || (t.subs || []).length)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          {pickerTeamId && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-80 overflow-y-auto">
              {[...(teams.find((t) => t.id === pickerTeamId)?.players || []),
                ...(teams.find((t) => t.id === pickerTeamId)?.subs || [])].map((p) => (
                <button
                  key={p.id}
                  onClick={() => linkPlayer(p.id)}
                  className="bg-neutral-900/80 border border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-100 hover:border-[#FF6124]/60 text-left"
                >
                  {p.number ? `#${p.number} ` : ""}
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Seizoenfilter */}
      <div className="flex items-center gap-3 animate-fade-up" style={{ animationDelay: "0ms" }}>
        <label className="text-xs text-neutral-400">Seizoen</label>
        <select
          value={selectedSeason}
          onChange={(e) => setSelectedSeason(e.target.value)}
          className="bg-neutral-900/80 border border-neutral-700 px-3 py-1.5 rounded-xl text-sm"
        >
          <option value="all">Alle seizoenen</option>
          {seasonOptions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* HERO */}
      <div
        className="rounded-2xl p-6 bg-gradient-to-br from-[#FF6124]/30 via-neutral-800/80 to-neutral-900 border border-[#FF6124]/30 shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-up"
        style={{ animationDelay: "70ms" }}
      >
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-neutral-800 flex items-center justify-center text-xl font-semibold text-neutral-200 ring-2 ring-[#FF6124] shrink-0">
            {me.avatarUrl ? (
              <img src={me.avatarUrl} alt={me.name} className="w-full h-full object-cover" />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">{me.name}</h2>
            <p className="text-sm text-neutral-300">
              {me.number ? `#${me.number} · ` : ""}
              {myTeam?.name || ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={() => {
              setPickerTeamId(myTeam?.id || "");
              setPickerOpen(true);
            }}
            className="px-4 py-2 rounded-xl bg-neutral-900/80 border border-neutral-700 text-neutral-200 text-sm hover:border-[#FF6124]/60"
          >
            Wijzig speler
          </button>
          <button
            onClick={() => navigate("/statistics")}
            className="px-4 py-2 rounded-xl bg-[#FF6124] text-white text-sm font-medium hover:opacity-90"
          >
            Volledige statistieken
          </button>
        </div>
      </div>

      {myClips.length === 0 ? (
        <div
          className="bg-neutral-800/70 border border-neutral-700/60 rounded-2xl p-6 text-center text-sm text-neutral-500 animate-fade-up"
          style={{ animationDelay: "140ms" }}
        >
          Nog geen clips voor jou getagd. Tag clips in een wedstrijd om je statistieken te zien.
        </div>
      ) : (
        <>
          {/* KPI RIJ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-up" style={{ animationDelay: "140ms" }}>
            <KpiCard icon={<Calendar size={22} />} label="Wedstrijden" value={<AnimatedNumber value={myMatches.length} />} />
            <KpiCard icon={<Crosshair size={22} />} label="Schoten" value={<AnimatedNumber value={stats.attempts} />} />
            <KpiCard icon={<Trophy size={22} />} label="Doelpunten" value={<AnimatedNumber value={stats.goals} />} />
            <KpiCard
              icon={<TrendingUp size={22} />}
              label="Afronding"
              value={stats.attempts ? <AnimatedNumber value={stats.fg} suffix="%" /> : "—"}
              sub={
                <span>
                  Team: {stats.teamFg}%
                  <span className={`ml-2 font-semibold ${diff >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {diff >= 0 ? "↑" : "↓"} {Math.abs(diff)}pp
                  </span>
                </span>
              }
            />
          </div>

          {/* AFROUNDING PER AFSTAND VS TEAM */}
          <div
            className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 animate-fade-up"
            style={{ animationDelay: "210ms" }}
          >
            <h3 className="text-sm font-semibold text-neutral-200 mb-3">Afronding per afstand vs team</h3>
            <div className="space-y-3">
              {[
                { id: "schot_3m", label: "<3m" },
                { id: "schot_6m", label: "<6m" },
                { id: "schot_9m", label: "<9m" },
              ].map((d) => {
                const s = stats.byDistance[d.id];
                const myPct = fg(s.mine.goals, s.mine.attempts);
                const teamPct = fg(s.team.goals, s.team.attempts);
                return (
                  <div key={d.id} className="grid grid-cols-12 items-center gap-3">
                    <div className="col-span-2 sm:col-span-1 text-xs text-neutral-400">{d.label}</div>
                    <div className="col-span-10 sm:col-span-11 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-neutral-500 w-8">Jij</span>
                        <div className="flex-1 h-2 rounded-full bg-neutral-950/70 overflow-hidden">
                          <div
                            className="h-full bg-[#FF6124] rounded-full transition-[width] duration-700 ease-out"
                            style={{ width: `${mounted ? myPct : 0}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-neutral-300 w-24 text-right">
                          {s.mine.attempts ? `${myPct}%` : "—"} · {s.mine.goals}/{s.mine.attempts}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-neutral-500 w-8">Team</span>
                        <div className="flex-1 h-2 rounded-full bg-neutral-950/70 overflow-hidden">
                          <div
                            className="h-full bg-neutral-400 rounded-full transition-[width] duration-700 ease-out"
                            style={{ width: `${mounted ? teamPct : 0}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-neutral-500 w-24 text-right">
                          {s.team.attempts ? `${teamPct}%` : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* FEITJES */}
          {facts.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-up" style={{ animationDelay: "280ms" }}>
              {facts.map((f, i) => (
                <div key={i} className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-[#FF6124]/20 text-[#FF6124] shrink-0">{f.icon}</div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white leading-snug">{f.title}</div>
                    <div className="text-[11px] text-neutral-400 mt-0.5">{f.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* STERKE PUNTEN & VERBETERPUNTEN */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-fade-up" style={{ animationDelay: "350ms" }}>
            <div className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-green-400 mb-2">
                <ThumbsUp size={15} /> Sterke punten
              </div>
              {insights.strong.length ? (
                <ul className="space-y-1.5">
                  {insights.strong.map((s, i) => (
                    <li key={i} className="bg-neutral-900/80 rounded-xl px-3 py-2 text-sm text-neutral-200">
                      {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-neutral-500">Nog te weinig data — tag meer wedstrijden.</div>
              )}
            </div>
            <div className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-400 mb-2">
                <Target size={15} /> Verbeterpunten
              </div>
              {insights.improve.length ? (
                <ul className="space-y-1.5">
                  {insights.improve.map((s, i) => (
                    <li key={i} className="bg-neutral-900/80 rounded-xl px-3 py-2 text-sm text-neutral-200">
                      {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-neutral-500">Nog te weinig data — tag meer wedstrijden.</div>
              )}
            </div>
          </div>

          {/* VORM PER WEDSTRIJD */}
          {formData.length > 0 && (
            <div
              className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 space-y-3 animate-fade-up"
              style={{ animationDelay: "420ms" }}
            >
              <h3 className="text-sm font-semibold text-neutral-200">Vorm per wedstrijd (afronding%)</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={formData} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: "#a3a3a3", fontSize: 11 }} stroke="#404040" />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "#a3a3a3", fontSize: 11 }}
                    stroke="#404040"
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 12, color: "white" }}
                    formatter={(value, name, props) => [
                      `${value}% (${props.payload.goals}/${props.payload.attempts})`,
                      "Afronding",
                    ]}
                  />
                  <ReferenceLine
                    y={stats.teamFg}
                    stroke="#a3a3a3"
                    strokeDasharray="4 4"
                    label={{ value: `Team ${stats.teamFg}%`, position: "right", fill: "#a3a3a3", fontSize: 11 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="fg"
                    name="Afronding"
                    stroke="#FF6124"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#FF6124" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* MIJN SCHOTEN OP HET VELD */}
          <div
            className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 animate-fade-up"
            style={{ animationDelay: "490ms" }}
          >
            <h3 className="text-sm font-semibold text-neutral-200 mb-4">Mijn schoten op het veld</h3>
            <FieldHeatmap points={heatmapPoints} maxWidth="max-w-3xl" zoneOverlay={zoneOverlay} />
          </div>

          {/* RECENTE MOMENTEN */}
          {recentClips.length > 0 && (
            <div
              className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 animate-fade-up"
              style={{ animationDelay: "560ms" }}
            >
              <h3 className="text-sm font-semibold text-neutral-200 mb-3">Recente momenten</h3>
              <div className="space-y-1.5">
                {recentClips.map((c) => {
                  const m = scopeMatches.find((x) => x.id === c.matchId);
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveClip(c)}
                      className="w-full bg-neutral-900/80 rounded-xl px-3 py-2 flex items-center gap-3 hover:bg-neutral-900 transition text-left"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          c.result === "goal" ? "bg-green-500" : c.result === "miss" ? "bg-red-500" : "bg-neutral-600"
                        }`}
                      />
                      <span className="flex-1 min-w-0 truncate text-sm text-neutral-100">
                        {formatActionLabel(c.actionType)}
                      </span>
                      <span className="text-[11px] text-neutral-500 whitespace-nowrap">
                        {formatMatchDate(m?.date).slice(0, 5)} · {c.half || 1}e · {fmt(c.time || 0)}
                      </span>
                      <BarChart2 size={13} className="text-neutral-600 shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Wijzig-speler picker (vanuit hero) */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-neutral-900 border border-neutral-700 rounded-2xl p-4 space-y-3 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Koppel je spelersprofiel</h3>
              <button onClick={() => setPickerOpen(false)} className="text-neutral-400 hover:text-white text-xl px-1">
                ✕
              </button>
            </div>
            <select
              value={pickerTeamId}
              onChange={(e) => setPickerTeamId(e.target.value)}
              className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded-xl text-sm w-full"
            >
              <option value="">— kies team —</option>
              {teams
                .filter((t) => (t.players || []).length || (t.subs || []).length)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
            {pickerTeamId && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[...(teams.find((t) => t.id === pickerTeamId)?.players || []),
                  ...(teams.find((t) => t.id === pickerTeamId)?.subs || [])].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => linkPlayer(p.id)}
                    className="bg-neutral-800/70 border border-neutral-700/50 rounded-xl px-3 py-2 text-sm text-neutral-100 hover:border-[#FF6124]/60 text-left"
                  >
                    {p.number ? `#${p.number} ` : ""}
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Clip player modal */}
      {activeClip && (
        <ClipPlayerModal
          clip={activeClip}
          match={scopeMatches.find((x) => x.id === activeClip.matchId) || matches.find((x) => x.id === activeClip.matchId)}
          playerLabel={`${me.number ? `#${me.number} ` : ""}${me.name}`}
          teams={teams}
          onClose={() => setActiveClip(null)}
          onOpenMatch={(matchId) => navigate(`/matches/${matchId}`)}
        />
      )}
    </div>
  );
}

// COMPONENTS BELOW

function KpiCard({ icon, label, value, sub }) {
  return (
    <div className="bg-neutral-800/70 border border-neutral-700/60 shadow-lg shadow-black/20 rounded-2xl p-4 flex items-start gap-3 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="p-2.5 rounded-xl bg-[#FF6124]/20 text-[#FF6124]">{icon}</div>
      <div className="min-w-0">
        <div className="text-neutral-400 text-xs">{label}</div>
        <div className="text-2xl font-bold text-white">{value}</div>
        {sub && <div className="text-[11px] text-neutral-400 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}
