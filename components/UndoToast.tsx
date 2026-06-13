"use client";

import { useEffect, useState } from "react";
import { Undo2, X } from "lucide-react";
import { useStoreTick } from "@/lib/useStoreTick";
import { getUndoable, performUndo, clearUndoable } from "@/lib/store";

/**
 * Gmail-style "Undo" bar. After a major action (log purchase, add items,
 * remove item, mark complete) the store registers an undoable; this bar
 * floats above the bottom nav for a short window offering to reverse it.
 * Only the most recent action is undoable, and only this session — saves
 * already hit the shared database.
 *
 * Rendered once per layout so it's present on every screen the user lands
 * on after an action (the undoable is global to the in-memory store).
 */
const WINDOW_MS = 12000;

export default function UndoToast() {
  useStoreTick();
  const undoable = getUndoable();
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // Fresh undoable → start its auto-dismiss timer (keyed on seq so a new
  // action restarts the clock).
  useEffect(() => {
    if (!undoable) return;
    const t = setTimeout(() => clearUndoable(), WINDOW_MS);
    return () => clearTimeout(t);
  }, [undoable?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onUndo() {
    if (busy) return;
    setBusy(true);
    const res = await performUndo();
    setBusy(false);
    setFlash(res.ok ? "Undone" : res.reason ?? "Undo failed");
    setTimeout(() => setFlash(null), 2600);
  }

  if (!undoable && !flash) return null;

  return (
    <div className="fixed inset-x-0 bottom-[60px] z-40 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-screen-sm">
        {flash ? (
          <div className="mx-auto w-fit rounded-full bg-ink-900 text-white text-xs px-4 py-2 shadow-lg">
            {flash}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-ink-900 text-white shadow-lg px-3.5 py-2.5">
            <p className="text-xs flex-1 min-w-0 truncate">{undoable!.label}</p>
            <button
              onClick={onUndo}
              disabled={busy}
              className="inline-flex items-center gap-1 text-xs font-semibold text-white hover:text-sand-200 disabled:opacity-60"
            >
              <Undo2 className="w-3.5 h-3.5" />
              {busy ? "Undoing…" : "Undo"}
            </button>
            <button
              onClick={() => clearUndoable()}
              aria-label="Dismiss"
              className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
