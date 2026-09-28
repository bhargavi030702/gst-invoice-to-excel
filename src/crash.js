import fs from 'node:fs';
import path from 'node:path';

let currentFile = '';
let reportPath = null;

export function nowReading(file) {
  currentFile = file;
}

export function crashReportPath() {
  return reportPath;
}

// Written only when the tool itself has a bug - never for something the user
// did. One report per run; the first fault is the one worth reading.
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
    '  Error code   : E99',
    `  When         : ${new Date().toLocaleString()}`,
    `  Reading file : ${currentFile || '(not reading a file at the time)'}`,
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
    '',
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
