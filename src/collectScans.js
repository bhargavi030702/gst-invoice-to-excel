/**
 * Gathers the non-selectable PDFs -- the scans, whose figures are a picture
 * rather than text -- into one folder inside output/.
 *
 * They are copied, never moved, so the input folder is left exactly as it was.
 *
 * Putting them beside the workbook is what lets the Excel links work: a link
 * written relative to the workbook keeps pointing at the right file even if the
 * whole output folder is moved or emailed on.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SCANNED_PDF_DIR } from './config.js';

/**
 * Copy every scanned PDF into output/<SCANNED_PDF_DIR>/ and record, on each
 * record, where its copy ended up.
 *
 * A file that cannot be copied is noted on that row and the run carries on --
 * a locked or vanished PDF must not cost you the other 1,200 rows.
 *
 * @param {object[]} records all results for this run
 * @param {string} inputDir folder the PDFs were read from
 * @param {string} outputDir folder the workbook is written to
 * @returns {{dir: string|null, copied: number, failed: number}}
 */
export function collectScannedPdfs(records, inputDir, outputDir) {
  const scans = records.filter((r) => r.status === 'SCANNED');
  if (scans.length === 0) return { dir: null, copied: 0, failed: 0 };

  const dir = path.join(outputDir, SCANNED_PDF_DIR);
  try {
    fs.mkdirSync(dir, { recursive: true });
    clearStalePdfs(dir);
  } catch (err) {
    for (const r of scans) {
      r.details += ` The copy of this PDF could not be made because the folder "${dir}" could not be created (${err.message}).`;
    }
    return { dir: null, copied: 0, failed: scans.length };
  }

  const used = new Set();
  let copied = 0;
  let failed = 0;

  for (const record of scans) {
    const source = path.join(inputDir, record.file);

    // Sub-folders are flattened, so two PDFs could want the same name.
    let name = path.basename(record.file);
    if (used.has(name.toLowerCase())) {
      const { name: stem, ext } = path.parse(name);
      let n = 2;
      while (used.has(`${stem} (${n})${ext}`.toLowerCase())) n += 1;
      name = `${stem} (${n})${ext}`;
    }
    used.add(name.toLowerCase());

    try {
      fs.copyFileSync(source, path.join(dir, name));
      record.scanCopy = `${SCANNED_PDF_DIR}/${name}`;
      copied += 1;
    } catch (err) {
      failed += 1;
      record.details += ` This PDF could not be copied into the "${SCANNED_PDF_DIR}" folder (${err.message}).`;
    }
  }

  return { dir, copied, failed };
}

/**
 * Drop the PDFs a previous run left here, so the folder always shows exactly
 * the scans from the run that produced the workbook beside it.
 *
 * Only .pdf files are touched -- anything else someone has put in the folder
 * is left alone -- and a file that will not delete is skipped rather than
 * being allowed to stop the run.
 */
function clearStalePdfs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue;
    try {
      fs.unlinkSync(path.join(dir, entry.name));
    } catch {
      // Open in a viewer, most likely; the copy below will overwrite it.
    }
  }
}
