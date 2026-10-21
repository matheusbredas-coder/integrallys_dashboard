import { getAnaliseData } from "./data";
import { AnalisePanel } from "./analise-panel";

/**
 * O trecho de análise do /marketing, isolado num componente próprio para poder ficar dentro
 * de um <Suspense>.
 *
 * O motivo é concreto: os números vêm de duas APIs de fora (Google e Anthropic), e o
 * /marketing é a tela de trabalho de quem está ligando para as leads. Buscar isso junto com
 * o resto faria a página inteira esperar por uma chamada externa lenta — com a fronteira, o
 * quadro de ligações aparece na hora e a análise entra quando chegar.
 */
export async function AnaliseSection() {
  const source = await getAnaliseData();
  return <AnalisePanel source={source} />;
}

/** Placeholder enquanto as duas APIs respondem, no mesmo formato dos blocos que virão. */
export function AnaliseSectionSkeleton() {
  return (
    <>
      <div className="skeleton" style={{ height: 22, width: 220, borderRadius: 8, margin: "8px 0 0" }} />
      <div className="card" style={{ padding: 20 }}>
        <div className="skeleton" style={{ height: 14, width: "30%" }} />
        <div className="skeleton" style={{ height: 220, width: "100%", marginTop: 16, borderRadius: 16 }} />
      </div>
    </>
  );
}
