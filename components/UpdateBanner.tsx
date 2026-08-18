"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { startUpdateCheck, dismissUpdate, runningBuildId } from "@/lib/update-check";

/**
 * Thin bar offering a refresh when a newer build has been deployed. Replaces
 * the "fully close and reopen the app after every deploy" instruction — which
 * costs a PIN re-entry here, since the session lives in sessionStorage.
 *
 * Mounted once in the root layout, so it covers every screen including login
 * and is not role-gated (guests and viewers run stale bundles too).
 *
 * Deliberately in the document flow rather than fixed/overlaid: on a phone it
 * would otherwise sit on top of the header or a half-filled /new form. Sticky
 * keeps it reachable once the page scrolls, and z-40 keeps it under modals
 * (which are z-50) so it can never trap a dialog.
 *
 * Wording is fixed by the suite contract — "Update available" and "Refresh",
 * identical in every Tanawin app.
 */
export default function UpdateBanner() {
  const [build, setBuild] = useState<string | null>(null);

  useEffect(() => {
    const stop = startUpdateCheck(setBuild);
    return stop;
  }, []);

  // Exposed purely so a deploy can be diagnosed from the console in
  // production ("which build is this page actually running?"). Cloudflare's
  // edge can serve one client a new build while another still gets the old
  // bytes for a minute or two, and guessing at that wastes real time.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__tanawinBuild = {
      running: runningBuildId(),
      deployed: build,
    };
  }, [build]);

  if (!build) return null;

  return (
    <div className="sticky top-0 z-40 bg-leaf-500 text-white shadow-sm">
      <div className="max-w-screen-sm mx-auto px-4 h-11 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Update available</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => location.reload()}
            className="h-8 px-3 rounded-lg bg-white/20 hover:bg-white/30 transition-colors text-white text-xs font-medium"
          >
            Refresh
          </button>
          <button
            onClick={() => {
              dismissUpdate(build);
              setBuild(null);
            }}
            aria-label="Dismiss"
            className="w-8 h-8 rounded-lg hover:bg-white/20 transition-colors flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
