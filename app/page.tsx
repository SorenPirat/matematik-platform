"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/utils/supabaseClient";

const LS_GLOBAL_SESSION_CODE = "session_code_v1";
const LS_GLOBAL_ALIAS = "session_alias_v1";

type Track = {
  title: string;
  description: string;
  href?: string;
  tag: string;
  accent: string;
};

const tracks: Track[] = [
  {
    title: "Øvelseszonen",
    description: "Plus, minus, gange og division i blandede missioner.",
    href: "/practice",
    tag: "Aktiv",
    accent: "from-emerald-200/70 via-white to-blue-200/60",
  },
  {
    title: "Potenser af 10",
    description: "Bliv sikker på potensregning og videnskabelig notation.",
    href: "/potenser",
    tag: "Aktiv",
    accent: "from-violet-100/70 via-white to-rose-100/60",
  },
  {
    title: "Brøker",
    description: "Plus, minus, gange og division med brøker og hele tal.",
    href: "/broeker",
    tag: "Aktiv",
    accent: "from-orange-100/80 via-white to-amber-100/60",
  },
  {
    title: "Regnehierarkiet",
    description: "Find r\u00e6kkef\u00f8lgen og regn regnestykket korrekt.",
    href: "/regnehierarkiet",
    tag: "Aktiv",
    accent: "from-amber-100/80 via-white to-rose-100/60",
  },
  {
    title: "Omskrivning",
    description: "Omskriv mellem decimaltal, procent og broeker.",
    href: "/omskrivning",
    tag: "Aktiv",
    accent: "from-cyan-100/80 via-white to-sky-100/60",
  },
  {
    title: "Procent og promille",
    description: "Træn procentregning og promille i hverdagsopgaver.",
    href: "/procent",
    tag: "Aktiv",
    accent: "from-sky-100/80 via-white to-emerald-100/60",
  },
  {
    title: "Ligninger",
    description: "Løs enkle og lidt sværere ligninger.",
    href: "/ligninger",
    tag: "Aktiv",
    accent: "from-lime-100/80 via-white to-emerald-100/50",
  },
  {
    title: "Geometri",
    description: "Areal, omkreds og vinkler i overskuelige trin.",
    tag: "Kommer snart",
    accent: "from-yellow-100/70 via-white to-orange-100/60",
  },
];

export default function Home() {
  const [sessionCode, setSessionCode] = useState("");
  const [alias, setAlias] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const autoJoinRef = useRef<string | null>(null);
  const [autoJoinAllowed, setAutoJoinAllowed] = useState(false);

  useEffect(() => {
    const savedSession = localStorage.getItem(LS_GLOBAL_SESSION_CODE);
    const savedAlias = localStorage.getItem(LS_GLOBAL_ALIAS);
    if (savedSession && savedAlias) {
      setSessionCode(savedSession);
      setAlias(savedAlias);
      setAutoJoinAllowed(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("session");
    if (code) {
      setSessionCode(code.toUpperCase());
      setAutoJoinAllowed(true);
    }
  }, []);

  useEffect(() => {
    if (isJoined || joining) return;
    if (!sessionCode || !alias) return;
    if (!autoJoinAllowed) return;
    const key = `${sessionCode}:${alias}`;
    if (autoJoinRef.current === key) return;
    autoJoinRef.current = key;
    joinSession(sessionCode, alias);
  }, [sessionCode, alias, isJoined, joining, autoJoinAllowed]);

  async function joinSession(nextSession: string, nextAlias: string) {
    const trimmedSession = nextSession.trim().toUpperCase();
    const trimmedAlias = nextAlias.trim().replace(/:/g, "");
    if (!trimmedSession || !trimmedAlias) {
      setJoinError("Udfyld sessionkode og alias.");
      return;
    }
    setJoining(true);
    setJoinError("");
    const { data: session, error } = await supabase
      .from("sessions")
      .select("id,code,expires_at")
      .eq("code", trimmedSession)
      .single();
    if (error || !session) {
      setJoinError("Sessionkode findes ikke.");
      setJoining(false);
      return;
    }
    const expiresAt = new Date(session.expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      setJoinError("Sessionen er udl?bet.");
      setJoining(false);
      return;
    }

    localStorage.setItem(LS_GLOBAL_SESSION_CODE, trimmedSession);
    localStorage.setItem(LS_GLOBAL_ALIAS, trimmedAlias);
    setSessionCode(trimmedSession);
    setAlias(trimmedAlias);
    setIsJoined(true);
    setJoining(false);
  }

  const selectClass =
    "mt-2 w-full rounded-xl border border-black/10 bg-white/80 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-2)]";

  if (!isJoined) {
    return (
      <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 right-0 h-64 w-64 rounded-full bg-[var(--brand-2)]/20 blur-3xl float-slow"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 rounded-full bg-[var(--brand-1)]/20 blur-3xl float-slow"
        />

        <div className="relative mx-auto flex max-w-3xl flex-col gap-8">
          <header className="flex flex-col gap-4 rise-in">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Sessionstart
            </p>
            <h1 className="text-4xl font-[var(--font-display)] text-slate-900 md:text-5xl">
              Indtast session og alias
            </h1>
            <p className="max-w-2xl text-base text-slate-600">
              Skriv den kode din lærer har givet dig, og vælg et alias.
            </p>
          </header>

          <section className="rounded-3xl border border-[var(--border)] bg-[var(--panel)]/90 p-6 shadow-[var(--shadow-1)] backdrop-blur">
            <div className="grid gap-5">
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Sessionkode
                </label>
                <input
                  className={selectClass}
                  value={sessionCode}
                  placeholder="ABCDE1"
                  onChange={(e) => {
                    setAutoJoinAllowed(false);
                    setSessionCode(e.target.value.toUpperCase());
                  }}
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Alias
                </label>
                <input
                  className={selectClass}
                  value={alias}
                  placeholder="Fx Sara"
                  onChange={(e) => {
                    setAutoJoinAllowed(false);
                    setAlias(e.target.value);
                  }}
                />
              </div>
              {joinError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {joinError}
                </div>
              )}
              <button
                onClick={() => joinSession(sessionCode, alias)}
                disabled={joining}
                className="rounded-full bg-[var(--brand-2)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200/50 transition hover:translate-y-[-1px] hover:bg-blue-600 disabled:opacity-60"
              >
                {joining ? "Forbinder..." : "Start øvelse"}
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-10 md:px-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-0 h-64 w-64 rounded-full bg-[var(--brand-2)]/20 blur-3xl float-slow"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 rounded-full bg-[var(--brand-1)]/20 blur-3xl float-slow"
      />

      <div className="relative mx-auto flex max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-4 rise-in">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Matematikmenu - Onlineskolen
          </p>
          <h1 className="text-4xl font-[var(--font-display)] text-slate-900 md:text-5xl">
            Vælg din træning
          </h1>
          <p className="max-w-2xl text-base text-slate-600">
            Vælg et fokusområde og byg sikkerhed trin for trin. Nye baner
            kommer løbende.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {tracks.map((track) => {
            const card = (
              <div className="relative h-full overflow-hidden rounded-3xl border border-black/10 bg-white/80 p-6 shadow-[var(--shadow-1)] backdrop-blur transition">
                <div
                  aria-hidden
                  className={`absolute inset-0 bg-gradient-to-br ${track.accent}`}
                />
                <div className="relative flex h-full flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Spor
                    </span>
                    <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700">
                      {track.tag}
                    </span>
                  </div>
                  <div className="flex-1">
                    <h2 className="text-2xl font-semibold text-slate-900">
                      {track.title}
                    </h2>
                    <p className="mt-2 text-sm text-slate-600">
                      {track.description}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      {track.href ? "Start" : "Snart"}
                    </span>
                  </div>
                </div>
              </div>
            );

            return track.href ? (
              <Link
                key={track.title}
                href={track.href}
                className="group focus:outline-none"
              >
                <div className="transition group-hover:-translate-y-1 group-focus-visible:-translate-y-1">
                  {card}
                </div>
              </Link>
            ) : (
              <div key={track.title} className="opacity-90 grayscale-[0.15]">
                {card}
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}



