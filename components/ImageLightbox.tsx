"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * Full-screen image viewer. Used instead of opening the photo in a new tab —
 * receipt photos are stored as `data:` URLs, and browsers (Chrome especially)
 * block top-level navigation to a data: URL, so the new tab just came up
 * blank. An in-app overlay works everywhere, including mobile.
 *
 * Tap the backdrop, the X, or press Esc to close.
 */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Receipt photo"
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center"
      >
        <X className="w-5 h-5 text-white" />
      </button>
      {/* Stop propagation so tapping the image itself doesn't close it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full object-contain rounded"
      />
    </div>
  );
}
