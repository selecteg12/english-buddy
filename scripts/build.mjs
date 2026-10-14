import { build as bundle } from 'esbuild';
import { build as renderer } from 'vite';
import { mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await bundle({ entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs', bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'] });
await bundle({ entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs', bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'] });
await renderer();
