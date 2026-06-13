"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User as UserIcon, ShieldCheck, Eye, KeyRound, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { getBootstrapStatus, getUsers, resetPinWithRecoveryCode, retryBootstrap } from "@/lib/store";
import { useStoreTick } from "@/lib/useStoreTick";
import { login, homePathFor } from "@/lib/auth";

export default function LoginPage() {
  useStoreTick();
  const router = useRouter();
  const users = getUsers();
  const bootStatus = getBootstrapStatus();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Admin forgot-PIN failsafe (recovery code generated in Manage staff).
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPin, setNewPin] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  const selectedUser = selectedName
    ? users.find((u) => u.name.toLowerCase() === selectedName.toLowerCase())
    : undefined;

  function handleSubmit() {
    if (!selectedName) return;
    const user = login(selectedName, pin);
    if (!user) {
      setError("PIN incorrect — try again");
      setPin("");
      return;
    }
    router.replace(homePathFor(user.role));
  }

  function selectUser(name: string) {
    setSelectedName(name);
    setPin("");
    setError(null);
    setRecoveryMode(false);
    setRecoveryCode("");
    setNewPin("");
  }

  async function handleRecoverySubmit() {
    if (!selectedUser || recoveryBusy) return;
    if (!recoveryCode.trim()) {
      setError("Enter your recovery code.");
      return;
    }
    if (!/^\d{4}$/.test(newPin)) {
      setError("Choose a new 4-digit PIN.");
      return;
    }
    setRecoveryBusy(true);
    setError(null);
    const res = await resetPinWithRecoveryCode(selectedUser.id, recoveryCode, newPin);
    setRecoveryBusy(false);
    if (!res.ok) {
      setError(res.reason ?? "Couldn't reset the PIN.");
      return;
    }
    // PIN is updated and the code is used up — log straight in.
    const user = login(selectedUser.name, newPin);
    if (user) {
      window.alert(
        "PIN updated and you're logged in.\n\nYour recovery code has been used up — generate a new one in Manage staff and write it down.",
      );
      router.replace(homePathFor(user.role));
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-sand-50">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/tanawin-icon.jpg"
            onError={(e) => {
              // Fall back to the SVG rendering if the official art is missing.
              const img = e.currentTarget;
              if (!img.src.endsWith("/tanawin-icon.svg")) {
                img.src = "/tanawin-icon.svg";
              }
            }}
            alt="Tanawin"
            className="w-20 h-20 rounded-2xl shadow-sm mb-3"
          />
          <h1 className="text-xl font-medium text-ink-900">Tanawin Operating Expenses</h1>
          <p className="text-xs text-ink-500 mt-1">Tanawin Bed and Breakfast</p>
        </div>

        {!selectedName ? (
          <div className="space-y-2">
            <p className="text-xs text-ink-500 mb-3">Who&rsquo;s using the app?</p>

            {/* The user list arrives with the initial data load. Until it
                does, show progress; if the load failed, say so and offer a
                retry — never an unexplained blank screen. */}
            {users.length === 0 && bootStatus !== "error" && (
              <div className="card flex items-center gap-3 p-4">
                <Loader2 className="w-5 h-5 text-leaf-500 animate-spin flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-ink-900">Loading…</p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    Fetching the user list. On slow connections this can take a moment.
                  </p>
                </div>
              </div>
            )}
            {users.length === 0 && bootStatus === "error" && (
              <div className="card p-4">
                <div className="flex items-center gap-3">
                  <WifiOff className="w-5 h-5 text-clay-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-ink-900">Couldn&rsquo;t connect</p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      Check your internet connection. We&rsquo;ll keep retrying automatically.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => retryBootstrap()}
                  className="btn btn-sm w-full mt-3"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Try again now
                </button>
              </div>
            )}

            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => selectUser(u.name)}
                className="w-full card flex items-center gap-3 p-4 hover:bg-sand-50 transition-colors text-left"
              >
                <div
                  className={
                    "w-10 h-10 rounded-full flex items-center justify-center " +
                    (u.role === "admin" ? "bg-leaf-50 text-leaf-600" : "bg-sand-100 text-ink-700")
                  }
                >
                  {u.role === "admin" ? (
                    <ShieldCheck className="w-5 h-5" />
                  ) : u.role === "guest" ? (
                    <Eye className="w-5 h-5" />
                  ) : (
                    <UserIcon className="w-5 h-5" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-ink-900">{u.name}</p>
                  <p className="text-xs text-ink-500">
                    {u.role === "admin" ? "Admin" : u.role === "guest" ? "View only" : "Staff"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        ) : recoveryMode ? (
          <div className="card p-6">
            <button
              onClick={() => {
                setRecoveryMode(false);
                setError(null);
              }}
              className="text-xs text-ink-500 mb-4 hover:text-ink-900"
            >
              ← Back to PIN entry
            </button>
            <p className="text-sm font-medium text-ink-900 flex items-center gap-1.5">
              <KeyRound className="w-4 h-4 text-leaf-600" /> Reset your PIN
            </p>
            <p className="text-xs text-ink-500 mt-1 mb-4">
              Enter the recovery code you generated in Manage staff, then choose
              a new PIN.
            </p>
            <label className="block">
              <span className="text-[11px] text-ink-500">Recovery code</span>
              <input
                type="text"
                autoFocus
                autoCapitalize="characters"
                autoComplete="off"
                value={recoveryCode}
                onChange={(e) => {
                  setRecoveryCode(e.target.value.toUpperCase());
                  setError(null);
                }}
                className="input mt-0.5 text-center tracking-widest font-medium"
                placeholder="XXXX-XXXX-XXXX"
              />
            </label>
            <label className="block mt-3">
              <span className="text-[11px] text-ink-500">New 4-digit PIN</span>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={newPin}
                onChange={(e) => {
                  setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4));
                  setError(null);
                }}
                className="input mt-0.5 text-center text-2xl tracking-[0.6em] font-medium"
                placeholder="• • • •"
              />
            </label>
            {error && <p className="text-xs text-clay-500 mt-2">{error}</p>}
            <button
              onClick={handleRecoverySubmit}
              disabled={recoveryBusy}
              className="btn-primary w-full mt-4"
            >
              {recoveryBusy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Checking…
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" /> Set new PIN
                </>
              )}
            </button>
            <p className="text-[11px] text-ink-300 mt-3 text-center">
              The code is used up once it works — generate a fresh one afterwards.
            </p>
          </div>
        ) : (
          <div className="card p-6">
            <button
              onClick={() => setSelectedName(null)}
              className="text-xs text-ink-500 mb-4 hover:text-ink-900"
            >
              ← Pick someone else
            </button>
            <p className="text-sm text-ink-700 mb-1">
              Hi <span className="font-medium text-ink-900">{selectedName}</span>
            </p>
            <p className="text-xs text-ink-500 mb-4">Enter your 4-digit PIN</p>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoFocus
              value={pin}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                setPin(v);
                setError(null);
                if (v.length === 4) {
                  // Auto-submit when 4 digits entered
                  setTimeout(() => {
                    const u = login(selectedName, v);
                    if (!u) {
                      setError("PIN incorrect — try again");
                      setPin("");
                      return;
                    }
                    router.replace(homePathFor(u.role));
                  }, 100);
                }
              }}
              className="input text-center text-2xl tracking-[0.6em] font-medium"
              placeholder="• • • •"
            />
            {error && <p className="text-xs text-clay-500 mt-2">{error}</p>}
            {/* Staff PIN resets go through the admin; the admin's own
                failsafe is the recovery code (set up in Manage staff). */}
            {selectedUser?.role === "admin" ? (
              <button
                onClick={() => {
                  setRecoveryMode(true);
                  setError(null);
                }}
                className="w-full text-[11px] text-leaf-600 mt-4 text-center hover:underline"
              >
                Forgot your PIN? Use your recovery code
              </button>
            ) : (
              <p className="text-[11px] text-ink-300 mt-4 text-center">
                Forgot your PIN? Ask Lexi to reset it.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
