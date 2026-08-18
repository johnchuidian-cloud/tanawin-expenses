/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Build stamp for the "update available" banner.
 *
 * Every build gets an id. It's written to public/version.json (served at
 * /version.json on the deployed site) AND inlined into the bundle as
 * NEXT_PUBLIC_BUILD_ID, so a running page can ask "is the deployed build
 * still the one I'm running?" without depending on response headers.
 *
 * Why not ETag / Last-Modified: the Hub found that Cloudflare's static asset
 * responses carry neither, so a header-based check sits inert forever — it
 * deploys clean, throws nothing, and never fires. A file we write ourselves
 * can't be taken away by the platform.
 *
 * Written here (at config load) rather than in a prebuild script because the
 * Cloudflare build runs `npx @cloudflare/next-on-pages`, which invokes
 * `next build` directly — an npm `prebuild` hook would never fire.
 */
function resolveBuildId() {
  // Cloudflare Pages sets this; preferred because it needs no git binary.
  const fromCI = process.env.CF_PAGES_COMMIT_SHA;
  if (fromCI) return fromCI.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // Not a git checkout (or git missing) — fall back to build time.
    return String(Date.now());
  }
}

const BUILD_ID = resolveBuildId();

try {
  const dir = path.join(__dirname, "public");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "version.json"), `${JSON.stringify({ build: BUILD_ID })}\n`);
} catch (err) {
  // Never fail a build over this — the banner degrades to "never shows".
  console.warn("version stamp: could not write public/version.json", err);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
};

module.exports = nextConfig;
