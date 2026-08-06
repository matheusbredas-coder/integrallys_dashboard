// A small, quote-aware CSV parser for the leads-import feature. Hand-rolled rather than a
// dependency, matching how this codebase already hand-rolls its other parsers (see
// email-parse.ts). Only what a Meta Ads Manager lead export needs: quoted fields (with
// embedded commas/newlines and "" as an escaped quote), CRLF or LF line endings, and a
// tolerant read of blank lines.

/** Splits raw CSV text into rows of raw cell strings, quote-aware. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1; // swallow; the following \n (or end of text) closes the row
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  // Text that doesn't end on a newline still has one pending field/row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Parses CSV text into header -> cell objects, one per data row.
 *
 * The first row is the header; a row is skipped when every one of its cells is blank
 * (this is what makes a trailing blank line a no-op instead of an empty-string data row).
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const [header, ...dataRows] = rows;
  return dataRows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const obj: Record<string, string> = {};
      header.forEach((label, index) => {
        obj[label] = row[index] ?? "";
      });
      return obj;
    });
}
