import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAppData } from "../context/AppDataContext";
import { useAuth } from "../context/AuthContext";
import { db } from "../lib/firebaseClient";
import { doc, getDoc } from "firebase/firestore";

function fmt(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// Simpele set aanvalsacties voor live taggen (allemaal met Raak/Mis-popup)
const OFFENSE_ACTIONS = [
  { id: "schot", label: "Schot", isChance: true },
  { id: "doorloopbal", label: "Doorloopbal", isChance: true },
  { id: "kleine_kans", label: "Kleine kans", isChance: true },
  { id: "strafworp", label: "Strafworp", isChance: true },
  { id: "vrije_bal", label: "Vrije bal", isChance: true },
];

// Verdedigingsacties voor live taggen: alleen tegenstander-kansen met Raak/Mis-popup
const DEFENSE_ACTIONS = [
  { id: "tegen_schot", label: "Tegenstander schot", isChance: true, opponentGoal: true },
  { id: "tegen_doorloopbal", label: "Tegenstander doorloopbal", isChance: true, opponentGoal: true },
  { id: "tegen_kleine_kans", label: "Tegenstander kleine kans", isChance: true, opponentGoal: true },
  { id: "tegen_strafworp", label: "Tegenstander strafworp", isChance: true, opponentGoal: true },
  { id: "tegen_vrije_bal", label: "Tegenstander vrije bal", isChance: true, opponentGoal: true },
];

export default function LiveTagging() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const {
    ready,
    matches,
    getTeamPlayers,
    addClip,
    getClipsByMatch,
    deleteClip,
    addSubstitution,
    getSubsByMatch,
    loadMatchVideosLocally,
  } = useAppData() || {};

  const [userClubId, setUserClubId] = useState("");
  const [currentHalf, setCurrentHalf] = useState(1);
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [lastMessage, setLastMessage] = useState("");
  const [subOutId, setSubOutId] = useState("");
  const [subInId, setSubInId] = useState("");
  const [videoTime, setVideoTime] = useState(0);
  const [chancePrompt, setChancePrompt] = useState(null);
  const [isClockRunning, setIsClockRunning] = useState(false);
  const [fullscreenOverlayOpen, setFullscreenOverlayOpen] = useState(false);
  const [clipSavedFlash, setClipSavedFlash] = useState(null);

  const videoRef = useRef(null);
  const videoShellRef = useRef(null);

  const match = useMemo(
    () => matches.find((m) => m.id === matchId) || null,
    [matches, matchId]
  );

  // Gebruik, net als in MatchDetail, spelers van beide teams zodat er altijd spelers zichtbaar zijn
  const allTeamPlayers = useMemo(() => {
    if (!match || !getTeamPlayers) return [];

    const homePlayers = match.homeTeamId ? getTeamPlayers(match.homeTeamId) || [] : [];
    const awayPlayers = match.awayTeamId ? getTeamPlayers(match.awayTeamId) || [] : [];

    // Als er thuis-spelers zijn, gebruik die (typisch jouw team), anders uitteam
    if (homePlayers.length) return homePlayers;
    if (awayPlayers.length) return awayPlayers;
    return [];
  }, [match, getTeamPlayers]);

  const clips = useMemo(
    () => (match && getClipsByMatch ? getClipsByMatch(match.id) : []),
    [match, getClipsByMatch]
  );

  const subs = useMemo(
    () => (match && getSubsByMatch ? getSubsByMatch(match.id) : []),
    [match, getSubsByMatch]
  );

  // Dynamische opstelling op basis van basis-8 + wissels t/m huidige videotijd
  const { livePlayers, benchPlayers } = useMemo(() => {
    if (!match || !allTeamPlayers.length) {
      return { livePlayers: [], benchPlayers: [] };
    }

    const baseIds = Array.isArray(match.players) && match.players.length
      ? new Set(match.players)
      : new Set(allTeamPlayers.map((p) => p.id));

    const allIds = new Set(allTeamPlayers.map((p) => p.id));
    const onField = new Set(baseIds);
    const bench = new Set(
      Array.from(allIds).filter((id) => !onField.has(id))
    );

    if (!subs || !subs.length) {
      return {
        livePlayers: allTeamPlayers.filter((p) => onField.has(p.id)),
        benchPlayers: allTeamPlayers.filter((p) => bench.has(p.id)),
      };
    }

    const orderedSubs = [...subs].sort((a, b) => {
      const ha = a.half || 1;
      const hb = b.half || 1;
      if (ha !== hb) return ha - hb;
      return (a.time || 0) - (b.time || 0);
    });

    const currentHalfLocal = currentHalf || 1;
    const currentTimeLocal = videoTime || 0;

    for (const s of orderedSubs) {
      const sh = s.half || 1;
      const st = s.time || 0;

      if (sh < currentHalfLocal || (sh === currentHalfLocal && st <= currentTimeLocal)) {
        if (s.outPlayer && onField.has(s.outPlayer)) {
          onField.delete(s.outPlayer);
          bench.add(s.outPlayer);
        }
        if (s.inPlayer) {
          bench.delete(s.inPlayer);
          onField.add(s.inPlayer);
        }
      } else {
        break;
      }
    }

    const livePlayersList = allTeamPlayers.filter((p) => onField.has(p.id));
    const benchPlayersList = allTeamPlayers.filter((p) => bench.has(p.id));

    return { livePlayers: livePlayersList, benchPlayers: benchPlayersList };
  }, [match, allTeamPlayers, subs, currentHalf, videoTime]);

  const [src1, setSrc1] = useState("");
  const [src2, setSrc2] = useState("");

  // Hergebruik de opgeslagen/Firestored video-urls van MatchDetail
  useEffect(() => {
    if (!match) {
      setSrc1("");
      setSrc2("");
      return;
    }

    const urls = match.videoUrls || {};
    const saved = loadMatchVideosLocally ? loadMatchVideosLocally(match.id) || {} : {};

    setSrc1(urls.half1 || saved.half1 || "");
    setSrc2(urls.half2 || saved.half2 || "");
  }, [match, loadMatchVideosLocally]);

  // Eenvoudige wedstrijdklok: verhoog videoTime zolang de klok loopt
  useEffect(() => {
    if (!isClockRunning) return;

    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const delta = (now - last) / 1000;
      last = now;
      setVideoTime((prev) => prev + delta);
    }, 250);

    return () => clearInterval(id);
  }, [isClockRunning]);

  // Laad clubId van de gebruiker zodat clips aan een club gekoppeld worden
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
        console.error("[LiveTagging] Fout bij laden clubId:", e);
        setUserClubId("");
      }
    }

    loadUserClub();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const currentSrc = currentHalf === 1 ? src1 : src2;

  const selectedPlayer = useMemo(
    () => livePlayers.find((p) => p.id === selectedPlayerId) || null,
    [livePlayers, selectedPlayerId]
  );

  function formatPlayerLabel(p) {
    const number = p.number ? `${p.number} ` : "";
    return `${number}${p.name || "Onbekend"}`;
  }

  async function handleSaveSubstitution() {
    if (!match || !addSubstitution) return;
    if (!subOutId || !subInId || subOutId === subInId) return;

    try {
      await addSubstitution({
        matchId: match.id,
        outPlayer: subOutId,
        inPlayer: subInId,
        time: videoTime || 0,
        half: currentHalf,
      });
      setSubOutId("");
      setSubInId("");
      setLastMessage("Wissel opgeslagen");
    } catch (e) {
      console.error("[LiveTagging] Fout bij opslaan wissel:", e);
    }
  }

  async function handleDeleteLastClip() {
    if (!clips.length || !deleteClip) return;

    // Verwijder alleen clips die vanuit deze Live-tagging pagina zijn gemaakt
    const last = clips.find((c) => c.source === "live");
    if (!last?.id) return;
    try {
      await deleteClip(last.id);
      setLastMessage("Laatste clip verwijderd");
    } catch (e) {
      console.error("[LiveTagging] Fout bij verwijderen laatste clip:", e);
    }
  }

  async function handleLiveAction(config, options = {}) {
    if (!match || !addClip) return;

    const now = videoTime || 0;
    const isDefense = options.isDefense || false;
    const opponentGoal = !!config.opponentGoal;

    const base = {
      matchId: match.id,
      playerId: selectedPlayerId || "",
      teamId: opponentGoal ? "" : match.homeTeamId,
      time: now,
      half: currentHalf,
      phase: isDefense || opponentGoal ? "defense" : "attack",
      zone: null,
      actionType: config.actionType || config.id,
      result: null,
      opponentGoal,
      // Markeer clips die vanuit deze LiveTagging-pagina zijn gemaakt
      source: "live",
      customActionId: null,
      sequenceId: null,
      x: null,
      y: null,
      clubId: userClubId || null,
    };

    // Voor alle kansen: video pauzeren en popup tonen
    if (config.isChance) {
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
        setIsClockRunning(false);
      }
      setChancePrompt({ config, base });
      return;
    }

    const ok = await addClip(base);
    if (ok) {
      const parts = [];
      if (selectedPlayer) {
        parts.push(formatPlayerLabel(selectedPlayer));
      }
      parts.push(config.label);
      setLastMessage(`${parts.join(" · ")} (${fmt(now)})`);
      setClipSavedFlash({ text: `✓ ${config.label} opgeslagen`, type: "saved" });
      setTimeout(() => setClipSavedFlash(null), 2200);
    }
  }

  async function confirmLiveChance(resultKey) {
    if (!chancePrompt || !addClip) return;

    const isOpp = !!chancePrompt.base.opponentGoal;
    let finalResult;

    if (isOpp) {
      // Tegenstander-kansen gebruiken aparte result-codes, net als in MatchDetail
      finalResult = resultKey === "goal" ? "opp_goal" : "opp_miss";
    } else {
      finalResult = resultKey === "goal" ? "goal" : "miss";
    }

    const clip = { ...chancePrompt.base, result: finalResult };

    const ok = await addClip(clip);
    if (ok) {
      const parts = [];
      const timeLabel = fmt(chancePrompt.base.time || 0);
      if (selectedPlayer) {
        parts.push(formatPlayerLabel(selectedPlayer));
      }
      parts.push(chancePrompt.config.label);
      const resultLabel = resultKey === "goal" ? "RAAK" : "MIS";
      parts.push(resultLabel);
      setLastMessage(`${parts.join(" · ")} (${timeLabel})`);
      const flashType = resultKey === "goal" ? "goal" : "miss";
      setClipSavedFlash({ text: `${resultKey === "goal" ? "✓ RAAK" : "✗ MIS"} — ${chancePrompt.config.label}`, type: flashType });
      setTimeout(() => setClipSavedFlash(null), 2500);
    }

    setChancePrompt(null);
  }

  function toggleVideoPlayback() {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsClockRunning(true);
    } else {
      videoRef.current.pause();
      setIsClockRunning(false);
    }
  }

  function seekVideo(seconds) {
    if (!videoRef.current) {
      setVideoTime((t) => Math.max(0, t + seconds));
      return;
    }
    const next = Math.max(0, (videoRef.current.currentTime || 0) + seconds);
    videoRef.current.currentTime = next;
    setVideoTime(next);
  }


  return (
    <>
    {!ready && <div className="p-6 text-neutral-400">Laden…</div>}

    {ready && !match && (
      <div className="p-6 text-neutral-400">
        <button onClick={() => navigate(-1)} className="mb-4 text-sm text-[#FF6124] underline">
          ← Terug naar wedstrijden
        </button>
        Wedstrijd niet gevonden.
      </div>
    )}

    {/* ── Fullscreen tagging view ── */}
    {ready && match && fullscreenOverlayOpen && (
      <div className="fixed inset-0 z-[9000] bg-neutral-950 flex flex-col">
        {/* Topbalk */}
        <div className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setFullscreenOverlayOpen(false)}
              className="px-3 py-1.5 rounded-xl bg-neutral-800 text-white text-xs hover:bg-neutral-700"
            >
              ← Terug
            </button>
            <span className="text-sm font-semibold text-white">Live taggen v9</span>
            <span className="text-xs text-neutral-400">{match.date || ""} · {match.location || ""}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`px-3 py-1 rounded-full border text-xs ${currentHalf === 1 ? "bg-[#FF6124] border-[#FF6124] text-white" : "bg-neutral-900 border-neutral-700 text-white"}`}
              onClick={() => setCurrentHalf(1)}
            >1e helft</button>
            <button
              className={`px-3 py-1 rounded-full border text-xs ${currentHalf === 2 ? "bg-[#FF6124] border-[#FF6124] text-white" : "bg-neutral-900 border-neutral-700 text-white"}`}
              onClick={() => setCurrentHalf(2)}
            >2e helft</button>
            <span className="px-2 py-1 rounded-full bg-neutral-900 border border-neutral-700 text-xs text-white">
              {fmt(videoTime || 0)}
            </span>
            <button
              type="button"
              onClick={() => setIsClockRunning((v) => !v)}
              className={`px-3 py-1 rounded-full text-xs font-medium ${isClockRunning ? "bg-neutral-800 text-neutral-200" : "bg-[#FF6124] text-white"}`}
            >
              {isClockRunning ? "Pauze" : "Start"}
            </button>
            <button
              type="button"
              onClick={handleDeleteLastClip}
              disabled={!clips.length}
              className={`px-2 py-1 rounded-full border text-[11px] ${clips.length ? "border-red-500 text-red-400 hover:bg-red-900/30" : "border-neutral-700 text-neutral-600 cursor-not-allowed"}`}
            >
              Undo
            </button>
          </div>
        </div>

        {/* Video — volledig zichtbaar, 16:9, popup staat eroverheen */}
        <div className="relative shrink-0 bg-black w-full">
          {currentSrc ? (
            <video
              ref={videoRef}
              src={currentSrc}
              className="w-full aspect-video bg-black"
              controls
              onPlay={() => setIsClockRunning(true)}
              onPause={() => setIsClockRunning(false)}
            />
          ) : (
            <div className="w-full aspect-video flex items-center justify-center text-neutral-500 text-sm">
              Geen video beschikbaar voor deze helft.
            </div>
          )}

          {/* Raak/Mis popup — bovenop de video */}
          {chancePrompt && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10">
              <div className="rounded-2xl border-2 border-[#FF6124] bg-neutral-900 p-6 text-center shadow-2xl w-[min(92vw,340px)]">
                <div className="text-xl font-bold text-[#FF6124] mb-1">{chancePrompt.config.label}</div>
                <div className="text-sm text-neutral-300 mb-5">Wat was het resultaat?</div>
                <div className="flex justify-center gap-4">
                  <button
                    type="button"
                    onClick={() => confirmLiveChance("goal")}
                    className="rounded-xl bg-emerald-600 px-8 py-3 text-lg font-bold text-white hover:bg-emerald-500"
                  >
                    ✓ Raak
                  </button>
                  <button
                    type="button"
                    onClick={() => confirmLiveChance("miss")}
                    className="rounded-xl bg-red-600 px-8 py-3 text-lg font-bold text-white hover:bg-red-500"
                  >
                    ✗ Mis
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setChancePrompt(null)}
                  className="mt-4 text-xs text-neutral-500 hover:text-neutral-300"
                >
                  Annuleren
                </button>
              </div>
            </div>
          )}

          {/* Groen vinkje toast — rechtsboven in de video */}
          {clipSavedFlash && (
            <div
              className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-lg"
              style={{
                backgroundColor: clipSavedFlash.type === "goal" ? "#16a34a" : clipSavedFlash.type === "miss" ? "#dc2626" : "#16a34a",
                animation: "fadeInOut 2.2s ease forwards",
              }}
            >
              ✓ {clipSavedFlash.type === "goal" ? "Raak" : clipSavedFlash.type === "miss" ? "Mis" : "Opgeslagen"}
            </div>
          )}
        </div>

        {/* Tag panel — scrollbaar onder video */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {livePlayers.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedPlayerId(p.id)}
                className={`px-3 py-1.5 rounded-full text-xs border font-medium transition-colors ${
                  selectedPlayerId === p.id
                    ? "bg-[#FF6124] border-[#FF6124] text-white"
                    : "bg-neutral-800 border-neutral-700 text-neutral-200 hover:border-neutral-500"
                }`}
              >
                {formatPlayerLabel(p)}
              </button>
            ))}
            {livePlayers.length === 0 && (
              <span className="text-xs text-neutral-500">Geen spelers gevonden</span>
            )}
          </div>

          {selectedPlayer && (
            <div className="text-xs text-[#FF6124] font-medium">
              Geselecteerd: {formatPlayerLabel(selectedPlayer)}
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-neutral-300 mb-2">Aanval</div>
            <div className="flex flex-wrap gap-2">
              {OFFENSE_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => handleLiveAction(a)}
                  className="px-4 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-sm text-white hover:bg-[#FF6124]/20 hover:border-[#FF6124]/60 transition-colors"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-red-400 mb-2">Verdediging / tegenstander</div>
            <div className="flex flex-wrap gap-2">
              {DEFENSE_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => handleLiveAction(a, { isDefense: true })}
                  className="px-4 py-2 rounded-xl bg-red-950/30 border border-red-700/60 text-sm text-red-100 hover:bg-red-900/40 transition-colors"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-neutral-500 pt-1 border-t border-neutral-800">
            <span>{lastMessage || "—"}</span>
            <span>{clips.length} clips</span>
          </div>
        </div>

      </div>
    )}

    {/* ── Normale view ── */}
    {ready && match && !fullscreenOverlayOpen && (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-[#FF6124] underline mb-1"
          >
            ← Terug naar wedstrijden
          </button>
          <h2 className="text-2xl font-semibold">Live taggen</h2>
          <p className="text-neutral-400 text-sm">
            {match.date || "onbekende datum"} · {match.location || "onbekende locatie"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm text-neutral-300">
          <div className="flex items-center gap-2">
            <button
              className={`px-3 py-1 rounded-full border text-xs ${
                currentHalf === 1
                  ? "bg-[#FF6124] border-[#FF6124] text-white"
                  : "bg-neutral-900 border-neutral-700"
              }`}
              onClick={() => setCurrentHalf(1)}
            >
              1e helft
            </button>
            <button
              className={`px-3 py-1 rounded-full border text-xs ${
                currentHalf === 2
                  ? "bg-[#FF6124] border-[#FF6124] text-white"
                  : "bg-neutral-900 border-neutral-700"
              }`}
              onClick={() => setCurrentHalf(2)}
            >
              2e helft
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-neutral-300">
            <span className="px-2 py-1 rounded-full bg-neutral-900 border border-neutral-700">
              Tijd: {fmt(videoTime || 0)}
            </span>
            <button
              type="button"
              onClick={() => setIsClockRunning((v) => !v)}
              className={`px-3 py-1 rounded-full text-[11px] font-medium ${
                isClockRunning
                  ? "bg-neutral-800 text-neutral-200"
                  : "bg-[#FF6124] text-white"
              }`}
            >
              {isClockRunning ? "Pauze" : "Start"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsClockRunning(false);
                setVideoTime(0);
              }}
              className="px-2 py-1 rounded-full text-[11px] text-neutral-400 border border-neutral-700 hover:text-white"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(220px,1fr)] gap-4">
        <div className="flex flex-col gap-3">
          {/* Spelersrij */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-3 flex flex-wrap gap-2">
            {livePlayers.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPlayerId(p.id)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  selectedPlayerId === p.id
                    ? "bg-[#FF6124] border-[#FF6124] text-white"
                    : "bg-neutral-900 border-neutral-700 text-neutral-200 hover:border-neutral-500"
                }`}
              >
                {formatPlayerLabel(p)}
              </button>
            ))}
          </div>

          {/* Video */}
          <div ref={videoShellRef} className="relative bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
            {currentSrc ? (
              <video
                ref={videoRef}
                src={currentSrc}
                className="w-full bg-black aspect-video"
                controls
                onPlay={() => setIsClockRunning(true)}
                onPause={() => setIsClockRunning(false)}
              />
            ) : (
              <div className="w-full aspect-video bg-black flex items-center justify-center text-neutral-500 text-sm">
                Live/video bron nog niet ingesteld voor deze helft.
              </div>
            )}
            <div className="border-t border-neutral-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
              <div>
                {selectedPlayer ? `Speler: ${formatPlayerLabel(selectedPlayer)}` : "Geen speler geselecteerd"}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setFullscreenOverlayOpen(true)}
                  className="px-4 py-2 rounded-xl bg-[#FF6124] text-white text-xs font-semibold hover:opacity-90"
                >
                  Fullscreen taggen
                </button>
                {lastMessage && <span className="text-neutral-400">{lastMessage}</span>}
                <button
                  type="button"
                  onClick={handleDeleteLastClip}
                  disabled={!clips.length}
                  className={`px-3 py-1 rounded-full border text-[11px] ${
                    clips.length
                      ? "border-red-500 text-red-400 hover:bg-red-900/30"
                      : "border-neutral-700 text-neutral-600 cursor-not-allowed"
                  }`}
                >
                  Laatste clip verwijderen
                </button>
              </div>
            </div>
          </div>

          {/* Wissels */}
          <div className="bg-[#FF6124]/10 border border-[#FF6124]/40 rounded-2xl p-3 space-y-2">
            <div className="text-xs font-semibold text-[#FF6124] mb-1">Wissel registreren</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div>
                <label className="block text-neutral-400 mb-1">Speler eruit</label>
                <select
                  value={subOutId}
                  onChange={(e) => setSubOutId(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-2 py-1 text-neutral-100 text-xs"
                >
                  <option value="">— kies speler —</option>
                  {livePlayers.map((p) => (
                    <option key={p.id} value={p.id}>{formatPlayerLabel(p)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-neutral-400 mb-1">Speler erin (bank)</label>
                <select
                  value={subInId}
                  onChange={(e) => setSubInId(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-2 py-1 text-neutral-100 text-xs"
                >
                  <option value="">— kies speler —</option>
                  {benchPlayers.map((p) => (
                    <option key={p.id} value={p.id}>{formatPlayerLabel(p)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSaveSubstitution}
                disabled={!subOutId || !subInId || subOutId === subInId}
                className={`px-3 py-1 rounded-xl text-xs font-medium ${
                  !subOutId || !subInId || subOutId === subInId
                    ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                    : "bg-[#FF6124] text-white hover:opacity-90"
                }`}
              >
                Wissel opslaan
              </button>
            </div>
          </div>
        </div>

        {/* Rechts: acties */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-3 flex flex-col gap-2">
          <div className="text-xs font-semibold text-neutral-300 mb-1">Aanval</div>
          {OFFENSE_ACTIONS.map((a) => (
            <button
              key={a.id}
              onClick={() => handleLiveAction(a)}
              className="w-full text-left px-3 py-2 rounded-xl text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-100"
            >
              {a.label}
            </button>
          ))}
          <div className="mt-4">
            <div className="text-xs font-semibold text-neutral-300 mb-1">Verdediging</div>
            <div className="flex flex-wrap gap-2">
              {DEFENSE_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => handleLiveAction(a, { isDefense: true })}
                  className="px-3 py-1 rounded-full text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-100"
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4">
            <div className="text-xs text-neutral-500 mb-1">Totaal clips</div>
            <div className="text-lg font-semibold">{clips.length}</div>
          </div>
        </div>
      </div>
    </div>
    )}

    {/* Toast — zichtbaar in beide modes */}
    {clipSavedFlash && (
      <div className={`fixed bottom-6 right-6 z-[99999] rounded-2xl px-6 py-4 text-base font-bold text-white shadow-2xl pointer-events-none ${
        clipSavedFlash.type === "goal"
          ? "bg-emerald-600 ring-2 ring-emerald-400"
          : clipSavedFlash.type === "miss"
          ? "bg-red-600 ring-2 ring-red-400"
          : "bg-[#FF6124] ring-2 ring-orange-400"
      }`}>
        {clipSavedFlash.text}
      </div>
    )}

    {/* Raak/Mis popup — zichtbaar in beide modes */}
    {chancePrompt && (
      <div className="fixed inset-0 z-[99998] flex items-center justify-center bg-black/70">
        <div className="rounded-2xl border-2 border-[#FF6124] bg-neutral-900 p-6 text-center shadow-2xl w-[min(92vw,340px)]">
          <div className="text-xl font-bold text-[#FF6124] mb-1">{chancePrompt.config.label}</div>
          <div className="text-sm text-neutral-300 mb-5">Wat was het resultaat?</div>
          <div className="flex justify-center gap-4">
            <button
              type="button"
              onClick={() => confirmLiveChance("goal")}
              className="rounded-xl bg-emerald-600 px-8 py-3 text-lg font-bold text-white hover:bg-emerald-500"
            >
              ✓ Raak
            </button>
            <button
              type="button"
              onClick={() => confirmLiveChance("miss")}
              className="rounded-xl bg-red-600 px-8 py-3 text-lg font-bold text-white hover:bg-red-500"
            >
              ✗ Mis
            </button>
          </div>
          <button
            type="button"
            onClick={() => setChancePrompt(null)}
            className="mt-4 text-xs text-neutral-500 hover:text-neutral-300"
          >
            Annuleren
          </button>
        </div>
      </div>
    )}
    </>
  );
}
