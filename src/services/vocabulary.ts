import type { Vocabulary } from '../shared/schema';
import { requireWord } from '../shared/validation';
import { VocabularyCache } from './cache';
import { englishSynonyms, type DictionaryProvider, type TranslationProvider, type SynonymProvider } from './providers';

export class VocabularyService {
  private pending = new Map<string, Promise<Vocabulary>>();
  private requestTimes: number[] = [];
  private generation = 0;
  constructor(private dictionary: DictionaryProvider, private translation: TranslationProvider, private cache: VocabularyCache, private synonymProvider?: SynonymProvider) {}
  lookup(input: unknown, online = true): Promise<Vocabulary> {
    const word = requireWord(input);
    const cached = this.cache.get(word);
    if (cached && (cached.synonymsChecked || !online)) return Promise.resolve(cached);
    if (!online) return Promise.reject(new Error('Offline: this word is not cached. Enable online lookups in Settings.'));
    const running = this.pending.get(word);
    if (running) return running;
    this.requestTimes = this.requestTimes.filter(time => time > Date.now() - 60000);
    if (this.requestTimes.length >= 20 || this.pending.size >= 3) return Promise.reject(new Error('Too many lookups. Please wait a moment.'));
    this.requestTimes.push(Date.now());
    const generation = this.generation;
    const promise = this.fetch(word, cached).then(entry => {
      // Partial results remain usable but are retried on the next lookup.
      if (!entry.warnings.length && generation === this.generation) this.cache.set(entry);
      return entry;
    }).finally(() => this.pending.delete(word));
    this.pending.set(word, promise);
    return promise;
  }
  private async fetch(word: string, cached?: Vocabulary): Promise<Vocabulary> {
    const dictionaryRequest = cached ? Promise.resolve({ definition: cached.definition, partOfSpeech: cached.partOfSpeech, synonyms: cached.synonyms, ipa: cached.ipa, example: cached.example, sources: cached.sources }) : this.dictionary.lookup(word);
    const translationRequest = cached ? Promise.resolve({ text: cached.translation, synonyms: [], sources: [] }) : this.translation.translate(word);
    const [dictionary, translation, synonymResult] = await Promise.allSettled([dictionaryRequest, translationRequest, this.synonymProvider?.lookup(word) ?? Promise.resolve({ synonyms: [], sources: [] })]);
    const synonyms = englishSynonyms([
      ...(synonymResult.status === 'fulfilled' ? synonymResult.value.synonyms : []),
      ...(dictionary.status === 'fulfilled' ? dictionary.value.synonyms : []),
      ...(translation.status === 'fulfilled' ? translation.value.synonyms ?? [] : [])
    ], word);
    if (dictionary.status === 'rejected' && translation.status === 'rejected' && !synonyms.length) throw new Error('Could not reach the vocabulary services, or the word was not found. Check your connection and try again.');
    const sources = [...(dictionary.status === 'fulfilled' ? dictionary.value.sources : []), ...(translation.status === 'fulfilled' ? translation.value.sources : []), ...(synonymResult.status === 'fulfilled' ? synonymResult.value.sources : [])];
    return {
      word, definition: '', translation: translation.status === 'fulfilled' ? translation.value.text : '',
      partOfSpeech: '', ipa: '', example: '',
      ...(dictionary.status === 'fulfilled' ? dictionary.value : {}),
      synonyms, synonymsChecked: synonymResult.status === 'fulfilled' || synonyms.length > 0,
      sources: sources.filter((source, index) => sources.findIndex(item => item.name === source.name && item.url === source.url) === index),
      warnings: [...(dictionary.status === 'rejected' ? ['English dictionary data is temporarily unavailable.'] : []), ...(translation.status === 'rejected' ? ['Russian translation is temporarily unavailable.'] : []), ...(synonymResult.status === 'rejected' && !synonyms.length ? ['English synonyms are temporarily unavailable. Please try again.'] : [])],
      fetchedAt: Date.now()
    };
  }
  clear() { this.generation++; this.cache.clear(); }
}
