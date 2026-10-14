import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, BuddyApi } from '../shared/schema';
const invoke = (name: string, value?: unknown) => ipcRenderer.invoke(`buddy:${name}`, value);
const api: BuddyApi = {
  getState: () => invoke('state'),
  subscribe: callback => { const listener = (_event: unknown, state: AppState) => callback(state); ipcRenderer.on('buddy:state', listener); return () => ipcRenderer.removeListener('buddy:state', listener); },
  settings: patch => invoke('settings', patch), lookup: word => invoke('lookup', word),
  copiedWord: () => invoke('copied'), saveWord: () => invoke('save'), removeWord: word => invoke('remove', word),
  closePopup: () => invoke('close'), openSettings: page => invoke('open-settings', page), menu: () => invoke('menu'),
  drag: phase => ipcRenderer.send('buddy:drag', phase), resetPosition: () => invoke('reset'), clearCache: () => invoke('cache'),
  hide: () => invoke('hide'), openSource: url => invoke('source', url), pronounce: () => invoke('pronounce')
};
contextBridge.exposeInMainWorld('buddy', api);
contextBridge.exposeInMainWorld('buddyPage', { subscribe: (callback: (page: string) => void) => { const listener = (_event: unknown, page: string) => callback(page); ipcRenderer.on('buddy:page', listener); return () => ipcRenderer.removeListener('buddy:page', listener); } });
