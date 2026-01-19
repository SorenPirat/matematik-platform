"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function HomeLink() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  const lastYRef = useRef(0);
  const tickingRef = useRef(false);
  const isHome = pathname === "/";

  useEffect(() => {
    if (isHome) return;
    lastYRef.current = window.scrollY;
    setVisible(true);

    function onScroll() {
      if (tickingRef.current) return;
      tickingRef.current = true;
      window.requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const delta = currentY - lastYRef.current;
        if (delta > 6) setVisible(false);
        if (delta < -6) setVisible(true);
        lastYRef.current = currentY;
        tickingRef.current = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHome]);

  if (isHome) return null;

  return (
    <Link
      href="/"
      className={`fixed left-6 top-6 z-50 rounded-full border border-black/10 bg-white/90 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700 shadow-sm backdrop-blur transition hover:-translate-y-0.5 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      Forside
    </Link>
  );
}
