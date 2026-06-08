/* Shown instantly on navigation while the page's server data loads, so the
   switch feels immediate instead of frozen. Mirrors the overview layout
   (greeting + KPI cards + two panels). Also serves as the fallback for any
   (app) route without its own loading.tsx. */
export default function Loading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div className="skeleton" style={{ height: 34, width: 300, borderRadius: 10 }} />

      <div className="grid-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 22 }}>
            <div className="skeleton" style={{ height: 13, width: "55%" }} />
            <div className="skeleton" style={{ height: 30, width: "72%", marginTop: 18 }} />
            <div className="skeleton" style={{ height: 12, width: "40%", marginTop: 16 }} />
          </div>
        ))}
      </div>

      <div className="grid-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 22, minHeight: 300 }}>
            <div className="skeleton" style={{ height: 18, width: "45%" }} />
            <div className="skeleton" style={{ height: 220, width: "100%", marginTop: 18, borderRadius: 16 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
