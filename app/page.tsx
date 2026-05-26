"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/auth";

export default function HomePage() {
  const user = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (user === undefined) return; // still loading session
    if (user === null) {
      router.replace("/login");
    } else if (user.role === "admin") {
      router.replace("/dashboard");
    } else {
      router.replace("/home");
    }
  }, [user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-ink-500 text-sm">Loading…</p>
    </div>
  );
}
