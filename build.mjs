/**
 * Bundles the whole tool -- its own code plus pdf.js and ExcelJS -- into the
 * single file that ships next to run.bat.
 *
 * This is a development-time script. It is not needed to *run* the tool, only
 * to rebuild it after changing anything under src/.
 *
 *   npm install          (once, to get esbuild and the libraries)
 *   node build.mjs
 *
 * The result needs nothing but Node.js: no node_modules, no npm install.
 */

import { build } from 'esbuild';
import fs from 'node:fs';

const OUTFILE = 'tool.mjs';

/**
 * Three things have to be arranged before third-party code will run tidily
 * inside a single ESM file. This code is placed above the bundle, so it runs
 * before any of the libraries initialise.
 *
 *  1. ExcelJS is CommonJS and calls require() for Node built-ins, which an ESM
 *     bundle has no require() for. createRequire supplies a real one.
 *
 *  2. pdf.js looks for the browser drawing types and warns about each one it
 *     cannot find. This tool only ever reads text, never renders a page, so
 *     harmless stand-ins keep the console clean without changing behaviour.
 *
 * The build also carries a source map inside the file, so an unexpected fault
 * reports "src/parsers/foo.js:57" instead of a meaningless offset into the
 * bundle. Node only consults it when started with --enable-source-maps, which
 * is why run.bat passes that flag.
 *
 *  3. pdf.js also probes for the optional "@napi-rs/canvas" package using its
 *     own require, and prints a warning when it is absent. That package is only
 *     needed for rendering, which this tool never does -- but the message
 *     appears during start-up, before any code of ours can turn it off. The
 *     filter below drops that one message and then takes itself back out, so
 *     every other warning still reaches the user.
 */
const banner = `
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) {
  if (globalThis[name] === undefined) {
    globalThis[name] = class { constructor() { throw new Error(name + ' is not available: this build only reads text from PDFs.'); } };
  }
}
{
  const __quiet = /^Warning: Cannot (load "@napi-rs\\/canvas"|access the \`require\` function)/;
  const __log = console.log;
  const __warn = console.warn;
  console.log = (...a) => { if (!(typeof a[0] === 'string' && __quiet.test(a[0]))) __log(...a); };
  console.warn = (...a) => { if (!(typeof a[0] === 'string' && __quiet.test(a[0]))) __warn(...a); };
  // Library start-up is synchronous, so by the first timer tick it is over.
  setTimeout(() => { console.log = __log; console.warn = __warn; }, 0);
}
`.trim();

await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: OUTFILE,
  banner: { js: banner },
  legalComments: 'none',
  logLevel: 'warning',
  // Carried inside the one file, so a stack trace names the real source file
  // and line. This is what makes a fault reported months from now workable.
  sourcemap: 'inline',
  sourcesContent: false,
});

const { size } = fs.statSync(OUTFILE);
console.log(`Built ${OUTFILE} (${(size / 1024 / 1024).toFixed(1)} MB)`);
