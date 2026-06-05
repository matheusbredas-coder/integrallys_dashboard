export const SCHEMA_DESCRIPTION = `Banco de dados Postgres (consulte somente estas views de leitura):

clientes_view — uma linha por paciente (337 linhas)
  id text, nome text, telefone text, email text, origem text,
  numero_vendas int, receita_total numeric, descontos numeric, ticket_medio numeric,
  cadastro_at timestamptz (signup date), procedimentos_raw text

vendas_view — uma linha por venda concluída (838 linhas, todas com status=1)
  id text, sold_at timestamptz, sold_month date, cliente_supabase_id text (-> clientes_view.id),
  cliente_nome text, procedimentos text, subtotal numeric, total numeric (BILLED revenue),
  valor_pago numeric (COLLECTED), desconto numeric, profissional text

vendas_monthly — resumo mensal
  month date, sales int, revenue_billed numeric, revenue_collected numeric

procedimentos_expanded — uma linha por (paciente, procedimento, quantidade)
  id text (-> clientes_view.id), procedure_name text, qty int

Notas: valores em BRL. "Receita" = vendas_view.total (faturada), a menos que o usuário peça a recebida (valor_pago).
Um paciente "comprou" se tiver linhas em vendas_view. Os nomes dos procedimentos incluem dosagens (ex.: "MONJAURO 2,5 MG").`;
