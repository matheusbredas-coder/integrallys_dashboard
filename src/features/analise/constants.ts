/**
 * Quantos dias a página busca de uma vez, de cada fonte.
 *
 * Vive num arquivo sem dependência nenhuma de propósito: o painel é um componente de
 * cliente e precisa deste número para escrever o subtítulo. Importá-lo de `ga4.ts` arrastava
 * o cliente do Google — e o gRPC inteiro — para o pacote do navegador, e o build quebrava.
 *
 * O painel recorta esta janela no navegador conforme o seletor de período, então trocar de
 * período não custa chamada nova. Um período mais antigo que isso aparece vazio.
 */
export const WINDOW_DAYS = 90;
