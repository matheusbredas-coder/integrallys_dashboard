// Gestek API payloads (field names confirmed from the n8n "Build Vendas Rows" node)
export type GestekCliente = { id: string; nome?: string; dataCriacao?: string };
export type GestekVendaItem = { nome?: string; quantidade?: number | string };
export type GestekVenda = {
  id: string; codigo?: number; data?: string; cliente?: string; clienteId?: string;
  status?: number; subtotal?: number; desconto?: number; valorDesconto?: number;
  tipoDesconto?: number; total?: number; valorPago?: number; valorTaxasCartao?: number;
  profissional?: string; observacoes?: string; itens?: GestekVendaItem[]; pagamentos?: unknown[];
  dataCriacao?: string; dataUltimaAlteracao?: string;
};

export type GestekAgendaProc = { id?: string; nome?: string; duracaoMinutos?: number; valor?: number };
export type GestekAgenda = {
  id: string;
  dataAgendamentoInicio?: string;
  pendente?: boolean;
  clienteNome?: string;
  clienteTelefone?: string;
  profissional?: { id?: string; nome?: string; cargo?: string | null };
  salaAtendimento?: { id?: string; nome?: string };
  procedimentos?: GestekAgendaProc[];
};
export type GestekAgendaRow = {
  id: string;
  data_inicio: string;
  pendente: boolean;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  profissional_id: string | null;
  profissional_nome: string | null;
  sala_nome: string | null;
  procedimentos: unknown[];
};

// Supabase shapes
export type SupabasePatient = { id: string; Nome?: string; gestek_id?: string | null };
export type NewPatientRow = { id: string; gestek_id: string; Nome: string; "Data do Cadastro": string };
export type GestekVendaRow = {
  id: string; codigo: number | null; data: string | null; cliente: string | null;
  cliente_gestek_id: string | null; cliente_supabase_id: string | null; status: number | null;
  procedimentos: string | null; subtotal: number | null; desconto: number | null;
  valor_desconto: number | null; tipo_desconto: number | null; total: number | null;
  valor_pago: number | null; valor_taxas_cartao: number | null; profissional: string | null;
  observacoes: string | null; itens: unknown[]; pagamentos: unknown[];
  data_criacao: string | null; data_ultima_alteracao: string | null;
};

export type SyncSummary = {
  run_id?: string; mode?: string; dryRun?: boolean;
  total_clientes?: number; patients_inserted?: number; vendas_upserted?: number; agenda_upserted?: number;
  orphan_supabase_patients?: number; duplicate_name_warnings?: number;
  started_at?: string; completed_at?: string;
  [k: string]: unknown;
};
export type SyncWarning = { level?: string; message?: string };
export type SyncResult =
  | { ok: true; summary: SyncSummary | null; warnings: SyncWarning[] }
  | { ok: false; code: "disabled" | "not_configured" | "guard_tripped" | "gestek_error" | "error"; message: string; summary?: SyncSummary };
