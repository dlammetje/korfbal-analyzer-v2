import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAppData } from "../context/AppDataContext";
import FieldHeatmap from "../components/FieldHeatmap";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebaseClient";
import { doc, getDoc } from "firebase/firestore";

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

  // Aparte filters voor de veld-heatmap
  const [mapTeam, setMapTeam] = useState("all");
  const [mapPlayer, setMapPlayer] = useState("all");
  const [mapAction, setMapAction] = useState("all");
  const [mapResult, setMapResult] = useState("all");

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

  const matchesForClub = useMemo(() => {
    if (!userClubId) return matches;
    return matches.filter((m) => !m.clubId || m.clubId === userClubId);
  }, [matches, userClubId]);

  const subsForClub = useMemo(() => {
    if (!matchesForClub.length) return [];
    const matchIds = new Set(matchesForClub.map((m) => m.id));
    return substitutions.filter((s) => matchIds.has(s.matchId));
  }, [substitutions, matchesForClub]);

  const clipsForClub = useMemo(() => {
    if (!userClubId) return clips;
    return clips.filter((c) => !c.clubId || c.clubId === userClubId);
  }, [clips, userClubId]);

  const enriched = useMemo(() => {
    // Gebruik alle clips (ook met sequenceId), maar alleen binnen de club.
    return clipsForClub.map(c => {
      const match = matchesForClub.find(m => m.id === c.matchId) || {};
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

      const datePart = match.date || "Onbekende datum";
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
  }, [clipsForClub, teams, matchesForClub]);

  const enrichedById = useMemo(() => {
    const map = {};
    enriched.forEach((c) => {
      if (c.id) map[c.id] = c;
    });
    return map;
  }, [enriched]);

  const filtered = useMemo(() => {
    return enriched.filter(c => {
      if (selectedTeam !== "all" && c.team !== selectedTeam) return false;
      if (selectedPlayer !== "all" && c.player !== selectedPlayer) return false;
      if (selectedZone !== "all" && c.zone !== selectedZone) return false;
      if (selectedAction !== "all" && c.actionType !== selectedAction) return false;
      if (selectedHalf !== "all" && String(c.half) !== selectedHalf) return false;
      if (selectedResult !== "all" && c.result !== selectedResult) return false;
      if (selectedMatch !== "all" && c.matchName !== selectedMatch) return false;
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
    const isShot = (c) => c.actionType === "schot" || c.actionType === "tegen_schot";
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
      return {
        attempts: list.length,
        goals: goalsType.length,
        fg: list.length ? Math.round((goalsType.length / list.length) * 100) : 0,
      };
    };

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
      doorloop,
      kleine,
      vrijeBal,
      strafworp,
      reboundsAttack: reboundsAttackWin,
      reboundsDefense: reboundsDefenseWin,
      totalRebounds: totalReboundsAttack + totalReboundsDefense,
      reboundAttackPct: totalReboundsAttack ? Math.round((reboundsAttackWin / totalReboundsAttack) * 100) : 0,
      reboundDefensePct: totalReboundsDefense ? Math.round((reboundsDefenseWin / totalReboundsDefense) * 100) : 0,
    };
  }, [statsClips]);

  const heatmap = useMemo(() => {
    const map = {};
    ZONES.forEach(z => map[z] = 0);
    statsClips.forEach(c => {
      if (map[c.zone] !== undefined) map[c.zone]++;
    });
    return map;
  }, [statsClips]);

  const shotchart = useMemo(() => {
    const map = {};
    ZONES.forEach((z) => {
      map[z] = { goal: 0, miss: 0, pct: 0 };
    });

    statsClips.forEach((c) => {
      const isShot = c.actionType === "schot" || c.actionType === "tegen_schot";
      if (isShot && map[c.zone]) {
        if (c.result === "goal" || c.result === "opp_goal") map[c.zone].goal++;
        if (c.result === "miss" || c.result === "opp_miss") map[c.zone].miss++;
      }
    });

    ZONES.forEach((z) => {
      const total = map[z].goal + map[z].miss;
      map[z].pct = total ? Math.round((map[z].goal / total) * 100) : 0;
    });

    return map;
  }, [statsClips]);

  const allPlayers = [...new Set(teams.flatMap(t => [...(t.players || []), ...(t.subs || [])]).map(p => p.name))];
  const allTeams = [...new Set(teams.map(t => t.name))];
  const allActions = [...new Set(enriched.map(c => c.actionType).filter(Boolean))];

  // Per-speler statistieken op basis van de huidige filters
  const perPlayerStats = useMemo(() => {
    // Basis: gebruik dezelfde gefilterde set als de rest van de pagina,
    // maar sluit opponent-clips (zonder speler / Onbekend) uit en, als er
    // een Team is gekozen, alleen clips van dat team.
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
      if (c.actionType === "schot") {
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
    const matchFilterName = selectedMatch !== "all" ? selectedMatch : null;

    // Helper om van playerId naar { name, teamName } te gaan
    const playerMetaById = new Map();
    teams.forEach((t) => {
      const all = [...(t.players || []), ...(t.subs || [])];
      all.forEach((p) => {
        if (!p?.id) return;
        playerMetaById.set(p.id, { name: p.name || "Onbekend", teamName: t.name || null });
      });
    });

    const matchNameById = new Map();
    matchesForClub.forEach((m) => {
      const home = teams.find((t) => t.id === m.homeTeamId);
      const away = teams.find((t) => t.id === m.awayTeamId);
      const datePart = m.date || "Onbekende datum";
      const homeName = home?.name || m.homeTeamId;
      const awayName = away?.name || m.awayTeamId;
      matchNameById.set(m.id, `${datePart} — ${homeName} vs ${awayName}`);
    });

    subsForClub.forEach((s) => {
      const matchName = matchNameById.get(s.matchId) || null;
      if (matchFilterName && matchName !== matchFilterName) return;
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
  }, [filtered, selectedTeam, subsForClub, teams, matchesForClub, selectedPlayer, selectedHalf, selectedMatch]);

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

    filtered.forEach((c) => {
      const row = ensure(c.matchName || "Onbekende wedstrijd");

      // Schoten
      if (c.actionType === "schot") {
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
      if (c.actionType === "rebound_verdediging") row.rebDefense += 1;

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

  // Clips voor de veld-heatmap met eigen filters (los van de algemene filters bovenaan)
  const mapFiltered = useMemo(() => {
    return enriched.filter((c) => {
      if (mapTeam !== "all" && c.team !== mapTeam) return false;
      if (mapPlayer !== "all" && c.player !== mapPlayer) return false;
      if (mapAction !== "all" && c.actionType !== mapAction) return false;
      if (mapResult !== "all" && c.result !== mapResult) return false;
      return true;
    });
  }, [enriched, mapTeam, mapPlayer, mapAction, mapResult]);

  const fieldHeatmapPoints = useMemo(() => {
    if (!mapFiltered.length) return [];

    // fallback posities per zone (zelfde indeling als Dashboard)
    const zoneCenters = ZONES.reduce((acc, z, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      acc[z] = {
        x: (col + 0.5) / 3,
        y: (row + 0.5) / 3,
      };
      return acc;
    }, {});

    return mapFiltered.map((c) => {
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
  }, [mapFiltered]);

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
    <div className="p-6 space-y-6">
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
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <Filter label="Team" value={selectedTeam} setter={setSelectedTeam} options={["all", ...allTeams]} />
          <Filter label="Speler" value={selectedPlayer} setter={setSelectedPlayer} options={["all", ...allPlayers]} />
          <Filter label="Zone" value={selectedZone} setter={setSelectedZone} options={["all", ...ZONES]} />
          <Filter label="Actie" value={selectedAction} setter={setSelectedAction} options={["all", ...allActions]} />
          <Filter label="Helft" value={selectedHalf} setter={setSelectedHalf} options={["all", "1", "2"]} />
          <Filter label="Resultaat" value={selectedResult} setter={setSelectedResult} options={["all", "goal", "miss", "opp_goal"]} />
          <Filter
            label="Wedstrijd"
            value={selectedMatch}
            setter={setSelectedMatch}
            options={[
              "all",
              ...matchesForClub.map((m) => {
                const home = teams.find((t) => t.id === m.homeTeamId);
                const away = teams.find((t) => t.id === m.awayTeamId);
                const datePart = m.date || "Onbekende datum";
                const homeName = home?.name || m.homeTeamId;
                const awayName = away?.name || m.awayTeamId;
                return `${datePart} — ${homeName} vs ${awayName}`;
              }),
            ]}
          />
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title={statsMode === "for" ? "Schoten" : "Tegenschoten"}
          value={playerStats.totalShots}
        />
        <StatCard
          title={statsMode === "for" ? "Goals" : "Tegengoals"}
          value={playerStats.goals}
          color="#FF6124"
        />
        <StatCard
          title={statsMode === "for" ? "Missers" : "Gemiste tegenschoten"}
          value={playerStats.misses}
          color="#dc2626"
        />
        {statsMode === "for" && (
          <StatCard
            title="Totaal kansen (schot + overige)"
            value={`${playerStats.totalCombinedGoals}/${playerStats.totalCombinedAttempts} (${playerStats.totalCombinedFg}%)`}
            color="#22c55e"
          />
        )}
        <StatCard
          title={statsMode === "for" ? "Raak% overige kansen" : "Raak% tegenkansen"}
          value={`${playerStats.chanceFg}%`}
          color="#22c55e"
        />
        <StatCard
          title={statsMode === "for" ? "Raak% schoten" : "Raak% tegenschoten"}
          value={`${playerStats.fg}%`}
          color="#FF6124"
        />
        <StatCard
          title={statsMode === "for" ? "Mis% schoten" : "Mis% tegenschoten"}
          value={`${playerStats.missPct}%`}
          color="#dc2626"
        />

        {statsMode === "for" ? (
          <>
            <StatCard title="Assists" value={playerStats.assists} />
            <StatCard title="Balverlies" value={playerStats.turnovers} />
            <StatCard title="Overtredingen" value={playerStats.fouls} />
            <StatCard title="Ondersch. / Overnames" value={playerStats.interceptions} />
            <StatCard
              title="Rebound Aanv.%"
              value={`${playerStats.reboundAttackPct}%`}
            />
            <StatCard
              title="Rebound Verd.%"
              value={`${playerStats.reboundDefensePct}%`}
            />
          </>
        ) : (
          <>
            <StatCard
              title="Doorloopballen tegen (raak/pogingen, %)"
              value={`${playerStats.doorloop.goals}/${playerStats.doorloop.attempts} (${playerStats.doorloop.fg}%)`}
            />
            <StatCard
              title="Kleine kansen tegen (raak/pogingen, %)"
              value={`${playerStats.kleine.goals}/${playerStats.kleine.attempts} (${playerStats.kleine.fg}%)`}
            />
            <StatCard
              title="Vrije ballen tegen (raak/pogingen, %)"
              value={`${playerStats.vrijeBal.goals}/${playerStats.vrijeBal.attempts} (${playerStats.vrijeBal.fg}%)`}
            />
            <StatCard
              title="Strafworpen tegen (raak/pogingen, %)"
              value={`${playerStats.strafworp.goals}/${playerStats.strafworp.attempts} (${playerStats.strafworp.fg}%)`}
            />
            <StatCard
              title="Totaal kansen tegen"
              value={playerStats.chanceAttempts}
            />
            <StatCard
              title="Totaal acties tegen"
              value={statsClips.length}
            />
          </>
        )}
      </div>

      <ShotChartView data={shotchart} />

      {/* Veld-heatmap met aparte filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3">
          <h3 className="text-lg font-semibold">Veldfilter</h3>
          <Filter
            label="Team (veld)"
            value={mapTeam}
            setter={setMapTeam}
            options={["all", ...allTeams]}
          />
          <Filter
            label="Speler (veld)"
            value={mapPlayer}
            setter={setMapPlayer}
            options={["all", ...allPlayers]}
          />
          <Filter
            label="Actie (veld)"
            value={mapAction}
            setter={setMapAction}
            options={["all", ...allActions]}
          />
          <Filter
            label="Resultaat (veld)"
            value={mapResult}
            setter={setMapResult}
            options={["all", "goal", "miss", "opp_goal"]}
          />
        </div>

        <div className="md:col-span-2">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
            <h3 className="text-lg font-semibold mb-3">Veld-heatmap</h3>
            <FieldHeatmap points={fieldHeatmapPoints} maxWidth="max-w-3xl" />
          </div>
        </div>
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
  return (
    <div>
      <label className="text-xs text-neutral-400 block mb-1">{label}</label>
      <select value={value} onChange={e => setter(e.target.value)}
        className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded-xl text-sm w-full">
        {options.map(o => (<option key={o} value={o}>{o}</option>))}
      </select>
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

function HeatmapView({ heatmap }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
      <h3 className="text-lg mb-3">Heatmap (Zone Activiteit)</h3>
      <div className="grid grid-cols-3 gap-2">
        {ZONES.map(z => (
          <div key={z} className="bg-neutral-800 rounded-xl p-3 text-center border border-neutral-700">
            <div className="text-xs text-neutral-400">{z}</div>
            <div className="text-lg mt-1">{heatmap[z]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShotChartView({ data }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
      <h3 className="text-lg mb-3">Shotchart per Zone</h3>
      <div className="grid grid-cols-3 gap-2">
        {ZONES.map(z => (
          <div key={z} className="bg-neutral-800 rounded-xl p-3 border border-neutral-700 text-center">
            <div className="text-xs text-neutral-400">{z}</div>
            <div className="text-sm mt-1 text-green-400">
              Raak: {data[z].goal}
            </div>
            <div className="text-sm text-red-400">
              Mis: {data[z].miss}
            </div>
            <div className="text-xs text-neutral-300 mt-1">
              {data[z].pct}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function PlayerStatsTable({ rows, total }) {
  const allRows = [...rows, total];

  const pct = (made, att) => (att ? Math.round((made / att) * 100) : 0);

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 mt-4 overflow-x-auto">
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