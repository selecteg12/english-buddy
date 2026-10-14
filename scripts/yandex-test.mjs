import { _electron as electron, chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const artifactRoot = resolve('artifacts');
const report = [];
const executablePath = 'C:\\Program Files (x86)\\Yandex\\YandexBrowser\\Application\\browser.exe';
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const accessibility = process.argv.includes('--accessibility');
let app, browser;
try {
  if (!existsSync(executablePath)) throw new Error('Yandex Browser is not installed at the expected path.');
  const data = resolve(artifactRoot, `yandex-data-${Date.now()}`);
  await mkdir(data, { recursive: true });
  await writeFile(resolve(data, 'buddy.json'), JSON.stringify({ settings: { onboardingComplete: true, popupTimeout: 0 }, words: [] }));
  const fixturePath = resolve(artifactRoot, 'browser-fixture.html');
  await writeFile(fixturePath, '<!doctype html><meta charset="utf-8"><title>English Buddy Browser Fixture</title><style>body{font-family:Segoe UI;background:#f6f7fb;padding:70px;color:#233456}h1{font-size:20px}p{font-size:44px;margin-top:50px}small{color:#8898ae}</style><h1>English Buddy · Browser selection test</h1><p><span id="word">consistent</span></p><small>Only this isolated test page is used for verification.</small>');
  app = await electron.launch({ args: ['.', `--buddy-data=${data}`], env: environment });
  await expect.poll(() => app.windows().length).toBe(2);
  const popup = app.windows().find(page => page.url().includes('view=popup'));
  browser = await chromium.launchPersistentContext(resolve(artifactRoot, `yandex-profile-${Date.now()}`), { executablePath, headless: false, viewport: { width: 900, height: 580 }, args: ['--no-first-run', '--no-default-browser-check', '--window-position=140,120', ...(accessibility ? ['--force-renderer-accessibility'] : [])], timeout: 20000 });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(fixturePath).href);
  report.push(`Browser engine: ${await page.evaluate(() => navigator.userAgent)}`);
  await page.bringToFront();
  const box = await page.locator('#word').boundingBox();
  const point = await page.evaluate(({ x, y }) => ({ x: Math.round(x * window.devicePixelRatio), y: Math.round(y * window.devicePixelRatio) }), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn(resolve('native-bin/SelectionHelper.exe'), ['--test-browser', String(point.x), String(point.y)], { windowsHide: true });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Browser UI Automation timed out')); }, 12000);
    let output = ''; child.stdout.on('data', data => { output += data.toString(); }); child.on('error', reject); child.on('exit', () => { clearTimeout(timeout); resolvePromise(output.trim()); });
  });
  if (!output.includes('test-clicked')) throw new Error(`Could not click test page: ${output}`);
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  await page.screenshot({ path: resolve(artifactRoot, 'yandex-selection.png') });
  expect(selected).toBe('consistent');
  await expect.poll(() => popup.evaluate(async () => (await window.buddy.getState()).popup.word), { timeout: 10000 }).toBe('consistent');
  await expect.poll(() => popup.evaluate(async () => (await window.buddy.getState()).popup.status), { timeout: 25000 }).toBe('ready');
  await expect(popup.getByRole('region', { name: 'English synonyms' }).locator('.synonyms span').first()).toBeVisible();
  await page.screenshot({ path: resolve(artifactRoot, 'yandex-selection.png') });
  report.push(`PASS: automatic word selection in installed Yandex Browser, isolated profile, ${accessibility ? 'explicit accessibility flags' : 'default accessibility settings'}`);
  report.push('PASS: selected consistent -> real vocabulary popup');
  report.push('PASS: selected word automatically displays English synonyms');
} catch (error) { report.push(`FAIL: ${error.stack || error.message}`); process.exitCode = 1; }
finally { if (browser) await browser.close(); if (app) await app.close(); await writeFile(resolve(artifactRoot, 'yandex-test.txt'), report.join('\n') + '\n'); console.log(report.join('\n')); }
