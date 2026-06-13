"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { PlayerSuggestion } from "@/lib/predictions/types";

/**
 * Free-text player input with a filtered suggestion dropdown. Shared by the
 * Fun challenge form and the admin fun-answers form — fun pick scoring is an
 * exact string match, so both sides must offer the SAME suggestion spellings.
 */
export default function PlayerPicker({
  value,
  disabled,
  players,
  placeholder,
  onChange,
  onSelect,
}: {
  value: string;
  disabled: boolean;
  players: readonly PlayerSuggestion[];
  placeholder: string;
  onChange: (next: string) => void;
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    const pool = query
      ? players.filter(
          (p) => p.name.toLowerCase().includes(query) || p.team.toLowerCase() === query,
        )
      : players;
    return pool.slice(0, 8);
  }, [players, query]);

  return (
    <div ref={wrapRef} className="relative w-full">
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="h-9 w-full rounded-lg border border-pitch-700 bg-pitch-950 px-3 text-sm font-semibold text-text-primary outline-none placeholder:font-normal placeholder:text-text-muted focus:border-gold-500/60 disabled:opacity-50"
      />
      {open && !disabled && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-pitch-700 bg-pitch-900 py-1 shadow-xl">
          {matches.map((p) => (
            <li key={`${p.team}:${p.name}`}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-pitch-800"
                onClick={() => {
                  onSelect(p.name);
                  setOpen(false);
                }}
              >
                <span aria-hidden="true">{p.flag}</span>
                <span className="flex-1 truncate font-semibold">{p.name}</span>
                <span className="text-xs text-text-muted">{p.team}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
