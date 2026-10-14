import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, session, shell, Tray } from 'electron';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { LocalStore } from '../storage/store';
import { VocabularyCache } from '../services/cache';
import { DatamuseSynonyms, FreeDictionary, WiktionaryTranslation } from '../services/providers';
import { VocabularyService } from '../services/vocabulary';
import { settingsPatchSchema, type AppState, type PopupState } from '../shared/schema';
import { allowedSource, requireWord } from '../shared/validation';
import { BuddyWindows } from './windows/windows';
import { NativeSelection } from './selection/native';

protocol.registerSchemesAsPrivileged([{ scheme: 'buddy', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const testData = process.argv.find(arg => arg.startsWith('--buddy-data='))?.slice('--buddy-data='.length);
if (testData) app.setPath('userData', resolve(testData));
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();

let store: LocalStore, windows: BuddyWindows, service: VocabularyService, helper: NativeSelection, tray: Tray;
let nativeStatus = 'Starting Windows selection…', hidden = false, shortcutAvailable = false;
let popup: PopupState = { status: 'idle', word: '', entry: null, message: '', saved: false };
let dismiss: ReturnType<typeof setTimeout> | undefined, lookupVersion = 0, lastWord = '', lastTime = 0;
let quitting = false;

function state(): AppState { return { ...store.snapshot(), popup, nativeStatus, hidden, shortcutAvailable, storageWarning: store.warning }; }
function broadcast() {
  if (!windows || !store) return;
  const value = state();
  for (const window of windows.all()) window.webContents.send('buddy:state', value);
  if (tray && !tray.isDestroyed()) updateTray();
}
function timer() {
  clearTimeout(dismiss);
  const seconds = store.snapshot().settings.popupTimeout;
  if (seconds > 0) dismiss = setTimeout(closePopup, seconds * 1000);
}
function closePopup() { ++lookupVersion; lastWord = ''; clearTimeout(dismiss); windows.popup.hide(); }
async function lookup(input: unknown, explicit = false) {
  const word = requireWord(input);
  const settings = store.snapshot().settings;
  if (!explicit && (hidden || !settings.monitoring || !settings.onboardingComplete)) return;
  if (!explicit && word === lastWord && Date.now() - lastTime < 1200) return;
  lastWord = word; lastTime = Date.now();
  const version = ++lookupVersion;
  clearTimeout(dismiss);
  popup = { status: 'loading', word, entry: null, message: '', saved: false };
  broadcast();
  if (hidden) { hidden = false; windows.flag.showInactive(); applyMonitoring(); }
  await windows.showPopup();
  if (version !== lookupVersion) return;
  try {
    const entry = await service.lookup(word, settings.online);
    if (version !== lookupVersion) return;
    popup = { status: 'ready', word, entry, message: '', saved: store.snapshot().words.some(item => item.word === word) };
  } catch (error) {
    if (version !== lookupVersion) return;
    popup = { status: 'error', word, entry: null, message: error instanceof Error ? error.message : 'Lookup failed. Please try again.', saved: false };
  }
  broadcast(); timer();
}
function missing(protectedField: boolean) {
  ++lookupVersion;
  popup = { status: 'error', word: '', entry: null, saved: false, message: protectedField ? 'Protected input: selection was ignored.' : 'This app did not expose a selected word. Copy one English word, then click “Use copied word”.' };
  broadcast(); void windows.showPopup(); timer();
}
function applyMonitoring() {
  const settings = store.snapshot().settings;
  helper.setEnabled(settings.monitoring && settings.onboardingComplete && !hidden);
  globalShortcut.unregisterAll();
  shortcutAvailable = !settings.shortcut || globalShortcut.register('CommandOrControl+Shift+E', () => helper.capture());
}
function hide() { hidden = true; closePopup(); windows.flag.hide(); applyMonitoring(); broadcast(); }
function updateTray() {
  const settings = store.snapshot().settings;
  tray.setToolTip(`English Buddy · ${settings.monitoring && settings.onboardingComplete && !hidden ? 'Watching selections' : 'Paused'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: hidden ? 'Show Buddy' : 'Hide Buddy', click: () => { if (hidden) { hidden = false; windows.flag.showInactive(); applyMonitoring(); broadcast(); } else hide(); } },
    { label: 'Watch selections', type: 'checkbox', checked: settings.monitoring, click: item => { store.updateSettings({ monitoring: item.checked }); applyMonitoring(); broadcast(); } },
    { type: 'separator' },
    { label: 'Settings', click: () => { void windows.openSettings(); } },
    { label: 'My vocabulary', click: () => { void windows.openSettings('words'); } },
    { type: 'separator' }, { label: 'Quit English Buddy', click: () => app.quit() }
  ]));
}

function registerIpc() {
  const handle = (channel: string, action: (input: unknown) => unknown, views = ['settings', 'words', 'popup', 'flag']) => {
    ipcMain.handle(`buddy:${channel}`, (event, input: unknown) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const frameUrl = event.senderFrame?.url;
      if (!window || !windows.all().includes(window) || event.senderFrame !== event.sender.mainFrame || !frameUrl) throw new Error('Untrusted IPC sender.');
      const url = new URL(frameUrl);
      const local = url.protocol === 'buddy:' && url.hostname === 'app' && url.pathname === '/index.html';
      const dev = !app.isPackaged && process.env.BUDDY_DEV_URL && url.origin === process.env.BUDDY_DEV_URL;
      if ((!local && !dev) || !views.includes(url.searchParams.get('view') ?? '')) throw new Error('Untrusted IPC origin.');
      return action(input);
    });
  };
  handle('state', () => state());
  handle('settings', input => {
    const patch = settingsPatchSchema.parse(input);
    if (patch.launchAtStartup !== undefined) {
      if (!app.isPackaged) { if (patch.launchAtStartup) throw new Error('Startup is available in the installed build.'); }
      else app.setLoginItemSettings({ openAtLogin: patch.launchAtStartup, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath });
    }
    store.updateSettings(patch); applyMonitoring(); broadcast();
    if (windows.popup.isVisible() && popup.status !== 'loading') timer();
  });
  handle('lookup', input => lookup(input, true), ['settings', 'words']);
  handle('copied', () => lookup(clipboard.readText(), true));
  handle('save', () => { if (popup.entry) { store.save(popup.entry); popup.saved = true; broadcast(); } }, ['popup']);
  handle('remove', input => { store.remove(input); popup.saved = store.snapshot().words.some(item => item.word === popup.word); broadcast(); }, ['settings', 'words']);
  handle('close', () => closePopup(), ['popup']);
  handle('open-settings', input => windows.openSettings(z.enum(['settings', 'words']).default('settings').parse(input)));
  handle('menu', () => {
    const settings = store.snapshot().settings;
    Menu.buildFromTemplate([
      { label: settings.monitoring ? 'Pause watching' : 'Resume watching', click: () => { store.updateSettings({ monitoring: !settings.monitoring }); applyMonitoring(); broadcast(); } },
      { label: 'Use copied word', click: () => { void lookup(clipboard.readText(), true).catch(() => missing(false)); } },
      { label: 'Settings', click: () => { void windows.openSettings(); } },
      { label: 'My vocabulary', click: () => { void windows.openSettings('words'); } },
      { label: 'Hide Buddy', click: hide }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }
    ]).popup({ window: windows.flag });
  }, ['flag']);
  handle('reset', () => windows.resetPosition(), ['settings', 'words']);
  handle('cache', () => service.clear(), ['settings', 'words']);
  handle('hide', () => hide());
  handle('source', input => shell.openExternal(allowedSource(input)), ['popup', 'settings', 'words']);
  handle('pronounce', () => { if (popup.entry) helper.speak(popup.entry.word); }, ['popup']);
  ipcMain.on('buddy:drag', (event, phase: unknown) => {
    if (event.sender === windows.flag.webContents && event.senderFrame === event.sender.mainFrame && ['start', 'move', 'end'].includes(String(phase))) windows.drag(phase as 'start' | 'move' | 'end');
  });
}

async function start() {
  const root = resolve(__dirname, '../renderer');
  protocol.handle('buddy', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!path.startsWith(root + sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path).href);
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  store = new LocalStore(app.getPath('userData'));
  service = new VocabularyService(new FreeDictionary(), new WiktionaryTranslation(), new VocabularyCache(join(app.getPath('userData'), 'cache.json')), new DatamuseSynonyms());
  windows = new BuddyWindows((x, y) => store.position(x, y));
  helper = new NativeSelection(join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'native/SelectionHelper.exe' : 'native-bin/SelectionHelper.exe'), (word, explicit) => { void lookup(word, explicit); }, value => { nativeStatus = value; broadcast(); }, missing);
  registerIpc();
  await windows.init(store.snapshot().settings);
  tray = new Tray(nativeImage.createFromPath(join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'icon.png' : 'assets/icon.png')).resize({ width: 24, height: 24 }));
  tray.on('double-click', () => { void windows.openSettings(); });
  applyMonitoring(); helper.start(); broadcast();
  if (!store.snapshot().settings.onboardingComplete) await windows.openSettings();
  app.on('second-instance', () => { void windows.openSettings(); });
}
if (locked) void app.whenReady().then(start).catch(error => { console.error('English Buddy startup failed:', error instanceof Error ? error.message : 'unknown error'); app.quit(); });
app.on('window-all-closed', () => { /* Tray owns the app lifecycle. */ });
app.on('before-quit', () => { if (quitting) return; quitting = true; clearTimeout(dismiss); helper?.stop(); globalShortcut.unregisterAll(); tray?.destroy(); });
