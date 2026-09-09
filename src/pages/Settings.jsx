import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useAppData } from "../context/AppDataContext";
import { db, storage } from "../lib/firebaseClient";
import { doc, getDoc, setDoc, collection, query, where, getDocs, deleteDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export default function Settings() {
  const { currentUser, changeEmail, deleteAccount } = useAuth();
  const { teams = [], updatePlayerAvatar } = useAppData() || {};

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [preferredTeamId, setPreferredTeamId] = useState("");
  const [themeColor, setThemeColor] = useState("#FF6124");
  const [clubWebsite, setClubWebsite] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  // Club-koppeling
  const [clubCode, setClubCode] = useState("");
  const [clubInviteCode, setClubInviteCode] = useState("");
  const [clubStatus, setClubStatus] = useState("");

  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState("");

  // Speler-koppeling + profielfoto
  const [linkedTeamId, setLinkedTeamId] = useState("");
  const [linkedPlayerId, setLinkedPlayerId] = useState("");
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarStatus, setAvatarStatus] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);

  const playerOptions = teams.flatMap((t) => {
    const players = (t.players || []).concat(t.subs || []);
    return players.map((p) => ({
      teamId: t.id,
      teamName: t.name || "Onbekend team",
      playerId: p.id,
      label: `${t.name || "Onbekend team"} · ${p.number ? p.number + " - " : ""}${p.name}`,
    }));
  });

  // CSS-variable toepassen zodra themeColor wijzigt
  useEffect(() => {
    if (themeColor) {
      document.documentElement.style.setProperty("--accent-color", themeColor);
    }
  }, [themeColor]);

  async function handleLinkPlayer() {
    if (!currentUser) return;
    if (!linkedTeamId || !linkedPlayerId) {
      setAvatarStatus("Kies eerst een team en een speler om te koppelen.");
      return;
    }

    try {
      const ref = doc(db, "users", currentUser.uid);
      await setDoc(ref, {
        teamId: linkedTeamId,
        playerId: linkedPlayerId,
      }, { merge: true });
      setAvatarStatus("Je account is gekoppeld aan de gekozen speler.");
    } catch (e) {
      console.error("[Settings] Fout bij speler koppelen:", e);
      setAvatarStatus("Speler koppelen mislukt. Probeer het later opnieuw.");
    }
  }

  async function handleUploadAvatar() {
    if (!currentUser) return;
    if (!linkedTeamId || !linkedPlayerId) {
      setAvatarStatus("Koppel eerst je account aan een speler.");
      return;
    }
    if (!avatarFile) {
      setAvatarStatus("Kies eerst een afbeeldingsbestand.");
      return;
    }

    if (!storage) {
      console.error("[Settings] Firebase Storage niet beschikbaar");
      setAvatarStatus("Uploaden niet mogelijk (storage niet beschikbaar).");
      return;
    }

    try {
      setAvatarUploading(true);
      setAvatarStatus("Profielfoto wordt geüpload...");

      const safeExt = (avatarFile.name || "").split(".").pop() || "jpg";
      const path = `avatars/${currentUser.uid}/${linkedTeamId}_${linkedPlayerId}.${safeExt}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, avatarFile);
      const url = await getDownloadURL(storageRef);

      await updatePlayerAvatar(linkedTeamId, linkedPlayerId, url);

      setAvatarStatus("Profielfoto opgeslagen.");
      setAvatarFile(null);
    } catch (e) {
      console.error("[Settings] Fout bij uploaden profielfoto:", e);
      setAvatarStatus("Uploaden van profielfoto mislukt. Probeer het later opnieuw.");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleDeleteAccount() {
    if (!currentUser) return;

    const confirmed = window.confirm(
      "Weet je zeker dat je je account DEFINITIEF wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt."
    );
    if (!confirmed) return;

    try {
      // Verwijder gebruikersdocument uit Firestore
      const userRef = doc(db, "users", currentUser.uid);
      await deleteDoc(userRef);

      // Verwijder Auth-account
      await deleteAccount();

      // Redirect naar login/signup
      window.location.href = "/signup";
    } catch (e) {
      console.error("[Settings] Fout bij account verwijderen:", e);
      alert(
        e?.code === "auth/requires-recent-login"
          ? "Account verwijderen vereist een recente login. Log opnieuw in en probeer het opnieuw."
          : "Account verwijderen is mislukt. Zie console voor details."
      );
    }
  }

  useEffect(() => {
    if (!currentUser) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadProfile() {
      try {
        setLoading(true);
        setEmail(currentUser.email || "");
        setDisplayName(currentUser.displayName || "");

        const ref = doc(db, "users", currentUser.uid);
        const snap = await getDoc(ref);
        if (!cancelled && snap.exists()) {
          const data = snap.data() || {};
          if (data.displayName) setDisplayName(data.displayName);
          if (data.preferredTeamId) setPreferredTeamId(data.preferredTeamId);
          if (data.themeColor) setThemeColor(data.themeColor);
          if (data.clubWebsite) setClubWebsite(data.clubWebsite);

          if (data.teamId) setLinkedTeamId(data.teamId);
          if (data.playerId) setLinkedPlayerId(data.playerId);

          // Toon eventueel bestaande club-informatie in de status
          if (data.clubId && data.clubName) {
            setClubStatus(`Gekoppeld aan club: ${data.clubName}`);
          }
        }
      } catch (e) {
        console.error("[Settings] Fout bij laden profiel:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  async function handleSave() {
    if (!currentUser) return;
    try {
      setSaving(true);
      setStatus("");

      const ref = doc(db, "users", currentUser.uid);
      await setDoc(ref, {
        displayName: displayName || "",
        preferredTeamId: preferredTeamId || "",
        themeColor: themeColor || "#FF6124",
        clubWebsite: clubWebsite || "",
        teamId: linkedTeamId || "",
        playerId: linkedPlayerId || "",
      }, { merge: true });

      setStatus("Instellingen opgeslagen.");

      // Herlaad de pagina zodat de Header direct de nieuwe clubWebsite oppakt
      window.location.reload();
    } catch (e) {
      console.error("[Settings] Fout bij opslaan profiel:", e);
      setStatus("Opslaan mislukt. Zie console voor details.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkClub() {
    if (!currentUser) return;
    const trimmedCode = clubCode.trim();
    const trimmedInvite = clubInviteCode.trim();

    if (!trimmedCode || !trimmedInvite) {
      setClubStatus("Vul zowel een clubcode als een uitnodigingscode in.");
      return;
    }

    try {
      setClubStatus("Club wordt opgezocht...");

      const clubsRef = collection(db, "clubs");
      const q = query(
        clubsRef,
        where("shortCode", "==", trimmedCode),
        where("signupCode", "==", trimmedInvite),
        where("active", "==", true)
      );

      const snap = await getDocs(q);

      if (snap.empty) {
        setClubStatus("Geen actieve club gevonden voor deze combinatie. Controleer de codes.");
        return;
      }

      // Neem de eerste match
      const docSnap = snap.docs[0];
      const clubData = docSnap.data() || {};
      const clubId = docSnap.id;
      const clubName = clubData.name || trimmedCode;

      const userRef = doc(db, "users", currentUser.uid);
      await setDoc(userRef, {
        clubId,
        clubName,
      }, { merge: true });

      setClubStatus(`Gekoppeld aan club: ${clubName}`);
    } catch (e) {
      console.error("[Settings] Fout bij club koppelen:", e);
      setClubStatus("Club koppelen mislukt. Probeer het later opnieuw of neem contact op met de beheerder.");
    }
  }

  if (!currentUser) {
    return (
      <div className="p-6 text-neutral-400">
        Je moet ingelogd zijn om instellingen te kunnen wijzigen.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 text-neutral-400">
        Instellingen laden…
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-semibold">Instellingen</h2>

      {/* Profiel */}
      <div className="bg-[#FF6124]/10 border border-[#FF6124]/40 rounded-2xl p-4 space-y-4 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
        <h3 className="text-lg font-semibold text-[#FF6124] tracking-wide">Profiel</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Naam</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white"
              placeholder="Jouw naam"
            />
          </div>

      {/* Spelerkoppeling & profielfoto */}
      <div className="bg-[#FF6124]/10 border border-[#FF6124]/40 rounded-2xl p-4 space-y-4 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]">
        <h3 className="text-lg font-semibold text-[#FF6124] tracking-wide">Spelerprofiel</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs text-neutral-400 mb-1">Ik ben speler:</label>
            <select
              value={linkedTeamId && linkedPlayerId ? `${linkedTeamId}::${linkedPlayerId}` : ""}
              onChange={(e) => {
                const value = e.target.value;
                if (!value) {
                  setLinkedTeamId("");
                  setLinkedPlayerId("");
                  return;
                }
                const [teamId, playerId] = value.split("::");
                setLinkedTeamId(teamId || "");
                setLinkedPlayerId(playerId || "");
              }}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white"
            >
              <option value="">Kies jouw naam uit de spelerslijst</option>
              {playerOptions.map((opt) => (
                <option key={`${opt.teamId}::${opt.playerId}`} value={`${opt.teamId}::${opt.playerId}`}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleLinkPlayer}
              className="mt-2 px-3 py-1 rounded-xl text-xs text-white bg-[#FF6124] disabled:opacity-60"
            >
              Koppel mijn account aan deze speler
            </button>
            <p className="text-xs text-neutral-500 mt-1">
              Dit wordt gebruikt voor je profielfoto en persoonlijke statistieken.
            </p>
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">Profielfoto uploaden</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-neutral-300"
            />
            <button
              type="button"
              onClick={handleUploadAvatar}
              disabled={avatarUploading}
              className="mt-2 px-3 py-1 rounded-xl text-xs text-white bg-[#FF6124] disabled:opacity-60"
            >
              {avatarUploading ? "Bezig met uploaden…" : "Profielfoto opslaan"}
            </button>
          </div>
        </div>

        {avatarStatus && (
          <div className="text-xs text-neutral-300">{avatarStatus}</div>
        )}
      </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              disabled
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-neutral-400 cursor-not-allowed"
            />
            <p className="text-xs text-neutral-500 mt-1">
              Je inlog-e-mailadres kan hieronder worden gewijzigd.
            </p>
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">Eigen team</label>
            <select
              value={preferredTeamId}
              onChange={(e) => setPreferredTeamId(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white"
            >
              <option value="">Alle teams tonen</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-neutral-500 mt-1">
              Als je hier bijvoorbeeld "Sparta 1" kiest, zie je op andere pagina's standaard alleen de wedstrijden van dit team.
            </p>
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">Clubwebsite</label>
            <input
              type="url"
              value={clubWebsite}
              onChange={(e) => setClubWebsite(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white"
              placeholder="https://www.jouwclub.nl"
            />
            <p className="text-xs text-neutral-500 mt-1">
              Deze URL wordt gebruikt als link achter de clubtitel in de header.
            </p>
          </div>
        </div>
      </div>

      {/* Vormgeving / thema */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-4">
        <h3 className="text-lg font-semibold text-neutral-100">Vormgeving</h3>

        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex-1">
            <label className="block text-xs text-neutral-400 mb-1">Tint / clubkleur</label>
            <input
              type="color"
              value={themeColor}
              onChange={(e) => setThemeColor(e.target.value)}
              className="w-16 h-10 p-0 border border-neutral-700 rounded cursor-pointer bg-transparent"
            />
            <p className="text-xs text-neutral-500 mt-1">
              Deze kleur wordt gebruikt voor knoppen en accenten in de hele app.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-400">Voorbeeld:</span>
            <button
              type="button"
              className="px-4 py-2 rounded-xl text-sm text-white"
              style={{ backgroundColor: "var(--accent-color)" }}
            >
              Accent-knop
            </button>
          </div>
        </div>
      </div>

      {/* E-mailadres wijzigen */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3">
        <h3 className="text-lg font-semibold text-neutral-100">E-mailadres wijzigen</h3>
        <p className="text-xs text-neutral-500">
          Om veiligheidsredenen moet je je huidige wachtwoord invoeren voordat we je e-mailadres aanpassen.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Nieuw e-mailadres</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white"
              placeholder="nieuw@voorbeeld.nl"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Huidig wachtwoord</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-sm text-white"
              placeholder="Je huidige wachtwoord"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={changingEmail}
            onClick={async () => {
              if (!newEmail.trim() || !currentPassword.trim()) {
                setEmailStatus("Vul zowel een nieuw e-mailadres als je wachtwoord in.");
                return;
              }
              try {
                setChangingEmail(true);
                setEmailStatus("");
                await changeEmail(currentPassword.trim(), newEmail.trim());
                setEmail(newEmail.trim());
                setNewEmail("");
                setCurrentPassword("");
                setEmailStatus("E-mailadres gewijzigd.");
              } catch (err) {
                console.error("[Settings] Fout bij e-mail wijzigen:", err);
                const msg = err?.message || "E-mailadres wijzigen mislukt.";
                setEmailStatus(msg);
              } finally {
                setChangingEmail(false);
              }
            }}
            className="px-4 py-2 rounded-xl text-sm text-white bg-[#FF6124] disabled:opacity-60"
          >
            {changingEmail ? "Bezig…" : "E-mailadres wijzigen"}
          </button>
          {emailStatus && (
            <span className="text-xs text-neutral-400 max-w-md">{emailStatus}</span>
          )}
        </div>
      </div>

      {/* Gevaarzone: account verwijderen */}
      <div className="bg-red-950 border border-red-700/60 rounded-2xl p-4 space-y-3">
        <h3 className="text-lg font-semibold text-red-300">Gevaarzone</h3>
        <p className="text-xs text-red-200/80">
          Het verwijderen van je account is definitief. Je gebruikersprofiel wordt verwijderd en je kunt niet meer inloggen
          met dit e-mailadres. Wedstrijddata en clips blijven bewaard voor je club.
        </p>
        <button
          type="button"
          onClick={handleDeleteAccount}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700"
        >
          Account definitief verwijderen
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-xl text-sm text-white bg-[#FF6124] disabled:opacity-60"
        >
          {saving ? "Opslaan…" : "Instellingen opslaan"}
        </button>
        {status && <span className="text-xs text-neutral-400">{status}</span>}
      </div>
    </div>
  );
}