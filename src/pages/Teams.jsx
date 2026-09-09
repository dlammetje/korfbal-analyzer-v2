import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Users, Wrench } from "lucide-react";
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
  addSeasonToTeam,
  updateSeasonForTeam,
  deleteSeasonFromTeam,
  addOpponentToTeam, 
  removeOpponentFromTeam 
} = useAppData();

  const navigate = useNavigate();

  const [newTeamName, setNewTeamName] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [newPlayer, setNewPlayer] = useState({ name: "", number: "" });
  const [newSub, setNewSub] = useState({ name: "", number: "" });
  const [newOpponent, setNewOpponent] = useState("");
  const [selectedSeasonId, setSelectedSeasonId] = useState("");
  const [newSeason, setNewSeason] = useState({ name: "", part: "veld_najaar" });
  const [editingSeasonId, setEditingSeasonId] = useState("");
  const [editingSeason, setEditingSeason] = useState({ name: "", part: "veld_najaar" });
  const [seasonModalOpen, setSeasonModalOpen] = useState(false);
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [busy, setBusy] = useState({
    addTeam: false,
    addPlayer: false,
    addSub: false,
    addOpp: false,
    delTeam: false,
    removePlayerId: null,
    removeOppName: null,
    addSeason: false,
    saveSeason: false,
    deleteSeasonId: null,
  });

  // === Nieuw team toevoegen ===
  const handleAddTeam = async () => {
    if (!newTeamName.trim()) return alert("Voer een teamnaam in.");
    if (busy.addTeam) return;
    try {
      setBusy((b) => ({ ...b, addTeam: true }));
      await Promise.resolve(addTeam({ name: newTeamName }));
      setNewTeamName("");
      setTeamModalOpen(false);
    } catch (e) {
      console.error("Team toevoegen mislukt:", e);
      alert("Team toevoegen mislukt. Zie console voor details.");
    } finally {
      setBusy((b) => ({ ...b, addTeam: false }));
    }
  };

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);
  const selectedSeason = selectedTeam?.seasons?.find((s) => s.id === selectedSeasonId) || null;
  const seasonOpponents = selectedSeason ? (selectedSeason.opponents || []) : (selectedTeam?.opponents || []);

  useEffect(() => {
    if (!selectedTeam) {
      setSelectedSeasonId("");
      return;
    }
    if (selectedSeasonId && selectedTeam.seasons?.some((s) => s.id === selectedSeasonId)) return;
    setSelectedSeasonId(selectedTeam.seasons?.[0]?.id || "");
  }, [selectedTeam, selectedSeasonId]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold mb-2">Teams & Spelers</h2>
          <p className="text-neutral-400 text-sm">
            Maak teams aan, voeg spelers toe met rugnummers en beheer wissels.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTeamModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-2xl bg-[#FF6124] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-[#FF6124]/20 hover:opacity-90"
        >
          <Plus size={18} /> Team toevoegen
        </button>
      </div>

      {teamModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Nieuw team toevoegen</h3>
                <p className="text-sm text-neutral-400">Maak een team aan dat je daarna kunt vullen met spelers, seizoenen en tegenstanders.</p>
              </div>
              <button
                type="button"
                onClick={() => setTeamModalOpen(false)}
                className="rounded-xl px-3 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
              >
                Sluiten
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Teamnaam</label>
                <input
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="Bijv. Sparta 1"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-neutral-800 pt-4">
                <button
                  type="button"
                  onClick={() => setTeamModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
                >
                  Annuleren
                </button>
                <button
                  onClick={handleAddTeam}
                  disabled={busy.addTeam}
                  className="flex items-center gap-2 bg-[#FF6124] text-white px-4 py-2 rounded-xl hover:opacity-90 disabled:opacity-60"
                >
                  <Plus size={16} /> Toevoegen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* === Overzicht Teams === */}
      {teams.length > 0 ? (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
              <Users size={18} /> Teams
            </h3>
            <span className="text-xs text-neutral-500">{teams.length} team{teams.length === 1 ? "" : "s"}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTeamId(t.id)}
                className={`rounded-2xl border p-4 text-left transition ${
                  selectedTeamId === t.id
                    ? "bg-[#FF6124]/20 border-[#FF6124] text-white"
                    : "border-neutral-800 bg-neutral-950/60 text-neutral-300 hover:border-[#FF6124]/50 hover:bg-neutral-800"
                }`}
              >
                <div className="font-semibold">{t.name}</div>
                <div className="mt-2 text-xs text-neutral-400">
                  {t.players?.length || 0} spelers · {t.seasons?.length || 0} seizoenen
                </div>
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

          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-4">
            <div>
              <h4 className="font-semibold text-neutral-100">Seizoenen</h4>
              <p className="text-sm text-neutral-400">Maak per team een seizoen/deel aan, zodat tegenstanders per periode apart blijven.</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Naam seizoen</label>
                <input
                  type="text"
                  value={newSeason.name}
                  onChange={(e) => setNewSeason({ ...newSeason, name: e.target.value })}
                  placeholder="Bijv. 2025/2026"
                  className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-neutral-400 mb-1">Deel</label>
                <select
                  value={newSeason.part}
                  onChange={(e) => setNewSeason({ ...newSeason, part: e.target.value })}
                  className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                >
                  <option value="veld_najaar">Veld najaar</option>
                  <option value="zaal">Zaal</option>
                  <option value="veld_voorjaar">Veld voorjaar</option>
                </select>
              </div>
              <button
                onClick={async () => {
                  if (!newSeason.name.trim()) return alert("Voer een seizoensnaam in.");
                  if (busy.addSeason) return;
                  try {
                    setBusy((b) => ({ ...b, addSeason: true }));
                    const id = await Promise.resolve(addSeasonToTeam(selectedTeam.id, newSeason));
                    setNewSeason({ name: "", part: "veld_najaar" });
                    if (id) setSelectedSeasonId(id);
                  } catch (e) {
                    console.error("Seizoen toevoegen mislukt:", e);
                    alert("Seizoen toevoegen mislukt. Zie console.");
                  } finally {
                    setBusy((b) => ({ ...b, addSeason: false }));
                  }
                }}
                disabled={busy.addSeason}
                className="flex items-center gap-2 bg-[#FF6124] text-white px-4 py-2 rounded-xl hover:opacity-90 disabled:opacity-60"
              >
                <Plus size={16} /> Seizoen toevoegen
              </button>
            </div>

            {selectedTeam.seasons?.length > 0 ? (
              <div className="overflow-hidden rounded-2xl border border-neutral-800">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-950 text-neutral-400">
                    <tr>
                      <th className="px-3 py-2 text-left">Seizoen</th>
                      <th className="px-3 py-2 text-left">Deel</th>
                      <th className="px-3 py-2 text-left">Tegenstanders</th>
                      <th className="px-3 py-2 text-right">Acties</th>
                    </tr>
                  </thead>
                  <tbody>
                  {selectedTeam.seasons.map((season) => (
                    <tr
                      key={season.id}
                      onClick={() => {
                        setSelectedSeasonId(season.id);
                        setEditingSeasonId(season.id);
                        setEditingSeason({ name: season.name, part: season.part || "veld_najaar" });
                        setSeasonModalOpen(true);
                      }}
                      className={`cursor-pointer border-t border-neutral-800 transition ${
                        selectedSeasonId === season.id
                          ? "bg-[#FF6124]/20 text-white"
                          : "text-neutral-300 hover:bg-neutral-800"
                      }`}
                    >
                      <td className="px-3 py-3 font-medium">{season.name}</td>
                      <td className="px-3 py-3">{season.part === "zaal" ? "Zaal" : season.part === "veld_voorjaar" ? "Veld voorjaar" : "Veld najaar"}</td>
                      <td className="px-3 py-3">{season.opponents?.length || 0}</td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSeasonId(season.id);
                              setEditingSeasonId(season.id);
                              setEditingSeason({ name: season.name, part: season.part || "veld_najaar" });
                              setSeasonModalOpen(true);
                            }}
                            className="text-[#FF6124] hover:text-white"
                            title="Bewerk"
                          >
                            <Wrench size={16} />
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm("Weet je zeker dat je dit seizoen inclusief tegenstanders wilt verwijderen?")) return;
                              try {
                                setBusy((b) => ({ ...b, deleteSeasonId: season.id }));
                                await Promise.resolve(deleteSeasonFromTeam(selectedTeam.id, season.id));
                              } catch (err) {
                                console.error("Seizoen verwijderen mislukt:", err);
                                alert("Seizoen verwijderen mislukt. Zie console.");
                              } finally {
                                setBusy((b) => ({ ...b, deleteSeasonId: null }));
                              }
                            }}
                            disabled={busy.deleteSeasonId === season.id}
                            className="text-neutral-400 hover:text-red-400 disabled:opacity-60"
                            title="Verwijder seizoen"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-neutral-500 text-sm">Nog geen seizoenen toegevoegd.</div>
            )}
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



          {selectedSeason && seasonModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
              <div className="w-full max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-semibold text-white">Seizoen aanpassen</h4>
                    <p className="text-sm text-neutral-400">Wijzig de naam of het korfbalseizoen-deel.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSeasonModalOpen(false)}
                    className="rounded-xl px-3 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                  >
                    Sluiten
                  </button>
                </div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4">
                    <h5 className="mb-3 font-semibold text-neutral-100">Poule / Tegenstanders bij dit seizoen</h5>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex-1 min-w-48">
                        <label className="block text-xs text-neutral-400 mb-1">Tegenstander naam</label>
                        <input
                          type="text"
                          value={newOpponent}
                          onChange={(e) => setNewOpponent(e.target.value)}
                          placeholder="Bijv. Roda 1"
                          className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                        />
                      </div>
                      <button
                        onClick={async () => {
                          if (!newOpponent.trim()) return;
                          if (busy.addOpp) return;
                          try {
                            setBusy((b) => ({ ...b, addOpp: true }));
                            await Promise.resolve(addOpponentToTeam(selectedTeam.id, newOpponent, selectedSeason.id));
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
                        <Plus size={16} /> Toevoegen
                      </button>
                    </div>
                    {seasonOpponents.length > 0 ? (
                      <div className="mt-4 overflow-hidden rounded-xl border border-neutral-800">
                        <table className="w-full text-sm">
                          <thead className="bg-neutral-900 text-neutral-400">
                            <tr>
                              <th className="px-3 py-2 text-left">Naam</th>
                              <th className="px-3 py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {seasonOpponents.map((o, i) => (
                              <tr key={i} className="border-t border-neutral-800">
                                <td className="px-3 py-2">{o}</td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    onClick={async () => {
                                      if (busy.removeOppName === o) return;
                                      try {
                                        setBusy((b) => ({ ...b, removeOppName: o }));
                                        await Promise.resolve(removeOpponentFromTeam(selectedTeam.id, o, selectedSeason.id));
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
                      </div>
                    ) : (
                      <div className="mt-3 text-sm text-neutral-500">Nog geen tegenstanders toegevoegd aan dit seizoen.</div>
                    )}
                  </div>
                    <div>
                      <label className="block text-xs text-neutral-400 mb-1">Naam aanpassen</label>
                      <input
                        type="text"
                        value={editingSeasonId === selectedSeason.id ? editingSeason.name : selectedSeason.name}
                        onFocus={() => {
                          setEditingSeasonId(selectedSeason.id);
                          setEditingSeason({ name: selectedSeason.name, part: selectedSeason.part || "veld_najaar" });
                        }}
                        onChange={(e) => setEditingSeason({ ...editingSeason, name: e.target.value })}
                        className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-neutral-400 mb-1">Deel aanpassen</label>
                      <select
                        value={editingSeasonId === selectedSeason.id ? editingSeason.part : selectedSeason.part || "veld_najaar"}
                        onFocus={() => {
                          setEditingSeasonId(selectedSeason.id);
                          setEditingSeason({ name: selectedSeason.name, part: selectedSeason.part || "veld_najaar" });
                        }}
                        onChange={(e) => setEditingSeason({ ...editingSeason, part: e.target.value })}
                        className="bg-neutral-800 border border-neutral-700 rounded-xl px-3 py-2 text-white text-sm"
                      >
                        <option value="veld_najaar">Veld najaar</option>
                        <option value="zaal">Zaal</option>
                        <option value="veld_voorjaar">Veld voorjaar</option>
                      </select>
                    </div>
                  <div className="flex flex-wrap justify-between gap-3 border-t border-neutral-800 pt-4">
                    <button
                      onClick={async () => {
                        if (!confirm("Weet je zeker dat je dit seizoen inclusief tegenstanders wilt verwijderen?")) return;
                        try {
                          setBusy((b) => ({ ...b, deleteSeasonId: selectedSeason.id }));
                          await Promise.resolve(deleteSeasonFromTeam(selectedTeam.id, selectedSeason.id));
                          setSeasonModalOpen(false);
                        } catch (e) {
                          console.error("Seizoen verwijderen mislukt:", e);
                          alert("Seizoen verwijderen mislukt. Zie console.");
                        } finally {
                          setBusy((b) => ({ ...b, deleteSeasonId: null }));
                        }
                      }}
                      disabled={busy.deleteSeasonId === selectedSeason.id}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-red-400 hover:bg-red-500/10 disabled:opacity-60"
                    >
                      <Trash2 size={16} /> Verwijderen
                    </button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSeasonModalOpen(false)}
                        className="px-4 py-2 rounded-xl bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
                      >
                        Annuleren
                      </button>
                    <button
                      onClick={async () => {
                        if (!editingSeason.name.trim()) return;
                        if (busy.saveSeason) return;
                        try {
                          setBusy((b) => ({ ...b, saveSeason: true }));
                          await Promise.resolve(updateSeasonForTeam(selectedTeam.id, selectedSeason.id, editingSeason));
                          setSeasonModalOpen(false);
                        } catch (e) {
                          console.error("Seizoen opslaan mislukt:", e);
                          alert("Seizoen opslaan mislukt. Zie console.");
                        } finally {
                          setBusy((b) => ({ ...b, saveSeason: false }));
                        }
                      }}
                      disabled={busy.saveSeason}
                      className="px-4 py-2 rounded-xl bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-60"
                    >
                      Opslaan
                    </button>
                  </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}