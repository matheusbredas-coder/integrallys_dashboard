# Editar a Agenda da semana

A tabela "Agenda da semana" no `/marketing` deixou de ser só leitura. Além de mostrar o que o Gestek
já tem marcado, ela é onde a clínica **fecha um horário na mão** e onde **libera um horário que o
Gestek ainda mostra como ocupado**.

## O que o quadro mostra

Cada meia hora do dia é uma linha. Uma célula pode dizer isto:

| célula | significa | clicando nela |
|---|---|---|
| `×` cinza | ocupado: paciente no Gestek, **ou** bloqueio já salvo | marca para liberar |
| `—` cinza | livre: nunca teve nada, ou foi liberado por vocês | marca para bloquear (ou para voltar a ficar ocupado) |
| dourado (qualquer um) | **você mexeu e ainda não salvou** | desfaz |

Dourado quer dizer sempre a mesma coisa: alteração pendente.

Nenhum nome de paciente aparece, de propósito: a tela fica aberta na mesa o dia inteiro e "que
horário está livre?" não precisa de nome.

## Como editar

É **marcar e depois salvar** — nenhum clique escreve no banco sozinho.

1. **Marque.** Clique num horário, ou segure e arraste para marcar vários (inclusive atravessando
   dias). O sentido é decidido pela **primeira** célula: começou num horário livre, o arrasto inteiro
   fecha; começou num ocupado, o arrasto inteiro abre. Assim um arrasto não deixa buracos atrás de si.
2. **Confira.** O que está marcado fica dourado e o botão diz quantos são: "Salvar 3 horários".
3. **Salve.** Aí sim vai para o banco, e as células ficam cinza como as outras.

**Descartar** joga fora tudo que foi marcado e não salvo. Sair da página (ou trocar de semana) com
marcações não salvas pergunta antes — as marcações vivem só na sua tela até você salvar.

Dias que já passaram e dias fechados não aceitam clique.

## O que acontece por baixo

Cada decisão é uma linha em `agenda_manual_blocks` (migração 029) — uma por meia hora, por dia, com
`kind` dizendo a direção (`block` ou `open`). A chave primária é `(date, start_min)`, então uma meia
hora só pode ter uma decisão.

Nada disso vai para o Gestek — nem escreve, nem apaga. O Gestek não tem API para isso: os "lembretes"
e bloqueios feitos dentro da tela dele não aparecem para nenhuma integração, e era por isso que a
clínica bloqueava horário inventando um agendamento falso. Esta tabela é a versão honesta daquele
truque — e o `open` é como se desfaz um daqueles agendamentos falsos que ficaram para trás. Um `open`
não cancela o agendamento no Gestek: ele só faz o horário voltar a ser oferecido.

Quem lê essas decisões:

1. **A própria agenda** (`features/agenda/data.ts`) — desenha o `×` nos bloqueados e devolve os liberados ao estado de livre.
2. **O Lead Qualifier Bot** (`src/booking/blocks.ts`) — tira os bloqueados do que ele oferece, e
   acrescenta os liberados, inclusive quando o Gestek diz que estão ocupados. Um horário liberado
   entra **na frente** dos outros na hora de oferecer: buraco de cancelamento é o que mais vale
   preencher. Ele também segue valendo na hora do sinal, quando o bot reconfere se o horário ainda
   está de pé.

O bot lê a janela inteira (60 dias) numa consulta só, guardada por 1 minuto: uma alteração salva
agora vale para a próxima lead em até um minuto.

O bloqueio respeita **só aquela meia hora** — não come os 15 minutos de folga dos lados como um
agendamento de verdade faria. Se você bloqueia 15h, 14h30 continua sendo oferecido.

## Quando dá errado

Os dois lados degradam para **"a clínica não decidiu nada"** — nunca para "tudo bloqueado". Sem a
migração, sem credencial, ou com o Supabase fora do ar, a agenda desenha a semana só com o Gestek e o
bot oferece o que o Gestek disser. O prejuízo é o de antes: um horário oferecido que um humano
remarca. O contrário — segurar a agenda inteira por causa de uma consulta que falhou — custaria
agendamentos.

Uma linha `kind` desconhecida é ignorada dos dois lados, em vez de chutada: as duas direções fazem
coisas opostas, e chutar "open" entregaria uma meia hora ocupada.

Na tela, se o servidor recusar o Salvar, as marcações **continuam douradas** e o motivo aparece no
cabeçalho da tabela: nada foi escrito, e você pode clicar em Salvar de novo sem refazer o arrasto.

## Uma decisão não é um agendamento

Nada disso mexe na conta de "N na agenda" do cabeçalho do dia — aquele número é do Gestek. E um
bloqueio não segura nada dentro do Gestek: se alguém marcar um paciente naquele horário por lá, o
Gestek ganha e a célula passa a mostrar o `×` de ocupado por cima do bloqueio.
