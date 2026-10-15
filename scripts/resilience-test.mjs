import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve('artifacts'); await mkdir(root, { recursive: true });
const packaged = process.argv.includes('--packaged');
const prefix = packaged ? 'packaged-' : '';
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const report = [], tunnels = new Set(), connections = new Set();
const hosts = new Set(['api.dictionaryapi.dev', 'en.wiktionary.org', 'api.datamuse.com', 'api.mymemory.translated.net']);
const proxy = createServer((_request, response) => { response.writeHead(405); response.end(); });
proxy.on('connect', (request, client, head) => {
  const target = new URL(`https://${request.url}`);
  if (!hosts.has(target.hostname) || (target.port && target.port !== '443')) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const upstream = connect({ host: target.hostname, port: 443 });
  for (const socket of [client, upstream]) { connections.add(socket); socket.once('close', () => connections.delete(socket)); socket.on('error', () => { client.destroy(); upstream.destroy(); }); socket.setTimeout(10000, () => socket.destroy()); }
  upstream.once('connect', () => { tunnels.add(target.hostname); client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
});
await new Promise(resolvePromise => proxy.listen(0, '127.0.0.1', resolvePromise));
let app;
try {
  const dataArgument = `--buddy-data=${resolve(root, `${prefix}resilience-data-${Date.now()}`)}`;
  app = await electron.launch({ ...(packaged ? { executablePath: resolve('release/win-unpacked/English Buddy.exe'), args: [dataArgument] } : { args: ['.', dataArgument] }), env });
  if (packaged) expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
  await expect.poll(() => app.windows().length).toBe(3);
  const settings = app.windows().find(page => page.url().includes('view=settings'));
  const popup = app.windows().find(page => page.url().includes('view=popup'));
  await settings.evaluate(() => window.buddy.settings({ monitoring: false, shortcut: false, popupTimeout: 0 }));
  await app.evaluate(async ({ session }, port) => {
    await session.defaultSession.setProxy({ proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
    // Only this isolated app session is affected. TLS remains end to end.
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://api.dictionaryapi.dev/*', 'https://en.wiktionary.org/api/rest_v1/*'] }, (details, callback) => {
      if (new URL(details.url).hostname === 'api.dictionaryapi.dev') callback({ cancel: true });
      else setTimeout(() => callback({ cancel: false }), 1800);
    });
  }, proxy.address().port);
  await popup.evaluate(() => {
    window.__lookupTimings = { start: Date.now() };
    window.buddy.subscribe(state => {
      const time = window.__lookupTimings;
      if (state.popup.entry?.translation && !time.translation) time.translation = Date.now();
      if (state.popup.entry?.definition && !time.definition) time.definition = Date.now();
    });
  });
  await settings.getByLabel('Look up an English word').fill('consistent');
  await settings.getByRole('button', { name: 'Look up', exact: false }).click();
  await expect(popup.locator('.meaning')).toContainText(/[а-яё]/i, { timeout: 8000 });
  const partial = await popup.evaluate(() => window.buddy.getState());
  expect(partial.popup.status).toBe('loading'); expect(partial.popup.pending).toContain('definition');
  await expect(popup.locator('.loading')).toHaveCount(0);
  await popup.screenshot({ path: resolve(root, `${prefix}resilience-ru.png`), omitBackground: true });
  report.push('PASS: Russian translation is visible while the English definition is still loading');
  await popup.getByRole('button', { name: 'EN Definition' }).click();
  await expect(popup.locator('.meaning')).toContainText('Finding English definition');
  await expect.poll(() => popup.evaluate(async () => (await window.buddy.getState()).popup.status), { timeout: 10000 }).toBe('ready');
  const final = await popup.evaluate(() => window.buddy.getState());
  expect(final.popup.entry.definition.length).toBeGreaterThan(0);
  expect(final.popup.entry.sources.some(source => source.name === 'Wiktionary definition')).toBe(true);
  await expect(popup.locator('.meaning')).toHaveText(final.popup.entry.definition);
  await popup.screenshot({ path: resolve(root, `${prefix}resilience-en.png`), omitBackground: true });
  report.push('PASS: real English definition appears through Wiktionary with the primary dictionary blocked');
  const times = await popup.evaluate(() => window.__lookupTimings);
  expect(times.translation).toBeLessThan(times.definition);
  expect(tunnels.has('en.wiktionary.org')).toBe(true); expect(tunnels.has('api.datamuse.com')).toBe(true);
  report.push('PASS: vocabulary requests use the configured HTTP CONNECT proxy with normal TLS validation');
  report.push(`TIMING: Russian translation ${times.translation - times.start} ms; deliberately delayed English fallback ${times.definition - times.start} ms`);
} catch (error) { report.push(`FAIL: ${error.stack || error.message}`); process.exitCode = 1; }
finally {
  if (app) await app.close();
  for (const socket of connections) socket.destroy();
  await new Promise(resolvePromise => proxy.close(resolvePromise));
  await writeFile(resolve(root, `${prefix}resilience-test.txt`), report.join('\n') + '\n'); console.log(report.join('\n'));
}
