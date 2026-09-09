import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

const links = [
  { to: "/", label: "Dashboard" },
  { to: "/matches", label: "Wedstrijden" },
  { to: "/statistics", label: "Statistieken" },
  { to: "/teams", label: "Teams & Spelers" },
  { to: "/settings", label: "Instellingen" },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`${
        collapsed ? "w-16" : "w-64"
      } bg-neutral-900 border-r border-neutral-800 flex flex-col transition-all duration-200`}
    >
      <div
        className={`flex items-center px-4 py-4 border-b border-neutral-800 ${
          collapsed ? "justify-center" : "justify-between gap-3"
        }`}
      >
        {!collapsed && (
          <div className="text-xl font-semibold whitespace-nowrap">
            KORFBAL ANALYZER
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="ml-auto inline-flex items-center justify-center w-8 h-8 rounded-lg border border-neutral-700 text-neutral-400 hover:text-white hover:border-[#FF6124]"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      <nav className="flex-1 p-4 space-y-2">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `flex items-center px-3 py-2 rounded-xl text-sm transition ${
                isActive
                  ? "bg-[#FF6124] text-white"
                  : collapsed
                    ? "bg-neutral-800 text-neutral-200 hover:bg-neutral-700 hover:text-white"
                    : "text-neutral-300 hover:bg-neutral-800 hover:text-white"
              }`
            }
          >
            {!collapsed && (
              <span className="truncate flex items-center gap-2">
                <span>{link.label}</span>
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}