import { createServer } from 'vite';
import { context } from 'esbuild';
import { spawn } from 'node:child_process';
import electron from 'electron';
const native = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/build-native.ps1'], { stdio: 'inherit', windowsHide: true });
await new Promise((resolve, reject) => native.on('exit', code => code === 0 ? resolve() : reject(new Error('Native build failed'))));
for (const [entry, outfile] of [['src/main/index.ts','dist/main/index.cjs'],['src/preload/index.ts','dist/preload/index.cjs']]) {
  const build = await context({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  await build.watch();
}
const server = await createServer();
await server.listen();
const environment = { ...process.env, BUDDY_DEV_URL: 'http://127.0.0.1:5173' };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env: environment, windowsHide: true });
child.on('exit', async () => { await server.close(); process.exit(0); });
