"use client";

import { useMemo, useState } from "react";
import { Check, Lightbulb, Plus } from "lucide-react";
import {
  addSavedVendor,
  getSavedVendors,
  getVendorAutocomplete,
  normalizeVendor,
  proposeVendor,
  suggestCanonicalVendor,
} from "@/lib/store";
import type { Role } from "@/lib/types";

/**
 * Vendor text field with consistency help — never auto-changes what's typed:
 *  - a datalist of saved + previously-used vendors for plain autocomplete;
 *  - a "Did you mean Puregold?" nudge when the text looks like a known
 *    variant ("Pure Gold"), which the user taps to accept;
 *  - an offer to save a brand-new vendor (admins save directly; staff propose
 *    it for admin approval), so the canonical list grows over time.
 */
export default function VendorInput({
  value,
  onChange,
  role,
  userId,
  id = "vendor",
  label = "Vendor / store",
  placeholder = "e.g. Puregold",
}: {
  value: string;
  onChange: (next: string) => void;
  role: Role | undefined;
  userId: string;
  id?: string;
  label?: string;
  placeholder?: string;
}) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Computed once on mount — the saved/used vendor set is stable within a form.
  const options = useMemo(() => getVendorAutocomplete(), []);
  const savedNorms = useMemo(
    () => new Set(getSavedVendors().map((v) => normalizeVendor(v.name))),
    [],
  );

  const trimmed = value.trim();
  const suggestion = suggestCanonicalVendor(value);
  const isKnown = savedNorms.has(normalizeVendor(value));
  const canOffer =
    !busy &&
    !feedback &&
    !suggestion &&
    !isKnown &&
    trimmed.length >= 2 &&
    (role === "admin" || role === "staff");

  async function handleSave() {
    setBusy(true);
    const res = await addSavedVendor(trimmed);
    setBusy(false);
    setFeedback(res.ok ? `Saved “${trimmed}” as a vendor.` : res.reason ?? "Couldn't save.");
  }

  async function handlePropose() {
    setBusy(true);
    const res = await proposeVendor(trimmed, userId);
    setBusy(false);
    setFeedback(
      res.ok ? `Suggested “${trimmed}” — an admin will review it.` : res.reason ?? "Couldn't send.",
    );
  }

  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input
        id={id}
        type="text"
        list={`${id}-options`}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (feedback) setFeedback(null);
        }}
        placeholder={placeholder}
        className="input"
        autoComplete="off"
      />
      <datalist id={`${id}-options`}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      {suggestion && (
        <button
          type="button"
          onClick={() => {
            onChange(suggestion);
            setFeedback(null);
          }}
          className="w-full mt-2 px-3 py-2 rounded-lg bg-leaf-50 border border-leaf-100 flex items-center gap-2 hover:bg-leaf-100 transition-colors text-left"
        >
          <Lightbulb className="w-4 h-4 text-leaf-600 flex-shrink-0" />
          <p className="text-xs text-leaf-600 flex-1">
            Did you mean <span className="font-medium">{suggestion}</span>?{" "}
            <span className="text-leaf-600/70">Tap to use the saved name</span>
          </p>
        </button>
      )}

      {canOffer && (
        <button
          type="button"
          onClick={role === "admin" ? handleSave : handlePropose}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-leaf-600"
        >
          <Plus className="w-3 h-3" />
          {role === "admin"
            ? `Save “${trimmed}” as a vendor`
            : `Suggest “${trimmed}” as a saved vendor`}
        </button>
      )}

      {feedback && (
        <p className="mt-1.5 text-[11px] text-leaf-600 inline-flex items-center gap-1">
          <Check className="w-3 h-3" /> {feedback}
        </p>
      )}
    </div>
  );
}
