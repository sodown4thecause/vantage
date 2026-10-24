export type Row = Record<string, string>;

export function parseCsv(input: string): Row[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (char === "," || char === "\n") {
      record.push(field); field = ""; closed = false;
      if (char === "\n") { records.push(record); record = []; }
    } else {
      if (closed || char === '"') throw new Error("Invalid CSV quoting");
      field += char;
    }
  }
  if (quoted) throw new Error("Unterminated CSV field");
  if (field || record.length || closed) records.push([...record, field]);
  const headers = records.shift();
  if (!headers?.length || new Set(headers).size !== headers.length) throw new Error("Invalid CSV headers");
  return records.filter(row => row.some(Boolean)).map((row, index) => {
    if (row.length !== headers.length) throw new Error(`CSV record ${index + 2} has the wrong width`);
    return Object.fromEntries(headers.map((header, i) => [header, row[i].trim()]));
  });
}

export function writeCsv(headers: readonly string[], rows: Row[]): string {
  const escape = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [headers.join(","), ...rows.map(row => headers.map(header => escape(row[header] ?? "unknown")).join(","))].join("\n") + "\n";
}
