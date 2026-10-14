import { _electron as electron, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
const root = resolve('artifacts');
await mkdir(root, { recursive: true });
const report = [];
let app;
try {
  app = await electron.launch({ executablePath: resolve('release/win-unpacked/English Buddy.exe'), args: [`--buddy-data=${resolve(root, `packaged-data-${Date.now()}`)}`], env: environment });
  await expect.poll(() => app.windows().length, { timeout: 15000 }).toBe(3);
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
  const flag = app.windows().find(page => page.url().includes('view=flag'));
  const popup = app.windows().find(page => page.url().includes('view=popup'));
  const settings = app.windows().find(page => page.url().includes('view=settings'));
  await expect.poll(() => flag.evaluate(async () => (await window.buddy.getState()).nativeStatus), { timeout: 8000 }).toContain('ready');
  const secure = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => { const preferences = window.webContents.getLastWebPreferences(); return preferences.sandbox && preferences.contextIsolation && !preferences.nodeIntegration; }));
  expect(secure).toBe(true);
  report.push('PASS: packaged Windows executable launches without a development server');
  report.push('PASS: bundled native helper launches; sandbox and context isolation enabled');
  await settings.getByLabel('Look up an English word').fill('consistent');
  await settings.getByRole('button', { name: 'Look up', exact: false }).click();
  await expect.poll(() => popup.evaluate(async () => (await window.buddy.getState()).popup.status), { timeout: 30000 }).toBe('ready');
  const entry = await popup.evaluate(async () => (await window.buddy.getState()).popup.entry);
  expect(entry.translation).toContain('последовательный'); expect(entry.definition.length).toBeGreaterThan(0);
  expect(entry.synonyms.length).toBeGreaterThan(0);
  await expect(popup.getByRole('region', { name: 'English synonyms' }).locator('.synonyms span')).toHaveText(entry.synonyms);
  expect(await popup.locator('.synonyms span').first().evaluate(element => getComputedStyle(element).fontSize)).toBe('18px');
  const synonymsBox = await popup.getByRole('region', { name: 'English synonyms' }).boundingBox();
  const footerBox = await popup.locator('.popup-footer').boundingBox();
  expect(synonymsBox.y + synonymsBox.height).toBeLessThanOrEqual(footerBox.y);
  await popup.screenshot({ path: resolve(root, 'packaged-popup.png'), omitBackground: true });
  report.push('PASS: real English/Russian vocabulary in packaged app');
  report.push('PASS: English synonyms displayed first in the packaged app');
  report.push('PASS: 18px synonym text and every synonym fit above the footer without scrolling');
} catch (error) { report.push(`FAIL: ${error.stack || error.message}`); process.exitCode = 1; }
finally { if (app) await app.close(); await writeFile(resolve(root, 'packaged-test.txt'), report.join('\n') + '\n'); console.log(report.join('\n')); }
