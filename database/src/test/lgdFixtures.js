import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

/**
 * SYNTHETIC LGD reference material for tests: a small zip builder, a states workbook, a districts report and
 * detail/history pages, plus `makeDirectory`, which lays them out like the real reference directory.
 */

/** Builds a small zip (deflate) in memory: just enough structure for the reader under test. */
export function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(content));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(Buffer.byteLength(content), 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(Buffer.byteLength(content), 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    central.push(dir, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

export const cell = (ref, v, shared) =>
  shared ? `<c r="${ref}" t="s"><v>${v}</v></c>` : `<c r="${ref}"><v>${v}</v></c>`;
export const STATES_XLSX = () =>
  makeZip({
    'xl/sharedStrings.xml': `<sst><si><t>All States Of India</t></si><si><t>S.No.</t></si><si><t>State Code</t></si><si><t>State Version</t></si><si><t>State Name (In English)</t></si><si><t>State Name (In Local)</t></si><si><t>Census 2001 Code</t></si><si><t>Census 2011 Code</t></si><si><t>State or UT</t></si><si><t>Synthetic State</t></si><si><t>SYNTHETIC STATE</t></si><si><t>S</t></si><si><t>Synthetic Territory</t></si><si><t>U</t></si></sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
      <row r="1">${cell('A1', 0, true)}</row>
      <row r="2">${['S.No.', 'State Code', 'State Version', 'State Name (In English)', 'State Name (In Local)', 'Census 2001 Code', 'Census 2011 Code', 'State or UT'].map((_, i) => cell(`${'ABCDEFGH'[i]}2`, i + 1, true)).join('')}</row>
      <row r="3">${cell('A3', '1.0')}${cell('B3', '990001.0')}${cell('C3', '2.0')}${cell('D3', 9, true)}${cell('E3', 10, true)}${cell('F3', '7.0')}${cell('H3', 11, true)}</row>
      <row r="4">${cell('A4', '2.0')}${cell('B4', '990002.0')}${cell('C4', '1.0')}${cell('D4', 12, true)}${cell('F4', '0.0')}${cell('G4', '0.0')}${cell('H4', 13, true)}</row>
    </sheetData></worksheet>`,
  });

export const DISTRICTS_XML = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table>
<Row><Cell><Data ss:Type="String">Local Government Directory</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">All Districts Of India</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Modification done between (From 01/01/2005 - TO 20/10/2026)</Data></Cell></Row>
<Row/>
<Row><Cell><Data ss:Type="String">District Code</Data></Cell><Cell><Data ss:Type="String">District Name(In English)</Data></Cell><Cell><Data ss:Type="String">State Code</Data></Cell><Cell><Data ss:Type="String">State Name (In English)</Data></Cell><Cell><Data ss:Type="String">Census 2001 Code</Data></Cell><Cell><Data ss:Type="String">Census 2011 Code</Data></Cell></Row>
<Row><Cell><Data ss:Type="Number">990101</Data></Cell><Cell><Data ss:Type="String">North 24 Synth &amp; Co</Data></Cell><Cell><Data ss:Type="Number">990001</Data></Cell><Cell><Data ss:Type="String">Synthetic State</Data></Cell><Cell ss:Index="6"><Data ss:Type="String">555</Data></Cell></Row>
<Row><Cell><Data ss:Type="Number">990102</Data></Cell><Cell><Data ss:Type="String">Second District</Data></Cell><Cell><Data ss:Type="Number">990002</Data></Cell><Cell><Data ss:Type="String">Synthetic Territory</Data></Cell><Cell><Data ss:Type="String">01</Data></Cell><Cell><Data ss:Type="String">02</Data></Cell></Row>
<Row><Cell><Data ss:Type="String"/></Cell></Row>
<Row><Cell><Data ss:Type="String">Oct 20, 2026, 4:39 PM</Data></Cell></Row>
</Table></Worksheet></Workbook>`;

export const detail = (
  word,
  code,
  ver,
  minor,
  nameLabel,
  name,
  orderBlock,
  census = 'Census 2001 Code 10 Census2011 Code 541',
  tail = 'State Specific Code',
) =>
  `<html><body>--&gt; Alert General Details ${word} Code ${code} ${word} Version ${ver} Minor Version ${minor} ${nameLabel} (In English) ${name} ${nameLabel} (In Local language) लोकल ${word === 'State' ? 'State Alias' : 'Alias of the District'} (In English) ${census} ${tail} Government Order Details ${orderBlock}</body></html>`;
export const history = (word, rows) =>
  `<html><body>History Details S No ${word} Code ${word} Version ${word} Name (In English) Status ${rows.map((r, i) => `${i + 1} ${r[0]} ${r[1]} ${r[2]} ${r[3]}`).join(' ')} Close</body></html>`;

/** Writes a complete synthetic reference directory. */
export function makeDirectory() {
  const dir = mkdtempSync(join(tmpdir(), 'lgd-plan-'));
  writeFileSync(join(dir, 'All_Stateof_India_test.xlsx'), STATES_XLSX());
  writeFileSync(join(dir, 'alldistrictbyDate_test.xls'), DISTRICTS_XML);
  for (const sub of ['state_pages', 'district_pages'])
    mkdirSync(join(dir, 'raw', 'lgd', sub), { recursive: true });
  const put = (kind, code, d, h) => {
    const folder = join(dir, 'raw', 'lgd', `${kind}_pages`);
    writeFileSync(join(folder, `${kind}_${code}_detail.html`), d);
    writeFileSync(join(folder, `${kind}_${code}_history.html`), h);
  };
  put(
    'state',
    990001,
    detail(
      'State',
      990001,
      2,
      1,
      'State Name',
      'Synthetic State',
      'Order No 1/99 Order Date 04/03/2014 Effective Date 17/06/2014 Gazette Publication Date 04/03/2014',
      'Census 2001 Code Census2011 Code 00',
      'Government Order Details',
    ),
    history('State', [
      [990001, 1, 'Synthetic State', 'Inactive'],
      [990001, 2, 'Synthetic State', 'Active'],
    ]),
  );
  put(
    'state',
    990002,
    detail(
      'State',
      990002,
      1,
      1,
      'State Name',
      'Synthetic Territory',
      'Order No Order Date Effective Date 01/01/2005 Gazette Publication Date No Government Order Details found',
      'Census 2001 Code Census2011 Code 00',
      'Government Order Details',
    ),
    history('State', [[990002, 1, 'Synthetic Territory', 'Active']]),
  );
  put(
    'district',
    990101,
    detail(
      'District',
      990101,
      3,
      1,
      'Name of District',
      'North 24 Synth & Co',
      'Order No 9 Order Date 01/02/2016 Effective Date 11/10/2016 Gazette Publication Date No Government Order Details found',
    ),
    history('District', [
      [990101, 1, 'Old Name', 'Inactive'],
      [990101, 1, 'Old Name', 'Inactive'],
      [990101, 3, 'North 24 Synth & Co', 'Active'],
    ]),
  );
  put(
    'district',
    990999,
    detail(
      'District',
      990999,
      1,
      1,
      'Name of District',
      'Orphan',
      'Order No Order Date Effective Date 01/01/2005 Gazette Publication Date No Government Order Details found',
    ),
    history('District', [[990999, 1, 'Orphan', 'Inactive']]),
  );
  return dir;
}
