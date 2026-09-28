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
| `call_log` | quando foi **cada** uma (migração 030) |

Motivo: `stage` é um contrato de três escritores (o dropdown da tabela, o bot via
`POST /api/leads/form/stage`, e a importação de CSV) e **toda** escrita nele dispara uma
conversão para o Meta que não dá para cancelar nem reenviar — `capi_events` deduplica por
`${leadId}:${eventName}`. Além disso o bot descobre quem contatar com `stage='novo'`, então
uma lead arrastada para fora dessa etapa deixaria de receber o WhatsApp de abertura e, com
ele, toda a sequência de follow-up.

Consequência prática: **arrastar no quadro nunca mexe no funil nem no Meta**, e por isso o
quadro quase não pede confirmação — enquanto o dropdown da tabela pede, e deve continuar
pedindo. A única exceção é a volta para "A ligar", que zera a lead (veja abaixo).

Os testes que seguram essa regra estão em `src/features/form-leads/actions.test.ts`
("never writes the stage column", "never fires a Meta CAPI event, for any column"). Se algum
dia um deles ficar vermelho, o quadro começou a fazer algo que não é dele.

## Voltar para "A ligar" zera a lead

Arrastar um card de volta para a primeira coluna não é só "mudar de coluna": é dizer *começar
essa lead do zero*. `updateFormLeadBoard` com `column = null` grava, na mesma escrita:

| campo | vira |
|---|---|
| `call_attempts` | `0` |
| `call_log` | `[]` |
| `last_call_at` | `NULL` |
| `next_call_at` | `NULL` |
| `notes` | `NULL` |

Ou seja, o card volta a parecer uma lead recém-chegada — sem selo de tentativa, sem histórico
de ligações, sem data de próxima ligação e sem observação.

**Isso é a única coisa irreversível do quadro**: não existe histórico por trás de `notes`, o
texto apagado não volta. Por isso o quadro pergunta antes, dizendo o que vai perder
(`lostOnRestart` em `leads-board.tsx` monta a frase, `board-dialog.tsx` mostra) — e só pergunta
quando há algo a perder: uma lead sem tentativas e sem nota volta direto, sem interrupção.

As duas perguntas do quadro — essa e a data de "Retorno marcado" — saem no modal do próprio
CRM, centralizado na tela (`board-dialog.tsx`). **Não use `window.confirm` nem `window.prompt`
aqui**: eles pintam a faixa "localhost:3000 says…" no topo do navegador, que não tem nada a ver
com o visual do app. Foi por isso que saíram, em 02/09/2026.

Quem move um card por engano para "Removido" e o traz de volta perde a nota do mesmo jeito, e
isso é aceito: o comportamento pedido foi "voltou para A ligar, recomeça".

## O bot só trabalha "A ligar" e "Não atendeu"

Essas duas colunas são as únicas em que o bot fala com a lead — abertura, follow-up e resposta.
Em **Retorno marcado**, **Qualificado**, **Agendado** e **Removido** ele fica **mudo**: nada de
abertura, nada de follow-up, e nem resposta se ela escrever (a mensagem dela fica gravada, o bot
só não responde). Arrastar o card de volta para "A ligar" ou "Não atendeu" devolve a lead ao bot,
sem nada para desfazer.

É uma lista de permissão, não de bloqueio: coluna nova que alguém criar no quadro nasce muda, em
vez de começar a receber mensagem de venda sem ninguém decidir isso.

Quem faz a regra é o **bot lendo** `board_column` na hora de enviar (`BOT_ACTIVE_COLUMNS` em
`Lead Qualifier Bot/src/booking/formLeads.ts`) — o quadro continua não escrevendo nada fora de
`form_leads`, então a regra do topo deste documento vale igual.

Os dois casos de dúvida, resolvidos em lados opostos de propósito:

| situação | follow-up (o bot puxa conversa) | resposta (ela escreveu) |
|---|---|---|
| leitura do quadro falhou | não envia | responde |
| card apagado / não existe | não envia | responde |

## O quadro e a tabela podem discordar — de propósito

O "Agendado" do quadro é a anotação de quem ligou. O `stage='agendado'` da tabela é um
agendamento que caiu no Gestek de verdade. São coisas diferentes e podem não bater.

Para a pessoa não confundir uma com a outra, cada card mostra a etapa real do funil em texto
pequeno e não editável (`etapa: Contatado`). E quando a lead responde o WhatsApp do bot
(`stage === 'respondeu'`), ela sobe para o topo da coluna em que estiver — é o sinal mais
quente do quadro. Isso é só ordenação: o selo "Respondeu no WhatsApp" que existia no card foi
removido a pedido, e a borda verde-água que o acompanhava saiu junto porque hoje a borda
carrega a cor da coluna (veja abaixo).

O `stage` é **lido** para essas duas coisas. Nunca escrito.

## Notas

Cada card tem um botão "Notas" que abre a ficha da lead numa gaveta: telefone, e-mail, quando
ela entrou na lista, a etapa no funil (só leitura), **o histórico das ligações** e um campo
livre de observações. O botão
aparece em dourado com um ponto (`Notas •`) quando já existe algo escrito, para a pessoa saber
sem precisar abrir.

O texto vai para `form_leads.notes` — coluna que existe desde a migração 021 e que **nunca foi
lida nem escrita por nada** até agora (a projeção do bot em `booking/formLeads.ts` também não a
seleciona), então o quadro pôde assumi-la sem migração nova. `updateFormLeadNotes` segue a
mesma regra de isolamento do resto do quadro: não escreve `stage`, não dispara CAPI. Campo
vazio volta a `NULL`, para "tem nota?" continuar sendo uma verificação só.

### Histórico de ligações

Acima do campo de observações, a gaveta lista quando cada ligação foi feita:

```
Ligações
  1ª ligação    qui 03/09 14:32
  2ª ligação    qui 03/09 16:40
```

Quem grava é o quadro, nas duas ações que já contavam uma tentativa: arrastar (ou tocar) o card
para "Não atendeu", e o botão "+1 tentativa". O carimbo é do relógio do **servidor**, e sai
junto com o `call_attempts` na mesma escrita — só quando a contagem realmente sobe, para um
card que já gastou as três tentativas não inventar uma quarta ligação.

Guarda em `form_leads.call_log` (migração 030): um array jsonb de strings ISO, mais antiga
primeiro, no máximo 3. `last_call_at` continua existindo — é o que decide quando uma lead
terminada some do quadro (`visibleOnBoard`) — mas guarda **uma** data e é sobrescrito, e foi
por isso que a coluna nova precisou existir.

Toda a leitura passa por `src/features/form-leads/call-log.ts`, nunca pela coluna direto. Ele
resolve dois casos que a coluna sozinha erra: uma lead trabalhada **antes** da migração tem
histórico vazio e só `last_call_at` — essa hora aparece assim mesmo, em vez de a gaveta ficar
em branco; e uma lead trabalhada dos dois lados da migração tem menos entradas do que
tentativas, e aí a numeração é contada **de trás para frente** (a hora registrada é a da última
ligação, não a da primeira).

A lista é só leitura e fica **fora** do campo de observações de propósito: é o registro do
sistema, e quem reescreve as próprias anotações não pode apagá-lo sem querer selecionando as
linhas erradas.

**A gaveta é renderizada num portal para o `<body>`, e isso não é opcional.** O quadro fica
dentro de um `.card`, cuja classe global tem `transform` no hover — e qualquer ancestral com
`transform` vira o bloco de contenção de `position: fixed`. Sem o portal a gaveta é recortada
pela caixa do quadro: aparece com metade da altura e o botão Salvar cortado no rodapé.

## A cor do card é a cor da coluna

Cada card é tingido com a cor da coluna em que está, então dá para saber onde a lead está pela
cor sozinha — inclusive no meio do arrasto, quando o card está fora de qualquer coluna.

A tinta é misturada com `color-mix` em cima de `--panel-hi` em vez de ser uma cor chapada, para
a mesma porcentagem funcionar nos dois temas: ela acompanha a cor do painel em vez de ser um
tom fixo que ficaria lavado no escuro e sujo no claro. Por isso `COLUMN_ACCENT` só tem cores
literais, nunca variáveis CSS — `color-mix` precisa de uma cor de verdade para trabalhar.

## O card de "Não atendeu" não tem data, e nenhum card fica vermelho

O quadro já teve um `atrasada · 04/09` vermelho em todo card cuja hora tinha passado. Numa
lista trabalhada ao longo de dias, quase a coluna inteira ficava vermelha e o vermelho parava
de significar qualquer coisa. Saiu em 06/09/2026, junto com a chegada do histórico de ligações
— que é onde a pergunta "quando ela foi chamada mesmo?" passou a ser respondida, com hora de
verdade em vez de cor.

`dueLabel` em `leads-board.tsx` não tem mais ramo de atraso: quando mostra data, mostra em
palavras neutras (`ligar hoje 14:00`, `retorno 08/01 14:00`). Se alguém for recolocar o
vermelho, leia esta seção antes.

E o card de "Não atendeu" não mostra data nenhuma. Ele carrega, nesta ordem:

```
Lenita Alvarez
27 98182-0451
[2ª]  [+1 tentativa]
[Ligar]  [Notas]
```

O selo da tentativa e o botão que soma a próxima ficam juntos, numa linha própria acima de
"Ligar"/"Notas" — um par é sobre a ligação que está sendo feita, o outro é como se faz. Quando
as três acabam, o botão dá lugar a "tentativas esgotadas" e o selo continua. As outras colunas
mantêm só o par de baixo; "Retorno marcado" é a única que ainda mostra data no card, porque
quem liga escolheu aquele dia e é por isso que o card está ali.

### E o card não sai do lugar quando se clica "+1 tentativa"

"Não atendeu" é ordenada por **chegada**, não por data da próxima ligação. Registrar uma
ligação reescreve `next_call_at` (duas horas depois, depois dois dias úteis, depois `null`), e
enquanto a coluna era ordenada por essa data o card despencava na pilha no instante do clique —
quem estava no meio da ligação perdia a lead de vista. Somado a isso, o card deixou de mostrar
a data: a reordenação não tinha nem causa visível. Pedido em 06/09/2026.

As outras colunas não mudaram. "Retorno marcado" continua por data, porque ali a data está no
card e nada que a pessoa clica mexe nela. E a lead que respondeu o WhatsApp do bot continua
grudada no topo de qualquer coluna.

Está em `sortKeyFor` (`board-columns.ts`), com testes em `board-columns.test.ts`
("holds a Não atendeu card still…") e em `leads-board.test.tsx`
("leaves the card where it was when +1 tentativa is clicked").

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

## Drag and drop é nativo, sem biblioteca — e é o único jeito de mover um card

HTML5 puro (`draggable` + `dragstart`/`dragover`/`drop`). O repositório tem 12 dependências e
nenhuma abstração de UI.

**Não existe alternativa por clique.** Havia um `<select>` "mover para…" em cada card e ele foi
removido a pedido, para o quadro ser só arrastar. Isso tem uma consequência que precisa estar
escrita: **o quadro é só para computador.** O drag nativo do HTML5 não dispara em tela
sensível ao toque, então em celular ou tablet não há como mover um card — por nenhum caminho.

**Troque por `@dnd-kit/core` no dia em que precisar de qualquer uma destas três**, porque o
DnD nativo não dá conta delas:

1. **usar em tablet ou celular** — hoje é o motivo mais provável, já que não sobrou fallback;
   o pointer sensor do `@dnd-kit` resolve toque;
2. reordenar cards dentro de uma coluna;
3. coluna com scroll próprio — o DnD nativo não faz autoscroll dentro de `overflow-y: auto`,
   e a pessoa fica sem conseguir arrastar um card do fim da lista. É por isso que as colunas
   crescem e escondem o excedente atrás de "ver mais" em vez de rolar.

Como não sobrou caminho por clique, o jsdom não consegue exercitar o arrasto de verdade (ele
não implementa drag, e o `user-event` também não): os testes disparam eventos de arrasto
sintéticos com um `dataTransfer` montado à mão. **Arrastar de verdade só se verifica no
navegador**, e vale fazer isso a cada mudança neste arquivo.

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
