"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User as UserIcon, ShieldCheck } from "lucide-react";
import { getUsers } from "@/lib/store";
import { useStoreTick } from "@/lib/useStoreTick";
import { login } from "@/lib/auth";

export default function LoginPage() {
  useStoreTick();
  const router = useRouter();
  const users = getUsers();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    if (!selectedName) return;
    const user = login(selectedName, pin);
    if (!user) {
      setError("PIN incorrect — try again");
      setPin("");
      return;
    }
    router.replace(user.role === "admin" ? "/dashboard" : "/home");
  }

  function selectUser(name: string) {
    setSelectedName(name);
    setPin("");
    setError(null);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-sand-50">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/tanawin-icon.png"
            onError={(e) => {
              // Fall back to the SVG placeholder until the official PNG is added.
              const img = e.currentTarget;
              if (!img.src.endsWith("/tanawin-icon.svg")) {
                img.src = "/tanawin-icon.svg";
              }
            }}
            alt="Tanawin"
            className="w-20 h-20 rounded-2xl shadow-sm mb-3"
          />
          <h1 className="text-xl font-medium text-ink-900">Tanawin Expenses</h1>
          <p className="text-xs text-ink-500 mt-1">Tanawin Bed and Breakfast</p>
        </div>

        {!selectedName ? (
          <div className="space-y-2">
            <p className="text-xs text-ink-500 mb-3">Who&rsquo;s using the app?</p>
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
                  {u.role === "admin" ? <ShieldCheck className="w-5 h-5" /> : <UserIcon className="w-5 h-5" />}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-ink-900">{u.name}</p>
                  <p className="text-xs text-ink-500">{u.role === "admin" ? "Admin" : "Staff"}</p>
                </div>
              </button>
            ))}
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
                    router.replace(u.role === "admin" ? "/dashboard" : "/home");
                  }, 100);
                }
              }}
              className="input text-center text-2xl tracking-[0.6em] font-medium"
              placeholder="• • • •"
            />
            {error && <p className="text-xs text-clay-500 mt-2">{error}</p>}
            <p className="text-[11px] text-ink-300 mt-4 text-center">
              For prototype: Lexi = 1234, Janice = 0001, Sherill = 0002, Rio = 0003
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
