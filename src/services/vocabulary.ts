import type { Vocabulary } from '../shared/schema';
import { requireWord } from '../shared/validation';
import { VocabularyCache } from './cache';
import type { DictionaryProvider, TranslationProvider } from './providers';

export class VocabularyService {
  private pending = new Map<string, Promise<Vocabulary>>();
  private requestTimes: number[] = [];
  private generation = 0;
  constructor(private dictionary: DictionaryProvider, private translation: TranslationProvider, private cache: VocabularyCache) {}
  lookup(input: unknown, online = true): Promise<Vocabulary> {
    const word = requireWord(input);
    const cached = this.cache.get(word);
    if (cached) return Promise.resolve(cached);
    if (!online) return Promise.reject(new Error('Offline: this word is not cached. Enable online lookups in Settings.'));
    const running = this.pending.get(word);
    if (running) return running;
    this.requestTimes = this.requestTimes.filter(time => time > Date.now() - 60000);
    if (this.requestTimes.length >= 20 || this.pending.size >= 3) return Promise.reject(new Error('Too many lookups. Please wait a moment.'));
    this.requestTimes.push(Date.now());
    const generation = this.generation;
    const promise = this.fetch(word).then(entry => {
      // Partial results remain usable but are retried on the next lookup.
      if (!entry.warnings.length && generation === this.generation) this.cache.set(entry);
      return entry;
    }).finally(() => this.pending.delete(word));
    this.pending.set(word, promise);
    return promise;
  }
  private async fetch(word: string): Promise<Vocabulary> {
    const [dictionary, translation] = await Promise.allSettled([this.dictionary.lookup(word), this.translation.translate(word)]);
    if (dictionary.status === 'rejected' && translation.status === 'rejected') throw new Error('Could not reach the vocabulary services, or the word was not found. Check your connection and try again.');
    return {
      word, definition: '', translation: translation.status === 'fulfilled' ? translation.value.text : '',
      partOfSpeech: '', ipa: '', example: '',
      ...(dictionary.status === 'fulfilled' ? dictionary.value : {}),
      synonyms: dictionary.status === 'fulfilled' && dictionary.value.synonyms.length ? dictionary.value.synonyms : translation.status === 'fulfilled' ? translation.value.synonyms ?? [] : [],
      sources: [...(dictionary.status === 'fulfilled' ? dictionary.value.sources : []), ...(translation.status === 'fulfilled' ? translation.value.sources : [])],
      warnings: [...(dictionary.status === 'rejected' ? ['English dictionary data is temporarily unavailable.'] : []), ...(translation.status === 'rejected' ? ['Russian translation is temporarily unavailable.'] : [])],
      fetchedAt: Date.now()
    };
  }
  clear() { this.generation++; this.cache.clear(); }
}
