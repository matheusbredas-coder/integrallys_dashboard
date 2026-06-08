/* Next.js gives templates a unique key and fully recreates their DOM on
   every navigation (unlike layouts, which persist). That remount is what
   replays the CSS fade-rise on page swaps. See globals.css (.page-transition),
   gated to desktop and disabled under prefers-reduced-motion. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-transition">{children}</div>;
}
