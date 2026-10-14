import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
await build({ entryPoints: ['src/services/providers.ts'], outfile: 'artifacts/providers.mjs', bundle: true, platform: 'node', format: 'esm' });
const { FreeDictionary, WiktionaryTranslation } = await import(pathToFileURL(resolve('artifacts/providers.mjs')).href);
const results = await Promise.allSettled([new FreeDictionary().lookup('consistent'), new WiktionaryTranslation().translate('consistent')]);
for (let i = 0; i < results.length; i++) {
  const result = results[i];
  console.log(JSON.stringify({ provider: i ? 'Russian translation' : 'Free Dictionary', status: result.status, ...(result.status === 'fulfilled' ? { data: result.value } : { error: result.reason.message }) }, null, 2));
}
if (results.some(result => result.status === 'rejected')) process.exitCode = 1;
