/**
 * "Update available" check — suite-wide contract (see the Hub's work order).
 *
 * Every deploy used to end with "tell Lexi to fully close and reopen the app",
 * and until she did she ran old code without knowing. This notices a new build
 * and offers a refresh. It NEVER reloads on its own: this app holds half-typed
 * expense entries and in-progress receipt captures, and an automatic reload
 * would destroy real work. The person chooses when.
 *
 * Mechanism: next.config.js stamps a build id into /version.json at build time.
 * We poll that file and watch for the value changing. Header-based checks
 * (ETag / Last-Modified) are not an option — Cloudflare's static asset
 * responses don't carry them, so such a check would sit inert forever.
 *
 * Fails silent by design. Offline, 500, blocked, garbled — all mean "no update",
 * never an error surfaced to the user. This is a convenience, not a feature
 * worth interrupting anyone over.
 */

/** Inlined at build time; the build this running page was served from. */
const BAKED_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "";

/** How often to re-check while the tab is actually visible. */
const POLL_MS = 5 * 60 * 1000;

const DISMISS_KEY = "tanawin.update.dismissed";

/**
 * The build id we compare against. Seeded from the first successful fetch
 * rather than from BAKED_BUILD_ID — see the note in check(), which also
 * explains why the baked id is still consulted on later polls.
 */
let baseline: string | null = null;
let seenFirstCheck = false;
let inFlight = false;

function dismissedBuild(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/** Remember that this build's banner was dismissed, so we never re-nag for it. */
export function dismissUpdate(build: string): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, build);
  } catch {
    // Private mode / storage disabled — the banner just reappears on the next
    // poll. Harmless, and not worth failing over.
  }
}

/**
 * Read the deployed build id, or null if anything at all goes wrong.
 *
 * Cache-busting is mandatory, not decorative: Cloudflare's edge will happily
 * return a stale copy for repeated identical requests, which would make this
 * check silently never fire. Hence no-store AND a unique query param.
 */
async function fetchDeployedBuildId(): Promise<string | null> {
  try {
    const bust = Math.random().toString(36).slice(2);
    const res = await fetch(`/version.json?x=${bust}`, { cache: "no-store" });
    if (!res.ok) return null;
    // Parse defensively rather than calling res.json(): a missing file can be
    // answered with an HTML fallback page carrying a 200, and res.json() would
    // throw on it. A parse failure means "no update", never a new version.
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    const build = (parsed as { build?: unknown } | null)?.build;
    return typeof build === "string" && build ? build : null;
  } catch {
    return null;
  }
}

async function check(onUpdate: (build: string) => void): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const deployed = await fetchDeployedBuildId();
    if (!deployed) return;

    // The first successful check only establishes the baseline — it must never
    // raise a banner. Right after a deploy the edge can hand one client a fresh
    // /version.json while still serving it the previous HTML/bundle. Comparing
    // baked-vs-fetched *at load* would then show "Update available" on a page
    // whose refresh returns the same stale bundle — a banner the user cannot
    // clear by obeying it.
    if (!seenFirstCheck) {
      seenFirstCheck = true;
      baseline = deployed;
      return;
    }

    // Two independent reasons to offer a refresh (Kitchen's refinement, and it
    // matters): a NEW deploy landed while this page was open, or this page is
    // simply running a stale bundle. The second case is not hypothetical — if
    // the page loaded old HTML while /version.json was already new, baseline
    // alone records that new id as "current" and the page would never notice it
    // is behind, defeating the feature in exactly the propagation-lag case it
    // exists for. Checking the baked id on SUBSEQUENT polls only keeps the
    // load-time false positive out while still catching this.
    const isNewDeploy = deployed !== baseline;
    const runningStaleBundle = !!BAKED_BUILD_ID && deployed !== BAKED_BUILD_ID;

    if ((isNewDeploy || runningStaleBundle) && deployed !== dismissedBuild()) {
      onUpdate(deployed);
    }
  } finally {
    inFlight = false;
  }
}

/**
 * Start watching for a new build. Calls onUpdate(buildId) when one appears.
 * Returns a cleanup function.
 *
 * Checks on load (baseline only), whenever the tab becomes visible — the
 * "phone woke up" case, and by far the most common one here — and every few
 * minutes while visible. A hidden tab is never polled.
 */
export function startUpdateCheck(onUpdate: (build: string) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const isVisible = () => document.visibilityState === "visible";
  const run = () => void check(onUpdate);

  run();

  const onVisibility = () => {
    if (isVisible()) run();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const timer = window.setInterval(() => {
    if (isVisible()) run();
  }, POLL_MS);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.clearInterval(timer);
  };
}

/** The build this page is running, for debugging a deploy in production. */
export function runningBuildId(): string {
  return BAKED_BUILD_ID;
}
