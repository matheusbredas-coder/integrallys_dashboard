import "server-only";
import { unstable_cache } from "next/cache";
import { fetchCost } from "./anthropic-cost";
import { fetchTraffic } from "./ga4";
import type { AnaliseSource, Block, CostSource, TrafficSource } from "./types";

/**
 * As duas fontes guardam o próprio histórico, então a página lê ao vivo e guarda o
 * resultado por 15 minutos — não há tabela nem cron para manter. 15 min também respeita com
 * folga o limite da Anthropic (no máximo uma consulta por minuto) e a cota do GA4.
 */
const REVALIDATE_SECONDS = 900;

/**
 * Cada fonte tem o SEU cache, e o cache guarda só o sucesso.
 *
 * É por isso que o try/catch fica de fora do `unstable_cache` e não dentro: uma promessa
 * rejeitada não é memoizada, então uma credencial que ainda não existe é tentada de novo no
 * próximo carregamento. Com o catch por dentro, o erro virava um valor de sucesso e ficava
 * gravado por 15 minutos — a tela continuaria dizendo "não está configurado" por um bom
 * tempo depois de a chave já estar no lugar, que é exatamente quando alguém está tentando
 * fazer funcionar e olhando para a tela.
 *
 * Separar os dois também evita que uma fonte fora do ar invalide o cache da outra.
 */
const cachedTraffic = unstable_cache(() => fetchTraffic(), ["analise-traffic"], {
  revalidate: REVALIDATE_SECONDS,
  tags: ["analise"],
});

const cachedCost = unstable_cache(() => fetchCost(), ["analise-cost"], {
  revalidate: REVALIDATE_SECONDS,
  tags: ["analise"],
});

/**
 * Resolve uma fonte sem deixar que ela derrube a outra. Uma credencial vencida do Google
 * não pode apagar o gasto do Claude da tela — cada bloco carrega ou o dado ou o motivo de
 * não estar lá, e o painel decide o que mostrar.
 */
async function settle<T>(load: () => Promise<T>): Promise<Block<T>> {
  try {
    return { ok: true, data: await load() };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Falha desconhecida ao buscar os dados.";
    // O erro fica no log da Vercel com a pilha; na tela vai só a mensagem.
    console.error("[analise] fonte indisponível:", err);
    return { ok: false, error };
  }
}

/**
 * Não é cacheada de propósito: só junta os dois caches e carimba a hora. Se ela fosse
 * cacheada, `nowIso` congelaria junto — e é dele que sai o "mês atual" do seletor de
 * período, que passaria a apontar para um dia velho.
 */
export async function getAnaliseData(): Promise<AnaliseSource> {
  const [traffic, cost] = await Promise.all([
    settle<TrafficSource>(cachedTraffic),
    settle<CostSource>(cachedCost),
  ]);
  return { nowIso: new Date().toISOString(), traffic, cost };
}
