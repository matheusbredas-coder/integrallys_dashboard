"use client";

import { usePathname } from "next/navigation";

/* Replays a subtle fade-rise whenever the route changes (desktop only).
   Keying on the pathname remounts the wrapper, which restarts the CSS
   animation. Mobile/drawer gets no animation (see globals.css). */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div key={path} className="page-transition">
      {children}
    </div>
  );
}
