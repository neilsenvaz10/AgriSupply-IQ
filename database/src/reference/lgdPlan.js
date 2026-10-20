import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  LGD_BASELINE_ISO,
  parseDistrictsReport,
  parseStatesWorkbook,
  parseUnitDetail,
  parseUnitHistory,
} from './lgdParse.js';

/**
 * Builds the reference plan of the official LGD material (Milestone 2.4, Stage 3a): the reference sets and
 * the administrative-unit version rows they contain. Reads files only (no network, no database) and keeps
 * every raw file where it is: outside Git, unchanged.
 *
 * What it will NOT do: it never infers a legal date from an LGD date, never infers which district was split
 * from which, and never invents a version it was not shown. Dates are copied as LGD shows them, with the 2005
 * baseline flagged.
 */

const LGD = 'https://lgdirectory.gov.in';
const AUTHORITY =
  'Ministry of Panchayati Raj (content owner); National Informatics Centre (host) - Local Government Directory';
const LICENCE =
  'LGD Copyright Policy: free reproduction in any format with accurate, non-misleading use and prominent source acknowledgement.';
const TERMS =
  'LGD Terms: accuracy is not guaranteed and the content is not a statement of law; verify with the State departments.';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const isoDate = (d) => d.toISOString().slice(0, 10);

/** The canonical, hashed payload of one unit row (no ids, no timestamps of ours). */
export function contentFingerprint(u) {
  return sha256(
    JSON.stringify([
      u.unitType,
      u.lgdCode,
      u.historySeq,
      u.isLatestVersion,
      u.version,
      u.minorVersion,
      u.nameEn,
      u.nameLocal,
      u.parentLgdCode,
      u.stateKind,
      u.census2001Code,
      u.census2011Code,
      u.status,
      u.lgdEffectiveDate,
      u.lgdEffectiveIsBaseline,
      u.orderNo,
      u.orderDate,
      u.gazetteDate,
      u.governmentOrderRef,
      u.sourceSha256,
    ]),
  );
}

/**
 * @param {string} dir Reference data directory (raw files; outside Git).
 * @param {{ extraParents?: Map<number, number>, fetchLog?: Map<string, { url: string, retrieved_utc: string }> }} [options]
 *        `extraParents`: state code of districts missing from the official report (for example inactive ones),
 *        taken from the registry by the caller.
 */
export function buildLgdPlan(dir, options = {}) {
  const warnings = [];
  const extraParents = options.extraParents ?? new Map();
  const logPath = join(dir, 'raw', 'lgd', 'district_pages_fetch_log.jsonl');
  const fetchLog = options.fetchLog ?? new Map();
  if (!options.fetchLog && existsSync(logPath)) {
    for (const line of readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      const entry = JSON.parse(line);
      if (entry.http_status === 200) fetchLog.set(entry.file.split('/').pop(), entry);
    }
  }
  const fileInfo = (path) => {
    const bytes = readFileSync(path);
    return { sha256: sha256(bytes), size: bytes.length, mtime: statSync(path).mtime };
  };
  const find = (re) => {
    const name = readdirSync(dir).find((f) => re.test(f));
    if (!name) throw new Error(`no file matching ${re} in ${dir}`);
    return join(dir, name);
  };

  // ------------------------------------------------------------------ the two files downloaded by hand
  const statesPath = find(/^All_Stateof_India_.*\.xlsx$/);
  const districtsPath = find(/^alldistrictbyDate.*\.xls$/);
  const statesInfo = fileInfo(statesPath);
  const districtsInfo = fileInfo(districtsPath);
  const states = parseStatesWorkbook(readFileSync(statesPath));
  const report = parseDistrictsReport(readFileSync(districtsPath, 'utf8'));
  const stateKind = new Map(states.map((s) => [s.code, s.stateKind]));
  const parentOf = new Map(report.districts.map((d) => [d.code, d.stateCode]));
  for (const [code, parent] of extraParents) if (!parentOf.has(code)) parentOf.set(code, parent);

  const baseName = (p) => p.split(/[\\/]/).pop();
  const stamp = (info) => isoDate(info.mtime).replaceAll('-', '');
  const sets = [];

  const workbookUnits = states.map((s) => ({
    unitType: 'state',
    lgdCode: s.code,
    historySeq: 1,
    isLatestVersion: true,
    version: s.version,
    minorVersion: null,
    nameEn: s.nameEn,
    nameLocal: s.nameLocal,
    parentLgdCode: null,
    stateKind: s.stateKind,
    census2001Code: s.census2001,
    census2011Code: s.census2011,
    status: 'active',
    lgdEffectiveDate: null,
    lgdEffectiveIsBaseline: false,
    legalEffectiveDate: null,
    legalEffectiveEvidence: null,
    validFromKnown: false,
    orderNo: null,
    orderDate: null,
    gazetteDate: null,
    governmentOrderRef: null,
    sourceUrl: `${LGD}/downloadDirectory.do`,
    sourceSha256: statesInfo.sha256,
    retrievedAt: statesInfo.mtime.toISOString(),
    rawRecord: s,
  }));
  sets.push({
    code: `lgd-all-states-xlsx-${stamp(statesInfo)}`,
    kind: 'lgd_snapshot',
    authority: AUTHORITY,
    sourceUrl: `${LGD}/downloadDirectory.do`,
    accessMethod: 'manual_download',
    originalFilename: baseName(statesPath),
    format: 'xlsx, sheet allStateofIndia',
    fileSha256: statesInfo.sha256,
    fingerprintKind: 'file',
    sizeBytes: statesInfo.size,
    recordCount: workbookUnits.length,
    retrievedAt: statesInfo.mtime.toISOString(),
    asOfDate: isoDate(statesInfo.mtime),
    publicationDate: null,
    publicationNote: 'Generated on request from the live directory: current data, no edition date.',
    licenceNote: LICENCE,
    termsNote: TERMS,
    notes: 'The All States report. It has a State Version column but no dates.',
    units: workbookUnits,
  });

  const districtUnits = report.districts.map((d) => ({
    unitType: 'district',
    lgdCode: d.code,
    historySeq: 1,
    isLatestVersion: true,
    version: null,
    minorVersion: null,
    nameEn: d.nameEn,
    nameLocal: null,
    parentLgdCode: d.stateCode,
    stateKind: null,
    census2001Code: d.census2001,
    census2011Code: d.census2011,
    status: 'active',
    lgdEffectiveDate: null,
    lgdEffectiveIsBaseline: false,
    legalEffectiveDate: null,
    legalEffectiveEvidence: null,
    validFromKnown: false,
    orderNo: null,
    orderDate: null,
    gazetteDate: null,
    governmentOrderRef: null,
    sourceUrl: `${LGD}/downloadDirectory.do`,
    sourceSha256: districtsInfo.sha256,
    retrievedAt: districtsInfo.mtime.toISOString(),
    rawRecord: d,
  }));
  sets.push({
    code: `lgd-all-districts-xls-${stamp(districtsInfo)}`,
    kind: 'lgd_snapshot',
    authority: AUTHORITY,
    sourceUrl: `${LGD}/downloadDirectory.do`,
    accessMethod: 'manual_download',
    originalFilename: baseName(districtsPath),
    format: 'SpreadsheetML 2003 XML saved as .xls, sheet Report',
    fileSha256: districtsInfo.sha256,
    fingerprintKind: 'file',
    sizeBytes: districtsInfo.size,
    recordCount: districtUnits.length,
    retrievedAt: districtsInfo.mtime.toISOString(),
    asOfDate: isoDate(districtsInfo.mtime),
    publicationDate: null,
    publicationNote: `${report.window ?? ''} ${report.generated ?? ''}`.trim() || null,
    licenceNote: LICENCE,
    termsNote: TERMS,
    notes:
      'The All Districts report filtered by a modification window that covers 2005 to the download date: every active district. It is not a change log: no dates, versions or status per record.',
    units: districtUnits,
  });

  // ------------------------------------------------------------------ the public detail and history pages
  /** @param {'state' | 'district'} unitType */
  const pageSet = (unitType) => {
    const folder = join(dir, 'raw', 'lgd', unitType === 'state' ? 'state_pages' : 'district_pages');
    const detailFile = (code) => join(folder, `${unitType}_${code}_detail.html`);
    const codes = readdirSync(folder)
      .map((f) => new RegExp(`^${unitType}_(\\d+)_detail\\.html$`).exec(f)?.[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b);
    const units = [];
    const manifestLines = [];
    let newest = 0;
    let loaded = 0;
    for (const code of codes) {
      const parent = unitType === 'district' ? parentOf.get(code) : null;
      if (unitType === 'district' && parent === undefined) {
        warnings.push(`district ${code}: no parent state known, its pages are not loaded`);
        continue;
      }
      const detailPath = detailFile(code);
      const historyPath = detailPath.replace('_detail.html', '_history.html');
      if (!existsSync(historyPath)) {
        warnings.push(`${unitType} ${code}: history page missing`);
        continue;
      }
      const detailHtml = readFileSync(detailPath, 'utf8');
      const historyHtml = readFileSync(historyPath, 'utf8');
      const detail = parseUnitDetail(detailHtml, unitType);
      const history = parseUnitHistory(historyHtml, unitType);
      if (history.length === 0) {
        warnings.push(`${unitType} ${code}: empty history`);
        continue;
      }
      const detailSha = sha256(detailHtml);
      const historySha = sha256(historyHtml);
      manifestLines.push(
        `${unitType}_${code}_detail.html\t${detailSha}`,
        `${unitType}_${code}_history.html\t${historySha}`,
      );
      const logged = (path) => fetchLog.get(path.split(/[\\/]/).pop());
      const retrieved = (path) => logged(path)?.retrieved_utc ?? statSync(path).mtime.toISOString();
      newest = Math.max(
        newest,
        Date.parse(retrieved(detailPath)),
        Date.parse(retrieved(historyPath)),
      );
      const endpoint =
        unitType === 'state'
          ? ['globalviewStateDetail.do?globalstateId=', 'viewStateHistoryReport.do?globalstateId=']
          : [
              'globalviewDistrictDetail.do?globaldistrictId=',
              'viewDistrictHistoryReport.do?globaldistrictId=',
            ];
      history.forEach((row, index) => {
        const latest = index === history.length - 1;
        const baseline = latest && detail.effectiveDate === LGD_BASELINE_ISO;
        const attachGo =
          latest && detail.hasGovernmentOrderFile
            ? (/([A-Za-z0-9_][A-Za-z0-9_ .()-]*\.pdf)/i.exec(detailHtml)?.[1] ?? null)
            : null;
        units.push({
          unitType,
          lgdCode: code,
          historySeq: row.seq,
          isLatestVersion: latest,
          version: row.version,
          minorVersion: latest ? detail.minorVersion : null,
          nameEn: latest && detail.nameEn ? detail.nameEn : row.nameEn,
          nameLocal: latest ? detail.nameLocal : null,
          parentLgdCode: parent,
          stateKind: unitType === 'state' ? (stateKind.get(code) ?? null) : null,
          census2001Code: latest ? detail.census2001 : null,
          census2011Code: latest ? detail.census2011 : null,
          status: row.status,
          lgdEffectiveDate: latest ? detail.effectiveDate : null,
          lgdEffectiveIsBaseline: baseline,
          legalEffectiveDate: null,
          legalEffectiveEvidence: null,
          validFromKnown: latest && detail.effectiveDate !== null && !baseline,
          orderNo: latest ? detail.orderNo : null,
          orderDate: latest ? detail.orderDate : null,
          gazetteDate: latest ? detail.gazetteDate : null,
          governmentOrderRef: attachGo,
          sourceUrl: `${LGD}/${endpoint[latest ? 0 : 1]}${code}`,
          sourceSha256: latest ? detailSha : historySha,
          retrievedAt: retrieved(latest ? detailPath : historyPath),
          rawRecord: { history: row, detail: latest ? detail : null },
        });
      });
      loaded += 1;
    }
    const manifest = manifestLines.sort().join('\n');
    return {
      code: `lgd-${unitType}-pages-${isoDate(new Date(newest || Date.now())).replaceAll('-', '')}`,
      kind: 'lgd_snapshot',
      authority: AUTHORITY,
      sourceUrl: `${LGD}/${endpoint0(unitType)}`,
      accessMethod: 'public_page',
      originalFilename: null,
      format: 'HTML detail and version-history pages (one pair per unit)',
      fileSha256: sha256(manifest),
      fingerprintKind: 'manifest',
      sizeBytes: Buffer.byteLength(manifest),
      recordCount: loaded,
      retrievedAt: new Date(newest || Date.now()).toISOString(),
      asOfDate: isoDate(new Date(newest || Date.now())),
      publicationDate: null,
      publicationNote:
        'Live public pages; the effective date shown is that of the current version only.',
      licenceNote: LICENCE,
      termsNote: TERMS,
      notes: `Fingerprint = SHA-256 of the manifest listing every page's SHA-256 (${manifestLines.length} pages). No split or merger relation is inferred.`,
      units,
    };
  };
  const endpoint0 = (unitType) =>
    unitType === 'state' ? 'globalviewStateDetail.do' : 'globalviewDistrictDetail.do';
  sets.push(pageSet('state'));
  sets.push(pageSet('district'));
  for (const set of sets) for (const u of set.units) u.contentSha256 = contentFingerprint(u);
  return { sets, warnings };
}
