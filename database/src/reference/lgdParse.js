import { inflateRawSync } from 'node:zlib';

/**
 * Parsers for the OFFICIAL LGD (Local Government Directory) material acquired in Milestone 2.4:
 *
 *   - the "All States Of India" workbook (xlsx),
 *   - the "All Districts Of India" report (SpreadsheetML 2003 XML saved with an .xls extension),
 *   - the public per-state and per-district detail and version-history pages (HTML).
 *
 * Pure functions on bytes or text: no file system, no network, no database. Nothing is guessed: a field the
 * source does not show stays null. In particular a split or merger relationship between districts is never
 * inferred, and the effective date shown for a version is reported as LGD shows it.
 */

/** LGD's default effective date for units that predate its own records. It is not a legal date. */
export const LGD_BASELINE_ISO = '2005-01-01';

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&mdash;': '-',
  '&ndash;': '-',
};

/** @param {string} text */
export function decodeEntities(text) {
  return text
    .replace(/&(?:amp|lt|gt|quot|nbsp|mdash|ndash|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Visible text of an HTML page: no scripts, styles or tags, whitespace collapsed. */
export function htmlToText(html) {
  return decodeEntities(
    html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** `dd/mm/yyyy` as LGD writes it, to an ISO date; null for anything else (never guessed). */
export function lgdDateToIso(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((text ?? '').trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo}-${d}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

const blankToNull = (s) => {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
};

// ---------------------------------------------------------------------------------- xlsx (zip + xml)

/**
 * Minimal zip reader (stored and deflated entries) using only the standard library.
 *
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>}
 */
export function readZipEntries(buffer) {
  const END = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i -= 1) {
    if (buffer.readUInt32LE(i) === END) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  /** @type {Map<string, Buffer>} */
  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(start, start + compressedSize);
    entries.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const xmlText = (fragment) => decodeEntities(fragment.replace(/<[^>]+>/g, ''));

/** Column letters ("B", "AA") to a zero-based index. */
const columnIndex = (ref) =>
  [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

/**
 * Cell text of the first sheet of an xlsx file, row by row.
 *
 * @param {Buffer} buffer
 * @returns {string[][]}
 */
export function readXlsxRows(buffer) {
  const entries = readZipEntries(buffer);
  const sheet = entries.get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('the workbook has no first sheet');
  const shared = [];
  const sharedXml = entries.get('xl/sharedStrings.xml');
  if (sharedXml)
    for (const si of sharedXml.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g))
      shared.push(xmlText(si[1]));
  const rows = [];
  for (const row of sheet.toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    /** @type {string[]} */
    const cells = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cell[1])?.[1];
      const type = /\bt="([^"]+)"/.exec(cell[1])?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(cell[2] ?? '')?.[1];
      const inline = /<is>([\s\S]*?)<\/is>/.exec(cell[2] ?? '')?.[1];
      const text =
        type === 's' && value !== undefined
          ? (shared[Number(value)] ?? '')
          : inline !== undefined
            ? xmlText(inline)
            : decodeEntities(value ?? '');
      const at = ref ? columnIndex(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = text;
    }
    rows.push(cells);
  }
  return rows;
}

/** `35.0` (how the workbook writes integers) to `35`; anything else is returned as text. */
const wholeNumber = (s) =>
  /^\d+(\.0+)?$/.test((s ?? '').trim()) ? String(Number(s)) : blankToNull(s);

/**
 * The "All States Of India" workbook.
 *
 * @param {Buffer} buffer
 */
export function parseStatesWorkbook(buffer) {
  const rows = readXlsxRows(buffer);
  const header = rows.findIndex((r) => r.some((c) => /^State Code$/i.test(c.trim())));
  if (header < 0) throw new Error('the states workbook has no "State Code" header');
  const cols = Object.fromEntries(rows[header].map((c, i) => [c.trim().toLowerCase(), i]));
  const at = (r, name) => r[cols[name]] ?? '';
  const states = [];
  for (const r of rows.slice(header + 1)) {
    const code = wholeNumber(at(r, 'state code'));
    if (code === null) continue;
    states.push({
      code: Number(code),
      version: Number(wholeNumber(at(r, 'state version'))),
      nameEn: at(r, 'state name (in english)').trim(),
      nameLocal: blankToNull(at(r, 'state name (in local)')),
      census2001: wholeNumber(at(r, 'census 2001 code')),
      census2011: wholeNumber(at(r, 'census 2011 code')),
      stateKind: /^u/i.test(at(r, 'state or ut').trim()) ? 'union_territory' : 'state',
    });
  }
  return states;
}

// ---------------------------------------------------------------------------------- SpreadsheetML

/**
 * The "All Districts Of India" report (SpreadsheetML 2003 XML).
 *
 * @param {string} xml
 */
export function parseDistrictsReport(xml) {
  /** @type {string[][]} */
  const rows = [];
  for (const row of xml.matchAll(/<(?:ss:)?Row\b[^>]*>([\s\S]*?)<\/(?:ss:)?Row>/g)) {
    /** @type {string[]} */
    const cells = [];
    for (const cell of row[1].matchAll(
      /<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/g,
    )) {
      const index = /ss:Index="(\d+)"/.exec(cell[1])?.[1];
      if (index) while (cells.length < Number(index) - 1) cells.push('');
      const data = /<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/.exec(cell[2] ?? '');
      cells.push(data ? xmlText(data[1]).trim() : '');
    }
    rows.push(cells);
  }
  const header = rows.findIndex((r) => r[0] === 'District Code');
  if (header < 0) throw new Error('the districts report has no "District Code" header');
  const window =
    rows.map((r) => r[0] ?? '').find((t) => /^Modification done between/i.test(t)) ?? null;
  const generated =
    rows.map((r) => r[0] ?? '').find((t) => /^[A-Z][a-z]{2} \d{1,2}, \d{4}/.test(t)) ?? null;
  const districts = rows
    .slice(header + 1)
    .filter((r) => r.length >= 6 && /^\d+$/.test(r[0]))
    .map((r) => ({
      code: Number(r[0]),
      nameEn: r[1],
      stateCode: Number(r[2]),
      stateName: r[3],
      census2001: blankToNull(r[4]),
      census2011: blankToNull(r[5]),
    }));
  return { districts, window, generated };
}

// ---------------------------------------------------------------------------------- HTML pages

const DATE = '(\\d{2}/\\d{2}/\\d{4})?';

/** Text between two labels on a page, or null when either is missing or nothing is between them. */
const between = (text, from, to) => {
  const start = text.indexOf(from);
  if (start < 0) return null;
  const rest = text.slice(start + from.length);
  const end = to ? rest.indexOf(to) : -1;
  return blankToNull(end < 0 ? rest : rest.slice(0, end));
};

/**
 * A public detail page of a state (`globalviewStateDetail.do`) or district (`globalviewDistrictDetail.do`).
 *
 * @param {string} html
 * @param {'state' | 'district'} unitType
 */
export function parseUnitDetail(html, unitType) {
  const text = htmlToText(html);
  const word = unitType === 'state' ? 'State' : 'District';
  const head = new RegExp(`${word} Code (\\d+) ${word} Version (\\d+) Minor Version (\\d+)`).exec(
    text,
  );
  if (!head) throw new Error(`not a ${unitType} detail page`);
  const nameLabel = unitType === 'state' ? 'State Name' : 'Name of District';
  const nameEn =
    between(text, `${nameLabel} (In English)`, `${nameLabel} (In Local language)`) ?? '';
  const aliasLabel = unitType === 'state' ? 'State Alias' : 'Alias of the District';
  const nameLocal = between(text, `${nameLabel} (In Local language)`, aliasLabel);
  const census2001 = between(text, 'Census 2001 Code', 'Census2011 Code');
  const census2011 = between(
    text,
    'Census2011 Code',
    unitType === 'state' ? 'Government Order Details' : 'State Specific Code',
  );
  const order = new RegExp(
    `Order No ?(.*?) ?Order Date ?${DATE} ?Effective Date ?${DATE} ?Gazette Publication Date ?${DATE}`,
  ).exec(text);
  return {
    code: Number(head[1]),
    version: Number(head[2]),
    minorVersion: Number(head[3]),
    nameEn,
    nameLocal,
    census2001,
    census2011,
    orderNo: blankToNull(order?.[1]),
    orderDate: lgdDateToIso(order?.[2] ?? ''),
    effectiveDate: lgdDateToIso(order?.[3] ?? ''),
    gazetteDate: lgdDateToIso(order?.[4] ?? ''),
    hasGovernmentOrderFile: !/No Government Order Details found/.test(text) && /\.pdf/i.test(html),
  };
}

/**
 * A public version-history page (`viewStateHistoryReport.do`, `viewDistrictHistoryReport.do`): one row per
 * version, in the order LGD lists them. The version number can repeat (minor versions are not shown).
 *
 * @param {string} html
 * @param {'state' | 'district'} unitType
 */
export function parseUnitHistory(html, unitType) {
  const text = htmlToText(html);
  const word = unitType === 'state' ? 'State' : 'District';
  const at = text.indexOf(`${word} Code ${word} Version`);
  if (at < 0) throw new Error(`not a ${unitType} history page`);
  const body = text
    .slice(at)
    .replace(new RegExp(`^${word} Code ${word} Version ${word} Name \\(In English\\) Status`), '');
  const rows = [];
  for (const m of body.matchAll(
    /(\d+) (\d+) (\d+) (.+?) (Active|Inactive)(?= \d+ \d+ \d+ |\s*(?:Close|$))/g,
  )) {
    rows.push({
      seq: Number(m[1]),
      code: Number(m[2]),
      version: Number(m[3]),
      nameEn: m[4].trim(),
      status: m[5].toLowerCase(),
    });
  }
  return rows;
}
