import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("maps each data row to a header -> cell object", () => {
    const text = "id,nome\nl:1,Ana\nl:2,Bea\n";
    expect(parseCsv(text)).toEqual([
      { id: "l:1", nome: "Ana" },
      { id: "l:2", nome: "Bea" },
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    const text = 'id,nome\nl:1,"Silva, Ana"\n';
    expect(parseCsv(text)).toEqual([{ id: "l:1", nome: "Silva, Ana" }]);
  });

  it("keeps a newline inside a quoted field", () => {
    const text = 'id,nota\nl:1,"linha um\nlinha dois"\n';
    expect(parseCsv(text)).toEqual([{ id: "l:1", nota: "linha um\nlinha dois" }]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    const text = 'id,nome\nl:1,"Maria ""Mah"" Silva"\n';
    expect(parseCsv(text)).toEqual([{ id: "l:1", nome: 'Maria "Mah" Silva' }]);
  });

  it("handles CRLF line endings", () => {
    const text = "id,nome\r\nl:1,Ana\r\nl:2,Bea\r\n";
    expect(parseCsv(text)).toEqual([
      { id: "l:1", nome: "Ana" },
      { id: "l:2", nome: "Bea" },
    ]);
  });

  it("ignores a blank trailing line and works with no closing newline", () => {
    expect(parseCsv("id,nome\nl:1,Ana\n\n")).toEqual([{ id: "l:1", nome: "Ana" }]);
    expect(parseCsv("id,nome\nl:1,Ana")).toEqual([{ id: "l:1", nome: "Ana" }]);
  });

  it("returns an empty array for a header-only file", () => {
    expect(parseCsv("id,nome\n")).toEqual([]);
  });
});
