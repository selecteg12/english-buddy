import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { savedWordSchema, settingsPatchSchema, storeSchema, type StoreData, type Vocabulary, type SettingsPatch } from '../shared/schema';
import { requireWord } from '../shared/validation';

export class LocalStore {
  private data: StoreData;
  private file: string;
  warning = '';
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.file = join(directory, 'buddy.json');
    this.data = storeSchema.parse({});
    if (existsSync(this.file)) {
      try { this.data = storeSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))); }
      catch {
        renameSync(this.file, `${this.file}.damaged-${Date.now()}`);
        this.warning = 'A damaged data file was preserved beside buddy.json. Defaults were restored.';
      }
    }
  }
  snapshot(): StoreData { return structuredClone(this.data); }
  private commit(next: StoreData) {
    const validated = storeSchema.parse(next);
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(validated, null, 2), 'utf8');
    renameSync(temporary, this.file);
    this.data = validated;
  }
  updateSettings(patch: SettingsPatch) {
    this.commit({ ...this.data, settings: { ...this.data.settings, ...settingsPatchSchema.parse(patch) } });
  }
  position(x: number, y: number) {
    this.commit({ ...this.data, settings: { ...this.data.settings, position: { x, y } } });
  }
  save(entry: Vocabulary) {
    const word = requireWord(entry.word);
    if (this.data.words.some(item => item.word === word)) return;
    const saved = savedWordSchema.parse({ ...entry, word, savedAt: new Date().toISOString() });
    this.commit({ ...this.data, words: [saved, ...this.data.words] });
  }
  remove(input: unknown) {
    const word = requireWord(input);
    this.commit({ ...this.data, words: this.data.words.filter(item => item.word !== word) });
  }
}
