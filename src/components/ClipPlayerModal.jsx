import React, { useEffect, useRef } from "react";
import { formatActionLabel } from "../pages/MatchDetail";

const DEFAULT_PRE = 4;
const DEFAULT_POST = 6;
const clipPre = (c) => (typeof c.pre === "number" ? c.pre : DEFAULT_PRE);
const clipPost = (c) => (typeof c.post === "number" ? c.post : DEFAULT_POST);

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

// Modal die één clip afspeelt: vanaf tijd - pre tot tijd + post (één keer)
export default function ClipPlayerModal({ clip, match, playerLabel, teams, onClose, onOpenMatch }) {
  const half = clip.half || 1;
  const videoUrl = match?.videoUrls?.[`half${half}`] || "";
  const start = Math.max(0, (clip.time || 0) - clipPre(clip));
  const end = (clip.time || 0) + clipPost(clip);
  const videoRef = useRef(null);
  const endPausedRef = useRef(false);

  // Sluit met Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    function onLoadedMetadata() {
      v.currentTime = Math.min(Math.max(0, start), Math.max(0, v.duration || 0));
      v.play().catch(() => {});
    }
    function onTimeUpdate() {
      if (endPausedRef.current) return;
      if (v.currentTime >= end) {
        endPausedRef.current = true;
        v.pause();
      }
    }

    v.addEventListener("loadedmetadata", onLoadedMetadata);
    v.addEventListener("timeupdate", onTimeUpdate);
    if (v.readyState >= 1) onLoadedMetadata();
    return () => {
      v.removeEventListener("loadedmetadata", onLoadedMetadata);
      v.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [start, end, videoUrl]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-neutral-900 border border-neutral-700 rounded-2xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-white truncate">
              {formatActionLabel(clip.actionType)}
              {playerLabel && <span className="text-neutral-400 font-normal"> · {playerLabel}</span>}
            </div>
            <div className="text-xs text-neutral-500">
              {match
                ? `${formatMatchDate(match.date)} ${formatTeamName(match.homeTeamId, teams)} vs ${formatTeamName(match.awayTeamId, teams)} · ${clip.half || 1}e helft`
                : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white text-xl leading-none px-1"
            aria-label="Sluiten"
          >
            ✕
          </button>
        </div>

        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            autoPlay
            playsInline
            className="w-full rounded-xl bg-black"
          />
        ) : (
          <div className="w-full aspect-video rounded-xl bg-neutral-950 flex items-center justify-center text-sm text-neutral-500 text-center px-6">
            Beeld van deze helft is nog niet geüpload.
          </div>
        )}

        <div className="flex items-center gap-2">
          {videoUrl && (
            <button
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                endPausedRef.current = false;
                v.currentTime = start;
                v.play().catch(() => {});
              }}
              className="px-3 py-1.5 rounded-lg bg-[#FF6124] text-white text-sm hover:opacity-90"
            >
              Opnieuw afspelen
            </button>
          )}
          {match && (
            <button
              onClick={() => onOpenMatch(match.id)}
              className="px-3 py-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm text-neutral-200 hover:border-[#FF6124]/60"
            >
              Open wedstrijd
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
