import fs from 'node:fs';
import path from 'node:path';
import { SCANNED_PDF_DIR } from './config.js';

// A scanned PDF is a picture of a page, so its amounts have to be typed in by
// hand. A copy of each one is put beside the workbook and the file name in the
// sheet is made to open it, so the figures can be read off without hunting
// through the input folder.
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

    // Input folders have sub-folders, so two scans can share a file name.
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

// Last run's scans would otherwise pile up and the links in an old workbook
// would point at files this run knows nothing about.
function clearStalePdfs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue;
    try {
      fs.unlinkSync(path.join(dir, entry.name));
    } catch {
      // A file held open by a PDF viewer is not worth stopping the run for.
    }
  }
}
