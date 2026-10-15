import { Bookmark, Check, Clipboard, ExternalLink, LoaderCircle, Volume2, X } from 'lucide-react';
import { useState } from 'react';
import type { AppState } from '../../shared/schema';
import { ModeToggle } from './ModeToggle';

export function Popup({ state }: { state: AppState }) {
  const [error, setError] = useState('');
  const { popup, settings } = state;
  const entry = popup.entry;
  const meaning = settings.mode === 'ru' ? entry?.translation : entry?.definition;
  const meaningPending = popup.pending.includes(settings.mode === 'ru' ? 'translation' : 'definition');
  const perform = (action: Promise<unknown>) => { setError(''); void action.catch(e => setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Action failed.')); };
  return <main className="popup-wrap"><article className="word-popup">
    <div className="popup-eyebrow"><span><i /> A LITTLE ENGLISH, EVERY DAY</span><button className="icon-button" aria-label="Close word" onClick={() => perform(window.buddy.closePopup())}><X size={16} /></button></div>
    <header className="word-header"><div><h1>{popup.word || 'Your next word'}</h1><p>{entry?.partOfSpeech || (popup.status === 'loading' ? 'Finding the meaning…' : 'English Buddy')} {entry?.ipa && <span className="ipa">{entry.ipa}</span>}</p></div>
      {entry && <button className="pronounce" aria-label="Pronounce word" title="Pronounce with a Windows voice" onClick={() => perform(window.buddy.pronounce())}><Volume2 size={20} /></button>}
    </header>
    <div className="popup-content">
      {popup.status === 'loading' && !entry && <div className="loading"><LoaderCircle className="spin" size={23} /><p>Looking up your word<span>Results appear as soon as they arrive</span></p></div>}
      {(popup.status === 'idle' || popup.status === 'error') && <div className="lookup-error"><p>{popup.message || 'Select one English word in another app. Your Buddy will take it from there.'}</p><button className="secondary" onClick={() => perform(window.buddy.copiedWord())}><Clipboard size={15} />Use copied word</button></div>}
      {entry && <>
        <section className="popup-synonyms" aria-label="English synonyms">
          <div className="meaning-label">ENGLISH SYNONYMS</div>
          <div className="synonyms">{entry.synonyms.length ? entry.synonyms.map(word => <span key={word}>{word}</span>) : <small>{popup.pending.includes('synonyms') ? 'Finding English synonyms…' : entry.synonymsChecked ? 'No English synonyms were found for this word.' : 'English synonyms are unavailable right now.'}</small>}</div>
        </section>
        <div className="meaning-label">{settings.mode === 'ru' ? 'RUSSIAN TRANSLATION' : 'ENGLISH DEFINITION'}</div>
        <p className={`meaning ${settings.mode === 'ru' ? 'translation' : ''}`} aria-live="polite">{meaning || (meaningPending ? `Finding ${settings.mode === 'ru' ? 'Russian translation' : 'English definition'}…` : `${settings.mode === 'ru' ? 'Russian translation' : 'English definition'} is unavailable. Check your VPN connection and retry.`)}</p>
        {!meaning && !meaningPending && <button className="secondary" onClick={() => perform(window.buddy.lookup(popup.word))}>Retry lookup</button>}
        {entry.example && settings.mode === 'en' && <p className="example">“{entry.example}”</p>}
        {entry.warnings.map(warning => <p className="warning" key={warning}>{warning}</p>)}
        <div className="sources">{entry.sources.map(source => <span key={source.name}><button title={source.name} onClick={() => perform(window.buddy.openSource(source.url))}>{source.name}<ExternalLink size={10} /></button>{source.licenseUrl && <button onClick={() => perform(window.buddy.openSource(source.licenseUrl!))}>{source.license}</button>}</span>)}</div>
      </>}
      {error && <p className="warning" role="alert">{error}</p>}
    </div>
    <footer className="popup-footer"><ModeToggle mode={settings.mode} onChange={mode => perform(window.buddy.settings({ mode }))} />
      <button className={`save-button ${popup.saved ? 'is-saved' : ''}`} disabled={!entry || popup.saved || popup.status === 'loading'} onClick={() => perform(window.buddy.saveWord())} title="Save word" aria-label={popup.saved ? 'Word saved' : 'Save word'}>{popup.saved ? <Check size={17} /> : <Bookmark size={17} />}</button>
    </footer>
  </article></main>;
}
