import { describe, it, expect } from "vitest";
import { leadNeighbourhood, leadWeightGoal } from "./form-answers";

describe("leadNeighbourhood", () => {
  it("reads the question however it is worded", () => {
    expect(leadNeighbourhood({ "Qual seu bairro?": "Praia da Costa" })).toBe("Praia da Costa");
    expect(leadNeighbourhood({ "Em qual bairro você mora?": "Itapuã" })).toBe("Itapuã");
    expect(leadNeighbourhood({ Bairro: "Jardim Camburi" })).toBe("Jardim Camburi");
    expect(leadNeighbourhood({ "BAIRRO_ONDE_MORA": "Centro" })).toBe("Centro");
  });

  it("is null when the form never asked", () => {
    expect(leadNeighbourhood({ "Nome completo": "Ana", Telefone: "27999999999" })).toBeNull();
  });

  it("treats a blank answer as no answer", () => {
    expect(leadNeighbourhood({ Bairro: "   " })).toBeNull();
  });

  it("survives a missing or malformed raw", () => {
    expect(leadNeighbourhood(null)).toBeNull();
    expect(leadNeighbourhood(undefined)).toBeNull();
    expect(leadNeighbourhood({})).toBeNull();
  });
});

describe("leadWeightGoal", () => {
  it("reads the question however it is worded", () => {
    expect(leadWeightGoal({ "Quantos quilos você quer perder?": "10kg" })).toBe("10kg");
    expect(leadWeightGoal({ "Quanto peso você deseja perder?": "uns 15 quilos" })).toBe("uns 15 quilos");
    expect(leadWeightGoal({ "Quantos quilos gostaria de eliminar?": "20" })).toBe("20");
    expect(leadWeightGoal({ "Quantos quilos?": "8" })).toBe("8");
    expect(leadWeightGoal({ "Meta de emagrecimento": "12 kg" })).toBe("12 kg");
  });

  it("keeps the answer verbatim — it is a human's words, not a number", () => {
    expect(leadWeightGoal({ "Quantos quilos você quer perder?": "não sei, uns 5 ou 6" }))
      .toBe("não sei, uns 5 ou 6");
  });

  // The whole reason the patterns demand a verb of losing.
  it("never reads the lead's CURRENT weight as her goal", () => {
    expect(leadWeightGoal({ "Qual seu peso atual?": "92kg" })).toBeNull();
    expect(leadWeightGoal({ "Peso": "92kg" })).toBeNull();
    expect(leadWeightGoal({ "Qual seu peso hoje?": "92kg" })).toBeNull();
  });

  it("picks the goal, not the current weight, when the form asks both", () => {
    expect(
      leadWeightGoal({
        "Qual seu peso atual?": "92kg",
        "Quantos quilos você quer perder?": "15kg",
      })
    ).toBe("15kg");
  });

  it("is null when the form never asked", () => {
    expect(leadWeightGoal({ "Nome completo": "Ana", Bairro: "Centro" })).toBeNull();
  });
});

describe("the two together", () => {
  it("pulls both out of one real-looking submission", () => {
    const raw = {
      "Nome completo": "Ana Souza",
      "Telefone celular": "27999998888",
      "Em qual bairro você mora?": "Praia da Costa",
      "Quantos quilos você quer perder?": "12kg",
    };
    expect(leadNeighbourhood(raw)).toBe("Praia da Costa");
    expect(leadWeightGoal(raw)).toBe("12kg");
  });

  it("does not confuse one question for the other", () => {
    const raw = { "Em qual bairro você mora?": "Centro" };
    expect(leadWeightGoal(raw)).toBeNull();
    expect(leadNeighbourhood({ "Quantos quilos você quer perder?": "12kg" })).toBeNull();
  });
});
