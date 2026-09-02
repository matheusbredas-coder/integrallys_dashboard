import Link from "next/link";
import { refreshAgenda } from "./actions";
import { MAX_WEEK_OFFSET } from "./rules";
import type { AgendaDay, AgendaWeek, DayOutcome } from "./types";
import { formatDayMonth, todayLocalISO } from "./time";

/**
 * The week's offerable times, as a grid — the caller's answer to "que horário eu
 * ofereço?" without opening Gestek.
 *
 * It shows the times the BOT would offer, not every hole in the diary: a slot is
 * here only if it grows an existing block (or starts the day) and strands no more
 * than the configured tolerance, so filling the grid top to bottom never leaves an
 * unusable gap between appointments. See slots.ts for the rule itself.
 *
 * Rows are the times that actually occur somewhere in the week rather than a fixed
 * half-hour ladder: on a normal week that is four or five rows instead of fourteen
 * mostly-empty ones, and it stays correct if Gestek ever offers an off-grid time.
 */

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** What an empty column says. A blank cell would send her to phone the clinic. */
const OUTCOME_NOTE: Record<Exclude<DayOutcome, "ok">, string> = {
  closed: "Fechado",
  past: "Já passou",
  full: "Sem encaixe",
  "too-late": "Curto demais",
  error: "Erro no Gestek",
};

const cell: React.CSSProperties = {
  borderTop: "1px solid var(--line)",
  padding: "10px 8px",
  textAlign: "center",
  fontSize: 13,
};

const navLink: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "7px 12px",
  fontSize: 12.5,
  color: "var(--muted)",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

function weekLabel(week: AgendaWeek): string {
  const first = week.days[0]?.dateISO ?? week.weekStartISO;
  const last = week.days[week.days.length - 1]?.dateISO ?? week.weekStartISO;
  return `${formatDayMonth(first)} a ${formatDayMonth(last)}`;
}

function DayHeader({ day, isToday }: { day: AgendaDay; isToday: boolean }) {
  return (
    <th style={{ padding: "0 8px 10px", textAlign: "center", fontWeight: 700 }}>
      <span style={{ display: "block", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: isToday ? "var(--gold)" : "var(--muted)" }}>
        {WEEKDAY_LABELS[day.weekday]}
      </span>
      <span style={{ display: "block", fontSize: 14, color: isToday ? "var(--gold-soft)" : "inherit" }}>
        {formatDayMonth(day.dateISO)}
      </span>
      <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--muted2)", marginTop: 2 }}>
        {day.outcome === "ok"
          ? `${day.slots.length} ${day.slots.length === 1 ? "horário" : "horários"}`
          : OUTCOME_NOTE[day.outcome]}
      </span>
    </th>
  );
}

export function AvailabilityTable({ week }: { week: AgendaWeek }) {
  const today = todayLocalISO();
  // Every time offered anywhere in the week, in clock order — the grid's rows.
  const rows = [...new Set(week.days.flatMap((d) => d.slots.map((s) => s.time)))].sort();
  const prev = Math.max(-MAX_WEEK_OFFSET, week.offset - 1);
  const next = Math.min(MAX_WEEK_OFFSET, week.offset + 1);

  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Link href={`/marketing?semana=${prev}`} scroll={false} style={navLink} aria-label="Semana anterior">←</Link>
        <strong style={{ fontSize: 14 }}>
          {week.offset === 0 ? "Esta semana" : week.offset === 1 ? "Semana que vem" : `Semana de ${formatDayMonth(week.weekStartISO)}`}
        </strong>
        <span className="muted" style={{ fontSize: 12.5 }}>({weekLabel(week)})</span>
        <Link href={`/marketing?semana=${next}`} scroll={false} style={navLink} aria-label="Próxima semana">→</Link>
        {week.offset !== 0 && (
          <Link href="/marketing?semana=0" scroll={false} style={{ ...navLink, color: "var(--gold-soft)" }}>Hoje</Link>
        )}
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11.5 }}>Atualizado às {week.fetchedAt}</span>
        <form action={refreshAgenda}>
          <button type="submit" style={{ ...navLink, background: "transparent", cursor: "pointer", fontFamily: "inherit" }}>
            Atualizar
          </button>
        </form>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ padding: "0 8px 10px", textAlign: "left", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
                Horário
              </th>
              {week.days.map((day) => (
                <DayHeader key={day.dateISO} day={day} isToday={day.dateISO === today} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((time) => (
              <tr key={time}>
                <td style={{ ...cell, textAlign: "left", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{time}</td>
                {week.days.map((day) => {
                  const open = day.slots.some((s) => s.time === time);
                  return (
                    <td key={day.dateISO} style={{ ...cell, background: open ? "color-mix(in srgb, var(--gold) 12%, transparent)" : "transparent" }}>
                      {open ? (
                        <span style={{ color: "var(--gold-soft)", fontWeight: 700 }} title={`${formatDayMonth(day.dateISO)} às ${time} — livre`}>
                          livre
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted2)" }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}

            {rows.length === 0 && (
              <tr>
                <td colSpan={week.days.length + 1} style={{ ...cell, textAlign: "left", color: "var(--muted)" }}>
                  Nenhum horário para oferecer nesta semana — veja o motivo de cada dia no cabeçalho.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
