import React from "react";

// points: [{ x: 0-1, y: 0-1, actionType, result }]
// onSelect?: ({ x, y }) => void
// selectedPosition?: { x, y } – tijdelijke marker (bijv. bij klikken voor nieuwe actie)
// maxWidth: Tailwind max-w-* class, bijv. "max-w-xl" (default)
export default function FieldHeatmap({ points = [], onSelect, selectedPosition, maxWidth = "max-w-xl", hideHint = false, zoneOverlay = null }) {
  function handleClick(e) {
    if (!onSelect) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    onSelect({ x, y });
  }

  const getColor = (p) => {
    if (p.result === "goal" || p.result === "opp_goal") return "bg-green-500";
    if (p.result === "miss" || p.result === "opp_miss") return "bg-red-500";
    if (p.actionType && p.actionType.includes("rebound")) return "bg-amber-400";
    if (p.actionType === "overtreding") return "bg-yellow-400";
    return "bg-[#FF6124]";
  };

  return (
    <div className="space-y-3">
      <div
        className={`relative w-full ${maxWidth} aspect-[3/2] bg-neutral-950 border border-neutral-800 rounded-2xl overflow-hidden mx-auto cursor-crosshair`}
        onClick={handleClick}
      >
        {/* Veldmarkeringen */}
        <div className="absolute inset-0 opacity-60">
          {/* middenlijn */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-neutral-800" />
          {/* horizontale hulplijnen */}
          <div className="absolute left-0 right-0 top-1/3 h-px bg-neutral-900" />
          <div className="absolute left-0 right-0 top-2/3 h-px bg-neutral-900" />
        </div>

        {/* Korf + korfzone (extra cirkel) iets boven het midden */}
        {/* Korfzone-ring */}
        <div
          className="absolute rounded-full border border-[#FF6124]/60 bg-[#FF6124]/5"
          style={{
            width: "16%",   // iets smaller
            height: "30%",  // nog wat hoger
            left: "50%",
            top: "38%",     // ring iets verder naar beneden
            transform: "translate(-50%, -50%)",
          }}
        />
        {/* Korf zelf */}
        <div
          className="absolute w-4 h-4 rounded-full border border-[#FF6124] bg-black/60"
          style={{
            left: "50%",
            top: "35%",
            transform: "translate(-50%, -50%)",
          }}
        />

        {/* Zone-overlay met afrondingspercentages per zone */}
        {Array.isArray(zoneOverlay) && zoneOverlay.length > 0 && (
          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
            {zoneOverlay.map((z, i) => (
              <div
                key={z.zone || i}
                className="relative border border-white/5"
                style={
                  (z.attempts || 0) > 0
                    ? { backgroundColor: `hsla(${Math.round((z.fg || 0) * 1.2)}, 70%, 45%, 0.18)` }
                    : undefined
                }
              >
                {(z.attempts || 0) > 0 && (
                  <span className="absolute top-1 left-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    {z.fg || 0}% · {z.goals || 0}/{z.attempts}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Punten */}
        {points
          .filter((p) => typeof p.x === "number" && typeof p.y === "number")
          .map((p, idx) => (
            <div
              key={p.id || idx}
              className={`absolute w-2 h-2 rounded-full shadow ${getColor(p)}`}
              style={{
                left: `${p.x * 100}%`,
                top: `${p.y * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            />
          ))}

        {/* Placeholder voor huidige selectie */}
        {selectedPosition &&
          typeof selectedPosition.x === "number" &&
          typeof selectedPosition.y === "number" && (
            <div
              className="absolute w-4 h-4 rounded-full border-2 border-white/80 ring-2 ring-[#FF6124]/70 pointer-events-none"
              style={{
                left: `${selectedPosition.x * 100}%`,
                top: `${selectedPosition.y * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            />
          )}
      </div>

      {onSelect && !hideHint && (
        <p className="text-xs text-neutral-500 text-center">
          Klik op het veld om een locatie te kiezen.
        </p>
      )}
    </div>
  );
}
