-- ─────────────────────────────────────────────────────────────────────────────
-- Sales detail table: one row per Gestek sale (Status = 1, completed purchases).
-- Paste into the Supabase SQL editor and run once.
-- Afterwards the populate step fills it via the REST API (idempotent upsert on id).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gestek_vendas (
  id                     text PRIMARY KEY,        -- Gestek venda id (ObjectId)
  codigo                 integer,                 -- human-friendly sale code
  data                   timestamptz,             -- WHEN the sale happened
  cliente                text,                    -- WHO (buyer name as on the sale)
  cliente_gestek_id      text,                    -- Gestek clienteId
  cliente_supabase_id    text,                    -- link to "Clientes".id (resolved by name/id)
  status                 integer,
  procedimentos          text,                    -- WHAT (readable: "Nome (qty), ...")
  subtotal               numeric(12,2),
  desconto               numeric(12,2),           -- DISCOUNT (header)
  valor_desconto         numeric(12,2),
  tipo_desconto          integer,
  total                  numeric(12,2),           -- final sale value
  valor_pago             numeric(12,2),           -- HOW MUCH THEY PAID
  valor_taxas_cartao     numeric(12,2),
  profissional           text,
  observacoes            text,
  itens                  jsonb,                   -- full line items (per-product detail)
  pagamentos             jsonb,                   -- full payment breakdown (forma, valor, ...)
  data_criacao           timestamptz,
  data_ultima_alteracao  timestamptz,
  inserted_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gestek_vendas_data_idx                ON gestek_vendas (data);
CREATE INDEX IF NOT EXISTS gestek_vendas_cliente_supabase_id_idx ON gestek_vendas (cliente_supabase_id);
CREATE INDEX IF NOT EXISTS gestek_vendas_cliente_gestek_id_idx   ON gestek_vendas (cliente_gestek_id);
