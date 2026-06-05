"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runAttendanceImport, type ImportSummary } from "./import";

export type ImportFormState = { summary?: ImportSummary; error?: string };

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — the report is tiny; reject anything unreasonable.

export async function importAttendance(_prev: ImportFormState, formData: FormData): Promise<ImportFormState> {
  // Defense in depth: /settings is behind the authenticated layout, but never write from an
  // unauthenticated request.
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entre novamente para importar." };

  const file = formData.get("file");
  const apply = formData.get("intent") === "apply";
  if (!(file instanceof File) || file.size === 0) return { error: "Selecione um arquivo .xlsx do relatório de atendimentos." };
  if (file.size > MAX_BYTES) return { error: "Arquivo muito grande." };

  try {
    const buf = await file.arrayBuffer();
    const summary = await runAttendanceImport(buf, apply);
    if (summary.totalRows === 0) {
      return { error: "Não encontrei a tabela de atendimentos no arquivo (cabeçalho \"Data Agendamento\")." };
    }
    if (apply) revalidatePath("/"); // Overview Atendimentos card + Comparecimento gauge read this.
    return { summary };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao processar o arquivo." };
  }
}
