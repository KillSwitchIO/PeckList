// CSV as other apps write it (RFC 4180): fields in double quotes may hold commas, quotes (doubled)
// and line breaks. Rows end in CR LF or LF.

/** Every row of `text`, each a list of fields. A leading byte-order mark is dropped. */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Rows as CSV text: every field quoted, CR LF between rows. */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const quote = (value: string | number | null | undefined) =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;
  return rows.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n';
}

/** Rows under a header row, as records by column name (the header is the first row naming them all). */
export function recordsOf(
  rows: string[][],
  isHeader: (row: string[]) => boolean,
): Record<string, string>[] {
  const start = rows.findIndex(isHeader);
  if (start < 0) return [];
  const header = rows[start]!.map((name) => name.trim());
  return rows
    .slice(start + 1)
    .filter((row) => row.some((field) => field.trim() !== ''))
    .map((row) => Object.fromEntries(header.map((name, i) => [name, row[i] ?? ''])));
}
