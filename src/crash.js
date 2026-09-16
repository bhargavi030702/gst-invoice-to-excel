/**
 * Crash reporting.
 *
 * If the tool ever hits a fault it does not expect, the person running it sees
 * a short, calm message, and a full report is written to the output folder for
 * whoever has to fix it.
 *
 * The report is the thing that makes a future failure workable: it names the
 * exact source file and line (the bundle carries a source map, so the trace
 * points at src/, not at the 5 MB built file), the PDF being read at the time,
 * and the machine it happened on.
 */

import fs from 'node:fs';
import path from 'node:path';

/** The PDF currently being read, so a crash can say which one caused it. */
let currentFile = '';

/**
 * Where this run's report was written.
 *
 * A bug in a parser would otherwise write one report per PDF and bury the
 * folder, so only the first is kept -- they would all say the same thing.
 */
let reportPath = null;

/** Called before each PDF is opened. */
export function nowReading(file) {
  currentFile = file;
}

/** The report written during this run, if any. */
export function crashReportPath() {
  return reportPath;
}

/**
 * Write a crash report next to the other output.
 * @param {unknown} err the thrown value
 * @param {string} outputDir where to write
 * @returns {string|null} the path written, or null if even that failed
 */
export function writeCrashReport(err, outputDir) {
  if (reportPath) return reportPath;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(outputDir, `CRASH_${stamp}.log`);

  const lines = [
    '================================================================',
    '  CRASH REPORT',
    '================================================================',
    '',
    '  Something inside the tool went wrong that it did not expect.',
    '  This is a bug, not something you did.',
    '',
    '  Send this whole file to whoever maintains the tool. Everything',
    '  needed to find the cause is below.',
    '',
    '================================================================',
    '  WHAT HAPPENED',
    '================================================================',
    '',
    `  Error code   : E99`,
    `  When         : ${new Date().toLocaleString()}`,
    `  Reading file : ${currentFile || '(not reading a PDF at the time)'}`,
    `  Message      : ${(err && err.message) || String(err)}`,
    '',
    '================================================================',
    '  WHERE IN THE CODE',
    '================================================================',
    '',
    '  Top line is where it broke. Paths point into src/, so the file',
    '  and line number can be opened directly.',
    '',
  ];

  const stack = err && err.stack ? String(err.stack) : '(no stack trace available)';
  for (const line of stack.split('\n')) lines.push('  ' + line);

  lines.push(
    '',
    '================================================================',
    '  THIS COMPUTER',
    '================================================================',
    '',
    `  Node.js  : ${process.version}`,
    `  Platform : ${process.platform} ${process.arch}`,
    `  Folder   : ${process.cwd()}`,
    ''
  );

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(target, lines.join('\r\n'), 'utf8');
    reportPath = target;
    return target;
  } catch {
    return null;
  }
}
