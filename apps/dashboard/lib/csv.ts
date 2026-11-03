export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number;
};

const NEEDS_QUOTING = /[",\r\n]/;

function escapeField(value: string | number): string {
  const text = String(value);
  return NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// RFC 4180: CRLF record separator; a field with a comma, quote or line break is
// quoted and embedded quotes are doubled. Numbers are written raw.
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((column) => escapeField(column.header));
  const records = rows.map((row) =>
    columns.map((column) => escapeField(column.value(row))).join(","),
  );
  return [header.join(","), ...records].join("\r\n");
}
