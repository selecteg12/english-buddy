import { z } from 'zod';

export const modeSchema = z.enum(['ru', 'en']);
export type LearningMode = z.infer<typeof modeSchema>;
export const pointSchema = z.object({ x: z.number().int().min(-100000).max(100000), y: z.number().int().min(-100000).max(100000) }).strict();
export const settingsSchema = z.object({
  mode: modeSchema.default('ru'), monitoring: z.boolean().default(true),
  shortcut: z.boolean().default(true), popupTimeout: z.number().int().min(0).max(120).default(20),
  animation: z.boolean().default(true), launchAtStartup: z.boolean().default(false),
  online: z.boolean().default(true), position: pointSchema.nullable().default(null),
  onboardingComplete: z.boolean().default(false)
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
// A patch must not apply defaults to omitted fields (Zod defaults inside an
// optional schema would otherwise reset unrelated preferences).
export const settingsPatchSchema = z.object({
  mode: modeSchema.optional(), monitoring: z.boolean().optional(),
  shortcut: z.boolean().optional(), popupTimeout: z.number().int().min(0).max(120).optional(),
  animation: z.boolean().optional(), launchAtStartup: z.boolean().optional(),
  online: z.boolean().optional(), onboardingComplete: z.boolean().optional()
}).strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export const sourceSchema = z.object({ name: z.string().max(80), url: z.string().url().max(1000), license: z.string().max(120).optional(), licenseUrl: z.string().url().max(1000).optional() });
export const vocabularySchema = z.object({
  word: z.string().min(1).max(64), partOfSpeech: z.string().max(60).default(''),
  translation: z.string().max(2000).default(''), definition: z.string().max(3000).default(''),
  synonyms: z.array(z.string().max(80)).max(12).default([]),
  ipa: z.string().max(150).default(''), example: z.string().max(1500).default(''),
  sources: z.array(sourceSchema).max(10).default([]), warnings: z.array(z.string().max(250)).max(5).default([]),
  fetchedAt: z.number().default(0)
});
export type Vocabulary = z.infer<typeof vocabularySchema>;
export const savedWordSchema = vocabularySchema.extend({ savedAt: z.string().datetime() });
export type SavedWord = z.infer<typeof savedWordSchema>;
export const storeSchema = z.object({ settings: settingsSchema.default(() => settingsSchema.parse({})), words: z.array(savedWordSchema).max(10000).default([]) });
export type StoreData = z.infer<typeof storeSchema>;
export type PopupState = { status: 'idle' | 'loading' | 'ready' | 'error'; word: string; entry: Vocabulary | null; message: string; saved: boolean };
export type AppState = { settings: Settings; words: SavedWord[]; popup: PopupState; nativeStatus: string; shortcutAvailable: boolean; hidden: boolean; storageWarning: string };
export interface BuddyApi {
  getState(): Promise<AppState>;
  subscribe(callback: (state: AppState) => void): () => void;
  settings(patch: SettingsPatch): Promise<void>;
  lookup(word: string): Promise<void>;
  copiedWord(): Promise<void>;
  saveWord(): Promise<void>;
  removeWord(word: string): Promise<void>;
  closePopup(): Promise<void>;
  openSettings(page?: 'settings' | 'words'): Promise<void>;
  menu(): Promise<void>;
  drag(phase: 'start' | 'move' | 'end'): void;
  resetPosition(): Promise<void>;
  clearCache(): Promise<void>;
  hide(): Promise<void>;
  openSource(url: string): Promise<void>;
  pronounce(): Promise<void>;
}
