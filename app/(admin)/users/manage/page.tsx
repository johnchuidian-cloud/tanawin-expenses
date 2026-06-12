"use client";

/**
 * Admin: manage staff display names and PINs.
 *
 * Used when a staff member is replaced — admin can rename the slot and
 * issue a new PIN without going through Supabase directly. Role is NOT
 * editable here (only one admin slot and it's fixed); the page just
 * shows admin rows as read-only at the top for awareness.
 *
 * Save model: each row has its own "Save" button that fires the moment
 * either the name or PIN is edited. PIN field is rendered as a 4-digit
 * numeric input so phone keyboards open with the number pad.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, X as XIcon } from "lucide-react";
import { useStoreTick } from "@/lib/useStoreTick";
import { getUsers, updateUser } from "@/lib/store";

interface Draft {
  name: string;
  pin: string;
}

export default function ManageUsersPage() {
  useStoreTick();
  const router = useRouter();
  const users = getUsers();

  // One draft per user. Pristine = matches current saved values.
  const initialDrafts = useMemo(() => {
    const map: Record<string, Draft> = {};
    for (const u of users) map[u.id] = { name: u.name, pin: u.pin };
    return map;
  }, [users]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initialDrafts);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  // Re-sync drafts when the underlying users list changes (e.g. another
  // tab updated). We only overwrite drafts that haven't been touched.
  function syncDraft(id: string) {
    setDrafts((cur) => ({
      ...cur,
      [id]: { name: users.find((u) => u.id === id)?.name ?? "", pin: users.find((u) => u.id === id)?.pin ?? "" },
    }));
  }

  function draftFor(id: string): Draft {
    return drafts[id] ?? initialDrafts[id] ?? { name: "", pin: "" };
  }

  function isDirty(id: string): boolean {
    const u = users.find((x) => x.id === id);
    const d = draftFor(id);
    if (!u) return false;
    return d.name.trim() !== u.name || d.pin.trim() !== u.pin;
  }

  function validate(id: string): string | null {
    const d = draftFor(id);
    if (!d.name.trim()) return "Name can't be blank.";
    if (!d.pin.trim()) return "PIN can't be blank.";
    if (!/^\d{4}$/.test(d.pin.trim())) return "PIN must be 4 digits.";
    // PIN uniqueness — two users can't share the same PIN or login is ambiguous.
    const collision = users.find(
      (u) => u.id !== id && u.pin === d.pin.trim(),
    );
    if (collision) return `PIN already used by ${collision.name}.`;
    return null;
  }

  function handleSave(id: string) {
    const err = validate(id);
    if (err) {
      window.alert(err);
      return;
    }
    const d = draftFor(id);
    updateUser(id, { name: d.name.trim(), pin: d.pin.trim() });
    setSavedFlash(id);
    setTimeout(() => setSavedFlash((cur) => (cur === id ? null : cur)), 2000);
  }

  const admins = users.filter((u) => u.role === "admin");
  const staff = users.filter((u) => u.role === "staff");

  // Shared editable row — staff and admin alike can have their name and PIN
  // changed here. Only the ROLE is fixed; Lexi edits her own PIN like
  // anyone else's.
  function renderUserRow(u: { id: string; name: string }) {
    const d = draftFor(u.id);
    const dirty = isDirty(u.id);
    const saved = savedFlash === u.id;
    return (
      <div
        key={u.id}
        className="p-3 rounded-lg bg-white border border-sand-200 space-y-2"
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] text-ink-500">Name</span>
            <input
              type="text"
              value={d.name}
              onChange={(e) =>
                setDrafts((cur) => ({
                  ...cur,
                  [u.id]: { ...draftFor(u.id), name: e.target.value },
                }))
              }
              className="input mt-0.5"
              placeholder="e.g. Janice"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-ink-500">4-digit PIN</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              value={d.pin}
              onChange={(e) =>
                setDrafts((cur) => ({
                  ...cur,
                  [u.id]: {
                    ...draftFor(u.id),
                    // Strip non-digits as the user types so phones don't
                    // accidentally insert spaces / suggestions.
                    pin: e.target.value.replace(/\D/g, "").slice(0, 4),
                  },
                }))
              }
              className="input mt-0.5 tracking-[0.4em] text-center"
              placeholder="• • • •"
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-ink-300">User ID: {u.id}</p>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                onClick={() => syncDraft(u.id)}
                className="text-[11px] text-ink-500 hover:text-ink-700 inline-flex items-center gap-0.5"
                aria-label="Revert changes"
              >
                <XIcon className="w-3 h-3" />
                Revert
              </button>
            )}
            <button
              onClick={() => handleSave(u.id)}
              disabled={!dirty}
              className={
                "btn btn-sm " +
                (dirty
                  ? "bg-leaf-500 text-white border-leaf-500"
                  : "bg-sand-100 text-ink-300 border-sand-100 cursor-not-allowed")
              }
            >
              {saved ? <Check className="w-3.5 h-3.5" /> : null}
              {saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-4">
      <div className="px-5 pt-4 pb-3 border-b border-sand-200 flex items-center gap-2">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-sand-100"
        >
          <ArrowLeft className="w-4 h-4 text-ink-700" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-base font-medium text-ink-900">Manage staff</p>
          <p className="text-[11px] text-ink-500">
            Rename a slot or issue a new PIN when staff are replaced
          </p>
        </div>
      </div>

      {/* Staff rows — editable */}
      <div className="px-5 pt-4 space-y-3">
        <p className="text-[11px] uppercase tracking-wide text-ink-500">Staff</p>
        {staff.map((u) => renderUserRow(u))}
      </div>

      {/* Admin row — name and PIN editable like staff; only the role is fixed */}
      <div className="px-5 pt-5 space-y-3">
        <p className="text-[11px] uppercase tracking-wide text-ink-500">Admin</p>
        {admins.map((u) => renderUserRow(u))}
        <p className="text-[10px] text-ink-300 pt-1">
          The admin role itself is fixed. Need to add a new staff member or
          change who the admin is? Contact the developer — those changes
          require a database update.
        </p>
      </div>

      <div className="px-5 pt-6">
        <Link href="/dashboard" className="text-xs text-ink-500">
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}
