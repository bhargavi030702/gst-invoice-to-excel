// Bundles src/ and everything it needs into one tool.mjs, so the folder can be
// copied to a machine that has Node.js and nothing else and still run.
//
//   npm run build
//
// The banner at the top of the output is there because pdf.js expects to be in a
// browser: it looks for drawing objects that do not exist under Node, and it
// prints two warnings about a canvas library this build has no use for. The
// stubs give it something to find, and the filter hides the two warnings without
// hiding anything else.

import esbuild from 'esbuild';

const BANNER = `import { createRequire as __createRequire } from 'node:module';
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
}`;

await esbuild.build({
  entryPoints: ['src/index.js'],
  outfile: 'tool.mjs',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  minify: false,
  // The map is what makes a crash report name a file in src/ and a line in it
  // rather than an offset into this bundle. The source itself is not copied in:
  // it would double the size of the file, and src/ sits beside it in the folder.
  sourcemap: 'inline',
  sourcesContent: false,
  banner: { js: BANNER },
  logLevel: 'info',
});
