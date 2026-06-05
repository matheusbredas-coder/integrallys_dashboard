export const SCHEMA_DESCRIPTION = `Banco de dados Postgres (consulte somente estas views de leitura):

clientes_view — uma linha por paciente (337 linhas)
  id text, nome text, telefone text, email text, origem text,
  numero_vendas int, receita_total numeric, descontos numeric, ticket_medio numeric,
  cadastro_at timestamptz (signup date), procedimentos_raw text

vendas_view — uma linha por venda concluída (838 linhas, todas com status=1)
  id text, sold_at timestamptz, sold_month date, cliente_supabase_id text (-> clientes_view.id),
  cliente_nome text, procedimentos text, subtotal numeric, total numeric (RECEITA FATURADA),
  valor_pago numeric (pago no ATO da venda, por venda — NÃO é o caixa do mês), desconto numeric, profissional text

vendas_monthly — faturamento por mês da VENDA
  month date, sales int, revenue_billed numeric (= soma de total)

cash_in_monthly — caixa recebido por mês do PAGAMENTO (concilia com o "Realizado" do Gestek)
  month date, payments int, cash_collected numeric

pagamentos_view — uma linha por pagamento realizado
  venda_id text, codigo int, cliente_supabase_id text (-> clientes_view.id), cliente_nome text,
  paid_at timestamptz, paid_month date, valor numeric

procedimentos_expanded — uma linha por (paciente, procedimento, quantidade)
  id text (-> clientes_view.id), procedure_name text, qty int

Notas: valores em BRL.
- "Faturamento / quanto vendi" no mês = soma de vendas_view.total por sold_month (ou vendas_monthly.revenue_billed). Conta a venda INTEIRA no mês em que foi feita.
- "Quanto recebi / entrou no caixa" no mês = cash_in_monthly.cash_collected (ou soma de pagamentos_view.valor por paid_month). Conta cada pagamento no mês em que foi PAGO.
- NUNCA use valor_pago agregado por mês de venda para "recebido no mês" — isso mistura competências e não bate com o financeiro do Gestek.
Um paciente "comprou" se tiver linhas em vendas_view. Os nomes dos procedimentos incluem dosagens (ex.: "MONJAURO 2,5 MG").`;
