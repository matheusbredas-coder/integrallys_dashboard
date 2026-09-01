# Quadro de ligações (`/marketing`)

O quadro kanban acima da tabela de leads do formulário. Quem trabalha nele é a pessoa que
liga para as leads; a tabela abaixo continua sendo o registro do funil.

## A regra que governa tudo

**O quadro não escreve `form_leads.stage` e não dispara nenhum evento do Meta CAPI.**

Ele tem campos próprios (migração 028) e é só isso que ele toca:

| coluna do banco | o que guarda |
|---|---|
| `board_column` | a coluna do quadro: `null` (= "A ligar"), `nao_atendeu`, `retorno`, `qualificado`, `agendado`, `removido` |
| `call_attempts` | quantas ligações já foram feitas (máx. 3) |
| `last_call_at` | quando foi a última |
| `next_call_at` | quando é a próxima |

Motivo: `stage` é um contrato de três escritores (o dropdown da tabela, o bot via
`POST /api/leads/form/stage`, e a importação de CSV) e **toda** escrita nele dispara uma
conversão para o Meta que não dá para cancelar nem reenviar — `capi_events` deduplica por
`${leadId}:${eventName}`. Além disso o bot descobre quem contatar com `stage='novo'`, então
uma lead arrastada para fora dessa etapa deixaria de receber o WhatsApp de abertura e, com
ele, toda a sequência de follow-up.

Consequência prática: **arrastar no quadro é sempre reversível**, e por isso o quadro não
pede confirmação nenhuma — enquanto o dropdown da tabela pede, e deve continuar pedindo.

Os testes que seguram essa regra estão em `src/features/form-leads/actions.test.ts`
("never writes the stage column", "never fires a Meta CAPI event, for any column"). Se algum
dia um deles ficar vermelho, o quadro começou a fazer algo que não é dele.

## O quadro e a tabela podem discordar — de propósito

O "Agendado" do quadro é a anotação de quem ligou. O `stage='agendado'` da tabela é um
agendamento que caiu no Gestek de verdade. São coisas diferentes e podem não bater.

Para a pessoa não confundir uma com a outra, cada card mostra a etapa real do funil em texto
pequeno e não editável (`etapa: Contatado`). E quando a lead responde o WhatsApp do bot
(`stage === 'respondeu'`), o card ganha borda verde-água e sobe para o topo da coluna em que
estiver — é o sinal mais quente do quadro, e não pode ficar perdido no meio da pilha.

O `stage` é **lido** para essas duas coisas. Nunca escrito.

## Cadência das ligações

De `docs/roteiro-ligacao.md` (na raiz do repositório do bot): 2 ligações no dia em que a lead
chega, e a 3ª dois dias depois se nenhuma foi atendida.

`src/features/form-leads/call-cadence.ts` calcula `next_call_at`:

| tentativas | próxima ligação |
|---|---|
| 1 | mesmo dia, ~2h depois (limitado a 18h30). Depois das 19h, ou fim de semana → próximo dia útil 09h |
| 2 | +2 dias úteis, 09h |
| 3 | `null` — "tentativas esgotadas" |

Horário da clínica: seg–sex, 09h–19h, `America/Sao_Paulo`. A aritmética usa o offset fixo
UTC-3 em vez de `toLocaleString`, porque o Brasil não tem horário de verão desde 2019 (o
mesmo pressuposto de `src/lib/format.ts`). Se o horário de verão voltar, é aqui e lá que
quebra.

A data de "Retorno marcado" é digitada por quem liga, mas **normalizada no servidor** para
horário útil — a server action é alcançável por POST direto, então não dá para confiar no que
chega do navegador.

## Drag and drop é nativo, sem biblioteca

HTML5 puro (`draggable` + `dragstart`/`dragover`/`drop`). O repositório tem 12 dependências e
nenhuma abstração de UI, e o quadro não precisa de nada do que `@dnd-kit` resolve bem.

**Troque por `@dnd-kit/core` no dia em que precisar de qualquer uma destas três**, porque o
DnD nativo não dá conta delas:

1. reordenar cards dentro de uma coluna;
2. coluna com scroll próprio — o DnD nativo não faz autoscroll dentro de `overflow-y: auto`,
   e a pessoa fica sem conseguir arrastar um card do fim da lista. É por isso que as colunas
   crescem e escondem o excedente atrás de "ver mais" em vez de rolar;
3. suporte a toque — o DnD nativo simplesmente não funciona em tela sensível ao toque. Hoje
   isso é coberto pelo `<select>` "mover para…" em cada card, que é também o caminho que os
   testes exercitam (jsdom não tem drag, e `user-event` não implementa arrasto).

Outras coisas que já estão resolvidas no arquivo e que é fácil quebrar sem querer:

- `onDragOver` **precisa** chamar `preventDefault()`, senão `onDrop` nunca dispara.
- O Firefox não inicia o arrasto sem `dataTransfer.setData()` no `dragstart`.
- `dragenter`/`dragleave` disparam a cada filho atravessado, então a coluna conta
  profundidade num `useRef`. `relatedTarget` não serve: é `null` no Safari durante o arrasto.
- Os cards **não** usam a classe global `.card`: o `transform` do `:hover` dela faz o
  navegador tirar o print do fantasma no meio da animação.
- A lead sendo arrastada fica num `useRef`, não em state — re-render durante o arrasto aborta
  o drag no Chrome.
- Um `router.refresh()` por arrasto seria caro (Server Functions são despachadas uma de cada
  vez, e cada refresh re-roda o `Promise.all` inteiro de `marketing/page.tsx`) e mataria o
  arrasto seguinte. Por isso o refresh é único e com debounce de 1,5s.

## Arquivos

- `db/migrations/028_form_leads_call_tracking.sql` — as quatro colunas
- `src/features/form-leads/types.ts` — `BOARD_COLUMNS`, rótulos, guarda
- `src/features/form-leads/call-cadence.ts` — quando é a próxima ligação (puro)
- `src/features/form-leads/board-columns.ts` — em que coluna e em que ordem (puro)
- `src/features/form-leads/actions.ts` — `updateFormLeadBoard`, o único escritor
- `src/features/form-leads/leads-board.tsx` — o quadro
- `src/app/(app)/marketing/page.tsx` — onde ele entra, reusando as linhas da tabela

## Nota de lado: a trava anti-retrocesso

`src/features/form-leads/stage-order.ts` foi escrito junto com o quadro mas é independente
dele. O bot reporta `respondeu` na primeira resposta da lead sem ler a etapa atual
(`Lead Qualifier Bot/src/pipeline.ts`), então uma lead marcada `qualificado` à mão de manhã
voltava sozinha para `respondeu` à tarde — na tabela e no Meta. A rota do bot agora só aceita
movimento para frente no funil, com `agendado` sempre liberado (um agendamento é fato
consumado, e precisa vencer até um `perdido` marcado à mão). O dropdown humano continua
podendo mover para qualquer lado.
