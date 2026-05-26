"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Wallet } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { reportPcfTopUp } from "@/lib/store";
import { peso, toIsoDate } from "@/lib/format";

export default function StaffLogTopUpPage() {
  const router = useRouter();
  const me = useCurrentUser();

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(toIsoDate());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<number | null>(null);

  function handleSubmit() {
    if (!me) return;
    const numeric = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!date) {
      setError("Pick a date.");
      return;
    }
    reportPcfTopUp({
      amount: numeric,
      date,
      reportedBy: me.id,
      note: note.trim() || undefined,
    });
    setSubmitted(numeric);
    setError(null);
  }

  if (submitted !== null) {
    return (
      <div className="px-5 py-10 flex flex-col items-center text-center max-w-sm mx-auto">
        <div className="w-12 h-12 rounded-full bg-leaf-50 flex items-center justify-center mb-3">
          <Check className="w-6 h-6 text-leaf-500" />
        </div>
        <p className="text-base font-medium text-ink-900">Top-up reported</p>
        <p className="text-sm text-ink-500 mt-1">
          {peso(submitted)} is awaiting Lexi&rsquo;s approval. It&rsquo;ll show
          in the PCF balance once she approves.
        </p>
        <div className="flex flex-col gap-2 w-full mt-6">
          <Link href="/home" className="btn-primary">
            Back to home
          </Link>
          <button
            onClick={() => {
              setSubmitted(null);
              setAmount("");
              setNote("");
              setDate(toIsoDate());
            }}
            className="btn"
          >
            Report another top-up
          </button>
        </div>
      </div>
    );
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
        <div>
          <p className="text-base font-medium text-ink-900">Log a top-up</p>
          <p className="text-[11px] text-ink-500">
            Report cash added to the pooled petty cash
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="px-5 pt-5 space-y-4">
        <div className="rounded-lg bg-leaf-50 p-3 flex items-start gap-3">
          <Wallet className="w-4 h-4 text-leaf-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-leaf-600">
            Lexi will see this in her review queue and approve or reject. Once
            approved, it&rsquo;s added to the PCF balance.
          </p>
        </div>

        <div>
          <label htmlFor="amount" className="label">
            Amount (₱)
          </label>
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^\d.]/g, ""));
              if (error) setError(null);
            }}
            placeholder="5000"
            className="input"
          />
        </div>

        <div>
          <label htmlFor="date" className="label">
            Date received
          </label>
          <input
            id="date"
            type="date"
            value={date}
            max={toIsoDate()}
            onChange={(e) => {
              setDate(e.target.value);
              if (error) setError(null);
            }}
            className="input"
          />
        </div>

        <div>
          <label htmlFor="note" className="label">
            Note (optional)
          </label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="e.g. From Ate Lexi via BPI transfer · ref 8847291"
            className="w-full px-3 py-2 rounded-lg border border-sand-200 bg-white text-base text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-leaf-300 focus:border-leaf-300 resize-none"
          />
        </div>

        {error && <p className="text-sm text-clay-500">{error}</p>}

        <button onClick={handleSubmit} className="btn-primary w-full">
          Submit for approval
        </button>
      </div>
    </div>
  );
}
