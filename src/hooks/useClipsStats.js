import { useMemo } from "react";

export function useClipsStats(clips = []) {

  return useMemo(() => {

    let totalChances = 0;
    let totalGoals = 0;
    let totalMiss = 0;
    let totalTurnovers = 0;
    let totalFouls = 0;

    const perPlayerMap = {};
    const perZoneMap = {};

    clips.forEach((c) => {

      const player = c.player || "Onbekend";
      const zone = c.zone || "—";

      // --- PER PLAYER ---
      if (!perPlayerMap[player]) {
        perPlayerMap[player] = {
          player,
          chances: 0,
          goals: 0,
          miss: 0
        };
      }

      // --- CHANCE / GOAL / MISS ---
      if (c.actionType === "schot" || c.isChance === true) {
        totalChances++;
        perPlayerMap[player].chances++;
      }

      if (c.result === "goal") {
        totalGoals++;
        perPlayerMap[player].goals++;
      }

      if (c.result === "miss") {
        totalMiss++;
        perPlayerMap[player].miss++;
      }

      // --- TURNOVERS ---
      if (c.actionType === "balverlies") {
        totalTurnovers++;
      }

      // --- FOULS ---
      if (c.actionType === "overtreding") {
        totalFouls++;
      }

      // --- PER ZONE ---
      if (!perZoneMap[zone]) {
        perZoneMap[zone] = {
          zone,
          total: 0,
          goals: 0
        };
      }

      perZoneMap[zone].total++;
      if (c.result === "goal") perZoneMap[zone].goals++;

    });

    const fgPerc =
      totalChances > 0 ? Math.round((totalGoals / totalChances) * 100) : 0;

    return {
      total: {
        chances: totalChances,
        goals: totalGoals,
        miss: totalMiss,
        turnovers: totalTurnovers,
        fouls: totalFouls,
        fg: fgPerc,
      },

      perPlayer: Object.values(perPlayerMap),
      perZone: Object.values(perZoneMap)
    };

  }, [clips]);
}