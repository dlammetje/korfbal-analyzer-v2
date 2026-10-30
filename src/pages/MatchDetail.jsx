// src/pages/MatchDetail.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Play, Pause, Upload, ChevronLeft, ChevronRight, Trash2, Star, Maximize2 } from "lucide-react";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebaseClient";
import { doc, getDoc } from "firebase/firestore";
import FieldHeatmap from "../components/FieldHeatmap";

const ZONES = [
  "Linksvoor", "Voor (midden)", "Rechtsvoor",
  "Linkerzij", "Korfzone", "Rechterzij",
  "Linksachter", "Achter (midden)", "Rechtsachter",
];

const ATTACK_ACTIONS = [
  { id: "schot_3m", label: "Schot >3m", isChance: true },
  { id: "schot_6m", label: "Schot >6m", isChance: true },
  { id: "schot_9m", label: "Schot >9m", isChance: true },
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
  { id: "tegen_schot_3m", label: "Tegenstander Schot >3m" },
  { id: "tegen_schot_6m", label: "Tegenstander Schot >6m" },
  { id: "tegen_schot_9m", label: "Tegenstander Schot >9m" },
];

export function formatActionLabel(actionId) {
  if (!actionId) return "—";
  const map = {
    schot_3m: "Schot >3m",
    schot_6m: "Schot >6m",
    schot_9m: "Schot >9m",
    schot: "Schot",
    rebound_win: "Rebound (win)",
    rebound_lose: "Rebound (Verlies)",
    balverlies: "Balverlies",
    tegen_schot_3m: "Tegenstander Schot >3m",
    tegen_schot_6m: "Tegenstander Schot >6m",
    tegen_schot_9m: "Tegenstander Schot >9m",
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

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function MatchDetail() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  const [userClubId, setUserClubId] = useState("");

  const [uploadStatus, setUploadStatus] = useState({ half1: null, half2: null });
  const [uploadProgress, setUploadProgress] = useState({ half1: 0, half2: 0 });
  const [uploadError, setUploadError] = useState({ half1: null, half2: null });

  const {
    ready,
    teams,
    matches,
    getTeamPlayers,
    saveMatchVideosLocally,
    loadMatchVideosLocally,
    addClip,
    deleteClip,
    getClipsByMatch,
    addSubstitution,
    deleteSubstitution,
    getSubsByMatch,
    uploadMatchVideo,
    clipSequences,
    getSequencesByMatch,
    addClipSequence,
    deleteClipSequence,
    setClipSequenceForClip,
    setClipFavorite,
    updateClipPosition,
  } = useAppData() || {};

  const match = useMemo(
    () => matches.find((m) => m.id === matchId) || null,
    [matches, matchId]
  );

  const homeTeam = useMemo(
    () => (match ? teams.find((t) => t.id === match.homeTeamId) || null : null),
    [teams, match]
  );
  const awayTeam = useMemo(
    () => (match ? teams.find((t) => t.id === match.awayTeamId) || null : null),
    [teams, match]
  );

  // --- Video state ---
  const [src1, setSrc1] = useState("");
  const [src2, setSrc2] = useState("");
  const [currentHalf, setCurrentHalf] = useState(1);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef(null);
  const videoShellRef = useRef(null);
  const [tagOverlayOpen, setTagOverlayOpen] = useState(false);

  // --- Tagging state ---
  const [phase, setPhase] = useState("attack");
  const [zone, setZone] = useState("Korfzone");
  const [playerId, setPlayerId] = useState("");
  const [showBenchInFullscreen, setShowBenchInFullscreen] = useState(false);
  const [prePost, setPrePost] = useState({ pre: 4, post: 6 });
  const [chancePrompt, setChancePrompt] = useState(null);
  const [clipSavedFlash, setClipSavedFlash] = useState(null);

  // --- Subs / custom actions state ---
  const [subPrompt, setSubPrompt] = useState(null);
  const [newSequenceName, setNewSequenceName] = useState("");
  const [newSequenceKind, setNewSequenceKind] = useState("attack");

  const [activeSequenceId, setActiveSequenceId] = useState("");

  const [fieldPosition, setFieldPosition] = useState(null);

  // Wissel-state / videoklok
  const [videoTime, setVideoTime] = useState(0);
  const [subOutId, setSubOutId] = useState("");
  const [subInId, setSubInId] = useState("");

  // --- Clip filters ---
  const [clipPlayerFilter, setClipPlayerFilter] = useState("");
  const [clipFavoritesOnly, setClipFavoritesOnly] = useState(false);
  const [clipActionFilter, setClipActionFilter] = useState("");

  // --- Playlist voor gefilterde clips ---
  const [playlistActive, setPlaylistActive] = useState(false);
  const [playlistIndex, setPlaylistIndex] = useState(0);

  // --- AI-voorgestelde clips (dummy voor nu) ---
  const [aiSuggestions, setAiSuggestions] = useState([]);

  const [selectedClipForEdit, setSelectedClipForEdit] = useState(null);

  // Laad clubId van de ingelogde gebruiker zodat nieuwe clips aan een club gekoppeld kunnen worden
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
          if (data.clubId) {
            setUserClubId(data.clubId);
          } else {
            setUserClubId("");
          }
        }
      } catch (e) {
        console.error("[MatchDetail] Fout bij laden clubId:", e);
        setUserClubId("");
      }
    }

    loadUserClub();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  // spelers voor deze match: alle spelers die bij de teams horen
  const matchPlayers = useMemo(() => {
    if (!match || !getTeamPlayers) return [];

    const homePlayers = getTeamPlayers(match.homeTeamId) || [];
    const awayPlayers = getTeamPlayers(match.awayTeamId) || [];
    return [...homePlayers, ...awayPlayers];
  }, [match, getTeamPlayers]);

  const clips = useMemo(
    () => (match ? getClipsByMatch(match.id) : []),
    [match, getClipsByMatch]
  );

  const subs = useMemo(
    () => (match ? getSubsByMatch(match.id) : []),
    [match, getSubsByMatch]
  );

  // Huidige opstelling op basis van basis-8 (match.players), bank (alle overige teamspelers)
  // en alle geregistreerde wissels in de wedstrijd (ongeacht exacte videotijd)
  const lineup = useMemo(() => {
    if (!match || !matchPlayers.length) {
      return { onField: [], bench: [] };
    }

    const startingIds = new Set(match.players || []);

    // Alle spelers die bij de teams horen
    const allIds = new Set(matchPlayers.map((p) => p.id));

    // Startopstelling: basis 8; bank: alle overige spelers
    const onField = new Set(startingIds);
    const bench = new Set(
      Array.from(allIds).filter((id) => !startingIds.has(id))
    );

    if (!subs || !subs.length) {
      const onFieldPlayers = matchPlayers.filter((p) => onField.has(p.id));
      const benchPlayers = matchPlayers.filter((p) => bench.has(p.id));
      return { onField: onFieldPlayers, bench: benchPlayers };
    }

    const orderedSubs = [...subs].sort((a, b) => {
      const ha = a.half || 1;
      const hb = b.half || 1;
      if (ha !== hb) return ha - hb;
      return (a.time || 0) - (b.time || 0);
    });

    // Pas alle wissels in chronologische volgorde toe, zodat we altijd de meest recente
    // veldbezetting krijgen, ongeacht de huidige videopositie.
    for (const s of orderedSubs) {
      if (s.outPlayer && onField.has(s.outPlayer)) {
        onField.delete(s.outPlayer);
        bench.add(s.outPlayer);
      }
      if (s.inPlayer) {
        bench.delete(s.inPlayer);
        onField.add(s.inPlayer);
      }
    }

    const onFieldPlayers = matchPlayers.filter((p) => onField.has(p.id));
    const benchPlayers = matchPlayers.filter((p) => bench.has(p.id));
    return { onField: onFieldPlayers, bench: benchPlayers };
  }, [match, matchPlayers, subs]);

  const onFieldPlayers = lineup.onField;
  const benchPlayers = lineup.bench;
  const activeFieldPlayers = onFieldPlayers.length > 0 ? onFieldPlayers : matchPlayers;

  // gefilterde clips op basis van speler-/actie-/favorieten-filter
  const filteredClips = useMemo(() => {
    let list = clips;

    if (clipPlayerFilter) {
      list = list.filter((c) => c.playerId === clipPlayerFilter);
    }

    if (clipActionFilter) {
      list = list.filter((c) => c.actionType === clipActionFilter);
    }

    if (clipFavoritesOnly) {
      list = list.filter((c) => c.favorite);
    }

    return list;
  }, [clips, clipPlayerFilter, clipActionFilter, clipFavoritesOnly]);

  // Playlistclips: gesorteerde versie van de huidige gefilterde clips
  const playlistClips = useMemo(() => {
    const list = [...filteredClips];
    return list.sort((a, b) => {
      const ha = a.half || 1;
      const hb = b.half || 1;
      if (ha !== hb) return ha - hb;
      return (a.time || 0) - (b.time || 0);
    });
  }, [filteredClips]);

  // unieke spelers die in clips voorkomen (voor filter dropdown)
  const playersWithClips = useMemo(() => {
    const idsInClips = new Set(clips.map((c) => c.playerId).filter(Boolean));
    return matchPlayers.filter((p) => idsInClips.has(p.id));
  }, [clips, matchPlayers]);

  const actionsInClips = useMemo(() => {
    const set = new Set(clips.map((c) => c.actionType).filter(Boolean));
    return Array.from(set).sort();
  }, [clips]);

  const sequencesForMatch = useMemo(
    () => (match ? getSequencesByMatch?.(match.id) || [] : []),
    [match, getSequencesByMatch, clipSequences]
  );

  const fieldPoints = useMemo(() => {
    if (!clips.length) return [];
    return clips
      .filter((c) => typeof c.x === "number" && typeof c.y === "number")
      .map((c) => ({
        id: c.id,
        x: c.x,
        y: c.y,
        actionType: c.actionType,
        result: c.result,
      }));
  }, [clips]);

  // Bepaal zone-naam op basis van veldlocatie (x,y in 0-1 range)
  function inferZoneFromPosition(pos) {
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return zone;

    const x = pos.x;
    const y = pos.y;

    // Korf staat op (0.5, ~0.35). Alles dicht in de buurt is Korfzone.
    const dx = x - 0.5;
    const dy = y - 0.35;
    const distSq = dx * dx + dy * dy;
    if (distSq < 0.12 * 0.12) {
      return "Korfzone";
    }

    // Links / midden / rechts
    let horiz;
    if (x < 1 / 3) horiz = "Links";
    else if (x > 2 / 3) horiz = "Rechts";
    else horiz = "";

    // Voor / midden / achter (boven in het veld is "Achter", onderin is "Voor")
    let vert;
    if (y < 1 / 3) vert = "Achter";
    else if (y > 2 / 3) vert = "Voor";
    else vert = "";

    // Combineer naar de bestaande zone-labels waar mogelijk
    if (vert === "Voor" && horiz === "Links") return "Linksvoor";
    if (vert === "Voor" && horiz === "") return "Voor (midden)";
    if (vert === "Voor" && horiz === "Rechts") return "Rechtsvoor";

    if (vert === "" && horiz === "Links") return "Linkerzij";
    if (vert === "" && horiz === "") return "Korfzone";
    if (vert === "" && horiz === "Rechts") return "Rechterzij";

    if (vert === "Achter" && horiz === "Links") return "Linksachter";
    if (vert === "Achter" && horiz === "") return "Achter (midden)";
    if (vert === "Achter" && horiz === "Rechts") return "Rechtsachter";

    return zone;
  }

  // --- Load saved video URLs on mount / when video-URLs zelf veranderen ---
  useEffect(() => {
    if (!match) {
      setSrc1("");
      setSrc2("");
      return;
    }

    // 1) Probeer eerst de URLs uit Firestore (match.videoUrls)
    const urls = match.videoUrls || {};

    // 2) Val terug op lokaal opgeslagen URLs (per browser/domein)
    const saved = loadMatchVideosLocally(match.id) || {};

    setSrc1(urls.half1 || saved.half1 || "");
    setSrc2(urls.half2 || saved.half2 || "");
  }, [matchId, match?.videoUrls?.half1, match?.videoUrls?.half2, loadMatchVideosLocally]);

  useEffect(() => {
    function isTypingInInput(e) {
      const tag = e.target?.tagName;
      const editable = e.target?.isContentEditable;
      return (
        editable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT"
      );
    }

    function handleKeyDown(e) {
      const key = e.key;

      if (key === "ArrowLeft") {
        if (isTypingInInput(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (videoRef.current) {
          videoRef.current.currentTime = Math.max(0, (videoRef.current.currentTime || 0) - 3);
        }
        return;
      }

      if (key === "ArrowRight") {
        if (isTypingInInput(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (videoRef.current) {
          videoRef.current.currentTime = (videoRef.current.currentTime || 0) + 3;
        }
        return;
      }

      if (key === " ") {
        if (isTypingInInput(e)) return;
        if (e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        toggleVideoPlayback();
        return;
      }

      if (isTypingInInput(e)) return;

      if (key === "q" || key === "Q") {
        if (!matchPlayers.length) return;
        const idx = matchPlayers.findIndex((p) => p.id === playerId);
        const nextIdx = idx <= 0 ? matchPlayers.length - 1 : idx - 1;
        setPlayerId(matchPlayers[nextIdx].id);
        return;
      }

      if (key === "w" || key === "W") {
        if (!matchPlayers.length) return;
        const idx = matchPlayers.findIndex((p) => p.id === playerId);
        const nextIdx = idx === -1 || idx === matchPlayers.length - 1 ? 0 : idx + 1;
        setPlayerId(matchPlayers[nextIdx].id);
        return;
      }

      if (key === "a" || key === "A") {
        setPhase("attack");
        return;
      }

      if (key === "d" || key === "D") {
        setPhase("defense");
        return;
      }

      if (key === "1" || key === "2" || key === "3" || key === "4" || key === "5" || key === "6" || key === "7" || key === "8" || key === "9") {
        const index = Number(key) - 1;
        if (index >= 0 && index < ZONES.length) {
          setZone(ZONES[index]);
        }
        return;
      }

      const triggerAttackAction = (id) => {
        const action = ATTACK_ACTIONS.find((a) => a.id === id);
        if (action) {
          handleAction(action, false, null);
        }
      };

      if (key === "s" || key === "S" || key === "1") {
        triggerAttackAction("schot_3m");
        return;
      }

      if (key === "x" || key === "X" || key === "2") {
        triggerAttackAction("schot_6m");
        return;
      }

      if (key === "c" || key === "C" || key === "3") {
        triggerAttackAction("schot_9m");
        return;
      }

      if (key === "r" || key === "R") {
        triggerAttackAction("rebound_win");
        return;
      }

      if (key === "t" || key === "T") {
        triggerAttackAction("rebound_lose");
        return;
      }

      if (key === "b" || key === "B") {
        triggerAttackAction("balverlies");
        return;
      }

      // Sneltoets voor tegenstander-schot alleen in verdedigingsfase
      if ((key === "g" || key === "G") && phase === "defense") {
        const opp = OPPONENT_GOALS[0];
        if (opp) {
          handleAction(opp, true, null);
        }
        return;
      }

    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [matchPlayers, playerId, phase, zone, match, currentHalf]);

  // --- Actions / tagging ---
  const allowedUploadEmails = [
    "dlammetje@gmail.com",
    "lvandeuveren91@gmail.com",
    // Voeg hier eventueel extra trainers/coaches toe
  ];

  const canUpload =
    !!currentUser &&
    !!currentUser.email &&
    allowedUploadEmails.includes(currentUser.email);

  function handleAction(action, opponent = false, customActionId = null) {
    if (!match || !videoRef.current) return;

    const now = videoRef.current.currentTime || 0;

    const zoneToUse = fieldPosition ? inferZoneFromPosition(fieldPosition) : zone;

    const ourTeamId = homeTeam?.id || awayTeam?.id || match.homeTeamId;

    const base = {
      matchId: match.id,
      // Gebruik altijd de geselecteerde speler zodat we ook bij tegenstander-kansen weten bij wie het gebeurde
      playerId: playerId,
      teamId: opponent ? "" : ourTeamId, // gebruikt ons team ook bij uitwedstrijden
      time: now,
      half: currentHalf,
      phase: opponent ? "defense" : phase,
      zone: zoneToUse,
      actionType: action.id,
      result: null,
      opponentGoal: opponent,
      customActionId,
      sequenceId: activeSequenceId || null,
      x: fieldPosition && typeof fieldPosition.x === "number" ? fieldPosition.x : null,
      y: fieldPosition && typeof fieldPosition.y === "number" ? fieldPosition.y : null,
      clubId: userClubId || null,
    };

    // Voor tegenstander-acties willen we ook altijd de Raak/Mis-popup tonen
    if (opponent) {
      if (videoRef.current && !videoRef.current.paused) videoRef.current.pause();
      setChancePrompt({ action, base });
      return;
    }

    if (action.isChance) {
      if (videoRef.current && !videoRef.current.paused) videoRef.current.pause();
      setChancePrompt({ action, base });
      return;
    }

    addClip(base);
    setClipSavedFlash("saved");
    setTimeout(() => setClipSavedFlash(null), 2000);
  }

  function confirmChance(result) {
    if (!chancePrompt) return;

    const isOpp = !!chancePrompt.base.opponentGoal;
    let finalResult = result;

    if (isOpp) {
      finalResult = result === "goal" ? "opp_goal" : "opp_miss";
    }

    addClip({ ...chancePrompt.base, result: finalResult });
    setChancePrompt(null);
    const flashType = result === "goal" ? "goal" : "miss";
    setClipSavedFlash(flashType);
    setTimeout(() => setClipSavedFlash(null), 2200);
  }

  function addMomentToSequence() {
    if (!match || !videoRef.current) return;

    if (!activeSequenceId) {
      alert("Kies eerst een sequentie bovenaan rechts.");
      return;
    }

    if (!playerId) {
      alert("Kies eerst een speler bovenaan rechts.");
      return;
    }

    const now = videoRef.current.currentTime || 0;
    const zoneToUse = fieldPosition ? inferZoneFromPosition(fieldPosition) : zone;

    const ourTeamId = homeTeam?.id || awayTeam?.id || match.homeTeamId;

    const base = {
      matchId: match.id,
      playerId,
      teamId: ourTeamId,
      time: now,
      half: currentHalf,
      phase: phase || "attack",
      zone: zoneToUse,
      actionType: "sequence_moment",
      result: null,
      opponentGoal: false,
      customActionId: null,
      sequenceId: activeSequenceId,
      x: fieldPosition && typeof fieldPosition.x === "number" ? fieldPosition.x : null,
      y: fieldPosition && typeof fieldPosition.y === "number" ? fieldPosition.y : null,
      clubId: userClubId || null,
    };

    addClip(base);
  }

  function playClip(c) {
    if (!videoRef.current) return;
    const start = Math.max(0, c.time - prePost.pre);

    if ((c.half || 1) !== currentHalf) {
      setCurrentHalf(c.half || 1);
      // kleine delay zodat de video source wisselt
      setTimeout(() => {
        if (!videoRef.current) return;
        videoRef.current.currentTime = start;
        videoRef.current.play();
        setPlaying(true);
      }, 80);
    } else {
      videoRef.current.currentTime = start;
      videoRef.current.play();
      setPlaying(true);
    }
  }

  // Speel een AI-suggestie (zonder dat het al een echte clip is)
  function playSuggestion(s) {
    if (!videoRef.current) return;
    const start = Math.max(0, (s.time || 0) - prePost.pre);

    if ((s.half || 1) !== currentHalf) {
      setCurrentHalf(s.half || 1);
      setTimeout(() => {
        if (!videoRef.current) return;
        videoRef.current.currentTime = start;
        videoRef.current.play();
        setPlaying(true);
      }, 80);
    } else {
      videoRef.current.currentTime = start;
      videoRef.current.play();
      setPlaying(true);
    }
  }

  // Speel alle huidige playlistClips achter elkaar
  function playAllClips() {
    if (!videoRef.current || !playlistClips.length) return;
    setPlaylistIndex(0);
    setPlaylistActive(true);
    playClip(playlistClips[0]);
  }

  // Genereer wat dummy-suggesties om de AI-flow te testen
  function generateDummySuggestions() {
    if (!match) return;

    const baseTime = videoRef.current?.currentTime || 60;
    const half = currentHalf || 1;

    const now = Date.now();
    const dummy = [0, 30, 60].map((offset, idx) => ({
      id: `dummy-${now}-${idx}`,
      matchId: match.id,
      time: baseTime + offset,
      half,
      type: "schot",
      actionType: "schot",
      playerId: "",
    }));

    setAiSuggestions(dummy);
  }

  // Zet een AI-suggestie om in een echte clip in de database
  function acceptSuggestion(s) {
    if (!match) return;

    const chosenPlayerId = s.playerId || playerId;
    if (!chosenPlayerId) {
      alert("Kies eerst een speler voor deze suggestie (in de rij of rechtsboven bij Speler).");
      return;
    }

    if (!fieldPosition || typeof fieldPosition.x !== "number" || typeof fieldPosition.y !== "number") {
      alert("Kies eerst een veldlocatie in de kaart rechts voordat je deze suggestie omzet naar een clip.");
      return;
    }

    const zoneToUse = fieldPosition ? inferZoneFromPosition(fieldPosition) : zone;

    const actionId = s.actionType || s.type || "schot";
    const actionFromList = ATTACK_ACTIONS.find((a) => a.id === actionId);
    const action =
      actionFromList || {
        id: actionId,
        label: (s.type || actionId || "Schot").toString(),
        isChance: true,
      };

    const ourTeamId = homeTeam?.id || awayTeam?.id || match.homeTeamId;

    const base = {
      matchId: match.id,
      playerId: chosenPlayerId,
      teamId: ourTeamId,
      time: s.time || 0,
      half: s.half || 1,
      phase: "attack",
      zone: zoneToUse,
      actionType: action.id,
      result: null,
      opponentGoal: false,
      customActionId: null,
      sequenceId: activeSequenceId || null,
      x: fieldPosition && typeof fieldPosition.x === "number" ? fieldPosition.x : null,
      y: fieldPosition && typeof fieldPosition.y === "number" ? fieldPosition.y : null,
      clubId: userClubId || null,
    };

    if (action.isChance) {
      setChancePrompt({ action, base });
    } else {
      addClip(base);
    }

    // Reset veldlocatie na gebruik, zodat volgende clips niet automatisch dezelfde positie krijgen
    setFieldPosition(null);
    setAiSuggestions((prev) => prev.filter((x) => x.id !== s.id));
  }

  // Luister naar tijdsverloop om automatisch naar de volgende clip te gaan
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function handleTimeUpdate() {
      if (!playlistActive || !playlistClips.length) return;
      const current = playlistClips[playlistIndex];
      if (!current) return;

      const clipEnd = (current.time || 0) + (prePost.post || 0);
      if (video.currentTime >= clipEnd - 0.1) {
        const nextIndex = playlistIndex + 1;
        if (nextIndex < playlistClips.length) {
          setPlaylistIndex(nextIndex);
          playClip(playlistClips[nextIndex]);
        } else {
          setPlaylistActive(false);
        }
      }
    }

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [playlistActive, playlistIndex, playlistClips, prePost.post]);

  // Houd de huidige videotijd bij voor de wissel-opstelling
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function handleTime() {
      setVideoTime(video.currentTime || 0);
    }

    video.addEventListener("timeupdate", handleTime);
    return () => video.removeEventListener("timeupdate", handleTime);
  }, []);

  function submitSub(outId, inId) {
    if (!match || !videoRef.current) return;
    if (!outId || !inId || outId === inId) return;

    addSubstitution({
      matchId: match.id,
      outPlayer: outId,
      inPlayer: inId,
      time: videoRef.current.currentTime || 0,
      half: currentHalf,
    });

    setSubPrompt(null);
  }

  function toggleVideoPlayback() {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      const p = videoRef.current.play();
      if (p && typeof p.then === "function") {
        p.then(() => setPlaying(true)).catch((err) => {
          console.warn("[Video] Play mislukt:", err);
          setPlaying(false);
        });
      } else {
        setPlaying(true);
      }
    } else {
      videoRef.current.pause();
      setPlaying(false);
    }
  }

  function seekVideo(seconds) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, (videoRef.current.currentTime || 0) + seconds);
  }

  function openTagFullscreen() {
    setTagOverlayOpen(true);
    try {
      const el = videoShellRef.current;
      if (el) {
        if (el.requestFullscreen) {
          el.requestFullscreen().catch(() => {});
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        }
      }
    } catch (_) {}
  }

  function closeTagFullscreen() {
    setTagOverlayOpen(false);
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    } catch (_) {}
  }

  useEffect(() => {
    function handleFullscreenChange() {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (!isFs && tagOverlayOpen) {
        setTagOverlayOpen(false);
      }
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, [tagOverlayOpen]);

  const formatTeamName = (teamObj, teamId) => {
    if (teamObj?.name) return teamObj.name;
    if (typeof teamId === "string" && teamId.trim()) return teamId;
    return "Onbekend team";
  };

  if (!ready) {
    return <div className="p-6 text-neutral-400">Laden…</div>;
  }

  if (!match) {
    return (
      <div className="p-6 text-neutral-400">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 text-sm text-[#FF6124] underline"
        >
          ← Terug naar wedstrijden
        </button>
        Wedstrijd niet gevonden.
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* HEADER */}
      <div className="mb-6">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-[#FF6124] underline mb-2"
        >
          ← Terug naar wedstrijden
        </button>
        <h2 className="text-2xl font-semibold">
          {formatTeamName(homeTeam, match.homeTeamId)} vs {formatTeamName(awayTeam, match.awayTeamId)}
        </h2>
        <p className="text-neutral-400 text-sm">
          Datum: {match.date || "onbekend"} · Locatie: {match.location || "onbekend"}
        </p>
        <p className="text-neutral-400 text-sm">
          Uitslag: {Number(match.homeScore || 0)} - {Number(match.awayScore || 0)}
        </p>
      </div>

      {/* MAIN 2-COLUMN LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — VIDEO + CLIPS */}
        <div className="space-y-4">
          {/* UPLOAD BUTTONS - alleen tonen voor geautoriseerde e-mails */}
          {canUpload && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {/* 1e HELFT */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-3.5 space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-300">Video 1e helft</span>
                  {uploadStatus.half1 === "uploading" && (
                    <span className="text-xs font-bold text-[#FF6124] animate-pulse">
                      {uploadProgress.half1}%
                    </span>
                  )}
                  {uploadStatus.half1 === "success" && (
                    <span className="text-xs font-semibold text-green-400">✓ Geüpload</span>
                  )}
                  {uploadStatus.half1 === "error" && (
                    <span className="text-xs font-semibold text-red-400">✕ Mislukt</span>
                  )}
                  {!uploadStatus.half1 && src1 && (
                    <span className="text-[11px] text-neutral-400">Aanwezig</span>
                  )}
                </div>

                {uploadStatus.half1 === "uploading" ? (
                  <div className="space-y-1.5 pt-1">
                    <div className="w-full bg-neutral-800 rounded-full h-2.5 overflow-hidden border border-neutral-700/60">
                      <div
                        className="bg-gradient-to-r from-[#FF6124] to-[#ff854d] h-full rounded-full transition-all duration-200"
                        style={{ width: `${uploadProgress.half1}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-neutral-400 flex items-center justify-between font-mono">
                      <span>Bezig met uploaden…</span>
                      <span className="text-[#FF6124] font-semibold">{uploadProgress.half1}%</span>
                    </div>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-750 text-white text-xs font-medium px-3.5 py-2.5 rounded-xl cursor-pointer transition-colors border border-neutral-700 hover:border-[#FF6124]/50">
                    <Upload size={14} />
                    {src1 ? "1e helft vervangen" : "Video 1e helft uploaden"}
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        setUploadProgress((prev) => ({ ...prev, half1: 0 }));
                        setUploadStatus((prev) => ({ ...prev, half1: "uploading" }));
                        setUploadError((prev) => ({ ...prev, half1: null }));

                        try {
                          console.log("UPLOAD START →", match.id, "half1", file);
                          const url = await uploadMatchVideo(
                            match.id,
                            "half1",
                            file,
                            (percent) => {
                              setUploadProgress((prev) => ({ ...prev, half1: percent }));
                            }
                          );
                          setSrc1(url);
                          setUploadStatus((prev) => ({ ...prev, half1: "success" }));
                        } catch (error) {
                          console.error("Upload mislukt:", error);
                          setUploadError((prev) => ({
                            ...prev,
                            half1: error.message || "Er is een fout opgetreden bij het uploaden",
                          }));
                          setUploadStatus((prev) => ({ ...prev, half1: "error" }));
                        } finally {
                          e.target.value = "";
                        }
                      }}
                    />
                  </label>
                )}

                {/* Toon eventuele foutmeldingen */}
                {uploadError.half1 && (
                  <div className="text-red-400 text-xs">{uploadError.half1}</div>
                )}
              </div>

              {/* 2e HELFT */}
              <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-3.5 space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-300">Video 2e helft</span>
                  {uploadStatus.half2 === "uploading" && (
                    <span className="text-xs font-bold text-[#FF6124] animate-pulse">
                      {uploadProgress.half2}%
                    </span>
                  )}
                  {uploadStatus.half2 === "success" && (
                    <span className="text-xs font-semibold text-green-400">✓ Geüpload</span>
                  )}
                  {uploadStatus.half2 === "error" && (
                    <span className="text-xs font-semibold text-red-400">✕ Mislukt</span>
                  )}
                  {!uploadStatus.half2 && src2 && (
                    <span className="text-[11px] text-neutral-400">Aanwezig</span>
                  )}
                </div>

                {uploadStatus.half2 === "uploading" ? (
                  <div className="space-y-1.5 pt-1">
                    <div className="w-full bg-neutral-800 rounded-full h-2.5 overflow-hidden border border-neutral-700/60">
                      <div
                        className="bg-gradient-to-r from-[#FF6124] to-[#ff854d] h-full rounded-full transition-all duration-200"
                        style={{ width: `${uploadProgress.half2}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-neutral-400 flex items-center justify-between font-mono">
                      <span>Bezig met uploaden…</span>
                      <span className="text-[#FF6124] font-semibold">{uploadProgress.half2}%</span>
                    </div>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-750 text-white text-xs font-medium px-3.5 py-2.5 rounded-xl cursor-pointer transition-colors border border-neutral-700 hover:border-[#FF6124]/50">
                    <Upload size={14} />
                    {src2 ? "2e helft vervangen" : "Video 2e helft uploaden"}
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        setUploadProgress((prev) => ({ ...prev, half2: 0 }));
                        setUploadStatus((prev) => ({ ...prev, half2: "uploading" }));
                        setUploadError((prev) => ({ ...prev, half2: null }));

                        try {
                          console.log("UPLOAD START →", match.id, "half2", file);
                          const url = await uploadMatchVideo(
                            match.id,
                            "half2",
                            file,
                            (percent) => {
                              setUploadProgress((prev) => ({ ...prev, half2: percent }));
                            }
                          );
                          setSrc2(url);
                          setUploadStatus((prev) => ({ ...prev, half2: "success" }));
                        } catch (error) {
                          console.error("Upload mislukt:", error);
                          setUploadError((prev) => ({
                            ...prev,
                            half2: error.message || "Er is een fout opgetreden bij het uploaden",
                          }));
                          setUploadStatus((prev) => ({ ...prev, half2: "error" }));
                        } finally {
                          e.target.value = "";
                        }
                      }}
                    />
                  </label>
                )}

                {/* Toon eventuele foutmeldingen */}
                {uploadError.half2 && (
                  <div className="text-red-400 text-xs">{uploadError.half2}</div>
                )}
              </div>
            </div>
          )}

          {/* VIDEO & FULLSCREEN SHELL */}
          <div
            ref={videoShellRef}
            className={
              tagOverlayOpen
                ? "fixed inset-0 z-[9000] bg-neutral-950 flex flex-col overflow-hidden select-none"
                : "relative bg-black border border-neutral-800 rounded-2xl overflow-hidden"
            }
            style={{ colorScheme: "normal" }}
          >
            {tagOverlayOpen ? (
              <>
                {/* FULLSCREEN BOVENBALK */}
                <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-neutral-900 border-b border-neutral-800 z-30">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleVideoPlayback}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#FF6124] px-4 py-1.5 text-xs font-semibold text-white shadow hover:opacity-90 transition-opacity"
                    >
                      {playing ? <Pause size={14} /> : <Play size={14} />}
                      {playing ? "Pauze" : "Play"}
                    </button>
                    <button
                      type="button"
                      onClick={() => seekVideo(-5)}
                      className="inline-flex items-center gap-1 rounded-xl bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700 transition-colors"
                    >
                      <ChevronLeft size={14} /> 5s
                    </button>
                    <button
                      type="button"
                      onClick={() => seekVideo(5)}
                      className="inline-flex items-center gap-1 rounded-xl bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700 transition-colors"
                    >
                      5s <ChevronRight size={14} />
                    </button>
                    <div className="flex items-center gap-1 bg-neutral-800/80 p-0.5 rounded-xl border border-neutral-700">
                      <button
                        type="button"
                        onClick={() => setCurrentHalf(1)}
                        className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                          currentHalf === 1 ? "bg-[#FF6124] text-white" : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        1e helft
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentHalf(2)}
                        className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                          currentHalf === 2 ? "bg-[#FF6124] text-white" : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        2e helft
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={closeTagFullscreen}
                      className="rounded-xl bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700 transition-colors"
                    >
                      ✕ Sluiten
                    </button>
                  </div>
                </div>

                {/* MIDDENSECTIE MET VIDEO & GROTE VELDLOCATIE NAAST ELKAAR */}
                <div className="flex-1 min-h-0 relative flex flex-col md:flex-row items-center justify-center gap-3 md:gap-4 p-2 md:p-3 bg-black overflow-hidden">
                  {/* VIDEO CONTAINER */}
                  <div className="flex-1 min-h-0 w-full h-full flex items-center justify-center relative overflow-hidden">
                    {(() => {
                      const currentSrc = currentHalf === 1 ? src1 : src2;
                      if (!currentSrc) {
                        return (
                          <div className="text-neutral-500 text-sm">
                            Beelden nog niet geüpload voor deze helft.
                          </div>
                        );
                      }
                      return (
                        <video
                          ref={videoRef}
                          controls
                          playsInline
                          className="max-h-full max-w-full w-auto h-auto object-contain mx-auto block shadow-2xl rounded-xl"
                          src={currentSrc || null}
                          onPlay={() => setPlaying(true)}
                          onPause={() => setPlaying(false)}
                          onEnded={() => setPlaying(false)}
                        />
                      );
                    })()}

                    {/* Toast vinkje — rechtsboven in de video */}
                    {clipSavedFlash && (
                      <div
                        className="absolute top-3 right-3 z-30 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-lg pointer-events-none"
                        style={{
                          backgroundColor: clipSavedFlash === "goal" ? "#16a34a" : clipSavedFlash === "miss" ? "#dc2626" : "#16a34a",
                          animation: "fadeInOut 2.2s ease forwards",
                        }}
                      >
                        {clipSavedFlash === "goal" ? "✓ Raak" : clipSavedFlash === "miss" ? "✗ Mis" : "✓ Opgeslagen"}
                      </div>
                    )}
                  </div>

                  {/* GROTE CONSTANT ZICHTBARE VELDLOCATIE */}
                  <div className="w-full md:w-80 lg:w-[420px] xl:w-[460px] shrink-0 bg-neutral-900/95 border border-neutral-800 rounded-2xl p-3 shadow-2xl flex flex-col justify-center">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                          Veldlocatie
                        </span>
                        {zone && (
                          <span className="text-xs font-medium text-[#FF6124] bg-[#FF6124]/15 border border-[#FF6124]/40 px-2 py-0.5 rounded-md">
                            {zone}
                          </span>
                        )}
                      </div>
                      {fieldPosition && (
                        <button
                          type="button"
                          onClick={() => setFieldPosition(null)}
                          className="text-[11px] text-neutral-400 hover:text-white underline"
                        >
                          Wissen
                        </button>
                      )}
                    </div>

                    <FieldHeatmap
                      points={fieldPoints}
                      onSelect={({ x, y }) => {
                        const pos = { x, y };
                        setFieldPosition(pos);
                        setZone(inferZoneFromPosition(pos));
                      }}
                      selectedPosition={fieldPosition}
                      maxWidth="w-full"
                      hideHint
                    />
                  </div>
                </div>

                {/* Tagging panel onderaan (zit netjes onder het beeld) */}
                <div className="shrink-0 bg-neutral-900 border-t border-neutral-800 p-3 sm:p-4 space-y-2.5 z-20 max-h-[48vh] overflow-y-auto">
                  {/* SPELERS IN HET VELD ALS BLOKJES */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                          Spelers in het veld
                        </span>
                        {playerId && (
                          <span className="text-xs font-medium text-[#FF6124] bg-[#FF6124]/15 border border-[#FF6124]/40 px-2 py-0.5 rounded-lg flex items-center gap-1.5">
                            Geselecteerd: {matchPlayers.find((p) => p.id === playerId)?.name || "Speler"}
                            <button
                              type="button"
                              onClick={() => setPlayerId("")}
                              className="text-neutral-400 hover:text-white text-xs ml-0.5"
                              title="Deselecteer"
                            >
                              ✕
                            </button>
                          </span>
                        )}
                      </div>
                      {benchPlayers.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowBenchInFullscreen((v) => !v)}
                          className="text-xs text-neutral-400 hover:text-[#FF6124] transition-colors"
                        >
                          {showBenchInFullscreen ? "Verberg bank" : `Toon bank (${benchPlayers.length})`}
                        </button>
                      )}
                    </div>

                    {/* Veldspelers blokjes naast elkaar */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2">
                      {activeFieldPlayers.map((p) => {
                        const isSelected = playerId === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setPlayerId(isSelected ? "" : p.id)}
                            className={`px-3 py-2.5 rounded-xl border text-xs sm:text-sm font-semibold transition-all text-center truncate ${
                              isSelected
                                ? "bg-[#FF6124] border-[#FF6124] text-white shadow-lg ring-2 ring-[#FF6124]/50 scale-[1.02]"
                                : "bg-neutral-900 border-neutral-700 text-neutral-200 hover:border-[#FF6124]/60 hover:bg-neutral-800"
                            }`}
                            title={p.name}
                          >
                            {p.number ? <span className="opacity-75 mr-1 text-xs">#{p.number}</span> : null}
                            {p.name}
                          </button>
                        );
                      })}
                      {activeFieldPlayers.length === 0 && (
                        <div className="col-span-full text-xs text-neutral-500 py-2">
                          Geen veldspelers gevonden. Voeg spelers toe aan de opstelling.
                        </div>
                      )}
                    </div>

                    {/* Bankspelers optioneel tonen */}
                    {showBenchInFullscreen && benchPlayers.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-neutral-800">
                        <div className="text-[11px] text-neutral-400 mb-1.5 font-medium">Bankspelers</div>
                        <div className="flex flex-wrap gap-2">
                          {benchPlayers.map((p) => {
                            const isSelected = playerId === p.id;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => setPlayerId(isSelected ? "" : p.id)}
                                className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-all ${
                                  isSelected
                                    ? "bg-[#FF6124] border-[#FF6124] text-white shadow-md ring-1 ring-[#FF6124]/50"
                                    : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-600"
                                }`}
                              >
                                {p.number ? `#${p.number} ` : ""}{p.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* FASE (AANVAL / VERDEDIGING) */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-300">Fase:</span>
                      <div className="inline-flex rounded-xl bg-neutral-900 p-0.5 border border-neutral-800">
                        <button
                          type="button"
                          onClick={() => setPhase("attack")}
                          className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
                            phase === "attack"
                              ? "bg-[#FF6124] text-white shadow"
                              : "text-neutral-400 hover:text-white"
                          }`}
                        >
                          Aanval
                        </button>
                        <button
                          type="button"
                          onClick={() => setPhase("defense")}
                          className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
                            phase === "defense"
                              ? "bg-blue-600 text-white shadow"
                              : "text-neutral-400 hover:text-white"
                          }`}
                        >
                          Verdediging
                        </button>
                      </div>
                    </div>
                    {!playerId && (
                      <span className="text-[11px] text-amber-400/90 hidden sm:inline">
                        Kies eerst een speler hierboven, en klik daarna de actie
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {(phase === "attack" ? ATTACK_ACTIONS : DEFENSE_ACTIONS).map((a) => (
                      <button key={a.id} type="button" onClick={() => handleAction(a, false)}
                        className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-3 text-sm text-white hover:bg-[#FF6124]/20">
                        {a.label}
                      </button>
                    ))}
                  </div>
                  {phase === "defense" && (
                    <div className="mt-3">
                      <div className="mb-2 text-xs font-semibold text-red-300">Tegenstander kansen</div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {OPPONENT_GOALS.map((a) => (
                          <button key={a.id} type="button" onClick={() => handleAction(a, true)}
                            className="rounded-xl border-2 border-red-600 bg-red-950/40 px-3 py-3 text-sm text-red-200 hover:bg-red-900/50">
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {(() => {
                  const currentSrc = currentHalf === 1 ? src1 : src2;
                  if (!currentSrc) {
                    return (
                      <div className="w-full aspect-video bg-black flex items-center justify-center text-neutral-500 text-sm">
                        Beelden nog niet geüpload voor deze helft.
                      </div>
                    );
                  }
                  return (
                    <video
                      ref={videoRef}
                      controls
                      playsInline
                      className="w-full aspect-video select-none"
                      style={{ objectFit: "contain", display: "block", background: "black" }}
                      src={currentSrc || null}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onEnded={() => setPlaying(false)}
                    />
                  );
                })()}

                {/* Toast vinkje — rechtsboven in de video */}
                {clipSavedFlash && (
                  <div
                    className="absolute top-3 right-3 z-30 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-lg pointer-events-none"
                    style={{
                      backgroundColor: clipSavedFlash === "goal" ? "#16a34a" : clipSavedFlash === "miss" ? "#dc2626" : "#16a34a",
                      animation: "fadeInOut 2.2s ease forwards",
                    }}
                  >
                    {clipSavedFlash === "goal" ? "✓ Raak" : clipSavedFlash === "miss" ? "✗ Mis" : "✓ Opgeslagen"}
                  </div>
                )}

                <div className="p-4 flex flex-wrap items-center gap-3 border-t border-neutral-800">
              <button
                type="button"
                onClick={toggleVideoPlayback}
                className="px-4 py-2 rounded-xl bg-[#FF6124] text-white flex items-center gap-2 font-semibold hover:opacity-90 transition-opacity"
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
                {playing ? "Pauze" : "Play"}
              </button>

              <button
                type="button"
                onClick={() => seekVideo(-3)}
                className="flex items-center gap-1 bg-neutral-800 text-neutral-300 px-3 py-2 rounded-xl hover:bg-neutral-700 transition-colors"
              >
                <ChevronLeft size={14} /> 3s
              </button>

              <button
                type="button"
                onClick={() => seekVideo(3)}
                className="flex items-center gap-1 bg-neutral-800 text-neutral-300 px-3 py-2 rounded-xl hover:bg-neutral-700 transition-colors"
              >
                3s <ChevronRight size={14} />
              </button>

              <button
                type="button"
                onClick={openTagFullscreen}
                className="flex items-center gap-2 bg-[#FF6124] text-white px-4 py-2 rounded-xl font-semibold text-sm shadow hover:opacity-90 transition-opacity"
              >
                <Maximize2 size={16} /> Fullscreen taggen
              </button>

              {/* Pre/Post (seconden) tussen scrub en helft-knoppen */}
              <div className="flex items-end gap-3 ml-4">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-neutral-400">Pre (s)</label>
                  <input
                    type="number"
                    min={0}
                    value={prePost.pre}
                    onChange={(e) =>
                      setPrePost((pp) => ({ ...pp, pre: Number(e.target.value || 0) }))
                    }
                    className="w-16 bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-xs text-neutral-100"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-neutral-400">Post (s)</label>
                  <input
                    type="number"
                    min={0}
                    value={prePost.post}
                    onChange={(e) =>
                      setPrePost((pp) => ({ ...pp, post: Number(e.target.value || 0) }))
                    }
                    className="w-16 bg-neutral-900 border border-neutral-700 rounded-lg px-2 py-1 text-xs text-neutral-100"
                  />
                </div>
              </div>

              {/* Halve knoppen helemaal rechts, zoals origineel */}
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => setCurrentHalf(1)}
                  className={`px-3 py-1 rounded-xl ${
                    currentHalf === 1
                      ? "bg-[#FF6124] text-white"
                      : "bg-neutral-800 text-neutral-300"
                  }`}
                >
                  1e helft
                </button>
                <button
                  onClick={() => setCurrentHalf(2)}
                  className={`px-3 py-1 rounded-xl ${
                    currentHalf === 2
                      ? "bg-[#FF6124] text-white"
                      : "bg-neutral-800 text-neutral-300"
                  }`}
                >
                  2e helft
                </button>
              </div>
            </div>
          </>
        )}

            {/* Raak/Mis popup — absolute binnen videoShell, werkt in fullscreen */}
            {chancePrompt && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
                <div className="bg-neutral-900 border-2 border-[#FF6124] rounded-2xl p-6 text-center space-y-4 max-w-sm w-full mx-4">
                  <h3 className="text-xl font-semibold text-[#FF6124]">{chancePrompt.action.label}</h3>
                  <p className="text-neutral-300">Wat was het resultaat van deze kans?</p>
                  <div className="flex justify-center gap-4 pt-2">
                    <button
                      onClick={() => confirmChance("goal")}
                      className="px-6 py-2 rounded-xl bg-green-600 text-white font-bold text-lg"
                    >
                      ✓ Raak
                    </button>
                    <button
                      onClick={() => confirmChance("miss")}
                      className="px-6 py-2 rounded-xl bg-red-600 text-white font-bold text-lg"
                    >
                      ✗ Mis
                    </button>
                  </div>
                  <button
                    onClick={() => setChancePrompt(null)}
                    className="text-xs text-neutral-500 hover:text-neutral-300"
                  >
                    Annuleren
                  </button>
                </div>
              </div>
            )}

            {/* Toast vinkje — rechtsboven in de video */}
            {clipSavedFlash && (
              <div
                className="absolute top-3 right-3 z-30 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-lg pointer-events-none"
                style={{
                  backgroundColor: clipSavedFlash === "goal" ? "#16a34a" : clipSavedFlash === "miss" ? "#dc2626" : "#16a34a",
                  animation: "fadeInOut 2.2s ease forwards",
                }}
              >
                {clipSavedFlash === "goal" ? "✓ Raak" : clipSavedFlash === "miss" ? "✗ Mis" : "✓ Opgeslagen"}
              </div>
            )}
          </div>

          {/* CLIPS + FILTERS */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between gap-3">
              <div className="font-medium">Clips</div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-400">Filter speler:</span>
                  <select
                    value={clipPlayerFilter}
                    onChange={(e) => setClipPlayerFilter(e.target.value)}
                    className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-1 text-xs text-neutral-200"
                  >
                    <option value="">Alle</option>
                    {playersWithClips.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.number ? `#${p.number} ` : ""}{p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-400">Filter actie:</span>
                  <select
                    value={clipActionFilter}
                    onChange={(e) => setClipActionFilter(e.target.value)}
                    className="bg-neutral-950 border border-neutral-700 rounded-lg px-2 py-1 text-xs text-neutral-200"
                  >
                    <option value="">Alle</option>
                    {actionsInClips.map((a) => (
                      <option key={a} value={a}>
                        {a.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={() => setClipFavoritesOnly((v) => !v)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs border ${
                    clipFavoritesOnly
                      ? "border-yellow-400 text-yellow-300 bg-yellow-500/10"
                      : "border-neutral-700 text-neutral-300 bg-neutral-900"
                  }`}
                >
                  <Star size={12} className={clipFavoritesOnly ? "fill-yellow-400" : ""} />
                  Favorieten
                </button>

                <button
                  type="button"
                  onClick={playAllClips}
                  disabled={!playlistClips.length}
                  className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs border ${
                    playlistClips.length
                      ? "border-[#FF6124] text-[#FF6124] bg-[#FF6124]/10 hover:bg-[#FF6124]/20"
                      : "border-neutral-700 text-neutral-500 bg-neutral-900 cursor-not-allowed"
                  }`}
                >
                  <Play size={12} />
                  Alles afspelen
                </button>
              </div>
            </div>

            <div className="max-h-[360px] overflow-y-auto overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead className="bg-neutral-950 text-neutral-400 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-2 text-left">Tijd</th>
                    <th className="px-4 py-2 text-left">Helft</th>
                    <th className="px-4 py-2 text-left">Speler</th>
                    <th className="px-4 py-2 text-left">Zone</th>
                    <th className="px-4 py-2 text-left">Actie</th>
                    <th className="px-4 py-2 text-left">Resultaat</th>
                    <th className="px-4 py-2 text-left">Fav</th>
                    <th className="px-4 py-2 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClips.length ? (
                    filteredClips.map((c, idx) => {
                      const p = matchPlayers.find((x) => x.id === c.playerId);
                      const isOpp = !!c.opponentGoal;

                      return (
                        <tr
                          key={c.id}
                          onClick={() => {
                            setPlaylistActive(false);
                            setPlaylistIndex(idx);
                            playClip(c);
                          }}
                          className={`border-t border-neutral-800 hover:bg-neutral-900 cursor-pointer ${
                            isOpp ? "bg-red-900/20" : ""
                          }`}
                        >
                          <td className="px-4 py-2">{fmt(c.time)}</td>
                          <td className="px-4 py-2">{c.half || 1}e</td>
                          <td className="px-4 py-2">
                            {p
                              ? `${p.number ? `#${p.number} ` : ""}${p.name}`
                              : "—"}
                          </td>
                          <td className="px-4 py-2">
                            {typeof c.x === "number" && typeof c.y === "number" ? (
                              c.zone || "—"
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const pos = { x: 0.5, y: 0.5 };
                                  setSelectedClipForEdit(c);
                                  setFieldPosition(pos);
                                }}
                                className="text-[11px] px-2 py-1 rounded-lg border border-neutral-700 text-neutral-300 bg-neutral-900 hover:bg-neutral-800"
                              >
                                Locatie
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {formatActionLabel(c.actionType)}
                          </td>
                          <td className="px-4 py-2">
                            {isOpp && c.result === "opp_goal" && (
                              <span className="text-red-400 font-semibold">
                                Raak
                              </span>
                            )}
                            {isOpp && c.result === "opp_miss" && (
                              <span className="text-red-300 font-semibold">
                                Mis
                              </span>
                            )}
                            {c.result === "goal" && !isOpp && (
                              <span className="text-green-400 font-semibold">
                                Raak
                              </span>
                            )}
                            {c.result === "miss" && !isOpp && (
                              <span className="text-neutral-400 font-semibold">
                                Mis
                              </span>
                            )}
                            {!c.result && !isOpp && "—"}
                          </td>
                          <td className="px-4 py-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!c.id || !setClipFavorite) return;
                                setClipFavorite(c.id, !c.favorite);
                              }}
                              className="text-neutral-400 hover:text-yellow-400"
                            >
                              <Star
                                size={14}
                                className={c.favorite ? "fill-yellow-400" : ""}
                              />
                            </button>
                          </td>
                            <td className="px-4 py-2 text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteClip(c.id);
                              }}
                              className="text-neutral-400 hover:text-red-400"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="px-4 py-4 text-center text-neutral-500">
                        Nog geen clips.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* AI-VOORGESTELDE CLIPS (dummy) - momenteel onzichtbaar gemaakt */}
          {false && (
            <div className="bg-[#FF6124]/10 border border-[#FF6124]/40 rounded-2xl p-4 space-y-3 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-[#FF6124] font-semibold text-sm tracking-wide">Voorgestelde clips (AI)</h3>
                  <p className="text-[11px] text-[#FF6124] font-semibold mt-0.5">
                    KOMT BINNENKORT – DEZE AI-FUNCTIE WERKT NOG NIET IN PRODUCTIE.
                  </p>
                  <p className="text-xs text-neutral-300 mt-0.5">
                    Testsectie voor AI-voorstellen: generateert voorbeeld-suggesties zodat je de flow kunt proberen.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={generateDummySuggestions}
                  className="px-3 py-1.5 rounded-xl bg-neutral-900/90 border border-[#FF6124] text-[#FF6124] text-xs hover:bg-[#FF6124]/20 whitespace-nowrap"
                >
                  Genereer test-suggesties
                </button>
              </div>

              {aiSuggestions.length ? (
                <div className="border-t border-neutral-800 pt-2 overflow-x-auto">
                  <table className="w-full text-xs bg-[#FF6124]/10 border border-[#FF6124]/40 rounded-xl overflow-hidden">
                    <thead className="bg-[#FF6124]/20 text-[#FF6124]">
                      <tr className="border-b border-[#FF6124]/40">
                        <th className="text-left py-1.5 px-2">Tijd</th>
                        <th className="text-left py-1.5 px-2">Helft</th>
                        <th className="text-left py-1.5 px-2">Type</th>
                        <th className="text-left py-1.5 px-2">Speler</th>
                        <th className="text-right py-1.5 px-2">Acties</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiSuggestions.map((s) => (
                        <tr key={s.id} className="border-t border-[#FF6124]/25 hover:bg-[#FF6124]/10">
                          <td className="py-1.5 px-2 text-neutral-100">{fmt(s.time || 0)}</td>
                          <td className="py-1.5 px-2 text-neutral-100">{s.half || 1}e</td>
                          <td className="py-1.5 px-2 text-neutral-200">{s.type || "schot"}</td>
                          <td className="py-1.5 px-2">
                            <select
                              value={s.playerId || ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                setAiSuggestions((prev) =>
                                  prev.map((x) => (x.id === s.id ? { ...x, playerId: value } : x))
                                );
                              }}
                              className="bg-neutral-950/80 border border-neutral-700 rounded-lg px-2 py-1 text-[11px] text-neutral-100 max-w-[180px]"
                            >
                              <option value="">— kies speler —</option>
                              {matchPlayers.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.number ? `#${p.number} ` : ""}
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1.5 px-2 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => playSuggestion(s)}
                              className="text-xs px-2 py-1 rounded-lg border border-neutral-600 text-neutral-200 bg-neutral-900/70 hover:bg-neutral-800"
                            >
                              Speel
                            </button>
                            <button
                              type="button"
                              onClick={() => acceptSuggestion(s)}
                              className="text-xs px-2 py-1 rounded-lg border border-neutral-600 text-neutral-100 bg-neutral-900/70 hover:bg-neutral-800"
                            >
                              Maak clip
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setAiSuggestions((prev) => prev.filter((x) => x.id !== s.id))
                              }
                              className="text-xs px-2 py-1 rounded-lg border border-neutral-700 text-neutral-400 bg-neutral-900/70 hover:border-red-500 hover:text-red-400"
                            >
                              Verwijder
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-xs text-neutral-500">
                  Nog geen suggesties. Klik op "Genereer test-suggesties" om de AI-flow te proberen.
                </div>
              )}
            </div>
          )}

          {/* SEQUENCES VOOR DEZE WEDSTRIJD */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-4">
            <h3 className="text-neutral-100 font-medium text-sm">Sequenties voor deze wedstrijd</h3>

            {/* Nieuwe sequentie aanmaken */}
            <div className="flex flex-col sm:flex-row gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs text-neutral-400 mb-1">Naam sequentie</label>
                <input
                  type="text"
                  value={newSequenceName}
                  onChange={(e) => setNewSequenceName(e.target.value)}
                  placeholder="Bijv. Tegenstander ronde 1"
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <button
                onClick={async () => {
                  if (!match || !newSequenceName.trim()) return;
                  try {
                    await addClipSequence({ matchId: match.id, name: newSequenceName.trim(), kind: newSequenceKind });
                    setNewSequenceName("");
                  } catch (e) {
                    console.error("Sequentie aanmaken mislukt:", e);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-[#FF6124] text-white text-sm hover:opacity-90"
              >
                Nieuwe sequentie
              </button>
            </div>

            {/* Lijst met sequenties */}
            {sequencesForMatch.length ? (
              <div className="border-t border-neutral-800 pt-3">
                <table className="w-full text-sm">
                  <thead className="text-neutral-400 text-xs uppercase">
                    <tr>
                      <th className="text-left py-1">Naam</th>
                      <th className="text-right py-1">Acties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sequencesForMatch.map((s) => (
                      <tr key={s.id} className="border-t border-neutral-800">
                        <td className="py-1 pr-2 text-neutral-200">{s.name}</td>
                        <td className="py-1 text-right">
                          <button
                            onClick={() => deleteClipSequence(s.id)}
                            className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                          >
                            <Trash2 size={12} /> Verwijder
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-neutral-500 text-sm">Nog geen sequenties voor deze wedstrijd.</div>
            )}
          </div>
        </div>

        {/* RIGHT — TAGGING PANEL */}
        <div className="space-y-6">
          <div>
            <label className="text-neutral-400 text-sm">Sequentie (optioneel)</label>
            <select
              value={activeSequenceId}
              onChange={(e) => setActiveSequenceId(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm mt-1"
            >
              <option value="">— geen sequentie —</option>
              {sequencesForMatch.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <div className="mt-3 flex flex-col gap-1">
              <button
                type="button"
                onClick={addMomentToSequence}
                className="px-3 py-2 rounded-xl bg-[#FF6124] text-white text-xs font-medium hover:opacity-90"
              >
                Moment aan sequentie toevoegen
              </button>
              <p className="text-[11px] text-neutral-400">
                Gebruik dit om een moment in de gekozen sequentie te markeren op de huidige videotijd,
                zonder een aparte actie te kiezen.
              </p>
            </div>
          </div>

          {/* PLAYER SELECT */}
          <div>
            <label className="text-neutral-400 text-sm">Speler</label>
            <select
              value={playerId}
              onChange={(e) => setPlayerId(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-sm mt-1"
            >
              <option value="">
                {matchPlayers.length ? "— kies speler —" : "Geen spelers gevonden"}
              </option>
              {matchPlayers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number ? `#${p.number} ` : ""}{p.name}
                </option>
              ))}
            </select>
          </div>

          {/* VELDLOCATIE */}
          <div>
            <label className="text-neutral-400 text-sm">Veldlocatie</label>
            <div className="mt-2">
              <FieldHeatmap
                points={fieldPoints}
                onSelect={(pos) => setFieldPosition(pos)}
                selectedPosition={fieldPosition}
                maxWidth="max-w-lg"
              />
            </div>

            {selectedClipForEdit && (
              <div className="mt-3 p-2 rounded-xl bg-neutral-900 border border-neutral-800 text-xs space-y-2">
                <div className="text-neutral-300">Locatie bewerken voor clip:</div>
                <div className="text-neutral-400">
                  <span className="font-mono mr-2">{fmt(selectedClipForEdit.time || 0)}</span>
                  <span className="mr-2">{selectedClipForEdit.half || 1}e helft</span>
                  {(() => {
                    const p = matchPlayers.find((x) => x.id === selectedClipForEdit.playerId);
                    return (
                      <span className="mr-2">
                        {p ? `${p.number ? `#${p.number} ` : ""}${p.name}` : "Onbekende speler"}
                      </span>
                    );
                  })()}
                  <span className="text-neutral-500">
                    {formatActionLabel(selectedClipForEdit.actionType)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!selectedClipForEdit?.id || !updateClipPosition) return;
                      if (!fieldPosition || typeof fieldPosition.x !== "number" || typeof fieldPosition.y !== "number") return;
                      const newZone = inferZoneFromPosition(fieldPosition);
                      const ok = await updateClipPosition(selectedClipForEdit.id, {
                        x: fieldPosition.x,
                        y: fieldPosition.y,
                        zone: newZone,
                      });
                      if (ok) {
                        setSelectedClipForEdit(null);
                        setFieldPosition(null);
                      }
                    }}
                    className="px-3 py-1 rounded-lg bg-[#FF6124] text-white text-[11px] font-medium hover:opacity-90"
                  >
                    Locatie opslaan
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedClipForEdit(null)}
                    className="px-2 py-1 rounded-lg border border-neutral-700 text-[11px] text-neutral-400 hover:text-white"
                  >
                    Annuleren
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ATTACK / DEFENSE */}
          <div className="flex gap-2">
            <button
              onClick={() => setPhase("attack")}
              className={`px-4 py-2 rounded-xl w-full ${
                phase === "attack"
                  ? "bg-[#FF6124] text-white"
                  : "bg-neutral-900 text-neutral-300"
              }`}
            >
              Aanval
            </button>
            <button
              onClick={() => setPhase("defense")}
              className={`px-4 py-2 rounded-xl w-full ${
                phase === "defense"
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-900 text-neutral-300"
              }`}
            >
              Verdediging
            </button>
          </div>

          {/* ACTIONS */}
          <div className="space-y-4">
            <div>
              <h3 className="text-neutral-300 text-sm mb-2">
                {phase === "attack" ? "Aanvalsacties" : "Verdedigingsacties"}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(phase === "attack" ? ATTACK_ACTIONS : DEFENSE_ACTIONS).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => handleAction(a, false)}
                    className="rounded-xl border border-neutral-700 bg-neutral-900 hover:bg-[#FF6124]/10 text-sm px-3 py-2"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            {phase === "defense" && (
              <div>
                <h3 className="text-neutral-300 text-sm mb-2">Tegenstander goals</h3>
                <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
                  {OPPONENT_GOALS.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => handleAction(a, true)}
                      className="rounded-xl border-2 border-red-600 text-red-400 bg-neutral-900 hover:bg-red-900/20 text-sm px-3 py-2"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* WISSELS ONDERAAN */}
          <div className="bg-[#FF6124]/10 border border-[#FF6124]/40 rounded-2xl p-3 space-y-3 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[#FF6124] tracking-wide">Wissels</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-end text-xs">
              <div>
                <label className="text-[11px] text-neutral-300 block mb-1">Speler uit</label>
                <select
                  value={subOutId}
                  onChange={(e) => setSubOutId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-2 py-1.5 text-xs text-neutral-100"
                >
                  <option value="">— kies speler —</option>
                  {onFieldPlayers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number ? `#${p.number} ` : ""}{p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] text-neutral-300 block mb-1">Speler in</label>
                <select
                  value={subInId}
                  onChange={(e) => setSubInId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-2 py-1.5 text-xs text-neutral-100"
                >
                  <option value="">— kies speler —</option>
                  {benchPlayers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number ? `#${p.number} ` : ""}{p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end mt-1">
              <button
                type="button"
                onClick={() => {
                  if (!subOutId || !subInId || subOutId === subInId) {
                    alert("Kies een speler uit het veld en een andere speler van de bank.");
                    return;
                  }
                  submitSub(subOutId, subInId);
                  setSubOutId("");
                  setSubInId("");
                }}
                className="px-3 py-1.5 rounded-xl bg-[#FF6124] text-white text-xs font-semibold hover:opacity-90"
              >
                Wissel opslaan
              </button>
            </div>

            <div className="border-t border-[#FF6124]/40 pt-2 mt-1 space-y-1">
              <div className="text-[11px] text-neutral-300 mb-1">Wisselgeschiedenis</div>
              {subs && subs.length ? (
                <div className="max-h-40 overflow-y-auto text-[11px]">
                  {[...subs]
                    .sort((a, b) => {
                      const ha = a.half || 1;
                      const hb = b.half || 1;
                      if (ha !== hb) return ha - hb;
                      return (a.time || 0) - (b.time || 0);
                    })
                    .map((s) => {
                      const outP = matchPlayers.find((p) => p.id === s.outPlayer);
                      const inP = matchPlayers.find((p) => p.id === s.inPlayer);
                      return (
                        <div
                          key={s.id}
                          className="flex items-center justify-between gap-2 py-0.5 border-b border-neutral-900 last:border-b-0"
                        >
                          <div className="flex flex-col">
                            <span className="text-neutral-300">
                              {fmt(s.time || 0)} · {s.half || 1}e helft
                            </span>
                            <span className="text-neutral-400">
                              {outP ? `${outP.number ? `#${outP.number} ` : ""}${outP.name}` : "?"}
                              {"  ᐸᐳ "}
                              {inP ? `${inP.number ? `#${inP.number} ` : ""}${inP.name}` : "?"}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteSubstitution && s.id && deleteSubstitution(s.id)}
                            className="text-[10px] px-2 py-0.5 rounded-lg border border-red-700 text-red-400 hover:bg-red-900/30"
                          >
                            Verwijder
                          </button>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="text-[11px] text-neutral-600">Nog geen wissels geregistreerd.</div>
              )}
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}
