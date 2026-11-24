// Bundles demo/demo.ts and inlines it into demo/page.html.
// Writes docs/demo.html (standalone page) and docs/demo.artifact.html (fragment for hosts that add their own <html> skeleton).
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const result = await build({
  entryPoints: ['demo/demo.ts'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  write: false,
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = (await readFile('demo/page.html', 'utf8')).replace('/*__DEMO_JS__*/', () => js);
await mkdir('docs', { recursive: true });
await writeFile('docs/demo.artifact.html', page);
await writeFile(
  'docs/demo.html',
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}\n</body>\n</html>\n`,
);
console.log(`built docs/demo.html (${(page.length / 1024).toFixed(1)} KB)`);
