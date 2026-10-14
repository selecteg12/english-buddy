import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import { clampRect, popupBounds } from '../../shared/geometry';
import type { Settings } from '../../shared/schema';

export class BuddyWindows {
  flag!: BrowserWindow;
  popup!: BrowserWindow;
  settingsWindow: BrowserWindow | null = null;
  private dragOffset: { x: number; y: number } | null = null;
  private ready = new Map<number, Promise<void>>();
  constructor(private savePosition: (x: number, y: number) => void) {}
  private create(view: string, options: BrowserWindowConstructorOptions): BrowserWindow {
    const window = new BrowserWindow({ show: false, backgroundColor: '#00000000', icon: join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'icon.png' : 'assets/icon.png'), ...options,
      webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, backgroundThrottling: true }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    this.ready.set(window.id, new Promise(resolve => window.once('ready-to-show', () => resolve())));
    const dev = process.env.BUDDY_DEV_URL;
    void window.loadURL(dev && !app.isPackaged ? `${dev}/?view=${view}` : `buddy://app/index.html?view=${view}`);
    return window;
  }
  async init(settings: Settings) {
    const area = screen.getPrimaryDisplay().workArea;
    const position = settings.position ?? { x: area.x + area.width - 140, y: area.y + area.height - 160 };
    const display = screen.getDisplayNearestPoint(position);
    this.flag = this.create('flag', { ...clampRect({ ...position, width: 100, height: 108 }, display.workArea), frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false });
    this.popup = this.create('popup', { width: 390, height: 420, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false });
    this.flag.setAlwaysOnTop(true, 'pop-up-menu');
    this.popup.setAlwaysOnTop(true, 'pop-up-menu');
    this.flag.on('move', () => this.anchorPopup());
    this.flag.on('closed', () => app.quit());
    screen.on('display-removed', () => this.reposition());
    screen.on('display-metrics-changed', () => this.reposition());
    await this.ready.get(this.flag.id);
    this.flag.showInactive();
  }
  private reposition() {
    const bounds = this.flag.getBounds();
    this.flag.setBounds(clampRect(bounds, screen.getDisplayNearestPoint(bounds).workArea));
    this.anchorPopup();
  }
  anchorPopup() { if (this.popup && !this.popup.isDestroyed()) this.popup.setBounds(popupBounds(this.flag.getBounds(), screen.getDisplayMatching(this.flag.getBounds()).workArea)); }
  async showPopup() {
    await this.ready.get(this.popup.id);
    if (this.popup.isDestroyed()) return;
    this.anchorPopup(); this.popup.showInactive();
  }
  drag(phase: 'start' | 'move' | 'end') {
    const point = screen.getCursorScreenPoint();
    if (phase === 'start') {
      const { x, y } = this.flag.getBounds();
      this.dragOffset = { x: point.x - x, y: point.y - y };
    } else if (phase === 'move' && this.dragOffset) {
      this.flag.setBounds(clampRect({ x: point.x - this.dragOffset.x, y: point.y - this.dragOffset.y, width: 100, height: 108 }, screen.getDisplayNearestPoint(point).workArea));
    } else if (phase === 'end') {
      this.dragOffset = null;
      const { x, y } = this.flag.getBounds(); this.savePosition(x, y);
    }
  }
  resetPosition() {
    const area = screen.getPrimaryDisplay().workArea;
    const x = area.x + area.width - 140, y = area.y + area.height - 160;
    this.flag.setPosition(x, y); this.savePosition(x, y);
  }
  async openSettings(page: 'settings' | 'words' = 'settings') {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.webContents.send('buddy:page', page); this.settingsWindow.show(); this.settingsWindow.focus(); return;
    }
    this.settingsWindow = this.create(page, { width: 860, height: 720, minWidth: 730, minHeight: 640, backgroundColor: '#f6f7fb', title: 'English Buddy', autoHideMenuBar: true });
    this.settingsWindow.on('closed', () => { this.settingsWindow = null; });
    await this.ready.get(this.settingsWindow.id);
    this.settingsWindow.show();
  }
  all() { return [this.flag, this.popup, this.settingsWindow].filter((w): w is BrowserWindow => !!w && !w.isDestroyed()); }
}
