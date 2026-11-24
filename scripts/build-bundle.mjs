// Builds a single-file browser bundle (window.Nodemap) next to the ESM output from tsc.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'Nodemap',
  minify: true,
  sourcemap: true,
  target: 'es2020',
  outfile: 'dist/nodemap.iife.js',
});
console.log('built dist/nodemap.iife.js');
