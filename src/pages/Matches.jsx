// src/pages/Matches.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Upload, ChevronLeft, ChevronRight, Plus, Trash2, FileText, Wrench, ArrowLeftRight, RotateCcw } from "lucide-react";
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
  { id: "schot_3m", label: "Schot <3m", isChance: true },
  { id: "schot_6m", label: "Schot <6m", isChance: true },
  { id: "schot_9m", label: "Schot <9m", isChance: true },
  { id: "rebound_win", label: "Rebound (win)", isChance: false },
  { id: "rebound_lose", label: "Rebound (Verlies)", isChance: false },
  { id: "balverlies", label: "Balverlies", isChance: false },
];

const DEFENSE_ACTIONS = [
  { id: "rebound_def_win", label: "Rebound verd. (win)", isChance: false },
  { id: "rebound_def_lose", label: "Rebound verd. (Verlies)", isChance: false },
  { id: "balverlies", label: "Balverlies", isChance: false },
  { id: "verdedigd", label: "Verdedigd", isChance: false },
  { id: "onderschepping", label: "Onderschepping", isChance: false },
  { id: "overtreding", label: "Overtreding", isChance: false },
];

const OPPONENT_GOALS = [
  { id: "tegen_schot_3m", label: "Tegenstander Schot <3m" },
  { id: "tegen_schot_6m", label: "Tegenstander Schot <6m" },
  { id: "tegen_schot_9m", label: "Tegenstander Schot <9m" },
];

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

const DEFAULT_PRE = 4;
const DEFAULT_POST = 6;
const clipPre = (c) => (typeof c.pre === "number" ? c.pre : DEFAULT_PRE);
const clipPost = (c) => (typeof c.post === "number" ? c.post : DEFAULT_POST);

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

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
    phase: "zaal",
    homeTeamId: "",
    awayTeamId: "",
    homeScore: "",
    awayScore: "",
    seasonId: "",
    players: [], // basis 8; bank wordt automatisch bepaald uit teamspelers - basis 8
    vakken: { vak1: [], vak2: [] },
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

  const [editMatchId, setEditMatchId] = useState("");
  const editingMatch = useMemo(
    () => matches.find((m) => m.id === editMatchId) || null,
    [matches, editMatchId]
  );
  const [editDraft, setEditDraft] = useState({
    date: "",
    homeScore: "",
    awayScore: "",
    location: "",
    seasonId: "",
    seasonName: "",
    homeTeamId: "",
    awayTeamId: "",
  });

  // Bewerkbare vakken voor geselecteerde wedstrijd
  const [editVakken, setEditVakken] = useState({ vak1: [], vak2: [] });

  useEffect(() => {
    if (!selectedMatch) {
      setEditVakken({ vak1: [], vak2: [] });
      return;
    }
    if (selectedMatch.vakken && Array.isArray(selectedMatch.vakken.vak1) && Array.isArray(selectedMatch.vakken.vak2)) {
      setEditVakken({
        vak1: [...selectedMatch.vakken.vak1],
        vak2: [...selectedMatch.vakken.vak2],
      });
      return;
    }
    const ids = selectedMatch.players || [];
    setEditVakken({ vak1: ids.slice(0, 4), vak2: ids.slice(4) });
  }, [selectedMatch]);

  useEffect(() => {
    if (!editingMatch) {
      setEditDraft({
        date: "",
        homeScore: "",
        awayScore: "",
        location: "",
        seasonId: "",
        seasonName: "",
        homeTeamId: "",
        awayTeamId: "",
      });
      return;
    }
    setEditDraft({
      date: editingMatch.date || "",
      homeScore: String(editingMatch.homeScore ?? ""),
      awayScore: String(editingMatch.awayScore ?? ""),
      location: editingMatch.location || "",
      seasonId: editingMatch.seasonId || "",
      seasonName: editingMatch.seasonName || "",
      homeTeamId: editingMatch.homeTeamId || "",
      awayTeamId: editingMatch.awayTeamId || "",
    });
  }, [editingMatch]);

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
  const [seqAutoAdvance, setSeqAutoAdvance] = useState(true);
  const pendingSeekRef = useRef(null);
  const stopAtRef = useRef(null);
  const internalSeekRef = useRef(false);
  const seqModalRef = useRef(null);

  const allowedManageEmails = [
    "dlammetje@gmail.com",
    "lvandeuveren91@gmail.com",
  ];

  const canManageMatches =
    !!currentUser &&
    !!currentUser.email &&
    allowedManageEmails.includes(currentUser.email);

  // --- Afgeleide team/seizoen lijsten voor dropdowns ---
  const homeTeamObj = teams.find(t => t.id === newMatch.homeTeamId) || null;
  const awayTeamObj = teams.find(t => t.id === newMatch.awayTeamId) || null;

  const allSeasons = useMemo(() => {
    if (!Array.isArray(teams)) return [];
    return teams.flatMap((t) =>
      (t.seasons || []).map((s) => ({ ...s, teamId: t.id, teamName: t.name }))
    );
  }, [teams]);

  const selectedSeason = useMemo(() => {
    return allSeasons.find((s) => s.id === newMatch.seasonId) || null;
  }, [allSeasons, newMatch.seasonId]);

  const selectedSeasonTeam = useMemo(() => {
    return selectedSeason ? teams.find((t) => t.id === selectedSeason.teamId) || null : null;
  }, [selectedSeason, teams]);

  const selectedSeasonOpponents = selectedSeason?.opponents || null;

  const editSeason = useMemo(() => {
    return allSeasons.find((s) => s.id === editDraft.seasonId) || null;
  }, [allSeasons, editDraft.seasonId]);

  const editSeasonTeam = useMemo(() => {
    return editSeason ? teams.find((t) => t.id === editSeason.teamId) || null : null;
  }, [editSeason, teams]);

  const editSeasonOpponents = editSeason?.opponents || null;

  // Tegenstanders van het geselecteerde seizoen gebruiken; anders de algemene tegenstanders van thuisteam of uitteam
  const seasonOrTeamOpponents = newMatch.seasonId && Array.isArray(selectedSeasonOpponents) && selectedSeasonOpponents.length
    ? selectedSeasonOpponents
    : Array.isArray(homeTeamObj?.opponents) && homeTeamObj.opponents.length
    ? homeTeamObj.opponents
    : Array.isArray(awayTeamObj?.opponents) && awayTeamObj.opponents.length
    ? awayTeamObj.opponents
    : null;

  // Zet speelveld (zaal/veld) automatisch bij seizoenswissel, maar overschrijf teams NIET
  useEffect(() => {
    if (!selectedSeason) return;
    setNewMatch((m) => ({
      ...m,
      phase: selectedSeason.part === "zaal" ? "zaal" : "veld",
    }));
  }, [selectedSeason]);

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

  // Video-URL voor de huidige sequentie-clip (alleen de juiste helft, geen cross-half fallback)
  const seqVideoSrc = useMemo(() => {
    if (!currentSeqClip || !currentSequenceMatch) return null;
    const h = currentSeqClip.half || 1;
    const urls = currentSequenceMatch.videoUrls || {};
    let url = urls[`half${h}`] || null;
    if (!url) {
      try {
        const stored = JSON.parse(
          localStorage.getItem(`ka2_videos_${currentSequenceMatch.id}`) || "{}"
        );
        url = stored[`half${h}`] || null;
      } catch (e) {
        // negeer parse fouten
      }
    }
    return url;
  }, [currentSeqClip, currentSequenceMatch]);

  // Spelers van thuis- en uitteam van de wedstrijd in de sequentie-modal
  const seqPlayers = useMemo(() => {
    if (!currentSequenceMatch || !getTeamPlayers) return [];
    return [
      ...(getTeamPlayers(currentSequenceMatch.homeTeamId || "") || []),
      ...(getTeamPlayers(currentSequenceMatch.awayTeamId || "") || []),
    ];
  }, [currentSequenceMatch, getTeamPlayers]);

  function playSeqClip(idx, autoplay = true) {
    if (!sequenceClipsForModal.length) return;
    const clamped = Math.max(0, Math.min(sequenceClipsForModal.length - 1, idx));
    pendingSeekRef.current = { idx: clamped, autoplay };
    // Zelfde clip (bijv. "Opnieuw"): index verandert niet, dus het effect draait niet — direct toepassen
    if (clamped === sequencePlaylistIndex) applyPendingSeek();
    else setSequencePlaylistIndex(clamped);
  }

  function applyPendingSeek() {
    const v = sequenceVideoRef.current;
    const pending = pendingSeekRef.current;
    if (!v || !pending) return;
    const clip = sequenceClipsForModal[pending.idx];
    if (!clip) {
      pendingSeekRef.current = null;
      return;
    }
    if (v.readyState < 1) return;
    internalSeekRef.current = true;
    v.currentTime = Math.max(0, (clip.time || 0) - clipPre(clip));
    setTimeout(() => {
      internalSeekRef.current = false;
    }, 0);
    if (pending.autoplay) v.play().catch(() => {});
    pendingSeekRef.current = null;
    stopAtRef.current = (clip.time || 0) + clipPost(clip);
  }

  useEffect(() => {
    applyPendingSeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequencePlaylistIndex, seqVideoSrc, sequenceSelectedId]);

  // Selecteer automatisch de eerste sequentie als de modal opent
  useEffect(() => {
    if (!sequenceModalMatchId) return;
    if (!sequenceSelectedId && sequenceOptionsForModal.length) {
      setSequenceSelectedId(sequenceOptionsForModal[0].id);
      setSequencePlaylistIndex(0);
      pendingSeekRef.current = { idx: 0, autoplay: false };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceModalMatchId, sequenceOptionsForModal, sequenceSelectedId]);

  // Scroll de actieve clip-kaart in beeld
  useEffect(() => {
    const el = seqModalRef.current?.querySelector(
      `[data-seq-idx="${sequencePlaylistIndex}"]`
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [sequencePlaylistIndex, sequenceSelectedId]);

  // Toetsenbord: Esc sluit, pijlen = vorige/volgende clip, spatie = play/pause
  useEffect(() => {
    if (!sequenceModalMatchId) return;
    function onKey(e) {
      const tag = e.target && e.target.tagName;
      const inField = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
      if (e.key === "Escape") {
        closeSeqModal();
      } else if (inField) {
        return;
      } else if (e.key === "ArrowLeft") {
        playSeqClip(sequencePlaylistIndex - 1);
      } else if (e.key === "ArrowRight") {
        playSeqClip(sequencePlaylistIndex + 1);
      } else if (e.key === " ") {
        e.preventDefault();
        const v = sequenceVideoRef.current;
        if (v) v.paused ? v.play().catch(() => {}) : v.pause();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceModalMatchId, sequencePlaylistIndex, sequenceClipsForModal]);

  function closeSeqModal() {
    setSequenceModalMatchId("");
    setSequenceSelectedId("");
    setSequencePlaylistIndex(0);
    pendingSeekRef.current = null;
    stopAtRef.current = null;
    internalSeekRef.current = false;
  }

  async function handleCreateMatch() {
  if (!newMatch.seasonId) {
    alert("Selecteer eerst een seizoen. Elke wedstrijd moet aan een seizoen worden gekoppeld.");
    return;
  }
  if (!newMatch.date || !newMatch.homeTeamId || !newMatch.awayTeamId) {
    alert("Vul minimaal datum, thuisteam en uitteam in.");
    return;
  }
  if (newMatch.homeTeamId === newMatch.awayTeamId) {
    alert("Thuisteam en uitteam mogen niet hetzelfde team zijn.");
    return;
  }

  if (!newMatch.vakken || newMatch.vakken.vak1.length !== 4 || newMatch.vakken.vak2.length !== 4) {
    alert("Selecteer 4 spelers per vak (Vak 1 en Vak 2).");
    return;
  }

  try {
    console.log("➡️ Nieuwe wedstrijd opslaan:", newMatch);

    const seasonLabel = selectedSeason ? `${selectedSeason.name} · ${selectedSeason.part === "zaal" ? "Zaal" : selectedSeason.part === "veld_voorjaar" ? "Veld voorjaar" : "Veld najaar"}` : "";

    const id = await addMatch({
      ...newMatch,
      players: [...newMatch.vakken.vak1, ...newMatch.vakken.vak2],
      homeScore: Number(newMatch.homeScore || 0),
      awayScore: Number(newMatch.awayScore || 0),
      seasonName: seasonLabel,
      clubId: userClubId || null,
    });

    console.log("✅ Wedstrijd opgeslagen met ID:", id);

    setSelectedMatchId(id);

    // Reset formulier
    setNewMatch({
      date: "",
      phase: "zaal",
      homeTeamId: "",
      awayTeamId: "",
      homeScore: "",
      awayScore: "",
      seasonId: "",
      players: [],
      vakken: { vak1: [], vak2: [] },
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

    const ourTeamId = selectedHomeTeam?.id || selectedAwayTeam?.id || selectedMatch.homeTeamId;

    const base = {
      matchId: selectedMatch.id,
      playerId: opponent ? "" : playerId,
      teamId: opponent ? "" : ourTeamId,
      time: now,
      half: currentHalf,
      phase: opponent ? "defense" : phase,
      zone,
      actionType: action.id,
      result: opponent ? "opp_goal" : null,
      opponentGoal: opponent,
      clubId: userClubId || null,
      pre: prePost.pre,
      post: prePost.post,
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
    const start = Math.max(0, c.time - clipPre(c));
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
          {/* SEASON */}
          <div>
            <label className="text-xs text-neutral-400">Seizoen *</label>
            <select
              value={newMatch.seasonId}
              onChange={e => {
                const seasonId = e.target.value;
                const season = allSeasons.find((s) => s.id === seasonId) || null;
                setNewMatch(m => ({
                  ...m,
                  seasonId,
                  phase: season?.part === "zaal" ? "zaal" : (season?.part ? "veld" : m.phase),
                }));
              }}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
            >
              <option value="">— Kies seizoen —</option>
              {allSeasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.teamName ? `${season.teamName} · ` : ""}{season.name} · {season.part === "zaal" ? "Zaal" : season.part === "veld_voorjaar" ? "Veld voorjaar" : "Veld najaar"}
                </option>
              ))}
            </select>
          </div>

          {/* HOME TEAM */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-neutral-400">Thuisteam *</label>
              <button
                type="button"
                onClick={() => setNewMatch(m => ({ ...m, homeTeamId: m.awayTeamId, awayTeamId: m.homeTeamId }))}
                className="text-[11px] text-[#FF6124] hover:text-[#ff7a45] flex items-center gap-1 transition-colors"
                title="Wissel thuisteam en uitteam om"
              >
                <ArrowLeftRight size={11} /> Wissel thuis/uit
              </button>
            </div>
            <select
              value={newMatch.homeTeamId}
              onChange={e => setNewMatch(m => ({ ...m, homeTeamId: e.target.value }))}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
            >
              <option value="">— Kies thuisteam —</option>
              {selectedSeasonTeam && (
                <optgroup label="Eigen team (seizoen)">
                  <option value={selectedSeasonTeam.id}>{selectedSeasonTeam.name}</option>
                </optgroup>
              )}
              {selectedSeasonOpponents && selectedSeasonOpponents.length > 0 && (
                <optgroup label="Tegenstanders (seizoen)">
                  {selectedSeasonOpponents.map((name, i) => (
                    <option key={i} value={name}>{name}</option>
                  ))}
                </optgroup>
              )}
              {teams.filter(t => t.id !== selectedSeasonTeam?.id).length > 0 && (
                <optgroup label={selectedSeasonTeam ? "Overige eigen teams" : "Eigen teams"}>
                  {teams.filter(t => t.id !== selectedSeasonTeam?.id).map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* AWAY TEAM */}
          <div>
            <label className="text-xs text-neutral-400 block mb-1">Uitteam *</label>
            <select
              value={newMatch.awayTeamId}
              onChange={e => setNewMatch(m => ({ ...m, awayTeamId: e.target.value }))}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
            >
              <option value="">— Kies uitteam —</option>
              {selectedSeasonTeam && (
                <optgroup label="Eigen team (seizoen)">
                  <option value={selectedSeasonTeam.id}>{selectedSeasonTeam.name}</option>
                </optgroup>
              )}
              {selectedSeasonOpponents && selectedSeasonOpponents.length > 0 && (
                <optgroup label="Tegenstanders (seizoen)">
                  {selectedSeasonOpponents.map((name, i) => (
                    <option key={i} value={name}>{name}</option>
                  ))}
                </optgroup>
              )}
              {teams.filter(t => t.id !== selectedSeasonTeam?.id).length > 0 && (
                <optgroup label={selectedSeasonTeam ? "Overige eigen teams" : "Eigen teams"}>
                  {teams.filter(t => t.id !== selectedSeasonTeam?.id).map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {newMatch.seasonId && !selectedSeasonOpponents?.length && (
              <p className="text-[10px] text-amber-400 mt-1">Geen tegenstanders voor dit seizoen ingesteld bij Teams & Spelers.</p>
            )}
          </div>

          <div>
            <label className="text-xs text-neutral-400">Datum *</label>
            <input type="date" value={newMatch.date}
              onChange={e => setNewMatch(m => ({ ...m, date: e.target.value }))}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm" />
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

          {/* PLAYERS: kies 2 vakken van 4 basisspelers; rest wordt bank */}
          <div className="md:col-span-3">
            <label className="text-xs text-neutral-400 mb-1">Basisspelers (4 per vak)</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-2">
                <div className="text-xs font-semibold text-neutral-300 mb-1">
                  Vak 1 ({newMatch.vakken.vak1.length}/4)
                </div>
                <PlayersPicker
                  teams={teams}
                  homeTeamId={newMatch.homeTeamId}
                  awayTeamId={newMatch.awayTeamId}
                  seasonTeamId={selectedSeasonTeam?.id}
                  selected={newMatch.vakken.vak1}
                  onChange={ids => setNewMatch(m => ({ ...m, vakken: { ...m.vakken, vak1: ids } }))}
                  type="all"
                  max={4}
                  exclude={newMatch.vakken.vak2}
                />
              </div>
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-2">
                <div className="text-xs font-semibold text-neutral-300 mb-1">
                  Vak 2 ({newMatch.vakken.vak2.length}/4)
                </div>
                <PlayersPicker
                  teams={teams}
                  homeTeamId={newMatch.homeTeamId}
                  awayTeamId={newMatch.awayTeamId}
                  seasonTeamId={selectedSeasonTeam?.id}
                  selected={newMatch.vakken.vak2}
                  onChange={ids => setNewMatch(m => ({ ...m, vakken: { ...m.vakken, vak2: ids } }))}
                  type="all"
                  max={4}
                  exclude={newMatch.vakken.vak1}
                />
              </div>
            </div>
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

                const homeTeam = teams.find((t) => t.id === m.homeTeamId);
                const awayTeam = teams.find((t) => t.id === m.awayTeamId);

                const isOurTeamHome = !!(homeTeam && (homeTeam.name || "").toLowerCase().includes("sparta"));
                const isOurTeamAway = !!(awayTeam && (awayTeam.name || "").toLowerCase().includes("sparta"));

                if (homeName === "Onbekend team" && homeTeam) {
                  homeName = homeTeam.name || homeName;
                }
                if (awayName === "Onbekend team" && awayTeam) {
                  awayName = awayTeam.name || awayName;
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
                    onClick={() => navigate(`/match/${m.id}`)}
                    className={
                      "border-t border-neutral-800 cursor-pointer hover:bg-neutral-800/60" +
                      (isSelected ? " bg-neutral-800" : "")
                    }
                  >
                    <td className="py-2">{formattedDate}</td>
                    <td className="py-2">
                      <span
                        className={
                          isOurTeamHome
                            ? "inline-flex items-center gap-2 rounded-xl bg-[#FF6124]/20 px-3 py-1 font-semibold text-[#FF6124] ring-1 ring-[#FF6124]/40"
                            : ""
                        }
                      >
                        {homeName}
                      </span>
                    </td>
                    <td className="py-2">
                      <span
                        className={
                          isOurTeamAway
                            ? "inline-flex items-center gap-2 rounded-xl bg-[#FF6124]/20 px-3 py-1 font-semibold text-[#FF6124] ring-1 ring-[#FF6124]/40"
                            : ""
                        }
                      >
                        {awayName}
                      </span>
                    </td>
                    <td className="py-2">
                      {homeScore} - {awayScore}
                    </td>
                    <td className="py-2 text-right flex items-center justify-end gap-3">
                      {canManageMatches && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditMatchId(m.id);
                          }}
                          className="p-2 rounded-lg border border-neutral-600 text-neutral-200 hover:border-[#FF6124] hover:text-[#FF6124]"
                          title="Bewerk"
                        >
                          <Wrench size={14} />
                        </button>
                      )}

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
              Opstelling voor geselecteerde wedstrijd (2 vakken van 4)
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-2">
                <div className="text-xs font-semibold text-neutral-300 mb-1">
                  Vak 1 ({editVakken.vak1.length}/4)
                </div>
                <PlayersPicker
                  teams={teams}
                  homeTeamId={selectedMatch.homeTeamId}
                  awayTeamId={selectedMatch.awayTeamId}
                  selected={editVakken.vak1}
                  onChange={ids => setEditVakken(v => ({ ...v, vak1: ids }))}
                  type="all"
                  max={4}
                  exclude={editVakken.vak2}
                />
              </div>
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-2">
                <div className="text-xs font-semibold text-neutral-300 mb-1">
                  Vak 2 ({editVakken.vak2.length}/4)
                </div>
                <PlayersPicker
                  teams={teams}
                  homeTeamId={selectedMatch.homeTeamId}
                  awayTeamId={selectedMatch.awayTeamId}
                  selected={editVakken.vak2}
                  onChange={ids => setEditVakken(v => ({ ...v, vak2: ids }))}
                  type="all"
                  max={4}
                  exclude={editVakken.vak1}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={async () => {
                  try {
                    if (editVakken.vak1.length !== 4 || editVakken.vak2.length !== 4) {
                      alert("Selecteer 4 spelers per vak (Vak 1 en Vak 2).");
                      return;
                    }
                    await updateMatch(selectedMatch.id, {
                      players: [...editVakken.vak1, ...editVakken.vak2],
                      vakken: { vak1: editVakken.vak1, vak2: editVakken.vak2 },
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
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeSeqModal}
        >
          <div
            ref={seqModalRef}
            className="bg-neutral-900 border border-neutral-700/60 rounded-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-neutral-800">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-neutral-100">Sequenties</h3>
                <div className="text-xs text-neutral-500">
                  {currentSequenceMatch
                    ? `${formatMatchDate(currentSequenceMatch.date)} ${formatTeamName(currentSequenceMatch.homeTeamId, teams)} vs ${formatTeamName(currentSequenceMatch.awayTeamId, teams)}`
                    : ""}
                </div>
              </div>
              <button
                onClick={closeSeqModal}
                className="text-neutral-400 hover:text-white text-xl leading-none px-1"
                aria-label="Sluiten"
              >
                ✕
              </button>
            </div>

            {/* Sequentie-keuze */}
            {sequenceOptionsForModal.length === 0 ? (
              <div className="p-6 text-sm text-neutral-500 text-center">
                Nog geen sequenties voor deze wedstrijd.
              </div>
            ) : (
              <div className="px-4 pt-3 flex items-center gap-3">
                <label className="text-xs text-neutral-400">Sequentie</label>
                <select
                  value={sequenceSelectedId}
                  onChange={(e) => {
                    setSequenceSelectedId(e.target.value);
                    setSequencePlaylistIndex(0);
                    pendingSeekRef.current = { idx: 0, autoplay: false };
                  }}
                  className="bg-neutral-800 border border-neutral-700 px-3 py-2 rounded-xl text-sm min-w-[220px] focus:outline-none focus:border-[#FF6124]"
                >
                  {sequenceOptionsForModal.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Body: video links, cliplijst rechts */}
            <div className="grid lg:grid-cols-3 gap-4 p-4 overflow-y-auto">
              <div className="lg:col-span-2 space-y-3">
                {currentSeqClip && seqVideoSrc ? (
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                    <video
                      ref={sequenceVideoRef}
                      className="w-full h-full"
                      src={seqVideoSrc}
                      controls
                      playsInline
                      onLoadedMetadata={applyPendingSeek}
                      onTimeUpdate={() => {
                        const v = sequenceVideoRef.current;
                        if (!v || !stopAtRef.current) return;
                        if (v.currentTime >= stopAtRef.current) {
                          stopAtRef.current = null;
                          if (
                            seqAutoAdvance &&
                            sequencePlaylistIndex < sequenceClipsForModal.length - 1
                          ) {
                            playSeqClip(sequencePlaylistIndex + 1);
                          } else {
                            v.pause();
                          }
                        }
                      }}
                      onSeeking={() => {
                        if (!internalSeekRef.current) stopAtRef.current = null;
                      }}
                    />
                    <span className="absolute top-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] text-white pointer-events-none">
                      Clip {sequencePlaylistIndex + 1} / {sequenceClipsForModal.length} ·{" "}
                      {currentSeqClip.half || 1}e helft · {fmt(currentSeqClip.time || 0)}
                    </span>
                  </div>
                ) : currentSeqClip ? (
                  <div className="rounded-xl bg-neutral-950 aspect-video flex items-center justify-center text-sm text-neutral-500 text-center px-6">
                    Beeld van de {currentSeqClip.half || 1}e helft is nog niet geüpload.
                  </div>
                ) : (
                  <div className="rounded-xl bg-neutral-950 aspect-video flex items-center justify-center text-sm text-neutral-500">
                    Geen clips voor deze sequentie.
                  </div>
                )}

                {/* Bediening */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => playSeqClip(sequencePlaylistIndex - 1)}
                    disabled={sequencePlaylistIndex === 0}
                    className="p-2 rounded-xl bg-neutral-800 text-neutral-200 disabled:opacity-40 hover:bg-neutral-700"
                    title="Vorige"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={() => playSeqClip(sequencePlaylistIndex)}
                    disabled={!currentSeqClip || !seqVideoSrc}
                    className="w-11 h-11 rounded-full bg-[#FF6124] text-white flex items-center justify-center disabled:opacity-40 hover:opacity-90"
                    title="Opnieuw afspelen"
                  >
                    <RotateCcw size={18} />
                  </button>
                  <button
                    onClick={() => playSeqClip(sequencePlaylistIndex + 1)}
                    disabled={sequencePlaylistIndex >= sequenceClipsForModal.length - 1}
                    className="p-2 rounded-xl bg-neutral-800 text-neutral-200 disabled:opacity-40 hover:bg-neutral-700"
                    title="Volgende"
                  >
                    <ChevronRight size={18} />
                  </button>

                  <label className="ml-auto flex items-center gap-2 text-xs text-neutral-400 cursor-pointer">
                    Automatisch door
                    <button
                      type="button"
                      onClick={() => setSeqAutoAdvance((v) => !v)}
                      className={`w-8 h-5 rounded-full transition-colors relative ${
                        seqAutoAdvance ? "bg-[#FF6124]" : "bg-neutral-700"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                          seqAutoAdvance ? "left-3.5" : "left-0.5"
                        }`}
                      />
                    </button>
                  </label>
                </div>

                {/* Segment-balken per clip */}
                {sequenceClipsForModal.length > 0 && (
                  <div className="flex gap-1">
                    {sequenceClipsForModal.map((c, i) => (
                      <button
                        key={c.id || i}
                        type="button"
                        onClick={() => playSeqClip(i)}
                        title={`Clip ${i + 1} · ${fmt(c.time || 0)}`}
                        className={`h-1.5 flex-1 rounded-full transition-colors ${
                          i === sequencePlaylistIndex
                            ? "bg-[#FF6124]"
                            : i < sequencePlaylistIndex
                            ? "bg-neutral-400"
                            : "bg-neutral-700 hover:bg-neutral-600"
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Cliplijst */}
              <div className="lg:max-h-[60vh] overflow-y-auto pr-1">
                <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1.5 px-1">
                  Momenten ({sequenceClipsForModal.length})
                </div>
                <div className="divide-y divide-neutral-800/80">
                  {sequenceClipsForModal.map((c, idx) => {
                    const p = seqPlayers.find((pl) => pl.id === c.playerId);
                    const active = idx === sequencePlaylistIndex;
                    return (
                      <div
                        key={c.id || idx}
                        data-seq-idx={idx}
                        onClick={() => playSeqClip(idx)}
                        className={`flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer border-l-2 transition-colors ${
                          active
                            ? "border-[#FF6124] bg-[#FF6124]/10 text-neutral-100"
                            : "border-transparent text-neutral-300 hover:bg-neutral-800/60"
                        }`}
                      >
                        <span className={`w-4 text-right tabular-nums ${active ? "text-[#FF6124] font-semibold" : "text-neutral-500"}`}>
                          {idx + 1}
                        </span>
                        <span className="flex-1 min-w-0 truncate">
                          {formatActionLabel(c.actionType)}
                          <span className="text-neutral-500">
                            {" · "}
                            {p ? `${p.number ? `#${p.number} ` : ""}${p.name}` : "Onbekend"}
                          </span>
                        </span>
                        {(c.result === "goal" || c.result === "miss") && (
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.result === "goal" ? "bg-green-500" : "bg-red-500"}`} title={c.result === "goal" ? "Raak" : "Mis"} />
                        )}
                        <span className="text-[10px] text-neutral-500 tabular-nums whitespace-nowrap">
                          {c.half || 1}e · {fmt(c.time || 0)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
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

      {/* EDIT MATCH MODAL */}
      {editingMatch && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-lg space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-neutral-100">Wedstrijd bewerken</h3>
              <button
                onClick={() => setEditMatchId("")}
                className="text-neutral-400 hover:text-white text-sm"
              >
                Sluiten
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs text-neutral-400 block mb-1">Seizoen</label>
                <select
                  value={editDraft.seasonId}
                  onChange={(e) => {
                    const seasonId = e.target.value;
                    const season = allSeasons.find((s) => s.id === seasonId) || null;
                    const seasonLabel = season
                      ? `${season.teamName ? `${season.teamName} · ` : ""}${season.name} · ${season.part === "zaal" ? "Zaal" : season.part === "veld_voorjaar" ? "Veld voorjaar" : "Veld najaar"}`
                      : "";
                    setEditDraft((d) => ({ ...d, seasonId, seasonName: seasonLabel }));
                  }}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                >
                  <option value="">— Geen seizoen —</option>
                  {allSeasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.teamName ? `${season.teamName} · ` : ""}{season.name} · {season.part === "zaal" ? "Zaal" : season.part === "veld_voorjaar" ? "Veld voorjaar" : "Veld najaar"}
                    </option>
                  ))}
                </select>
              </div>

              {/* TEAMS HEADER + SWITCH KNOP */}
              <div className="md:col-span-2 flex items-center justify-between pt-1 border-t border-neutral-800">
                <span className="text-xs font-semibold text-neutral-300">Teams</span>
                <button
                  type="button"
                  onClick={() => {
                    setEditDraft((d) => ({
                      ...d,
                      homeTeamId: d.awayTeamId,
                      awayTeamId: d.homeTeamId,
                      homeScore: d.awayScore,
                      awayScore: d.homeScore,
                    }));
                  }}
                  className="text-xs text-[#FF6124] hover:text-[#ff7a45] flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#FF6124]/40 bg-[#FF6124]/10 transition-colors font-medium"
                  title="Wissel thuisteam en uitteam (inclusief scores) om"
                >
                  <ArrowLeftRight size={13} /> Wissel thuis / uit
                </button>
              </div>

              {/* HOME TEAM */}
              <div>
                <label className="text-xs text-neutral-400 block mb-1">Thuisteam *</label>
                <select
                  value={editDraft.homeTeamId}
                  onChange={(e) => setEditDraft((d) => ({ ...d, homeTeamId: e.target.value }))}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                >
                  <option value="">— Kies thuisteam —</option>
                  {editSeasonTeam && (
                    <optgroup label="Eigen team (seizoen)">
                      <option value={editSeasonTeam.id}>{editSeasonTeam.name}</option>
                    </optgroup>
                  )}
                  {editSeasonOpponents && editSeasonOpponents.length > 0 && (
                    <optgroup label="Tegenstanders (seizoen)">
                      {editSeasonOpponents.map((name, i) => (
                        <option key={i} value={name}>{name}</option>
                      ))}
                    </optgroup>
                  )}
                  {teams.filter((t) => t.id !== editSeasonTeam?.id).length > 0 && (
                    <optgroup label={editSeasonTeam ? "Overige eigen teams" : "Eigen teams"}>
                      {teams
                        .filter((t) => t.id !== editSeasonTeam?.id)
                        .map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </optgroup>
                  )}
                  {editDraft.homeTeamId &&
                    editDraft.homeTeamId !== editSeasonTeam?.id &&
                    !(editSeasonOpponents || []).includes(editDraft.homeTeamId) &&
                    !teams.some((t) => t.id === editDraft.homeTeamId) && (
                      <optgroup label="Huidig team">
                        <option value={editDraft.homeTeamId}>{formatTeamName(editDraft.homeTeamId, teams)}</option>
                      </optgroup>
                    )}
                </select>
              </div>

              {/* AWAY TEAM */}
              <div>
                <label className="text-xs text-neutral-400 block mb-1">Uitteam *</label>
                <select
                  value={editDraft.awayTeamId}
                  onChange={(e) => setEditDraft((d) => ({ ...d, awayTeamId: e.target.value }))}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                >
                  <option value="">— Kies uitteam —</option>
                  {editSeasonTeam && (
                    <optgroup label="Eigen team (seizoen)">
                      <option value={editSeasonTeam.id}>{editSeasonTeam.name}</option>
                    </optgroup>
                  )}
                  {editSeasonOpponents && editSeasonOpponents.length > 0 && (
                    <optgroup label="Tegenstanders (seizoen)">
                      {editSeasonOpponents.map((name, i) => (
                        <option key={i} value={name}>{name}</option>
                      ))}
                    </optgroup>
                  )}
                  {teams.filter((t) => t.id !== editSeasonTeam?.id).length > 0 && (
                    <optgroup label={editSeasonTeam ? "Overige eigen teams" : "Eigen teams"}>
                      {teams
                        .filter((t) => t.id !== editSeasonTeam?.id)
                        .map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </optgroup>
                  )}
                  {editDraft.awayTeamId &&
                    editDraft.awayTeamId !== editSeasonTeam?.id &&
                    !(editSeasonOpponents || []).includes(editDraft.awayTeamId) &&
                    !teams.some((t) => t.id === editDraft.awayTeamId) && (
                      <optgroup label="Huidig team">
                        <option value={editDraft.awayTeamId}>{formatTeamName(editDraft.awayTeamId, teams)}</option>
                      </optgroup>
                    )}
                </select>
              </div>

              <div>
                <label className="text-xs text-neutral-400 block mb-1">Datum</label>
                <input
                  type="date"
                  value={editDraft.date}
                  onChange={(e) => setEditDraft((d) => ({ ...d, date: e.target.value }))}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-400 block mb-1">Locatie</label>
                <input
                  type="text"
                  value={editDraft.location}
                  onChange={(e) => setEditDraft((d) => ({ ...d, location: e.target.value }))}
                  placeholder="Bijv. Sporthal De Vink"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-400 block mb-1">Score thuis</label>
                <input
                  type="number"
                  value={editDraft.homeScore}
                  onChange={(e) => setEditDraft((d) => ({ ...d, homeScore: e.target.value }))}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-400 block mb-1">Score uit</label>
                <input
                  type="number"
                  value={editDraft.awayScore}
                  onChange={(e) => setEditDraft((d) => ({ ...d, awayScore: e.target.value }))}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditMatchId("")}
                className="px-4 py-2 rounded-xl bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
              >
                Annuleren
              </button>
              <button
                onClick={async () => {
                  if (!editDraft.homeTeamId || !editDraft.awayTeamId) {
                    alert("Vul zowel thuisteam als uitteam in.");
                    return;
                  }
                  if (editDraft.homeTeamId === editDraft.awayTeamId) {
                    alert("Thuisteam en uitteam mogen niet hetzelfde team zijn.");
                    return;
                  }
                  try {
                    await updateMatch(editingMatch.id, {
                      date: editDraft.date,
                      location: editDraft.location,
                      homeTeamId: editDraft.homeTeamId,
                      awayTeamId: editDraft.awayTeamId,
                      homeScore: Number(editDraft.homeScore ?? 0),
                      awayScore: Number(editDraft.awayScore ?? 0),
                      seasonId: editDraft.seasonId,
                      seasonName: editDraft.seasonName,
                    });
                    setEditMatchId("");
                    alert("Wedstrijd bijgewerkt.");
                  } catch (e) {
                    console.error("Fout bij bewerken wedstrijd:", e);
                    alert("Bijwerken mislukt. Zie console.");
                  }
                }}
                className="px-4 py-2 rounded-xl bg-[#FF6124] text-white hover:opacity-90"
              >
                Opslaan
              </button>
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

export function PlayersPicker({ teams, homeTeamId, awayTeamId, seasonTeamId, selected, onChange, type, exclude = [], max }) {
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

  if (awayTeam && awayTeam.id !== homeTeam?.id) {
    const players = (type === "subs") ? [] : dedupe([...(awayTeam.players || [])]);
    const subs = (type === "players") ? [] : dedupe([...(awayTeam.subs || [])]);
    if (players.length || subs.length) {
      sections.push({ key: `away-${awayTeam.id}`, players, subs });
    }
  }

  if (!homeTeam && !awayTeam && seasonTeamId) {
    const sTeam = teams.find(t => t.id === seasonTeamId);
    if (sTeam) {
      const players = (type === "subs") ? [] : dedupe([...(sTeam.players || [])]);
      const subs = (type === "players") ? [] : dedupe([...(sTeam.subs || [])]);
      if (players.length || subs.length) {
        sections.push({ key: `season-${sTeam.id}`, players, subs });
      }
    }
  }

  const excluded = new Set(exclude);

  function toggle(id) {
    if (excluded.has(id)) return;
    if (selected.includes(id)) {
      onChange(selected.filter(x => x !== id));
    } else {
      if (typeof max === "number" && selected.length >= max) return;
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
                  disabled={excluded.has(p.id)}
                  className={`px-3 py-2 rounded-xl border text-sm ${
                    excluded.has(p.id)
                      ? "border-neutral-800 bg-neutral-900 opacity-40 cursor-not-allowed"
                      : selected.includes(p.id)
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
                  disabled={excluded.has(p.id)}
                  className={`px-3 py-2 rounded-xl border text-sm ${
                    excluded.has(p.id)
                      ? "border-neutral-800 bg-neutral-900 opacity-40 cursor-not-allowed"
                      : selected.includes(p.id)
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