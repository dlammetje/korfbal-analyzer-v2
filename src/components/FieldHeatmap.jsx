import React from "react";

// points: [{ x: 0-1, y: 0-1, actionType, result }]
// onSelect?: ({ x, y }) => void
// selectedPosition?: { x, y } – tijdelijke marker (bijv. bij klikken voor nieuwe actie)
// maxWidth: Tailwind max-w-* class, bijv. "max-w-xl" (default)
export default function FieldHeatmap({ points = [], onSelect, selectedPosition, maxWidth = "max-w-xl" }) {
  function handleClick(e) {
    if (!onSelect) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    onSelect({ x, y });
  }

  const getColor = (p) => {
    if (p.result === "goal") return "bg-green-500";
    if (p.result === "miss") return "bg-red-500";
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

        {/* Korf iets boven het midden (realistischer paalpositie) */}
        <div
          className="absolute w-8 h-8 rounded-full border-2 border-[#FF6124] bg-black/60"
          style={{
            left: "50%",
            top: "35%",
            transform: "translate(-50%, -50%)",
          }}
        />

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

      {onSelect && (
        <p className="text-xs text-neutral-500 text-center">
          Klik op het veld om een locatie te kiezen.
        </p>
      )}
    </div>
  );
}
