import type { GestekVenda, GestekVendaItem, GestekVendaRow } from "./types";
import { normalizeName } from "./match";

const num = (n: unknown): number | null => (n == null ? null : Math.round(Number(n) * 100) / 100);
const ts = (s: unknown): string | null => (s && !String(s).startsWith("0001") ? String(s) : null);

export function buildProcedimentos(itens: GestekVendaItem[] | undefined): string | null {
  return (
    (itens || [])
      .map((it) => [it.nome, Number(it.quantidade) || 0] as [string | undefined, number])
      .filter(([n]) => n)
      .sort((a, b) => b[1] - a[1])
      .map(([n, q]) => `${n} (${q})`)
      .join(", ") || null
  );
}

export function mapVendaToRow(
  v: GestekVenda,
  gestekIdToSupabaseId: Record<string, string>,
  supabaseNameToId: Record<string, string> = {},
): GestekVendaRow {
  const supaId =
    (v.clienteId && gestekIdToSupabaseId[v.clienteId]) ||
    supabaseNameToId[normalizeName(v.cliente)] ||
    null;
  return {
    id: v.id,
    codigo: v.codigo ?? null,
    data: ts(v.data),
    cliente: v.cliente ?? null,
    cliente_gestek_id: v.clienteId ?? null,
    cliente_supabase_id: supaId,
    status: v.status ?? null,
    procedimentos: buildProcedimentos(v.itens),
    subtotal: num(v.subtotal),
    desconto: num(v.desconto),
    valor_desconto: num(v.valorDesconto),
    tipo_desconto: v.tipoDesconto ?? null,
    total: num(v.total),
    valor_pago: num(v.valorPago),
    valor_taxas_cartao: num(v.valorTaxasCartao),
    profissional: v.profissional ?? null,
    observacoes: v.observacoes ?? null,
    itens: v.itens ?? [],
    pagamentos: v.pagamentos ?? [],
    data_criacao: ts(v.dataCriacao),
    data_ultima_alteracao: ts(v.dataUltimaAlteracao),
  };
}
