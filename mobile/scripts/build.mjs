import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await build({ entryPoints: ['src/main.js'], bundle: true, outfile: 'dist/main.js', format: 'esm', target: ['es2022'], minify: true });
await Promise.all(['index.html', 'style.css'].map(name => copyFile(`src/${name}`, `dist/${name}`)));
