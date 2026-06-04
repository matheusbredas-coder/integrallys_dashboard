export const SCHEMA_DESCRIPTION = `Postgres database (query these read-only views only):

clientes_view — one row per patient (337 rows)
  id text, nome text, telefone text, email text, origem text,
  numero_vendas int, receita_total numeric, descontos numeric, ticket_medio numeric,
  cadastro_at timestamptz (signup date), procedimentos_raw text

vendas_view — one row per completed sale (838 rows, all status=1)
  id text, sold_at timestamptz, sold_month date, cliente_supabase_id text (-> clientes_view.id),
  cliente_nome text, procedimentos text, subtotal numeric, total numeric (BILLED revenue),
  valor_pago numeric (COLLECTED), desconto numeric, profissional text

vendas_monthly — monthly rollup
  month date, sales int, revenue_billed numeric, revenue_collected numeric

procedimentos_expanded — one row per (patient, procedure, qty)
  id text (-> clientes_view.id), procedure_name text, qty int

Notes: money is BRL. "Revenue" = vendas_view.total (billed) unless asked for collected (valor_pago).
A patient "bought" if they have rows in vendas_view. Procedure names include dosages (e.g. "MONJAURO 2,5 MG").`;
