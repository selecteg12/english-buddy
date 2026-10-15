import type { LookupField, LookupUpdate, Vocabulary } from '../shared/schema';
import { requireWord } from '../shared/validation';
import { VocabularyCache } from './cache';
import { englishSynonyms, type DictionaryData, type TranslationData, type SynonymData, type DictionaryProvider, type TranslationProvider, type SynonymProvider } from './providers';

type PendingLookup = { promise: Promise<Vocabulary>; listeners: Set<LookupUpdate>; latest?: { entry: Vocabulary; pending: LookupField[] } };
export class VocabularyService {
  private pending = new Map<string, PendingLookup>();
  private requestTimes: number[] = [];
  private generation = 0;
  constructor(private dictionary: DictionaryProvider, private translation: TranslationProvider, private cache: VocabularyCache, private synonymProvider?: SynonymProvider) {}
  lookup(input: unknown, online = true, onUpdate?: LookupUpdate): Promise<Vocabulary> {
    const word = requireWord(input), cached = this.cache.get(word);
    if (cached && ((!cached.warnings.length && cached.definition && cached.translation && cached.synonymsChecked) || !online)) return Promise.resolve(cached);
    if (!online) return Promise.reject(new Error('Offline: this word is not cached. Enable online lookups in Settings.'));
    const running = this.pending.get(word);
    if (running) {
      if (onUpdate) { running.listeners.add(onUpdate); if (running.latest) this.notify(onUpdate, running.latest); }
      return running.promise;
    }
    this.requestTimes = this.requestTimes.filter(time => time > Date.now() - 60000);
    if (this.requestTimes.length >= 20 || this.pending.size >= 3) return Promise.reject(new Error('Too many lookups. Please wait a moment.'));
    this.requestTimes.push(Date.now());
    const generation = this.generation;
    let resolveLookup!: (entry: Vocabulary) => void, rejectLookup!: (reason: unknown) => void;
    const task: PendingLookup = { promise: new Promise((resolve, reject) => { resolveLookup = resolve; rejectLookup = reject; }), listeners: new Set(onUpdate ? [onUpdate] : []) };
    this.pending.set(word, task);
    void this.fetch(word, cached, (entry, pending) => {
      task.latest = { entry, pending };
      for (const listener of task.listeners) this.notify(listener, task.latest);
    }).then(entry => {
      // Keep healthy fields even if another service fails; retry only missing fields.
      if (generation === this.generation) this.cache.set(entry);
      return entry;
    }).then(entry => {
      this.pending.delete(word); task.listeners.clear(); resolveLookup(entry);
    }, reason => {
      this.pending.delete(word); task.listeners.clear(); rejectLookup(reason);
    });
    return task.promise;
  }
  private notify(listener: LookupUpdate, update: { entry: Vocabulary; pending: LookupField[] }) {
    try { listener(structuredClone(update.entry), [...update.pending]); } catch { /* A closed UI does not invalidate a provider result. */ }
  }
  private async fetch(word: string, cached: Vocabulary | undefined, update: LookupUpdate): Promise<Vocabulary> {
    let dictionary: DictionaryData | undefined = cached?.definition ? { definition: cached.definition, partOfSpeech: cached.partOfSpeech, synonyms: cached.synonyms, ipa: cached.ipa, example: cached.example, sources: cached.sources } : undefined;
    let translation: TranslationData | undefined = cached?.translation ? { text: cached.translation, synonyms: [], sources: cached.sources } : undefined;
    let synonymData: SynonymData | undefined = cached?.synonymsChecked ? { synonyms: cached.synonyms, sources: cached.sources } : undefined;
    const pending = new Set<LookupField>(), failed = new Set<LookupField>();
    if (!dictionary) pending.add('definition');
    if (!translation) pending.add('translation');
    if (!synonymData) pending.add('synonyms');
    const snapshot = (): Vocabulary => {
      const synonyms = englishSynonyms([...(synonymData?.synonyms ?? []), ...(dictionary?.synonyms ?? []), ...(translation?.synonyms ?? []), ...(cached?.synonyms ?? [])], word);
      const sources = [...(dictionary?.sources ?? []), ...(translation?.sources ?? []), ...(synonymData?.sources ?? [])];
      return { word, definition: dictionary?.definition ?? '', translation: translation?.text ?? '', partOfSpeech: dictionary?.partOfSpeech ?? '', ipa: dictionary?.ipa ?? '', example: dictionary?.example ?? '', synonyms,
        synonymsChecked: !!synonymData || (!pending.has('synonyms') && synonyms.length > 0),
        sources: sources.filter((source, index) => sources.findIndex(item => item.name === source.name && item.url === source.url) === index),
        warnings: [...(failed.has('definition') ? ['English definition is unavailable. Check your VPN connection and retry.'] : []), ...(failed.has('translation') ? ['Russian translation is unavailable. Check your VPN connection and retry.'] : []), ...(failed.has('synonyms') && !synonyms.length ? ['English synonyms are temporarily unavailable. Please try again.'] : [])], fetchedAt: Date.now() };
    };
    const publish = () => { const entry = snapshot(); if (entry.definition || entry.translation || entry.synonyms.length) update(entry, [...pending]); };
    publish();
    const track = async <T>(field: LookupField, request: () => Promise<T>, accept: (value: T) => void) => {
      try { accept(await request()); } catch { failed.add(field); }
      finally { pending.delete(field); publish(); }
    };
    await Promise.all([
      ...(!dictionary ? [track('definition', () => this.dictionary.lookup(word), value => { dictionary = value; })] : []),
      ...(!translation ? [track('translation', () => this.translation.translate(word), value => { translation = value; })] : []),
      ...(!synonymData ? [track('synonyms', () => this.synonymProvider?.lookup(word) ?? Promise.resolve({ synonyms: [], sources: [] }), value => { synonymData = value; })] : [])
    ]);
    const entry = snapshot();
    if (!entry.definition && !entry.translation && !entry.synonyms.length) throw new Error('Could not reach the vocabulary services, or the word was not found. Check your VPN or internet connection and retry.');
    return entry;
  }
  clear() { this.generation++; this.cache.clear(); }
}
