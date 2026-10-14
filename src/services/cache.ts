import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { vocabularySchema, type Vocabulary } from '../shared/schema';

export class VocabularyCache {
  private entries = new Map<string, Vocabulary>();
  constructor(private file?: string, private ttl = 7 * 24 * 60 * 60 * 1000, private max = 500) {
    if (file && existsSync(file)) {
      try {
        const input: unknown = JSON.parse(readFileSync(file, 'utf8'));
        if (Array.isArray(input)) for (const raw of input.slice(-max)) {
          const result = vocabularySchema.safeParse(raw);
          if (result.success && result.data.fetchedAt > Date.now() - ttl) this.entries.set(result.data.word, result.data);
        }
      } catch { /* Cache is disposable; saved vocabulary is stored separately. */ }
    }
  }
  get(word: string): Vocabulary | undefined {
    const entry = this.entries.get(word);
    if (!entry || Date.now() - entry.fetchedAt > this.ttl) { this.entries.delete(word); return; }
    return structuredClone(entry);
  }
  set(entry: Vocabulary) {
    this.entries.delete(entry.word);
    this.entries.set(entry.word, vocabularySchema.parse(entry));
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
    this.flush();
  }
  clear() { this.entries.clear(); this.flush(); }
  private flush() {
    if (this.file) {
      writeFileSync(`${this.file}.tmp`, JSON.stringify([...this.entries.values()]), 'utf8');
      renameSync(`${this.file}.tmp`, this.file);
    }
  }
}
