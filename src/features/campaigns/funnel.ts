import type { Track } from "./classify";

export type ApprovalStatus = "draft" | "pending" | "approved" | "rejected";

export interface FunnelMessage {
  type: "text" | "image";
  text?: string;
  url?: string;
  caption?: string;
}

export interface FunnelStep {
  id: number;
  tactic: string;
  delayHint: string;
  delayDays: number;
  terminal?: boolean;
  templateName: string;
  approvalStatus: ApprovalStatus;
  /** Shared/base messages, used when a track has no override. */
  messages: FunnelMessage[];
  /** Per-track full-message overrides. */
  overrides?: Partial<Record<Track, FunnelMessage[]>>;
}

export interface ReactivationFunnel {
  stages: string[];
  resumePolicy: "restart" | "resume" | "stop";
  steps: FunnelStep[];
}

const PLACEHOLDER_RESULT_IMG = "https://ujlkfxufrlwqxhmbhqeh.supabase.co/storage/v1/object/public/bot-media/botox-antes-depois-1.jpg";
const PLACEHOLDER_VOUCHER_IMG = "https://placehold.co/600x400/png?text=Voucher+Retorno+48h";

export const defaultReactivationFunnel: ReactivationFunnel = {
  stages: ["not_sent", "sent", "engaged", "touch_up_booked", "protocol_interested", "lost"],
  resumePolicy: "restart",
  steps: [
    {
      id: 0, tactic: "warm-reconnect", delayHint: "Dia 0", delayDays: 0,
      templateName: "reativacao_opener", approvalStatus: "draft",
      messages: [{ type: "text", text: "" }], // overridden per track
      overrides: {
        rosto: [{ type: "text", text: "Oi, {nome}! Aqui é o Pedro, da Integrallys 💆‍♀️ Passei só pra matar a saudade — faz um tempinho que você não aparece por aqui e hoje lembrei de você. Fiquei pensando que já tá no ponto certo pra um retoque, pra renovar aquele seu resultado. E, se você topar, tenho uma novidade nossa pra te mostrar também ✨ Como você tá?" }],
        medidas: [{ type: "text", text: "Oi, {nome}! Aqui é o Pedro, da Integrallys 💆‍♀️ Passei só pra matar a saudade — faz um tempinho que você não aparece por aqui e hoje lembrei de você. Fiquei pensando que já tá na hora de dar aquela continuidade no seu resultado. E, se você topar, tenho uma novidade nossa pra te mostrar também ✨ Como você tá?" }],
      },
    },
    {
      id: 1, tactic: "soft-nudge", delayHint: "~Dia 3", delayDays: 3,
      templateName: "reativacao_soft_nudge", approvalStatus: "draft",
      messages: [{ type: "text", text: "Oi, {nome}! Passando de novo aqui 😊 Sei que a correria aperta. Quando sobrar um minutinho, me conta como você tá — ia adorar te ver de volta pra cuidar de você 💖" }],
    },
    {
      id: 2, tactic: "media-reengagement", delayHint: "~Dia 6", delayDays: 6,
      templateName: "reativacao_media", approvalStatus: "draft",
      messages: [{ type: "text", text: "" }],
      overrides: {
        rosto: [
          { type: "text", text: "Lembrei de você quando vi esse resultado ✨ Foi de uma paciente que voltou pra um retoque e a gente aproveitou pra realçar o rosto todo. Olha só:" },
          { type: "image", url: PLACEHOLDER_RESULT_IMG, caption: "Resultado real de uma paciente nossa 💖" },
        ],
        medidas: [
          { type: "text", text: "Lembrei de você quando vi esse resultado ✨ Foi de uma paciente que voltou pra dar continuidade e a gente conseguiu reduzir medidas e afinar o contorno. Olha só:" },
          { type: "image", url: PLACEHOLDER_RESULT_IMG, caption: "Resultado real de uma paciente nossa 💖" },
        ],
      },
    },
    {
      id: 3, tactic: "scarcity", delayHint: "~Dia 10", delayDays: 10,
      templateName: "reativacao_scarcity", approvalStatus: "draft",
      messages: [{ type: "text", text: "" }],
      overrides: {
        rosto: [{ type: "text", text: "{nome}, essa semana abri uma agenda especial de retorno, só pras nossas pacientes antigas 💆‍♀️ São pouquinhas vagas. Quer que eu separe uma pra você fazer seu retoque?" }],
        medidas: [{ type: "text", text: "{nome}, essa semana abri uma agenda especial de retorno, só pras nossas pacientes antigas 💆‍♀️ São pouquinhas vagas. Quer que eu separe uma pra você retomar seu resultado de medidas?" }],
      },
    },
    {
      id: 4, tactic: "gamified-incentive", delayHint: "~Dia 14", delayDays: 14,
      templateName: "reativacao_incentivo", approvalStatus: "draft",
      messages: [{ type: "text", text: "" }],
      overrides: {
        rosto: [
          { type: "text", text: "Tenho um mimo pra te trazer de volta 🎁 Uma cortesia no seu retorno. E, na consulta, aproveito pra te mostrar sem compromisso nosso protocolo completo de rosto. O voucher vale 48h — qual dia fica melhor pra você?" },
          { type: "image", url: PLACEHOLDER_VOUCHER_IMG, caption: "Seu mimo de retorno 💖" },
        ],
        medidas: [
          { type: "text", text: "Tenho um mimo pra te trazer de volta 🎁 Uma cortesia no seu retorno. E, na consulta, aproveito pra te mostrar sem compromisso nosso programa completo de redução de medidas. O voucher vale 48h — qual dia fica melhor pra você?" },
          { type: "image", url: PLACEHOLDER_VOUCHER_IMG, caption: "Seu mimo de retorno 💖" },
        ],
      },
    },
    {
      id: 5, tactic: "urgency-cancellation", delayHint: "~Dia 18", delayDays: 18,
      templateName: "reativacao_urgencia", approvalStatus: "draft",
      messages: [{ type: "text", text: "Oi, {nome}! Acabou de abrir um horário essa semana, por uma desistência 😍 Como faz tempo que a gente não se vê, quis te oferecer primeiro. Quer garantir ou prefere que eu deixe pra próxima da fila?" }],
    },
    {
      id: 6, tactic: "graceful-breakup", delayHint: "~Dia 21", delayDays: 21, terminal: true,
      templateName: "reativacao_despedida", approvalStatus: "draft",
      messages: [{ type: "text", text: "Vou parar de te chamar por aqui, tá? 💖 Só quero que saiba que sua vaga de retorno fica guardada com carinho. Quando quiser renovar seu resultado, é só me chamar. Um beijo, {nome}!" }],
    },
  ],
};

/** Materialize the ordered message sequence for one track (override wins over shared). */
export function resolveTrackSequence(
  funnel: ReactivationFunnel,
  track: Track,
): { id: number; delayDays: number; terminal: boolean; messages: FunnelMessage[] }[] {
  return [...funnel.steps]
    .sort((a, b) => a.delayDays - b.delayDays)
    .map((s) => ({
      id: s.id,
      delayDays: s.delayDays,
      terminal: !!s.terminal,
      messages: s.overrides?.[track] ?? s.messages,
    }));
}
