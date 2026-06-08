/* Instant skeleton for the Pacientes route while its (heavy) client + sales
   query resolves. Mirrors the title + table layout. */
export default function Loading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 1200, marginInline: "auto" }}>
      <div className="skeleton" style={{ height: 34, width: 200, borderRadius: 10 }} />

      <div className="card" style={{ padding: 18 }}>
        <div className="skeleton" style={{ height: 44, width: "100%", borderRadius: 14 }} />
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 40, width: "100%", marginTop: 10 }} />
        ))}
      </div>
    </div>
  );
}
