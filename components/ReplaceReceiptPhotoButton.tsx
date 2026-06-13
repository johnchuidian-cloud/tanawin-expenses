"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { replaceReceiptPhoto } from "@/lib/store";
import { fileToCompressedDataUrl } from "@/lib/image";

/**
 * "Replace photo" for a receipt — used when the first shot came out blurry
 * or cropped. Opens the phone's picker (gallery or camera), compresses the
 * pick like every other receipt photo, and overwrites the receipt's photo
 * after the server confirms. Shown to admin and staff wherever a receipt
 * photo appears; never to view-only guests.
 */
export default function ReplaceReceiptPhotoButton({
  receiptId,
  hasPhoto,
}: {
  receiptId: string;
  /** Wording: replace an existing photo vs add one where none exists. */
  hasPhoto: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (
      hasPhoto &&
      !window.confirm(
        "Replace the receipt photo?\n\nThe current photo will be overwritten — this can't be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const url = await fileToCompressedDataUrl(file);
      const res = await replaceReceiptPhoto(receiptId, url);
      setMsg(res.ok ? "Photo updated." : res.reason ?? "Couldn't save the new photo.");
      if (res.ok) setTimeout(() => setMsg(null), 4000);
    } catch {
      setMsg("Couldn't read that image — try another photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        disabled={busy}
        className="btn btn-sm w-full text-ink-700 disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…
          </>
        ) : (
          <>
            <ImagePlus className="w-3.5 h-3.5" />
            {hasPhoto ? "Replace photo with a better shot" : "Add a receipt photo"}
          </>
        )}
      </button>
      {msg && <p className="text-[11px] text-ink-500 mt-1 text-center">{msg}</p>}
      {/* No `capture` attribute → phones offer gallery, camera, and files. */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
