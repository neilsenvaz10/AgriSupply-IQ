import { createHash } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISTRICTS_XML, STATES_XLSX, detail, history, makeDirectory } from '../test/lgdFixtures.js';
import { buildLgdPlan, contentFingerprint, sha256 } from './lgdPlan.js';
import {
  LGD_BASELINE_ISO,
  decodeEntities,
  htmlToText,
  lgdDateToIso,
  parseDistrictsReport,
  parseStatesWorkbook,
  parseUnitDetail,
  parseUnitHistory,
  readZipEntries,
} from './lgdParse.js';

/**
 * Parsers and plan builder for the official LGD material. SYNTHETIC fixtures only (no network, no database).
 * The real files are checked by the last describe block, which runs only when FASALYTICS_REFERENCE_DIR points
 * at the (outside-Git) reference directory.
 */

describe('text helpers', () => {
  it('decodes entities and keeps all visible page text, even after a stray comment terminator', () => {
    expect(decodeEntities('A &amp; B&nbsp;C &mdash; D')).toBe('A & B C - D');
    const page =
      '<html>--> stray <script>x()</script><style>p{}</style><p>Visible   text</p> --></html>';
    expect(htmlToText(page)).toBe('--> stray Visible text -->');
  });

  it('turns LGD dates into ISO dates and refuses anything else', () => {
    expect(lgdDateToIso('11/10/2016')).toBe('2016-10-11');
    expect(lgdDateToIso(' 01/01/2005 ')).toBe(LGD_BASELINE_ISO);
    for (const bad of ['31/02/2020', '2016-10-11', '', null, undefined, '1/1/2005'])
      expect(lgdDateToIso(bad)).toBeNull();
  });
});

describe('the xlsx and SpreadsheetML readers', () => {
  it('reads a zip and the states workbook (integers written as 35.0, units flagged, blanks kept null)', () => {
    expect([...readZipEntries(STATES_XLSX()).keys()]).toEqual([
      'xl/sharedStrings.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    const states = parseStatesWorkbook(STATES_XLSX());
    expect(states).toEqual([
      {
        code: 990001,
        version: 2,
        nameEn: 'Synthetic State',
        nameLocal: 'SYNTHETIC STATE',
        census2001: '7',
        census2011: null,
        stateKind: 'state',
      },
      {
        code: 990002,
        version: 1,
        nameEn: 'Synthetic Territory',
        nameLocal: null,
        census2001: '0',
        census2011: '0',
        stateKind: 'union_territory',
      },
    ]);
    expect(() => parseStatesWorkbook(Buffer.from('not a zip at all'))).toThrow(/zip/);
  });

  it('reads the districts report, its modification window and its footer; rows without codes are ignored', () => {
    const report = parseDistrictsReport(DISTRICTS_XML);
    expect(report.window).toBe('Modification done between (From 01/01/2005 - TO 20/10/2026)');
    expect(report.generated).toBe('Oct 20, 2026, 4:39 PM');
    expect(report.districts).toEqual([
      {
        code: 990101,
        nameEn: 'North 24 Synth & Co',
        stateCode: 990001,
        stateName: 'Synthetic State',
        census2001: null,
        census2011: '555',
      },
      {
        code: 990102,
        nameEn: 'Second District',
        stateCode: 990002,
        stateName: 'Synthetic Territory',
        census2001: '01',
        census2011: '02',
      },
    ]);
    expect(() => parseDistrictsReport('<Workbook/>')).toThrow(/District Code/);
  });
});

describe('detail and history pages', () => {
  it('reads a district detail with a dated order, and one with blanks (nothing is guessed)', () => {
    const withOrder = parseUnitDetail(
      detail(
        'District',
        509,
        5,
        1,
        'Name of District',
        'Khammam',
        'Order No G.O.MS.No. 19 Order Date 05/02/2019 Effective Date 19/02/2019 Gazette Publication Date 20/02/2019 File Name x.pdf',
      ),
      'district',
    );
    expect(withOrder).toMatchObject({
      code: 509,
      version: 5,
      minorVersion: 1,
      nameEn: 'Khammam',
      census2001: '10',
      census2011: '541',
      orderNo: 'G.O.MS.No. 19',
      orderDate: '2019-02-05',
      effectiveDate: '2019-02-19',
      gazetteDate: '2019-02-20',
    });
    const blank = parseUnitDetail(
      detail(
        'District',
        7,
        1,
        1,
        'Name of District',
        'Plain',
        'Order No Order Date Effective Date 01/01/2005 Gazette Publication Date No Government Order Details found',
      ),
      'district',
    );
    expect(blank).toMatchObject({
      orderNo: null,
      orderDate: null,
      effectiveDate: '2005-01-01',
      gazetteDate: null,
      hasGovernmentOrderFile: false,
    });
    expect(() => parseUnitDetail('<html>nothing</html>', 'district')).toThrow(/district detail/);
  });

  it('reads a state detail, including a blank Census 2001 code', () => {
    const state = parseUnitDetail(
      detail(
        'State',
        36,
        1,
        1,
        'State Name',
        'Telangana',
        'Order No 33004/99 Order Date 04/03/2014 Effective Date 17/06/2014 Gazette Publication Date 04/03/2014 File Name g.pdf',
        'Census 2001 Code Census2011 Code 00',
        'Government Order Details',
      ),
      'state',
    );
    expect(state).toMatchObject({
      code: 36,
      nameEn: 'Telangana',
      census2001: null,
      census2011: '00',
      effectiveDate: '2014-06-17',
    });
  });

  it('reads a version history in the order listed, with repeated version numbers and names that contain digits', () => {
    const rows = parseUnitHistory(
      history('District', [
        [303, 1, '24 Paraganas North', 'Inactive'],
        [303, 2, 'Parganas 24 North', 'Inactive'],
        [303, 2, 'North 24 Parganas', 'Active'],
      ]),
      'district',
    );
    expect(rows).toEqual([
      { seq: 1, code: 303, version: 1, nameEn: '24 Paraganas North', status: 'inactive' },
      { seq: 2, code: 303, version: 2, nameEn: 'Parganas 24 North', status: 'inactive' },
      { seq: 3, code: 303, version: 2, nameEn: 'North 24 Parganas', status: 'active' },
    ]);
    expect(() => parseUnitHistory('<html>x</html>', 'state')).toThrow(/state history/);
  });
});

describe('the reference plan (synthetic directory)', () => {
  it('builds four reference sets with fingerprints, flags the LGD baseline and never sets a legal date', () => {
    const dir = makeDirectory();
    try {
      const plan = buildLgdPlan(dir);
      expect(
        plan.sets.map((s) => [s.kind, s.accessMethod, s.fingerprintKind, s.recordCount]),
      ).toEqual([
        ['lgd_snapshot', 'manual_download', 'file', 2],
        ['lgd_snapshot', 'manual_download', 'file', 2],
        ['lgd_snapshot', 'public_page', 'manifest', 2],
        ['lgd_snapshot', 'public_page', 'manifest', 1],
      ]);
      for (const set of plan.sets) expect(set.fileSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(new Set(plan.sets.map((s) => s.fileSha256)).size).toBe(4);
      expect(plan.warnings).toEqual([
        'district 990999: no parent state known, its pages are not loaded',
      ]);

      const statePages = plan.sets[2];
      const latest = statePages.units.filter((u) => u.isLatestVersion);
      expect(latest.map((u) => u.lgdCode)).toEqual([990001, 990002]);
      const territory = latest.find((u) => u.lgdCode === 990002);
      expect(territory).toMatchObject({
        lgdEffectiveDate: '2005-01-01',
        lgdEffectiveIsBaseline: true,
        validFromKnown: false,
        stateKind: 'union_territory',
      });
      const state = latest.find((u) => u.lgdCode === 990001);
      expect(state).toMatchObject({
        lgdEffectiveDate: '2014-06-17',
        lgdEffectiveIsBaseline: false,
        validFromKnown: true,
        orderNo: '1/99',
      });
      for (const u of plan.sets.flatMap((s) => s.units)) {
        expect(u.legalEffectiveDate, `${u.unitType} ${u.lgdCode}`).toBeNull();
        expect(u.contentSha256).toBe(contentFingerprint(u));
      }
      // an older version is listed but carries no date (LGD shows the date of the current version only)
      const older = statePages.units.find((u) => u.lgdCode === 990001 && !u.isLatestVersion);
      expect(older).toMatchObject({
        lgdEffectiveDate: null,
        validFromKnown: false,
        status: 'inactive',
      });

      const districtPages = plan.sets[3];
      expect(districtPages.units.map((u) => [u.historySeq, u.version, u.isLatestVersion])).toEqual([
        [1, 1, false],
        [2, 1, false],
        [3, 3, true],
      ]); // the repeated version 1 keeps its own sequence
      expect(districtPages.units.every((u) => u.parentLgdCode === 990001)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is deterministic: the same files give the same fingerprints and content hashes', () => {
    const dir = makeDirectory();
    try {
      const a = buildLgdPlan(dir);
      const b = buildLgdPlan(dir);
      expect(a.sets.map((s) => s.fileSha256)).toEqual(b.sets.map((s) => s.fileSha256));
      expect(a.sets.flatMap((s) => s.units.map((u) => u.contentSha256))).toEqual(
        b.sets.flatMap((s) => s.units.map((u) => u.contentSha256)),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes the parent of a district missing from the report from the caller (never guesses it)', () => {
    const dir = makeDirectory();
    try {
      const plan = buildLgdPlan(dir, { extraParents: new Map([[990999, 990002]]) });
      expect(plan.warnings).toEqual([]);
      expect(plan.sets[3].units.find((u) => u.lgdCode === 990999)).toMatchObject({
        parentLgdCode: 990002,
        status: 'inactive',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an LGD error page as unresolved, even when the registry offers a parent, and loads nothing for it', () => {
    const dir = makeDirectory();
    try {
      const folder = join(dir, 'raw', 'lgd', 'district_pages');
      const error =
        '<label>Ooops!!! <i class="x"></i></label><div><label>Something went wrong.</label></div><label>Error ID 1</label>';
      writeFileSync(join(folder, 'district_990888_detail.html'), error);
      writeFileSync(join(folder, 'district_990888_history.html'), '<html></html>');
      const plan = buildLgdPlan(dir, { extraParents: new Map([[990888, 990002]]) });
      expect(plan.unresolved).toEqual({ [plan.sets[3].code]: [990888] });
      expect(plan.warnings.filter((w) => /990888.*unresolved/.test(w))).toHaveLength(1);
      expect(plan.sets[3].units.some((u) => u.lgdCode === 990888)).toBe(false);
      expect(plan.sets[3].notes).toMatch(/Unresolved, not loaded.*990888/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const REAL = process.env.FASALYTICS_REFERENCE_DIR;
describe.runIf(Boolean(REAL && existsSync(REAL)))(
  'the real official files (outside Git; skipped when absent)',
  () => {
    it('match the recorded fingerprints and the counts reported in docs/geography', () => {
      const plan = buildLgdPlan(/** @type {string} */ (REAL));
      const [states, districts, statePages, districtPages] = plan.sets;
      expect(states.fileSha256).toBe(
        '108f75e927bdec4defe8a57a693ff378318967ebaf0b555afcaed93c69213ad2',
      );
      expect(districts.fileSha256).toBe(
        '442cfd9700c201128ff646b025bb6f1f71bb039f65f50e97056e5306d82a36a1',
      );
      expect(states.units).toHaveLength(36);
      expect(districts.units).toHaveLength(784);
      expect(new Set(districts.units.map((u) => u.lgdCode)).size).toBe(784);
      expect(statePages.recordCount).toBe(36);
      expect(districtPages.recordCount).toBeGreaterThanOrEqual(88);
      const telangana = statePages.units.find((u) => u.lgdCode === 36 && u.isLatestVersion);
      expect(telangana).toMatchObject({
        lgdEffectiveDate: '2014-06-17',
        lgdEffectiveIsBaseline: false,
        orderNo: '33004/99',
        legalEffectiveDate: null,
      });
      expect(
        statePages.units.filter((u) => u.lgdEffectiveIsBaseline && u.isLatestVersion).length,
      ).toBe(31); // LGD's 2005 baseline: not a legal date
      expect(sha256('x')).toHaveLength(64);
      expect(createHash('sha256').update('x').digest('hex')).toBe(sha256('x'));
    });
  },
);
