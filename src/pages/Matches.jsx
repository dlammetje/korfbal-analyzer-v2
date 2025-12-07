// src/pages/Matches.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Upload, ChevronLeft, ChevronRight, Plus, Trash2, FileText } from "lucide-react";
import { useAppData } from "../context/AppDataContext";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebaseClient";
import { doc, getDoc } from "firebase/firestore";

const ZONES = [
  "Linksvoor", "Voor (midden)", "Rechtsvoor",
  "Linkerzij", "Korfzone", "Rechterzij",
  "Linksachter", "Achter (midden)", "Rechtsachter"
];

const ATTACK_ACTIONS = [
  { id: "schot", label: "Schot", isChance: true },
  { id: "doorloopbal", label: "Doorloopbal", isChance: true },
  { id: "vrije_bal", label: "Vrije Bal", isChance: true },
  { id: "strafworp", label: "Strafworp", isChance: true },
  { id: "kleine_kans", label: "Kleine Kans", isChance: true },
  { id: "rebound_win", label: "Rebound (win)", isChance: false },
  { id: "rebound_lose", label: "Rebound (verlies)", isChance: false },
  { id: "assist", label: "Assist / Aangeef", isChance: false },
  { id: "balverlies", label: "Balverlies", isChance: false },
];

const DEFENSE_ACTIONS = [
  { id: "verdedigd", label: "Verdedigd", isChance: false },
  { id: "onderschepping", label: "Onderschepping", isChance: false },
  { id: "overname", label: "Overname", isChance: false },
  { id: "rebound_def_win", label: "Rebound verd. (win)", isChance: false },
  { id: "rebound_def_lose", label: "Rebound verd. (verlies)", isChance: false },
  { id: "overtreding", label: "Overtreding", isChance: false },
];

const OPPONENT_GOALS = [
  { id: "tegen_schot", label: "Tegenstander Schot" },
  { id: "tegen_doorloopbal", label: "Tegenstander Doorloopbal" },
  { id: "tegen_vrije_bal", label: "Tegenstander Vrije Bal" },
  { id: "tegen_strafworp", label: "Tegenstander Strafworp" },
];

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatTeamName(teamId, teams) {
  if (!teamId) return "Onbekend team";
  if (!Array.isArray(teams)) {
    if (typeof teamId === "string" && teamId.trim()) {
      // Laat alleen "menselijke" namen zien, geen lange ruwe IDs
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

export default function Matches() {
  const { currentUser } = useAuth();
  const {
    ready, teams, matches,
    addMatch, updateMatch, deleteMatch,
    getTeamPlayers, getTeamById,
    saveMatchVideosLocally, loadMatchVideosLocally,
    addClip, deleteClip, getClipsByMatch,
    addSubstitution, deleteSubstitution, getSubsByMatch,
    clipSequences,
  } = useAppData() || {};

    const navigate = useNavigate();

  const [newMatch, setNewMatch] = useState({
    date: "",
    location: "",
    phase: "zaal",
    homeTeamId: "",
    awayTeamId: "",
    homeScore: "",
    awayScore: "",
    players: [], // basis 8; bank wordt automatisch bepaald uit teamspelers - basis 8
    videoUrls: { half1: "", half2: "" },
  });

  // Removed:
  // const [availableHomeOpponents, setAvailableHomeOpponents] = useState([]);
  // const [availableAwayOpponents, setAvailableAwayOpponents] = useState([]);

  const [selectedMatchId, setSelectedMatchId] = useState("");
  const selectedMatch = useMemo(
    () => matches.find((m) => m.id === selectedMatchId) || null,
    [matches, selectedMatchId]
  );

  // Bewerkbare spelers voor geselecteerde wedstrijd
  const [editPlayers, setEditPlayers] = useState([]);

  useEffect(() => {
    if (!selectedMatch) {
      setEditPlayers([]);
      return;
    }
    setEditPlayers(selectedMatch.players || []);
  }, [selectedMatch]);

  const [preferredTeamId, setPreferredTeamId] = useState("");
  const [userClubId, setUserClubId] = useState("");

  // Laad het voorkeurs-team en clubId van de ingelogde gebruiker uit Firestore
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
        console.error("[Matches] Fout bij laden voorkeurs-team:", e);
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
    const matchesForClub = userClubId
      ? matches.filter((m) => !m.clubId || m.clubId === userClubId)
      : matches;

    if (!preferredTeamId) return matchesForClub;
    return matchesForClub.filter(
      (m) => m.homeTeamId === preferredTeamId || m.awayTeamId === preferredTeamId
    );
  }, [matches, preferredTeamId, userClubId]);

  const sortedMatches = useMemo(() => {
    if (!Array.isArray(visibleMatches) || !visibleMatches.length) return [];
    return [...visibleMatches].sort((a, b) => {
      const da = a.date || "";
      const db = b.date || "";
      return db.localeCompare(da);
    });
  }, [visibleMatches]);

  const [src1, setSrc1] = useState("");
  const [src2, setSrc2] = useState("");
  const [currentHalf, setCurrentHalf] = useState(1);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef(null);
  const sequenceVideoRef = useRef(null);

  const [phase, setPhase] = useState("attack");
  const [zone, setZone] = useState("Korfzone");
  const [playerId, setPlayerId] = useState("");
  const [prePost, setPrePost] = useState({ pre: 4, post: 6 });
  const [chancePrompt, setChancePrompt] = useState(null);

  const [subPrompt, setSubPrompt] = useState(null);

  // Notes per wedstrijd (voor nu alleen in lokale state)
  const [notesModalMatchId, setNotesModalMatchId] = useState("");
  const [notesDraft, setNotesDraft] = useState({
    title: "",
    type: "leermoment",
    text: "",
  });
  const [notesByMatch, setNotesByMatch] = useState({}); // { [matchId]: [{ id, title, type, text, likes, createdAt }] }
  const [notesBadgeDismissed, setNotesBadgeDismissed] = useState({}); // { [matchId]: true }

  // --- Sequentie playlist modal state ---
  const [sequenceModalMatchId, setSequenceModalMatchId] = useState("");
  const [sequenceSelectedId, setSequenceSelectedId] = useState("");
  const [sequencePlaylistIndex, setSequencePlaylistIndex] = useState(0);

  const allowedManageEmails = [
    "dlammetje@gmail.com",
    "lvandeuveren91@gmail.com",
  ];

  const canManageMatches =
    !!currentUser &&
    !!currentUser.email &&
    allowedManageEmails.includes(currentUser.email);

  // --- Afgeleide opponent-lijsten voor dropdowns ---
  const homeTeamObj = teams.find(t => t.id === newMatch.homeTeamId) || null;
  const awayTeamObj = teams.find(t => t.id === newMatch.awayTeamId) || null;

  // Als ONS team thuis is (homeTeamObj heeft opponents), toon die bij UIT-team
  const awaySelectOpponents = Array.isArray(homeTeamObj?.opponents) && homeTeamObj.opponents.length
    ? homeTeamObj.opponents
    : null;

  // Als ONS team uit is (awayTeamObj heeft opponents), toon die bij THUIS-team
  const homeSelectOpponents = Array.isArray(awayTeamObj?.opponents) && awayTeamObj.opponents.length
    ? awayTeamObj.opponents
    : null;

  // Notes uit matches initialiseren zodat ze blijven bestaan na reload
  useEffect(() => {
    if (!Array.isArray(matches)) return;
    const map = {};
    for (const m of matches) {
      if (Array.isArray(m.notes) && m.notes.length) {
        map[m.id] = m.notes;
      }
    }
    setNotesByMatch(map);
  }, [matches]);

  useEffect(() => {
    if (!selectedMatch) {
      setSrc1(""); setSrc2(""); setCurrentHalf(1); setPlaying(false);
      return;
    }
    const { half1, half2 } = loadMatchVideosLocally(selectedMatch.id) || {};
    setSrc1(half1 || "");
    setSrc2(half2 || "");
    setCurrentHalf(1);
    setPlaying(false);
  }, [selectedMatch, loadMatchVideosLocally]);

  // Removed useEffect for availableHomeOpponents and availableAwayOpponents

  // ---------- TAGGING ----------
  const matchPlayers = useMemo(() => {
    if (!selectedMatch || !getTeamPlayers) return [];

    // spelers-ids die jij bij deze wedstrijd hebt gekozen
    const setIds = [
      ...(selectedMatch.players || []),
      ...(selectedMatch.subs || []),
    ];

    const home = getTeamPlayers(selectedMatch.homeTeamId) || [];
    const away = getTeamPlayers(selectedMatch.awayTeamId) || [];

    const pool = [...home, ...away];

    // alleen spelers tonen die bij deze wedstrijd actief zijn
    return pool.filter(p => setIds.includes(p.id));
  }, [selectedMatch, getTeamPlayers]);

    const selectedHomeTeam = selectedMatch
    ? teams.find(t => t.id === selectedMatch.homeTeamId) || null
    : null;

  const selectedAwayTeam = selectedMatch
    ? teams.find(t => t.id === selectedMatch.awayTeamId) || null
    : null;

  const currentClips = useMemo(() => selectedMatch ? getClipsByMatch(selectedMatch.id) : [], [selectedMatch]);
  const currentSubs = useMemo(() => selectedMatch ? getSubsByMatch(selectedMatch.id) : [], [selectedMatch]);

  // Sequenties per match voor modal
  const sequenceOptionsForModal = useMemo(() => {
    if (!sequenceModalMatchId) return [];
    return (clipSequences || [])
      .filter((s) => s.matchId === sequenceModalMatchId)
      .map((s) => ({ id: s.id, name: s.name || "(naamloos)" }));
  }, [clipSequences, sequenceModalMatchId]);

  const sequenceClipsForModal = useMemo(() => {
    if (!sequenceModalMatchId || !sequenceSelectedId) return [];
    const list = (getClipsByMatch ? getClipsByMatch(sequenceModalMatchId) : []).filter(
      (c) => c.sequenceId === sequenceSelectedId
    );
    return [...list].sort((a, b) => {
      const ha = a.half || 1;
      const hb = b.half || 1;
      if (ha !== hb) return ha - hb;
      return (a.time || 0) - (b.time || 0);
    });
  }, [sequenceModalMatchId, sequenceSelectedId, getClipsByMatch]);

  const currentSeqClip = sequenceClipsForModal[sequencePlaylistIndex] || null;

  const currentSequenceMatch = useMemo(() => {
    if (!sequenceModalMatchId) return null;
    return matches.find((m) => m.id === sequenceModalMatchId) || null;
  }, [sequenceModalMatchId, matches]);

  function playCurrentSeqClipModal() {
    if (!sequenceVideoRef.current || !currentSeqClip) return;
    const start = Math.max(0, (currentSeqClip.time || 0) - 4);
    sequenceVideoRef.current.currentTime = start;
    sequenceVideoRef.current.play();
  }

  function goToNextSeqClipModal() {
    if (!sequenceClipsForModal.length) return;
    setSequencePlaylistIndex((idx) => Math.min(sequenceClipsForModal.length - 1, idx + 1));
  }

  function goToPrevSeqClipModal() {
    if (!sequenceClipsForModal.length) return;
    setSequencePlaylistIndex((idx) => Math.max(0, idx - 1));
  }

  async function handleCreateMatch() {
  if (!newMatch.date || !newMatch.homeTeamId || !newMatch.awayTeamId) {
    alert("Vul minimaal datum, thuisteam en uitteam in.");
    return;
  }

  if (!Array.isArray(newMatch.players) || newMatch.players.length !== 8) {
    alert("Selecteer precies 8 basisspelers voor deze wedstrijd.");
    return;
  }

  try {
    console.log("➡️ Nieuwe wedstrijd opslaan:", newMatch);

    const id = await addMatch({
      ...newMatch,
      homeScore: Number(newMatch.homeScore || 0),
      awayScore: Number(newMatch.awayScore || 0),
      clubId: userClubId || null,
    });

    console.log("✅ Wedstrijd opgeslagen met ID:", id);

    setSelectedMatchId(id);

    // Reset formulier
    setNewMatch({
      date: "",
      location: "",
      phase: "zaal",
      homeTeamId: "",
      awayTeamId: "",
      homeScore: "",
      awayScore: "",
      players: [],
      videoUrls: { half1: "", half2: "" },
    });

  } catch (err) {
    console.error("❌ Fout bij opslaan wedstrijd:", err);
    alert("Wedstrijd opslaan mislukt. Check console.");
  }
}

  function handleAction(action, opponent = false) {
    if (!selectedMatch || !videoRef.current) return;
    const now = videoRef.current.currentTime || 0;

    const base = {
      matchId: selectedMatch.id,
      playerId: opponent ? "" : playerId,
      teamId: opponent ? "" : selectedMatch.homeTeamId,
      time: now,
      half: currentHalf,
      phase: opponent ? "defense" : phase,
      zone,
      actionType: action.id,
      result: opponent ? "opp_goal" : null,
      opponentGoal: opponent,
      clubId: userClubId || null,
    };

    if (action.isChance && !opponent) {
      setChancePrompt({ action, base });
      return;
    }
    addClip(base);
  }

  function confirmChance(result) {
    addClip({ ...chancePrompt.base, result });
    setChancePrompt(null);
  }

  function playClip(c) {
    if (!videoRef.current) return;
    const start = Math.max(0, c.time - prePost.pre);
    if (c.half !== currentHalf) setCurrentHalf(c.half);
    setTimeout(() => {
      videoRef.current.currentTime = start;
      videoRef.current.play();
      setPlaying(true);
    }, 50);
  }

  function submitSub(outId, inId) {
    if (!selectedMatch || !videoRef.current) return;
    addSubstitution({
      matchId: selectedMatch.id,
      outPlayer: outId,
      inPlayer: inId,
      time: videoRef.current.currentTime || 0,
      half: currentHalf,
    });
    setSubPrompt(null);
  }

  if (!ready) return <div className="p-6 text-neutral-400">Laden…</div>;

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-semibold">Wedstrijden</h2>

      {/* CREATE MATCH */}
      <div className="bg-[#FF6124]/10 border border-[#FF6124]/40 rounded-2xl p-4 space-y-3 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
        <h3 className="text-lg font-semibold text-[#FF6124] tracking-wide mb-1">Nieuwe wedstrijd aanmaken</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-neutral-400">Datum</label>
            <input type="date" value={newMatch.date}
              onChange={e => setNewMatch(m => ({ ...m, date: e.target.value }))}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm" />
          </div>


          <div>
            <label className="text-xs text-neutral-400">Locatie</label>
            <input value={newMatch.location}
              onChange={e => setNewMatch(m => ({ ...m, location: e.target.value }))}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm" />
          </div>

          <div>
            <label className="text-xs text-neutral-400">Zaal/Veld</label>
            <select value={newMatch.phase}
              onChange={e => setNewMatch(m => ({ ...m, phase: e.target.value }))}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm">
              <option value="zaal">Zaal</option>
              <option value="veld">Veld</option>
            </select>
          </div>

          {/* HOME TEAM */}
          <div>
            <label className="text-xs text-neutral-400">Thuisteam</label>
            <select
              value={newMatch.homeTeamId}
              onChange={e => setNewMatch(m => ({ ...m, homeTeamId: e.target.value }))}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
            >
              <option value="">— Kies team —</option>
              {homeSelectOpponents
                ? homeSelectOpponents.map((name, i) => (
                    <option key={i} value={name}>{name}</option>
                  ))
                : teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
            </select>
          </div>

          {/* AWAY TEAM */}
          <div>
            <label className="text-xs text-neutral-400">Uitteam</label>
            <select
              value={newMatch.awayTeamId}
              onChange={e => setNewMatch(m => ({ ...m, awayTeamId: e.target.value }))}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
            >
              <option value="">— Kies team —</option>
              {awaySelectOpponents
                ? awaySelectOpponents.map((name, i) => (
                    <option key={i} value={name}>{name}</option>
                  ))
                : teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
            </select>
          </div>

          {/* SCORE */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-neutral-400">Score (Thuis)</label>
              <input type="number" value={newMatch.homeScore}
                onChange={e => setNewMatch(m => ({ ...m, homeScore: e.target.value }))}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm" />
            </div>
            <div>
              <label className="text-xs text-neutral-400">Score (Uit)</label>
              <input type="number" value={newMatch.awayScore}
                onChange={e => setNewMatch(m => ({ ...m, awayScore: e.target.value }))}
                className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm" />
            </div>
          </div>

          {/* PLAYERS: kies precies 8 basisspelers; rest wordt bank */}
          <div className="md:col-span-3">
            <label className="text-xs text-neutral-400 mb-1">Basisspelers (selecteer 8)</label>
            <PlayersPicker
              teams={teams}
              homeTeamId={newMatch.homeTeamId}
              awayTeamId={newMatch.awayTeamId}
              selected={newMatch.players}
              onChange={ids => setNewMatch(m => ({ ...m, players: ids }))}
              type="all"
            />
          </div>
        </div>

        <div className="flex justify-between items-center">
          <button
            onClick={handleCreateMatch}
            className="bg-[#FF6124] text-white px-4 py-2 rounded-xl flex items-center gap-2"
          >
            <Plus size={16} /> Wedstrijd aanmaken
          </button>
        </div>
      </div>

      {/* WEDSTRIJDEN TABEL */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3 mt-4">
        <h3 className="text-lg font-semibold text-neutral-100 mb-2">
          Alle wedstrijden
        </h3>

        {sortedMatches.length === 0 ? (
          <div className="text-neutral-500 text-sm">
            Nog geen wedstrijden toegevoegd.
          </div>
        ) : (
          <table className="w-full text-sm border-t border-neutral-800">
            <thead>
              <tr className="text-neutral-400">
                <th className="py-2 text-left">Datum</th>
                <th className="py-2 text-left">Thuis</th>
                <th className="py-2 text-left">Uit</th>
                <th className="py-2 text-left">Uitslag</th>
                <th className="py-2 text-right">Acties</th>
              </tr>
            </thead>
            <tbody>
              {sortedMatches.map((m) => {
                let homeName = formatTeamName(m.homeTeamId, teams);
                let awayName = formatTeamName(m.awayTeamId, teams);

                const ourTeam = Array.isArray(teams) && teams.length ? teams[0] : null;
                if (ourTeam) {
                  if (homeName === "Onbekend team" && m.homeTeamId === ourTeam.id) {
                    homeName = ourTeam.name || homeName;
                  }
                  if (awayName === "Onbekend team" && m.awayTeamId === ourTeam.id) {
                    awayName = ourTeam.name || awayName;
                  }
                }

                const isSelected = selectedMatchId === m.id;

                let formattedDate = m.date || "—";
                try {
                  if (m.date) {
                    const d = new Date(m.date);
                    if (!isNaN(d.getTime())) {
                      formattedDate = d.toLocaleDateString("nl-NL");
                    }
                  }
                } catch (_) {}

                const homeScore =
                  typeof m.homeScore === "number" ? m.homeScore : Number(m.homeScore || 0);
                const awayScore =
                  typeof m.awayScore === "number" ? m.awayScore : Number(m.awayScore || 0);

                return (
                  <tr
                    key={m.id}
                    onClick={() => setSelectedMatchId(m.id)}
                    className={
                      "border-t border-neutral-800 cursor-pointer hover:bg-neutral-800/60" +
                      (isSelected ? " bg-neutral-800" : "")
                    }
                  >
                    <td className="py-2">{formattedDate}</td>
                    <td className="py-2">{homeName}</td>
                    <td className="py-2">{awayName}</td>
                    <td className="py-2">
                      {homeScore} - {awayScore}
                    </td>
                    <td className="py-2 text-right flex items-center justify-end gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedMatchId(m.id);
                          navigate(`/match/${m.id}`);
                        }}
                        className="text-xs px-3 py-1 rounded-lg border border-neutral-600 text-neutral-200 hover:border-[#FF6124] hover:text-[#FF6124]"
                      >
                        Bekijken
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSequenceModalMatchId(m.id);
                          setSequenceSelectedId("");
                          setSequencePlaylistIndex(0);
                        }}
                        className="text-xs px-3 py-1 rounded-lg border border-neutral-600 text-neutral-200 hover:border-[#FF6124] hover:text-[#FF6124]"
                      >
                        Sequenties
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setNotesModalMatchId(m.id);
                          setNotesBadgeDismissed((prev) => ({
                            ...prev,
                            [m.id]: true,
                          }));
                        }}
                        className="relative p-2 rounded-lg border border-neutral-600 text-neutral-200 hover:border-[#FF6124] hover:text-[#FF6124]"
                        title="Notes"
                      >
                        <FileText size={14} />
                        {Array.isArray(notesByMatch[m.id]) && notesByMatch[m.id].length > 0 && !notesBadgeDismissed[m.id] && (
                          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-[10px] leading-4 text-white text-center font-semibold">
                            {notesByMatch[m.id].length}
                          </span>
                        )}
                      </button>

                      {canManageMatches && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Weet je zeker dat je deze wedstrijd wilt verwijderen?")) {
                              deleteMatch(m.id);
                            }
                          }}
                          className="p-2 rounded-lg border border-red-600 text-red-400 hover:bg-red-900/30"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {selectedMatch && (
          <div className="mt-4 border-t border-neutral-800 pt-4 space-y-3">
            <h4 className="text-sm font-semibold text-neutral-100">
              Opstelling voor geselecteerde wedstrijd (basis 8)
            </h4>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-xs text-neutral-400 mb-1 block">Basisspelers (selecteer 8)</label>
                <PlayersPicker
                  teams={teams}
                  homeTeamId={selectedMatch.homeTeamId}
                  awayTeamId={selectedMatch.awayTeamId}
                  selected={editPlayers}
                  onChange={setEditPlayers}
                  type="all"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={async () => {
                  try {
                    if (!Array.isArray(editPlayers) || editPlayers.length !== 8) {
                      alert("Selecteer precies 8 basisspelers voor deze wedstrijd.");
                      return;
                    }
                    await updateMatch(selectedMatch.id, {
                      players: editPlayers,
                    });
                    alert("Basisspelers opgeslagen voor deze wedstrijd. Bankspelers worden automatisch bepaald uit de overige teamleden.");
                  } catch (e) {
                    console.error("Fout bij opslaan basisspelers/wissels:", e);
                    alert("Opslaan mislukt, zie console voor details.");
                  }
                }}
                className="mt-2 px-4 py-2 rounded-xl bg-[#FF6124] text-white text-xs font-medium hover:opacity-90"
              >
                Opslaan voor deze wedstrijd
              </button>
            </div>
          </div>
        )}

      {/* Sequentie-playlist modal */}
      {sequenceModalMatchId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-5xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-semibold text-neutral-100">Clipplaylist per sequentie</h3>
              <button
                onClick={() => {
                  setSequenceModalMatchId("");
                  setSequenceSelectedId("");
                  setSequencePlaylistIndex(0);
                }}
                className="text-neutral-400 hover:text-white text-sm"
              >
                Sluiten
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <label className="text-xs text-neutral-400 block mb-1">Sequentie</label>
                <select
                  value={sequenceSelectedId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSequenceSelectedId(val);
                    setSequencePlaylistIndex(0);
                  }}
                  className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded-xl text-sm w-full"
                >
                  <option value="">— kies sequentie —</option>
                  {sequenceOptionsForModal.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bg-black rounded-2xl overflow-hidden mt-2">
              <video
                ref={sequenceVideoRef}
                className="w-full aspect-video"
                src={(() => {
                  if (!currentSeqClip || !currentSequenceMatch) return null;

                  const h = currentSeqClip.half || 1;
                  const urls = currentSequenceMatch.videoUrls || {};

                  // 1) Probeer match.videoUrls voor de juiste helft
                  let url = urls[`half${h}`] || null;

                  // 2) Val terug op een andere helft indien nodig
                  if (!url) {
                    url = urls.half1 || urls.half2 || null;
                  }

                  // 3) Probeer localStorage fallback (zelfde key als in AppDataContext)
                  if (!url) {
                    try {
                      const lsKey = `ka2_videos_${currentSequenceMatch.id}`;
                      const stored = JSON.parse(localStorage.getItem(lsKey) || "{}");
                      url = stored[`half${h}`] || stored.half1 || stored.half2 || null;
                    } catch (e) {
                      // negeer parse fouten
                    }
                  }

                  return url;
                })()}
                controls
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <button
                onClick={goToPrevSeqClipModal}
                className="px-3 py-2 rounded-xl bg-neutral-800 text-neutral-200 text-sm"
                disabled={!sequenceClipsForModal.length || sequencePlaylistIndex === 0}
              >
                Vorige
              </button>
              <button
                onClick={playCurrentSeqClipModal}
                className="px-4 py-2 rounded-xl bg-[#FF6124] text-white text-sm disabled:opacity-50"
                disabled={!sequenceClipsForModal.length || !currentSequenceMatch}
              >
                Speel huidige clip
              </button>
              <button
                onClick={goToNextSeqClipModal}
                className="px-3 py-2 rounded-xl bg-neutral-800 text-neutral-200 text-sm"
                disabled={!sequenceClipsForModal.length || sequencePlaylistIndex >= sequenceClipsForModal.length - 1}
              >
                Volgende
              </button>

              <span className="text-xs text-neutral-400 ml-auto">
                {sequenceClipsForModal.length
                  ? `Clip ${sequencePlaylistIndex + 1} van ${sequenceClipsForModal.length}`
                  : "Geen clips voor deze sequentie"}
              </span>
            </div>

            {sequenceClipsForModal.length > 0 && (
              <div className="max-h-64 overflow-y-auto mt-3 border-t border-neutral-800 pt-3 text-sm">
                <table className="w-full">
                  <thead className="text-neutral-400 text-xs">
                    <tr>
                      <th className="text-left py-1">#</th>
                      <th className="text-left py-1">Tijd</th>
                      <th className="text-left py-1">Helft</th>
                      <th className="text-left py-1">Speler</th>
                      <th className="text-left py-1">Actie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sequenceClipsForModal.map((c, idx) => (
                      <tr
                        key={c.id || idx}
                        className={`border-t border-neutral-800 cursor-pointer hover:bg-neutral-900 ${
                          idx === sequencePlaylistIndex ? "bg-[#FF6124]/20" : ""
                        }`}
                        onClick={() => {
                          setSequencePlaylistIndex(idx);
                          playCurrentSeqClipModal();
                        }}
                      >
                        <td className="py-1 pr-2 text-neutral-400 text-xs">{idx + 1}</td>
                        <td className="py-1 pr-2">{fmt(c.time || 0)}</td>
                        <td className="py-1 pr-2">{c.half || 1}e</td>
                        <td className="py-1 pr-2">{(() => {
                          const teamPlayers = getTeamPlayers
                            ? [
                                ...(getTeamPlayers(currentSequenceMatch?.homeTeamId || "") || []),
                                ...(getTeamPlayers(currentSequenceMatch?.awayTeamId || "") || []),
                              ]
                            : [];
                          const p = teamPlayers.find((p) => p.id === c.playerId);
                          return p?.name || "Onbekend";
                        })()}</td>
                        <td className="py-1 pr-2">{c.actionType || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      {/* NOTES MODAL PER WEDSTRIJD */}
      {notesModalMatchId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-3xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-semibold text-neutral-100">Notes</h3>
              <button
                onClick={() => {
                  setNotesModalMatchId("");
                  setNotesDraft({ title: "", type: "leermoment", text: "" });
                }}
                className="text-neutral-400 hover:text-white text-sm"
              >
                Sluiten
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-400 block mb-1">Titel</label>
                <input
                  type="text"
                  value={notesDraft.title}
                  onChange={(e) => setNotesDraft((d) => ({ ...d, title: e.target.value }))}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-neutral-100"
                  placeholder="Bijv. Sneller terug in organisatie"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
                <div>
                  <label className="text-xs text-neutral-400 block mb-1">Type</label>
                  <select
                    value={notesDraft.type}
                    onChange={(e) => setNotesDraft((d) => ({ ...d, type: e.target.value }))}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-neutral-100"
                  >
                    <option value="leermoment">Leermoment</option>
                    <option value="beter_kan">Dingen die beter kunnen</option>
                    <option value="compliment">Compliment</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs text-neutral-400 block mb-1">Beschrijving</label>
                  <textarea
                    rows={4}
                    value={notesDraft.text}
                    onChange={(e) => setNotesDraft((d) => ({ ...d, text: e.target.value }))}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-neutral-100 resize-none"
                    placeholder="Omschrijf kort wat je wilt meegeven aan het team."
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!notesDraft.title.trim() && !notesDraft.text.trim()) {
                      alert("Vul minimaal een titel of beschrijving in.");
                      return;
                    }
                    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    const list = notesByMatch[notesModalMatchId] || [];
                    const next = [
                      {
                        id,
                        title: notesDraft.title.trim() || "(zonder titel)",
                        type: notesDraft.type,
                        text: notesDraft.text.trim(),
                        likes: 0,
                        createdAt: new Date().toISOString(),
                      },
                      ...list,
                    ];
                    setNotesByMatch((prev) => ({
                      ...prev,
                      [notesModalMatchId]: next,
                    }));
                    if (notesModalMatchId) {
                      updateMatch(notesModalMatchId, { notes: next });
                    }
                    setNotesDraft({ title: "", type: "leermoment", text: "" });
                  }}
                  className="px-4 py-2 rounded-xl bg-[#FF6124] text-white text-sm font-medium hover:opacity-90"
                >
                  Opslaan
                </button>
              </div>
            </div>

            <div className="border-t border-neutral-800 pt-3 mt-2 space-y-2">
              <h4 className="text-sm font-semibold text-neutral-200">Bestaande notes</h4>
              {!(notesByMatch[notesModalMatchId] || []).length ? (
                <div className="text-xs text-neutral-500">
                  Nog geen notes voor deze wedstrijd.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {(notesByMatch[notesModalMatchId] || []).map((n) => (
                    <div
                      key={n.id}
                      className="border border-neutral-800 rounded-xl px-3 py-2 text-sm flex items-start gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs uppercase tracking-wide text-[#FF6124]">
                            {n.type === "leermoment"
                              ? "Leermoment"
                              : n.type === "beter_kan"
                              ? "Beter kan"
                              : "Compliment"}
                          </span>
                          <span className="text-xs text-neutral-500">
                            {new Date(n.createdAt).toLocaleString("nl-NL", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </span>
                        </div>
                        <div className="font-medium text-neutral-100 text-sm">
                          {n.title}
                        </div>
                        {n.text && (
                          <div className="text-xs text-neutral-300 mt-1 whitespace-pre-line">
                            {n.text}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-stretch gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const list = notesByMatch[notesModalMatchId] || [];
                            const next = list.map((x) =>
                              x.id === n.id ? { ...x, likes: (x.likes || 0) + 1 } : x
                            );
                            setNotesByMatch((prev) => ({
                              ...prev,
                              [notesModalMatchId]: next,
                            }));
                            if (notesModalMatchId) {
                              updateMatch(notesModalMatchId, { notes: next });
                            }
                          }}
                          className="flex flex-col items-center justify-center text-xs px-2 py-1 rounded-lg border border-neutral-700 text-neutral-300 hover:border-[#FF6124] hover:text-[#FF6124]"
                        >
                          <span>♥</span>
                          <span className="mt-0.5 text-[10px]">{n.likes || 0}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const list = notesByMatch[notesModalMatchId] || [];
                            const next = list.filter((x) => x.id !== n.id);
                            setNotesByMatch((prev) => ({
                              ...prev,
                              [notesModalMatchId]: next,
                            }));
                            if (notesModalMatchId) {
                              updateMatch(notesModalMatchId, { notes: next });
                            }
                          }}
                          className="text-[10px] px-2 py-1 rounded-lg border border-red-700 text-red-400 hover:bg-red-900/30"
                        >
                          Verwijder
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {chancePrompt && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center">
          <div className="bg-neutral-900 border border-[#FF6124] rounded-xl p-6">
            <h3 className="text-xl text-[#FF6124] font-bold">{chancePrompt.action.label}</h3>
            <p className="text-neutral-300 mb-4">Resultaat?</p>
            <div className="flex gap-4 justify-center">
              <button onClick={() => confirmChance("goal")} className="bg-green-600 px-4 py-2 rounded text-white">Raak</button>
              <button onClick={() => confirmChance("miss")} className="bg-neutral-700 px-4 py-2 rounded text-white">Mis</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function PlayersPicker({ teams, homeTeamId, awayTeamId, selected, onChange, type }) {
  const homeTeam = teams.find(t => t.id === homeTeamId);
  const awayTeam = teams.find(t => t.id === awayTeamId);

  function dedupe(list) {
    const seen = new Set();
    return list.filter((p) => {
      if (!p?.id) return false;
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  const sections = [];

  if (homeTeam) {
    const players = (type === "subs") ? [] : dedupe([...(homeTeam.players || [])]);
    const subs = (type === "players") ? [] : dedupe([...(homeTeam.subs || [])]);
    if (players.length || subs.length) {
      sections.push({ key: `home-${homeTeam.id}`, players, subs });
    }
  }

  if (awayTeam) {
    const players = (type === "subs") ? [] : dedupe([...(awayTeam.players || [])]);
    const subs = (type === "players") ? [] : dedupe([...(awayTeam.subs || [])]);
    if (players.length || subs.length) {
      sections.push({ key: `away-${awayTeam.id}`, players, subs });
    }
  }

  function toggle(id) {
    if (selected.includes(id)) {
      onChange(selected.filter(x => x !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  return (
    <div className="space-y-2">
      {sections.length === 0 && (
        <div className="text-neutral-500 text-sm">Voeg spelers toe aan teams.</div>
      )}

      {sections.map((section, idx) => (
        <div key={section.key} className={idx > 0 ? "pt-1 border-t border-neutral-900" : ""}>
          {section.players.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {section.players.map((p) => (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`px-3 py-2 rounded-xl border text-sm ${
                    selected.includes(p.id)
                      ? "border-[#FF6124] bg-[#FF6124]/15"
                      : "border-neutral-800 bg-neutral-900 hover:border-[#FF6124]/50"
                  }`}
                >
                  {p.number ? `#${p.number} ` : ""}{p.name}
                </button>
              ))}
            </div>
          )}

          {section.subs.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1">
              {section.subs.map((p) => (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`px-3 py-2 rounded-xl border text-sm ${
                    selected.includes(p.id)
                      ? "border-[#FF6124] bg-[#FF6124]/15"
                      : "border-neutral-800 bg-neutral-900 hover:border-[#FF6124]/50"
                  }`}
                >
                  {p.number ? `#${p.number} ` : ""}{p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}