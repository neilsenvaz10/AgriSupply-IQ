import { createReadStream } from 'node:fs';

/**
 * Streaming, bounded-memory CSV reader (RFC 4180 style).
 *
 * Reads the file in chunks and yields one parsed record at a time, so memory use is independent
 * of the file size (only the current record and one chunk are held). Handles quoted fields,
 * doubled quotes, embedded commas and line breaks, CRLF/LF, and a UTF-8 byte-order mark.
 *
 * It never "repairs" data. A record that does not have the header's number of columns is still
 * yielded, flagged with `columnCountMismatch`, so the importer can quarantine it with its raw
 * text intact. The file is opened read-only.
 *
 * @typedef {object} CsvRecord
 * @property {number} rowNumber 1-based number of the data row (the header is row 0).
 * @property {string[]} values The raw cell texts.
 * @property {boolean} columnCountMismatch True when `values.length` differs from the header.
 */

/**
 * Opens the file, reads its header row, and returns the header together with an async generator
 * of the remaining records. The header is available immediately (no deadlock between awaiting
 * the header and consuming the records).
 *
 * @param {string} filePath
 * @param {{ encoding?: BufferEncoding, highWaterMark?: number }} [options]
 * @returns {Promise<{ header: string[], records: AsyncGenerator<CsvRecord, void, void> }>}
 */
export async function readCsv(filePath, options = {}) {
  const parsed = parse(filePath, options);
  const first = await parsed.next();
  if (first.done) return { header: [], records: parsed };
  return { header: first.value.values, records: parsed };
}

/**
 * @param {string} filePath
 * @param {{ encoding?: BufferEncoding, highWaterMark?: number }} options
 * @returns {AsyncGenerator<CsvRecord, void, void>}
 */
async function* parse(filePath, options) {
  const stream = createReadStream(filePath, {
    encoding: options.encoding ?? 'utf8',
    highWaterMark: options.highWaterMark ?? 1 << 20,
  });
  /** @type {string[]} */
  let row = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false; // just closed a quote: next char decides (quote = escaped, else end)
  let rowHasContent = false;
  let haveHeader = false;
  let columnCount = 0;
  let rowNumber = 0;
  let first = true;

  /** @returns {CsvRecord | null} */
  const endRow = () => {
    row.push(field);
    const values = row;
    const hadContent = rowHasContent || values.length > 1 || values[0] !== '';
    row = [];
    field = '';
    rowHasContent = false;
    if (!hadContent) return null; // blank line
    if (!haveHeader) {
      haveHeader = true;
      columnCount = values.length;
      return { rowNumber: 0, values, columnCountMismatch: false };
    }
    rowNumber += 1;
    return { rowNumber, values, columnCountMismatch: values.length !== columnCount };
  };

  for await (let chunk of stream) {
    if (first) {
      first = false;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
    }
    for (let i = 0; i < chunk.length; i += 1) {
      const ch = chunk[i];
      if (inQuotes) {
        if (ch === '"') {
          inQuotes = false;
          afterQuote = true;
        } else {
          field += ch;
        }
        continue;
      }
      if (afterQuote) {
        afterQuote = false;
        if (ch === '"') {
          field += '"';
          inQuotes = true;
          continue;
        }
      }
      if (ch === '"' && field === '') {
        inQuotes = true;
        rowHasContent = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        rowHasContent = true;
      } else if (ch === '\n') {
        const record = endRow();
        if (record) yield record;
      } else if (ch === '\r') {
        // swallowed; the following \n (if any) ends the row
      } else {
        field += ch;
        rowHasContent = true;
      }
    }
  }
  if (inQuotes) {
    // An unterminated quote swallowed the rest of the file: surface it as a final broken row.
    const record = endRow();
    if (record) yield { ...record, columnCountMismatch: true };
  } else if (rowHasContent || field !== '' || row.length > 0) {
    const record = endRow();
    if (record) yield record;
  }
}
