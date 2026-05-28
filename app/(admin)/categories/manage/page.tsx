"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import { useStoreTick } from "@/lib/useStoreTick";
import {
  addCategoryDef,
  deleteCategoryDef,
  getCategoryDefs,
  getEntries,
  updateCategoryHints,
} from "@/lib/store";
import {
  ICON_REGISTRY,
  PICKABLE_ICON_KEYS,
  iconFor,
  staffCategoryLabel,
} from "@/lib/category-meta";
import { DEFAULT_HINTS } from "@/lib/category-hints";
import type { CategoryDef } from "@/lib/types";

/**
 * Admin page for adding and removing custom categories.
 *
 * Built-in categories show with a lock icon and no delete button.
 * Custom categories can be deleted only when no entries reference them
 * — the deleteCategoryDef store function enforces this and returns a
 * human-readable reason that we surface inline.
 */
export default function AdminManageCategoriesPage() {
  useStoreTick();
  const router = useRouter();

  const defs = getCategoryDefs();
  const entries = getEntries();

  const usageById = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      map.set(e.category, (map.get(e.category) ?? 0) + 1);
    }
    return map;
  }, [entries]);

  // New-category form state
  const [newName, setNewName] = useState("");
  const [newTagalog, setNewTagalog] = useState("");
  const [newIconKey, setNewIconKey] = useState<string>(PICKABLE_ICON_KEYS[0]);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{
    id: string;
    reason: string;
  } | null>(null);

  function handleAdd() {
    setFormError(null);
    const result = addCategoryDef({
      id: newName,
      tagalog: newTagalog,
      iconKey: newIconKey,
    });
    if (!result) {
      setFormError(
        newName.trim().length === 0
          ? "Type a name first."
          : "A category with that name already exists.",
      );
      return;
    }
    setNewName("");
    setNewTagalog("");
    setNewIconKey(PICKABLE_ICON_KEYS[0]);
  }

  function handleDelete(id: string) {
    setDeleteError(null);
    const result = deleteCategoryDef(id);
    if (!result.ok) {
      setDeleteError({ id, reason: result.reason ?? "Couldn't delete." });
    }
  }

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-sand-200 flex items-center gap-2">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-sand-100"
        >
          <ArrowLeft className="w-4 h-4 text-ink-700" />
        </button>
        <div className="flex-1">
          <p className="text-base font-medium text-ink-900">Manage categories</p>
          <p className="text-[11px] text-ink-500">
            Add new buckets for expenses you didn&rsquo;t plan for. Built-in
            ones are locked.
          </p>
        </div>
        <Link href="/categories" className="text-[11px] text-ink-500">
          Done
        </Link>
      </div>

      {/* Add new */}
      <section className="px-5 pt-5">
        <p className="text-sm font-medium text-ink-900 mb-2">
          Add a new category
        </p>
        <div className="space-y-3 rounded-lg bg-white border border-sand-200 p-3">
          <div>
            <label htmlFor="new-name" className="label">Name</label>
            <input
              id="new-name"
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (formError) setFormError(null);
              }}
              placeholder="e.g. Snacks"
              className="input"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="new-tagalog" className="label">
              Tagalog translation (optional)
            </label>
            <input
              id="new-tagalog"
              type="text"
              value={newTagalog}
              onChange={(e) => setNewTagalog(e.target.value)}
              placeholder="e.g. Meryenda"
              className="input"
              autoComplete="off"
            />
          </div>
          <div>
            <p className="label">Icon</p>
            <div className="grid grid-cols-5 gap-2">
              {PICKABLE_ICON_KEYS.map((key) => {
                const Icon = ICON_REGISTRY[key];
                const active = newIconKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setNewIconKey(key)}
                    aria-pressed={active}
                    className={
                      "h-10 rounded-lg border flex items-center justify-center transition-colors " +
                      (active
                        ? "border-leaf-500 bg-leaf-50"
                        : "border-sand-200 bg-white hover:bg-sand-50")
                    }
                  >
                    <Icon
                      className={
                        "w-4 h-4 " +
                        (active ? "text-leaf-600" : "text-ink-700")
                      }
                    />
                  </button>
                );
              })}
            </div>
          </div>
          {formError && (
            <p className="text-xs text-clay-500">{formError}</p>
          )}
          <button
            onClick={handleAdd}
            className="btn-primary w-full"
          >
            <Plus className="w-4 h-4" /> Add category
          </button>
        </div>
      </section>

      {/* Existing categories */}
      <section className="px-5 pt-6">
        <p className="text-sm font-medium text-ink-900 mb-2">
          All categories · {defs.length}
        </p>
        <div className="space-y-1.5">
          {defs.map((def) => (
            <CategoryRow
              key={def.id}
              def={def}
              usage={usageById.get(def.id) ?? 0}
              onDelete={handleDelete}
              blockedReason={
                deleteError?.id === def.id ? deleteError.reason : null
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * One category in the list, with an expandable smart-hints editor.
 *
 * Built-in default keywords (from lib/category-hints.ts) are shown as
 * read-only chips so the admin understands what triggers each category.
 * Below that, an editable comma-separated input for extras — these are
 * additive and get merged in by suggestCategory at runtime.
 */
function CategoryRow({
  def,
  usage,
  onDelete,
  blockedReason,
}: {
  def: CategoryDef;
  usage: number;
  onDelete: (id: string) => void;
  blockedReason: string | null;
}) {
  const Icon = iconFor(def.id);
  const defaults = DEFAULT_HINTS[def.id] ?? [];
  const extras = def.extraHints ?? [];

  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(extras.join(", "));
  const [savedFlash, setSavedFlash] = useState(false);

  function handleSave() {
    const parsed = draft
      .split(/[,\n]/g)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    updateCategoryHints(def.id, parsed);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  return (
    <div className="rounded-lg bg-white border border-sand-200 p-3">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-sand-100 flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-ink-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900">
            {staffCategoryLabel(def.id)}
          </p>
          <p className="text-[11px] text-ink-500 mt-0.5">
            {usage} entr{usage === 1 ? "y" : "ies"}
            {def.builtin ? " · built-in" : " · custom"}
            {extras.length > 0 && ` · +${extras.length} hint${extras.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {def.builtin ? (
          <Lock
            className="w-4 h-4 text-ink-300"
            aria-label="Built-in (cannot delete)"
          />
        ) : (
          <button
            onClick={() => onDelete(def.id)}
            className="btn btn-sm bg-white border-clay-200 text-clay-500"
            aria-label={`Delete ${def.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        )}
      </div>
      {blockedReason && (
        <p className="text-xs text-clay-500 mt-2">{blockedReason}</p>
      )}

      <button
        onClick={() => setExpanded((x) => !x)}
        className="mt-2 text-[11px] text-ink-500 inline-flex items-center gap-1 hover:text-ink-900"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronUp className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
        Smart-suggestion hints
      </button>

      {expanded && (
        <div className="mt-2 pt-3 border-t border-sand-100 space-y-3">
          {defaults.length > 0 && (
            <div>
              <p className="text-[11px] text-ink-500 mb-1.5">
                Defaults (always on)
              </p>
              <div className="flex flex-wrap gap-1">
                {defaults.map((kw) => (
                  <span
                    key={kw}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-sand-100 text-ink-700"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <label
              htmlFor={`hints-${def.id}`}
              className="text-[11px] text-ink-500 block mb-1"
            >
              Extra hints (comma-separated)
            </label>
            <textarea
              id={`hints-${def.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder="e.g. paksiw, chichirya, sago"
              className="w-full px-3 py-2 rounded-lg border border-sand-200 bg-white text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-leaf-300 focus:border-leaf-300 resize-none"
            />
            <p className="text-[10px] text-ink-500 mt-1">
              Type words you&rsquo;d expect in vendor or item names. Matching
              is case-insensitive substring (so &ldquo;paksiw&rdquo; catches
              &ldquo;Paksiw na Bangus&rdquo;).
            </p>
            <button
              onClick={handleSave}
              className="btn btn-sm w-full mt-2 bg-leaf-500 text-white border-leaf-500"
            >
              {savedFlash ? (
                <>
                  <Check className="w-3.5 h-3.5" /> Saved
                </>
              ) : (
                <>Save hints</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
