import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { db, getFirebase, storage } from "../lib/firebaseClient";
import { doc, deleteDoc, updateDoc, arrayUnion, getDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

const Ctx = createContext(null);
export function useAppData() {
  return useContext(Ctx);
}

let fns = {};
async function ensureFirebaseFns() {
  if (Object.keys(fns).length) return fns;
  try {
    const mod = await import("firebase/firestore");
    fns = { db, ...mod };
    console.log("[AppData] Firestore functies geladen ✅");
    return fns;
  } catch (e) {
    console.warn("[AppData] Firestore niet beschikbaar ❌", e);
    return null;
  }
}

async function uploadMatchVideo(matchId, half, file) {
  if (!matchId || !half || !file) {
    console.error("Ongeldige parameters voor uploadMatchVideo", { matchId, half, file });
    throw new Error("Ongeldige parameters voor video-upload");
  }

  // Controleer of Firebase storage beschikbaar is
  if (!storage) {
    console.error("Firebase Storage is niet beschikbaar");
    throw new Error("Firebase Storage is niet beschikbaar");
  }

  return new Promise((resolve, reject) => {
    try {
      const filePath = `matches/${matchId}/${half}.mp4`;
      const storageRef = ref(storage, filePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        "state_changed",
        (snap) => {
          const prog = (snap.bytesTransferred / snap.totalBytes) * 100;
          console.log(`Upload ${half}: ${prog.toFixed(0)}%`);
        },
        (err) => {
          console.error("Fout bij uploaden video:", err);
          reject(new Error("Er is een fout opgetreden bij het uploaden van de video"));
        },
        async () => {
          try {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            console.log(`Video succesvol geüpload naar ${url}`);

            // Firestore bijwerken met video-url
            try {
              const matchRef = doc(db, "matches", matchId);
              await updateDoc(matchRef, {
                [`videoUrls.${half}`]: url,
              });
              console.log("Firestore bijgewerkt met video URL");
            } catch (dbError) {
              console.error("Fout bij updaten Firestore:", dbError);
              // We gooien de fout niet door, want de upload is gelukt
            }

            // Opslaan in localStorage als fallback
            try {
              const key = LS_KEYS.VIDEOS(matchId);
              const videos = JSON.parse(localStorage.getItem(key) || "{}");
              videos[half] = url;
              localStorage.setItem(key, JSON.stringify(videos));
            } catch (lsError) {
              console.error("Fout bij opslaan in localStorage:", lsError);
            }

            resolve(url);
          } catch (error) {
            console.error("Fout bij ophalen download URL:", error);
            reject(new Error("Kon de geüploade video niet verwerken"));
          }
        }
      );
    } catch (e) {
      console.error("Onverwachte fout bij uploaden:", e);
      reject(new Error("Er is een onverwachte fout opgetreden bij het uploaden"));
    }
  });
}

const LS_KEYS = {
  TEAMS: "ka2_teams",
  MATCHES: "ka2_matches",
  CLIPS: "ka2_clips",
  SUBS: "ka2_subs",
  SEQUENCES: "ka2_clip_sequences",
  VIDEOS: (matchId) => `ka2_videos_${matchId}`,
};

export function AppDataProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [useFirestore, setUseFirestore] = useState(false);
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState([]);
  const [clips, setClips] = useState([]);
  const [substitutions, setSubstitutions] = useState([]);
  const [clipSequences, setClipSequences] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        console.log("[AppData] Initialiseren...");
        const fb = getFirebase();
        if (!fb || !fb.db) {
          console.warn("[AppData] Firebase niet gevonden, gebruik localStorage.");
          setTeams(JSON.parse(localStorage.getItem(LS_KEYS.TEAMS) || "[]"));
          setMatches(JSON.parse(localStorage.getItem(LS_KEYS.MATCHES) || "[]"));
          setClips(JSON.parse(localStorage.getItem(LS_KEYS.CLIPS) || "[]"));
          setSubstitutions(JSON.parse(localStorage.getItem(LS_KEYS.SUBS) || "[]"));
          setClipSequences(JSON.parse(localStorage.getItem(LS_KEYS.SEQUENCES) || "[]"));
          setReady(true);
          return;
        }

        const mod = await ensureFirebaseFns();
        if (!mod) throw new Error("Firestore module niet geladen");

        const { onSnapshot, collection, query, orderBy } = mod;
        setUseFirestore(true);

        onSnapshot(collection(db, "teams"), (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          console.log("[Firestore] teams →", items);
          setTeams(items);
        });
        onSnapshot(collection(db, "matches"), (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          console.log("[Firestore] matches →", items);
          setMatches(items);
        });
        const qClips = query(collection(db, "clips"), orderBy("createdAt", "desc"));
        onSnapshot(qClips, (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          console.log("[Firestore] clips →", items.length);
          setClips(items);
        });
        onSnapshot(collection(db, "substitutions"), (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setSubstitutions(items);
        });
        onSnapshot(collection(db, "clipSequences"), (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          console.log("[Firestore] clipSequences →", items.length);
          setClipSequences(items);
        });
        // Safeguard tegen dubbele updates bij hot reload
        // (geen setTeams hier handmatig; alles loopt via snapshots)
        setReady(true);
        console.log("[AppData] Firestore realtime actief ✅");
      } catch (e) {
        console.error("[AppData] Init fout:", e);
        setUseFirestore(false);
        setTeams(JSON.parse(localStorage.getItem(LS_KEYS.TEAMS) || "[]"));
        setMatches(JSON.parse(localStorage.getItem(LS_KEYS.MATCHES) || "[]"));
        setClips(JSON.parse(localStorage.getItem(LS_KEYS.CLIPS) || "[]"));
        setSubstitutions(JSON.parse(localStorage.getItem(LS_KEYS.SUBS) || "[]"));
        setClipSequences(JSON.parse(localStorage.getItem(LS_KEYS.SEQUENCES) || "[]"));
        setReady(true);
      }
    })();
  }, []);

  // --- Persist bij localStorage gebruik ---
  useEffect(() => {
    if (!useFirestore) localStorage.setItem(LS_KEYS.TEAMS, JSON.stringify(teams));
  }, [teams, useFirestore]);
  useEffect(() => {
    if (!useFirestore) localStorage.setItem(LS_KEYS.MATCHES, JSON.stringify(matches));
  }, [matches, useFirestore]);
  useEffect(() => {
    if (!useFirestore) localStorage.setItem(LS_KEYS.CLIPS, JSON.stringify(clips));
  }, [clips, useFirestore]);
  useEffect(() => {
    if (!useFirestore) localStorage.setItem(LS_KEYS.SUBS, JSON.stringify(substitutions));
  }, [substitutions, useFirestore]);
  useEffect(() => {
    if (!useFirestore) localStorage.setItem(LS_KEYS.SEQUENCES, JSON.stringify(clipSequences));
  }, [clipSequences, useFirestore]);

  // === CRUD FUNCTIES ===
  async function addTeam({ name, opponents = [] }) {
    const team = { name, opponents, players: [], subs: [] };
    if (useFirestore) {
      try {
        const { addDoc, collection } = await ensureFirebaseFns();
        const docRef = await addDoc(collection(db, "teams"), team);
        console.log("[Firestore] team toegevoegd:", docRef.id);
        // Geen lokale setTeams hier; realtime onSnapshot vult de state.
        return docRef.id;
      } catch (e) {
        console.error("[Firestore] Fout bij team toevoegen:", e);
        return null;
      }
    }
    const id = uuidv4();
    setTeams(prev => [...prev, { id, ...team }]);
    return id;
  }

  async function deleteTeam(teamId) {
    if (useFirestore) {
      try {
        const { doc, deleteDoc } = await ensureFirebaseFns();
        await deleteDoc(doc(db, "teams", teamId));
        console.log("[Firestore] team verwijderd:", teamId);
        return true;
      } catch (e) {
        console.error("[Firestore] Fout bij team verwijderen:", e);
        return false;
      }
    }
    setTeams(prev => prev.filter(t => t.id !== teamId));
    return true;
  }

  async function addPlayerToTeam(teamId, player) {
    try {
      const ref = doc(db, "teams", teamId);
      const snap = await getDoc(ref);
      const data = snap.data();
      const currentPlayers = data.players || [];
      const updatedPlayers = [
        ...currentPlayers,
        { id: crypto.randomUUID(), name: player.name, number: player.number },
      ];
      await updateDoc(ref, { players: updatedPlayers });
      console.log("[Firestore] speler toegevoegd:", player.name);
      return true;
    } catch (e) {
      console.error("[Firestore] Fout bij speler toevoegen:", e);
      return false;
    }
  }

  async function updateClipPosition(clipId, { x, y, zone }) {
    try {
      if (useFirestore) {
        const { doc, updateDoc } = await ensureFirebaseFns();
        const payload = {};
        if (typeof x === "number") payload.x = x;
        if (typeof y === "number") payload.y = y;
        if (typeof zone === "string") payload.zone = zone;
        await updateDoc(doc(db, "clips", clipId), payload);
      }

      setClips((prev) =>
        prev.map((c) =>
          c.id === clipId
            ? {
                ...c,
                x: typeof x === "number" ? x : c.x,
                y: typeof y === "number" ? y : c.y,
                zone: typeof zone === "string" ? zone : c.zone,
              }
            : c
        )
      );

      return true;
    } catch (e) {
      console.error("[Firestore] updateClipPosition fout:", e);
      return false;
    }
  }

  async function addPlayer(teamId, { name, number, isSub = false }) {
    if (useFirestore) {
      try {
        const { doc, getDoc, updateDoc, arrayUnion } = await ensureFirebaseFns();
        const ref = doc(db, "teams", teamId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          console.error("[Firestore] Team niet gevonden voor addPlayer:", teamId);
          return false;
        }
        const field = isSub ? "subs" : "players";
        // Haal huidige array veilig op
        const data = snap.data() || {};
        const current = Array.isArray(data[field]) ? data[field] : [];
        const next = [...current, { id: uuidv4(), name, number }];
        await updateDoc(ref, { [field]: next });
        console.log("[Firestore] speler toegevoegd aan", teamId, "→", name);
        return true;
      } catch (e) {
        console.error("[Firestore] Fout bij speler toevoegen:", e);
        return false;
      }
    }
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId
          ? {
              ...t,
              [isSub ? "subs" : "players"]: [
                ...(t[isSub ? "subs" : "players"] || []),
                { id: uuidv4(), name, number },
              ],
            }
          : t
      )
    );
    return true;
  }

  // --- Toegevoegde functies voor spelers, wissels en tegenstanders beheren ---
  async function removePlayer(teamId, playerId, isSub = false) {
    if (useFirestore) {
      try {
        const { doc, getDoc, updateDoc } = await ensureFirebaseFns();
        const ref = doc(db, "teams", teamId);
        const snap = await getDoc(ref);
        const data = snap.data();
        const field = isSub ? "subs" : "players";
        const next = (data[field] || []).filter(p => p.id !== playerId);
        await updateDoc(ref, { [field]: next });
        console.log("[Firestore] speler verwijderd van", teamId);
        return;
      } catch (e) {
        console.error("[Firestore] Fout bij speler verwijderen:", e);
      }
    }
    setTeams(prev =>
      prev.map(t =>
        t.id === teamId
          ? { ...t, [isSub ? "subs" : "players"]: (t[isSub ? "subs" : "players"] || []).filter(p => p.id !== playerId) }
          : t
      )
    );
  }

  async function updatePlayerAvatar(teamId, playerId, avatarUrl) {
    const updateLocal = () => {
      setTeams((prev) =>
        prev.map((t) => {
          if (t.id !== teamId) return t;
          const updateList = (list = []) =>
            list.map((p) => (p.id === playerId ? { ...p, avatarUrl } : p));
          return {
            ...t,
            players: updateList(t.players),
            subs: updateList(t.subs),
          };
        })
      );
    };

    if (!teamId || !playerId) {
      console.warn("updatePlayerAvatar: ontbrekende teamId/playerId", { teamId, playerId });
      return false;
    }

    if (useFirestore) {
      try {
        const { doc, getDoc, updateDoc } = await ensureFirebaseFns();
        const ref = doc(db, "teams", teamId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          console.error("[Firestore] Team niet gevonden voor updatePlayerAvatar:", teamId);
          return false;
        }

        const data = snap.data() || {};
        const updateList = (list = []) =>
          list.map((p) => (p.id === playerId ? { ...p, avatarUrl } : p));

        const nextPlayers = updateList(data.players || []);
        const nextSubs = updateList(data.subs || []);

        await updateDoc(ref, {
          players: nextPlayers,
          subs: nextSubs,
        });

        updateLocal();
        console.log("[Firestore] avatar bijgewerkt voor speler", playerId);
        return true;
      } catch (e) {
        console.error("[Firestore] Fout bij updatePlayerAvatar:", e);
        return false;
      }
    }

    updateLocal();
    return true;
  }

  async function addOpponentToTeam(teamId, opponentName) {
    if (useFirestore) {
      try {
        const { doc, getDoc, updateDoc } = await ensureFirebaseFns();
        const ref = doc(db, "teams", teamId);
        const snap = await getDoc(ref);
        const data = snap.data();
        const nextOpponents = [...(data.opponents || []), opponentName];
        await updateDoc(ref, { opponents: nextOpponents });
        console.log("[Firestore] tegenstander toegevoegd:", opponentName);
        return;
      } catch (e) {
        console.error("[Firestore] Fout bij tegenstander toevoegen:", e);
      }
    }
    setTeams(prev =>
      prev.map(t =>
        t.id === teamId ? { ...t, opponents: [...(t.opponents || []), opponentName] } : t
      )
    );
  }

  async function removeOpponentFromTeam(teamId, opponentName) {
    if (useFirestore) {
      try {
        const { doc, getDoc, updateDoc } = await ensureFirebaseFns();
        const ref = doc(db, "teams", teamId);
        const snap = await getDoc(ref);
        const data = snap.data();
        const nextOpponents = (data.opponents || []).filter(o => o !== opponentName);
        await updateDoc(ref, { opponents: nextOpponents });
        console.log("[Firestore] tegenstander verwijderd:", opponentName);
        return;
      } catch (e) {
        console.error("[Firestore] Fout bij tegenstander verwijderen:", e);
      }
    }
    setTeams(prev =>
      prev.map(t =>
        t.id === teamId
          ? { ...t, opponents: (t.opponents || []).filter(o => o !== opponentName) }
          : t
      )
    );
  }

  // --- CLIP SEQUENCES ---
  function getSequencesByMatch(matchId) {
    return clipSequences.filter((s) => s.matchId === matchId);
  }

  async function addClipSequence({ matchId, name, kind = "attack" }) {
    const seq = {
      matchId,
      name,
      kind,
      createdAt: useFirestore ? null : Date.now(),
    };

    if (useFirestore) {
      try {
        const { addDoc, collection, serverTimestamp } = await ensureFirebaseFns();
        const docRef = await addDoc(collection(db, "clipSequences"), {
          ...seq,
          createdAt: serverTimestamp(),
        });
        console.log("[Firestore] clipSequence toegevoegd:", docRef.id);
        return docRef.id;
      } catch (e) {
        console.error("[Firestore] Fout bij clipSequence toevoegen:", e);
        return null;
      }
    }

    const id = uuidv4();
    setClipSequences((prev) => [...prev, { id, ...seq }]);
    return id;
  }

  async function deleteClipSequence(sequenceId) {
    if (useFirestore) {
      try {
        const { doc, deleteDoc } = await ensureFirebaseFns();
        await deleteDoc(doc(db, "clipSequences", sequenceId));
        console.log("[Firestore] clipSequence verwijderd:", sequenceId);
      } catch (e) {
        console.error("[Firestore] Fout bij clipSequence verwijderen:", e);
      }
    }
    setClipSequences((prev) => prev.filter((s) => s.id !== sequenceId));

    // Koppel sequenceId los van bestaande clips in local state (UI-consistentie)
    setClips((prev) =>
      prev.map((c) =>
        c.sequenceId === sequenceId ? { ...c, sequenceId: null } : c
      )
    );
  }

  async function setClipSequenceForClip(clipId, sequenceId) {
    if (useFirestore) {
      try {
        const { doc, updateDoc } = await ensureFirebaseFns();
        await updateDoc(doc(db, "clips", clipId), {
          sequenceId: sequenceId || null,
        });
        console.log("[Firestore] clip sequenceId gezet:", clipId, sequenceId);
      } catch (e) {
        console.error("[Firestore] Fout bij setClipSequenceForClip:", e);
      }
    }

    setClips((prev) =>
      prev.map((c) =>
        c.id === clipId ? { ...c, sequenceId: sequenceId || null } : c
      )
    );
  }

  async function setClipFavorite(clipId, favorite) {
    if (useFirestore) {
      try {
        const { doc, updateDoc } = await ensureFirebaseFns();
        await updateDoc(doc(db, "clips", clipId), {
          favorite: !!favorite,
        });
        console.log("[Firestore] clip favorite gezet:", clipId, favorite);
      } catch (e) {
        console.error("[Firestore] Fout bij setClipFavorite:", e);
      }
    }

    setClips((prev) =>
      prev.map((c) =>
        c.id === clipId ? { ...c, favorite: !!favorite } : c
      )
    );
  }

  // --- MATCHES ---
  async function addMatch(match) {
    try {
      const cleanMatch = {
        date: match.date || "",
        location: match.location || "",
        phase: match.phase || "zaal",
        homeTeamId: match.homeTeamId || "",
        awayTeamId: match.awayTeamId || "",
        homeScore: Number(match.homeScore) || 0,
        awayScore: Number(match.awayScore) || 0,

        // 🔥 Altijd aanwezig
        players: Array.isArray(match.players) ? match.players : [],
        subs: Array.isArray(match.subs) ? match.subs : [],
        videoUrls: match.videoUrls || { half1: "", half2: "" },

        createdAt: useFirestore ? null : Date.now()
      };

      if (useFirestore) {
        const { addDoc, collection, serverTimestamp } = await ensureFirebaseFns();
        const docRef = await addDoc(collection(db, "matches"), {
          ...cleanMatch,
          createdAt: serverTimestamp(),
        });
        console.log("[Firestore] match toegevoegd:", docRef.id);
        return docRef.id;
      }

      const id = uuidv4();
      setMatches(prev => [...prev, { id, ...cleanMatch }]);
      return id;

    } catch (e) {
      console.error("[Firestore] Fout bij wedstrijd toevoegen:", e);
      return null;
    }
  }

  async function updateMatch(matchId, updates) {
    try {
      if (useFirestore) {
        const { doc, updateDoc } = await ensureFirebaseFns();
        await updateDoc(doc(db, "matches", matchId), updates);
        console.log("[Firestore] match geüpdatet:", matchId);
        return true;
      }
      setMatches(prev =>
        prev.map(m => (m.id === matchId ? { ...m, ...updates } : m))
      );
      return true;
    } catch (e) {
      console.error("[Firestore] Fout bij updateMatch:", e);
      return false;
    }
  }

  async function deleteMatch(matchId) {
    try {
      if (useFirestore) {
        const { doc, deleteDoc } = await ensureFirebaseFns();
        await deleteDoc(doc(db, "matches", matchId));
        console.log("[Firestore] match verwijderd:", matchId);
        return true;
      }
      setMatches(prev => prev.filter(m => m.id !== matchId));
      return true;
    } catch (e) {
      console.error("[Firestore] Fout bij deleteMatch:", e);
      return false;
    }
  }

  // --- CLIPS ---
  function getClipsByMatch(matchId) {
    return clips.filter(c => c.matchId === matchId);
  }

  async function addClip(clip) {
    try {
      if (useFirestore) {
        const { addDoc, collection, serverTimestamp } = await ensureFirebaseFns();
        await addDoc(collection(db, "clips"), {
          ...clip,
          createdAt: serverTimestamp(),
        });
        return true;
      }
      setClips(prev => [...prev, { id: uuidv4(), ...clip }]);
      return true;
    } catch (e) {
      console.error("[Firestore] addClip fout:", e);
      return false;
    }
  }

  async function deleteClip(id) {
    try {
      if (useFirestore) {
        const { doc, deleteDoc } = await ensureFirebaseFns();
        await deleteDoc(doc(db, "clips", id));
        return true;
      }
      setClips(prev => prev.filter(c => c.id !== id));
      return true;
    } catch (e) {
      console.error("[Firestore] deleteClip fout:", e);
      return false;
    }
  }

  // --- SUBSTITUTIONS ---
  function getSubsByMatch(matchId) {
    return substitutions.filter(s => s.matchId === matchId);
  }

  async function addSubstitution(sub) {
    try {
      if (useFirestore) {
        const { addDoc, collection, serverTimestamp } = await ensureFirebaseFns();
        await addDoc(collection(db, "substitutions"), {
          ...sub,
          createdAt: serverTimestamp(),
        });
        return true;
      }
      setSubstitutions(prev => [...prev, { id: uuidv4(), ...sub }]);
      return true;
    } catch (e) {
      console.error("[Firestore] addSubstitution fout:", e);
      return false;
    }
  }

  async function deleteSubstitution(id) {
    try {
      if (useFirestore) {
        const { doc, deleteDoc } = await ensureFirebaseFns();
        await deleteDoc(doc(db, "substitutions", id));
        return true;
      }
      setSubstitutions(prev => prev.filter(s => s.id !== id));
      return true;
    } catch (e) {
      console.error("[Firestore] deleteSubstitution fout:", e);
      return false;
    }
  }

  // --- VIDEO STORAGE LOCAL ---
  function saveMatchVideosLocally(matchId, data) {
    localStorage.setItem(LS_KEYS.VIDEOS(matchId), JSON.stringify(data));
  }

  function loadMatchVideosLocally(matchId) {
    return JSON.parse(localStorage.getItem(LS_KEYS.VIDEOS(matchId)) || "null");
  }

  async function removeTeam(teamId) {
    if (useFirestore) {
      try {
        const { doc, deleteDoc } = await ensureFirebaseFns();
        await deleteDoc(doc(db, "teams", teamId));
        console.log("[Firestore] team verwijderd:", teamId);
        // Realtime onSnapshot werkt de lokale state bij.
        return true;
      } catch (e) {
        console.error("[Firestore] Fout bij team verwijderen:", e);
        return false;
      }
    }
    // Fallback: localStorage-modus
    setTeams(prev => prev.filter(t => t.id !== teamId));
    return true;
  }

  // Basisselectoren
  const getTeamById = (id) => teams.find((t) => t.id === id) || null;
  const getTeamPlayers = (id) => {
    const t = getTeamById(id);
    return t ? [...(t.players || []), ...(t.subs || [])] : [];
  };

  const value = useMemo(
    () => ({
      ready,
      useFirestore,
      teams,
      matches,
      clips,
      substitutions,
      clipSequences,

      // teams
      addTeam,
      deleteTeam,
      removeTeam,

      // spelers
      addPlayer,
      addPlayerToTeam,
      removePlayer,
      updatePlayerAvatar,

      // wissels
      addSubToTeam: (teamId, player) => addPlayer(teamId, { ...player, isSub: true }),
      removePlayerFromTeam: (teamId, playerId) => removePlayer(teamId, playerId, false),
      removeSubFromTeam: (teamId, playerId) => removePlayer(teamId, playerId, true),

      // tegenstanders
      addOpponentToTeam,
      removeOpponentFromTeam,

      // wedstrijden
      addMatch,
      updateMatch,
      deleteMatch,
      getClipsByMatch,
      addClip,
      deleteClip,
      updateClipPosition,
      getSequencesByMatch,
      addClipSequence,
      deleteClipSequence,
      setClipSequenceForClip,
      setClipFavorite,
      addSubstitution,
      deleteSubstitution,
      getSubsByMatch,
      saveMatchVideosLocally,
      loadMatchVideosLocally,
      uploadMatchVideo,

      // helpers
      getTeamById,
      getTeamPlayers,
    }),
    [ready, useFirestore, teams, matches, clips, substitutions, clipSequences]
  );

  if (!ready) {
    return (
      <div style={{ color: "white", textAlign: "center", marginTop: "40vh" }}>
        ⏳ Laden data...
      </div>
    );
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}