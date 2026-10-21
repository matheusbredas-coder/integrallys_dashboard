import "server-only";
import { centsToUsd, isoToKey } from "./aggregate";
import { WINDOW_DAYS } from "./constants";
import type { CostByModel, CostDaily, CostSource } from "./types";

/** O endpoint aceita no máximo 31 baldes diários por página. */
const MAX_BUCKETS = 31;

class CostError extends Error {}

/**
 * Uma página do relatório de custo. Só os campos que a tela usa — o corpo real traz mais
 * (context_window, service_tier, inference_geo), que não entram em nenhuma conta aqui.
 */
type CostReport = {
  data?: {
    starting_at: string;
    results?: { amount?: string | null; model?: string | null; cost_type?: string | null }[] | null;
  }[] | null;
  has_more?: boolean;
  next_page?: string | null;
};

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function requestPage(key: string, params: URLSearchParams): Promise<CostReport> {
  const res = await fetch(`https://api.anthropic.com/v1/organizations/cost_report?${params}`, {
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "user-agent": "Integrallys-CRM/1.0 (https://integrallys-crm.vercel.app)",
    },
    // A rota já é cacheada por unstable_cache; um segundo cache aqui só atrasaria o dado.
    cache: "no-store",
  });

  // 401 = a chave nem foi aceita. 403 = a chave é válida, mas não é uma credencial de
  // Admin — é o que uma sk-ant-api03-... comum devolve aqui, e é de longe o engano mais
  // provável, porque as duas chaves saem da mesma tela do console e só o prefixo difere.
  // Sem esta ramificação a tela mostrava só "respondeu 403", que não diz o que fazer.
  if (res.status === 401 || res.status === 403) {
    throw new CostError(
      "A Anthropic não deixou ler o relatório de custo com esta chave. Ele exige uma Admin key " +
        "(sk-ant-admin01-...), criada em console.anthropic.com → Settings → API keys → Admin keys; " +
        "a chave comum (sk-ant-api03-...), que o bot e o chat usam, é recusada aqui. A Admin API " +
        "também não existe para conta individual: a conta precisa ser uma Organização."
    );
  }
  if (!res.ok) {
    throw new CostError(`A Anthropic respondeu ${res.status} ao pedir o relatório de custo.`);
  }
  return (await res.json()) as CostReport;
}

/**
 * Percorre a janela inteira, seguindo a paginação até `has_more` virar falso.
 *
 * O laço tem um teto de páginas de propósito: um `next_page` que voltasse igual ao anterior
 * deixaria o pedido rodando até o timeout da função na Vercel. 90 dias cabem em 3 páginas de
 * 31 baldes; 12 é folga suficiente para não truncar dado real.
 */
export async function fetchCost(): Promise<CostSource> {
  const key = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  if (!key) {
    throw new CostError("O custo do Claude não está configurado (falta ANTHROPIC_ADMIN_KEY).");
  }

  const byDay = new Map<string, number>();
  const byModel = new Map<string, number>();

  let page: string | null = null;
  for (let i = 0; i < 12; i++) {
    const params = new URLSearchParams({
      starting_at: isoDay(-(WINDOW_DAYS - 1)),
      ending_at: isoDay(1),
      bucket_width: "1d",
      limit: String(MAX_BUCKETS),
    });
    // Sem group_by o relatório não traz o modelo; com ele cada balde vira uma linha por
    // modelo e por tipo de token, que somamos de volta.
    params.append("group_by[]", "description");
    if (page) params.set("page", page);

    const report: CostReport = await requestPage(key, params);

    for (const bucket of report.data ?? []) {
      const day = isoToKey(bucket.starting_at);
      for (const item of bucket.results ?? []) {
        const usd = centsToUsd(item.amount);
        if (usd === 0) continue;
        byDay.set(day, (byDay.get(day) ?? 0) + usd);
        // Custos que não são de token (busca na web, execução de código) não têm modelo.
        const model = item.model ?? (item.cost_type ? `(${item.cost_type})` : "(outros)");
        byModel.set(`${day}|${model}`, (byModel.get(`${day}|${model}`) ?? 0) + usd);
      }
    }

    if (!report.has_more || !report.next_page) break;
    page = report.next_page;
  }

  const daily: CostDaily[] = [...byDay.entries()]
    .map(([date, usd]) => ({ date, usd }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const models: CostByModel[] = [...byModel.entries()].map(([composite, usd]) => {
    const sep = composite.indexOf("|");
    return { date: composite.slice(0, sep), model: composite.slice(sep + 1), usd };
  });

  return { daily, byModel: models };
}
