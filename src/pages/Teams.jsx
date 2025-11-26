import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Users } from "lucide-react";
import { useAppData } from "../context/AppDataContext";

export default function Teams() {
const { 
  teams, 
  addTeam, 
  deleteTeam, 
  addPlayerToTeam, 
  addSubToTeam, 
  removePlayerFromTeam, 
  removeSubFromTeam,   // ✅ HIER TOEVOEGEN
  addOpponentToTeam, 
  removeOpponentFromTeam 
} = useAppData();

  const navigate = useNavigate();

  const [newTeamName, setNewTeamName] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [newPlayer, setNewPlayer] = useState({ name: "", number: "" });
  const [newSub, setNewSub] = useState({ name: "", number: "" });
  const [newOpponent, setNewOpponent] = useState("");
  const [busy, setBusy] = useState({
    addTeam: false,
    addPlayer: false,
    addSub: false,
    addOpp: false,
    delTeam: false,
    removePlayerId: null,
    removeOppName: null,
  });

  // === Nieuw team toevoegen ===
  const handleAddTeam = async () => {
    if (!newTeamName.trim()) return alert("Voer een teamnaam in.");
    if (busy.addTeam) return;
    try {
      setBusy((b) => ({ ...b, addTeam: true }));
      await Promise.resolve(addTeam({ name: newTeamName }));
      setNewTeamName("");
    } catch (e) {
      console.error("Team toevoegen mislukt:", e);
      alert("Team toevoegen mislukt. Zie console voor details.");
    } finally {
      setBusy((b) => ({ ...b, addTeam: false }));
    }
  };

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-semibold mb-2">Teams & Spelers</h2>
      <p className="text-neutral-400 text-sm">
        Maak teams aan, voeg spelers toe met rugnummers en beheer wissels.
      </p>

      {/* === Team aanmaken === */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm text-neutral-400 mb-1">Teamnaam</label>
          <input
            type="text"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            placeholder="Bijv. Sparta 1"
            className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
          />
        </div>
        <button
          onClick={handleAddTeam}
          disabled={busy.addTeam}
          className="flex items-center gap-2 bg-[#FF6124] text-white px-4 py-2 rounded-xl hover:opacity-90 disabled:opacity-60"
        >
          <Plus size={16} /> Nieuw Team
        </button>
      </div>

      {/* === Overzicht Teams === */}
      {teams.length > 0 ? (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-4">
          <h3 className="text-lg font-semibold text-neutral-100 mb-3 flex items-center gap-2">
            <Users size={18} /> Teams
          </h3>
          <div className="flex flex-wrap gap-2">
            {teams.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTeamId(t.id)}
                className={`px-4 py-2 rounded-xl border ${
                  selectedTeamId === t.id
                    ? "bg-[#FF6124] border-[#FF6124] text-white"
                    : "border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-[#FF6124]/50"
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-neutral-500">Nog geen teams toegevoegd.</div>
      )}

      {/* === Spelers & Wissels === */}
      {selectedTeam && (
        <div className="space-y-6">
          {/* Team info header */}
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-semibold text-white">{selectedTeam.name}</h3>
            <button
              onClick={async () => {
                if (busy.delTeam) return;
                try {
                  setBusy((b) => ({ ...b, delTeam: true }));
                  await Promise.resolve(deleteTeam(selectedTeam.id));
                  // als het geselecteerde team verwijderd is, deselecteren
                  setSelectedTeamId((id) => (id === selectedTeam.id ? null : id));
                } catch (e) {
                  console.error("Team verwijderen mislukt:", e);
                  alert("Team verwijderen mislukt. Zie console.");
                } finally {
                  setBusy((b) => ({ ...b, delTeam: false }));
                }
              }}
              disabled={busy.delTeam}
              className="flex items-center gap-2 text-red-400 hover:text-red-300 disabled:opacity-60"
            >
              <Trash2 size={16} /> Verwijder Team
            </button>
          </div>

          {/* Spelers toevoegen */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
            <h4 className="font-semibold text-neutral-100 mb-2">Spelers</h4>
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Naam</label>
                <input
                  type="text"
                  value={newPlayer.name}
                  onChange={(e) => setNewPlayer({ ...newPlayer, name: e.target.value })}
                  placeholder="Bijv. A. Jansen"
                  className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Rugnummer</label>
                <input
                  type="number"
                  value={newPlayer.number}
                  onChange={(e) => setNewPlayer({ ...newPlayer, number: e.target.value })}
                  placeholder="7"
                  className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm w-24"
                />
              </div>
              <button
                onClick={async () => {
                  if (!newPlayer.name.trim()) return;
                  if (busy.addPlayer) return;
                  try {
                    setBusy((b) => ({ ...b, addPlayer: true }));
                    await Promise.resolve(addPlayerToTeam(selectedTeam.id, newPlayer));
                    setNewPlayer({ name: "", number: "" });
                  } catch (e) {
                    console.error("Speler toevoegen mislukt:", e);
                    alert("Speler toevoegen mislukt. Zie console.");
                  } finally {
                    setBusy((b) => ({ ...b, addPlayer: false }));
                  }
                }}
                disabled={busy.addPlayer}
                className="flex items-center gap-2 bg-[#FF6124] text-white px-4 py-2 rounded-xl hover:opacity-90 disabled:opacity-60"
              >
                <Plus size={16} /> Speler toevoegen
              </button>
            </div>

            {/* Spelerslijst */}
            {selectedTeam.players?.length > 0 ? (
              <table className="w-full text-sm border-t border-neutral-800">
                <thead>
                  <tr className="text-neutral-400">
                    <th className="py-2 text-left">Rugnr</th>
                    <th className="text-left">Naam</th>
                    <th className="text-center">Profiel</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTeam.players.map((p) => (
                    <tr key={p.id} className="border-t border-neutral-800 hover:bg-neutral-950">
                      <td className="py-2">{p.number}</td>
                      <td>{p.name}</td>
                      <td className="text-center">
                        <button
                          type="button"
                          className="text-xs text-[#FF6124] hover:underline"
                          onClick={() => navigate(`/player/${encodeURIComponent(p.name)}`)}
                        >
                          Profiel
                        </button>
                      </td>
                      <td className="text-right">
                        <button
                          onClick={async () => {
                            if (busy.removePlayerId === p.id) return;
                            try {
                              setBusy((b) => ({ ...b, removePlayerId: p.id }));
                              await Promise.resolve(removePlayerFromTeam(selectedTeam.id, p.id));
                            } catch (e) {
                              console.error("Speler verwijderen mislukt:", e);
                              alert("Speler verwijderen mislukt. Zie console.");
                            } finally {
                              setBusy((b) => ({ ...b, removePlayerId: null }));
                            }
                          }}
                          className="text-neutral-400 hover:text-red-400"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-neutral-500 text-sm mt-3">Nog geen spelers toegevoegd.</div>
            )}
          </div>

          {/* Wissels toevoegen */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
            <h4 className="font-semibold text-neutral-100 mb-2">Wisselspelers</h4>
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Naam</label>
                <input
                  type="text"
                  value={newSub.name}
                  onChange={(e) => setNewSub({ ...newSub, name: e.target.value })}
                  placeholder="Bijv. B. de Vries"
                  className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Rugnummer</label>
                <input
                  type="number"
                  value={newSub.number}
                  onChange={(e) => setNewSub({ ...newSub, number: e.target.value })}
                  placeholder="12"
                  className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm w-24"
                />
              </div>
              <button
                onClick={async () => {
                  if (!newSub.name.trim()) return;
                  if (busy.addSub) return;
                  try {
                    setBusy((b) => ({ ...b, addSub: true }));
                    await Promise.resolve(addSubToTeam(selectedTeam.id, newSub));
                    setNewSub({ name: "", number: "" });
                  } catch (e) {
                    console.error("Wissel toevoegen mislukt:", e);
                    alert("Wissel toevoegen mislukt. Zie console.");
                  } finally {
                    setBusy((b) => ({ ...b, addSub: false }));
                  }
                }}
                disabled={busy.addSub}
                className="flex items-center gap-2 bg-[#FF6124] text-white px-4 py-2 rounded-xl hover:opacity-90 disabled:opacity-60"
              >
                <Plus size={16} /> Wissel toevoegen
              </button>
            </div>

            {/* Wissellijst */}
            {selectedTeam.subs?.length > 0 ? (
              <table className="w-full text-sm border-t border-neutral-800">
                <thead>
                  <tr className="text-neutral-400">
                    <th className="py-2 text-left">Rugnr</th>
                    <th className="text-left">Naam</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTeam.subs.map((p) => (
                    <tr key={p.id} className="border-t border-neutral-800 hover:bg-neutral-950">
                      <td className="py-2">{p.number}</td>
                      <td>{p.name}</td>
                      <td className="text-right">
                        <button
                          onClick={async () => {
                            if (busy.removePlayerId === p.id) return;
                            try {
                              setBusy((b) => ({ ...b, removePlayerId: p.id }));
                              await Promise.resolve(removeSubFromTeam(selectedTeam.id, p.id));
                            } catch (e) {
                              console.error("Wissel verwijderen mislukt:", e);
                              alert("Wissel verwijderen mislukt. Zie console.");
                            } finally {
                              setBusy((b) => ({ ...b, removePlayerId: null }));
                            }
                          }}
                          className="text-neutral-400 hover:text-red-400"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-neutral-500 text-sm mt-3">Nog geen wissels toegevoegd.</div>
            )}
          </div>

          {/* Poule / Tegenstanders toevoegen */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
            <h4 className="font-semibold text-neutral-100 mb-2">Poule / Tegenstanders</h4>
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Tegenstander naam</label>
                <input
                  type="text"
                  value={newOpponent}
                  onChange={(e) => setNewOpponent(e.target.value)}
                  placeholder="Bijv. Roda 1"
                  className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                />
              </div>
              <button
                onClick={async () => {
                  if (!newOpponent.trim()) return;
                  if (busy.addOpp) return;
                  try {
                    setBusy((b) => ({ ...b, addOpp: true }));
                    await Promise.resolve(addOpponentToTeam(selectedTeam.id, newOpponent));
                    setNewOpponent("");
                  } catch (e) {
                    console.error("Tegenstander toevoegen mislukt:", e);
                    alert("Tegenstander toevoegen mislukt. Zie console.");
                  } finally {
                    setBusy((b) => ({ ...b, addOpp: false }));
                  }
                }}
                disabled={busy.addOpp}
                className="flex items-center gap-2 bg-[#FF6124] text-white px-4 py-2 rounded-xl hover:opacity-90 disabled:opacity-60"
              >
                <Plus size={16} /> Tegenstander toevoegen
              </button>
            </div>

            {selectedTeam.opponents?.length > 0 ? (
              <table className="w-full text-sm border-t border-neutral-800">
                <thead>
                  <tr className="text-neutral-400">
                    <th className="py-2 text-left">Naam</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTeam.opponents.map((o, i) => (
                    <tr key={i} className="border-t border-neutral-800 hover:bg-neutral-950">
                      <td className="py-2">{o}</td>
                      <td className="text-right">
                        <button
                          onClick={async () => {
                            if (busy.removeOppName === o) return;
                            try {
                              setBusy((b) => ({ ...b, removeOppName: o }));
                              await Promise.resolve(removeOpponentFromTeam(selectedTeam.id, o));
                            } catch (e) {
                              console.error("Tegenstander verwijderen mislukt:", e);
                              alert("Tegenstander verwijderen mislukt. Zie console.");
                            } finally {
                              setBusy((b) => ({ ...b, removeOppName: null }));
                            }
                          }}
                          className="text-neutral-400 hover:text-red-400"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-neutral-500 text-sm mt-3">Nog geen tegenstanders toegevoegd.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}