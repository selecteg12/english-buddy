import { BookOpen, Check, Clipboard, Globe2, Keyboard, MousePointer2, Move, Pause, Search, Settings2, Sparkles, Trash2, Wifi, Zap } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { AppState, SettingsPatch } from '../../shared/schema';
import { FlagArt } from '../components/Flag';
import { ModeToggle } from '../components/ModeToggle';
import { version as appVersion } from '../../../package.json';

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button className={`switch ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>;
}
function SettingRow({ icon, title, detail, children }: { icon: ReactNode; title: string; detail: string; children: ReactNode }) {
  return <div className="setting-row"><div className="setting-icon">{icon}</div><div className="setting-text"><h3>{title}</h3><p>{detail}</p></div>{children}</div>;
}
export function SettingsPage({ state, initialPage }: { state: AppState; initialPage: string }) {
  const [page, setPage] = useState(initialPage === 'words' ? 'words' : 'settings');
  const [query, setQuery] = useState(''), [manual, setManual] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState('');
  useEffect(() => window.buddyPage.subscribe(next => setPage(next === 'words' ? 'words' : 'settings')), []);
  const perform = async (action: Promise<unknown>, success = '') => {
    setError(''); setNotice('');
    try { await action; if (success) setNotice(success); }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Action failed.'); }
  };
  const update = (patch: SettingsPatch) => { void perform(window.buddy.settings(patch)); };
  const settings = state.settings;
  const watching = settings.monitoring && settings.onboardingComplete && !state.hidden;
  const words = state.words.filter(entry => `${entry.word} ${entry.translation} ${entry.definition}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-icon"><FlagArt /></div><div>english buddy<span>YOUR DESKTOP COMPANION</span></div></div>
      <div className="side-label">YOUR SPACE</div>
      <nav><button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}><Settings2 size={18} />Preferences</button><button className={page === 'words' ? 'active' : ''} onClick={() => setPage('words')}><BookOpen size={18} />My vocabulary<span className="count">{state.words.length}</span></button></nav>
      <div className="side-companion"><FlagArt /><p>Little words.<br />Bigger possibilities.</p><small>A little English, every day.</small></div>
      <div className="side-bottom"><span className={`status-dot ${watching ? '' : 'off'}`} />{watching ? 'Watching selections' : 'Selection watching paused'}<small>English Buddy · v{appVersion}</small></div>
    </aside>
    <main className="settings-main">
      <header className="page-header"><div><div className="eyebrow">MAKE YOURSELF AT HOME</div><h1>{page === 'words' ? 'My vocabulary' : 'A buddy, your way.'}</h1><p>{page === 'words' ? 'The words you meet. The words you keep.' : 'Small adjustments for your everyday English.'}</p></div><span className="desktop-badge">WINDOWS</span></header>
      {!settings.onboardingComplete && <div className="welcome-card"><Sparkles size={21} /><div><h3>Meet your new reading companion.</h3><p>Select one English word in Yandex Browser or ChatGPT. Buddy reads accessible text and sends only a validated word to dictionary services. Some apps may require the copy fallback.</p><button className="primary" onClick={() => update({ onboardingComplete: true, monitoring: true })}>Start learning <span>→</span></button></div></div>}
      <form className="manual-lookup" onSubmit={event => { event.preventDefault(); void perform(window.buddy.lookup(manual)); }}><Search size={17} /><input aria-label="Look up an English word" placeholder="A word on your mind? Look it up…" value={manual} onChange={event => setManual(event.target.value)} maxLength={64} /><button type="submit">Look up <span>↗</span></button></form>
      {error && <p className="feedback error" role="alert">{error}</p>}{notice && <p className="feedback" role="status"><Check size={15} />{notice}</p>}{state.storageWarning && <p className="feedback error">{state.storageWarning}</p>}
      {page === 'settings' ? <>
        <div className="section-title"><span>01</span>LEARNING</div>
        <section className="settings-card"><div className="learning-row"><div className="setting-icon"><Globe2 size={19} /></div><div className="setting-text"><h3>Your learning mode</h3><p>English synonyms in both modes. Choose translation or definition.</p></div><ModeToggle mode={settings.mode} onChange={mode => update({ mode })} /></div></section>
        <div className="section-title"><span>02</span>HOW BUDDY HELPS</div>
        <section className="settings-card">
          <SettingRow icon={<MousePointer2 size={19} />} title="Watch text selections" detail="Look up a word when you finish highlighting it."><Switch label="Watch text selections" checked={settings.monitoring} onChange={monitoring => update({ monitoring })} /></SettingRow>
          <SettingRow icon={<Keyboard size={19} />} title="Quick lookup shortcut" detail="Ask Windows for the current selection."><div className="row-controls"><kbd>Ctrl ⇧ E</kbd><Switch label="Quick lookup shortcut" checked={settings.shortcut} onChange={shortcut => update({ shortcut })} /></div></SettingRow>
          <SettingRow icon={<Pause size={19} />} title="Keep the popup around" detail="Auto-close after a little reading time."><select aria-label="Popup timeout" value={settings.popupTimeout} onChange={e => update({ popupTimeout: Number(e.target.value) })}>{[0, 10, 20, 30, 60, 120].map(seconds => <option key={seconds} value={seconds}>{seconds ? `${seconds} seconds` : 'Until I close it'}</option>)}</select></SettingRow>
          <SettingRow icon={<Wifi size={19} />} title="Online vocabulary" detail="Uses Windows proxy settings. Only a validated word is sent."><Switch label="Online vocabulary" checked={settings.online} onChange={online => update({ online })} /></SettingRow>
        </section>
        <div className="section-title"><span>03</span>ON YOUR DESKTOP</div>
        <section className="settings-card">
          <SettingRow icon={<Sparkles size={19} />} title="A little flag animation" detail="A gentle float while Buddy keeps you company."><Switch label="Flag animation" checked={settings.animation} onChange={animation => update({ animation })} /></SettingRow>
          <SettingRow icon={<Zap size={19} />} title="Start with Windows" detail="Have Buddy ready when you sign in."><Switch label="Start with Windows" checked={settings.launchAtStartup} onChange={launchAtStartup => update({ launchAtStartup })} /></SettingRow>
        </section>
        <div className="utility-buttons"><button onClick={() => void perform(window.buddy.resetPosition(), 'Buddy is back at the corner of your main display.')}><Move size={15} />Reset position</button><button onClick={() => void perform(window.buddy.clearCache(), 'Lookup cache cleared. Your saved words are safe.')}><Trash2 size={15} />Clear cache</button><button onClick={() => void perform(window.buddy.hide(), 'Buddy is hidden. Show it again from the tray icon.')}><Pause size={15} />Hide Buddy</button></div>
        <div className="help-note"><Clipboard size={18} /><div><strong>When an app keeps its text to itself</strong><p>Copy a single word, then use <button onClick={() => void perform(window.buddy.copiedWord())}>Use copied word</button>. Your clipboard is read only when you ask; its contents are never changed.</p></div></div>
        <div className="native-status"><span className="status-dot" />{state.nativeStatus}{!state.shortcutAvailable && <p className="warning">Ctrl+Shift+E is already in use by another application.</p>}</div>
      </> : <>
        <div className="vocabulary-heading"><h2>{state.words.length} saved {state.words.length === 1 ? 'word' : 'words'}</h2><div className="word-search"><Search size={15} /><input aria-label="Search saved words" placeholder="Find a word…" value={query} onChange={e => setQuery(e.target.value)} /></div></div>
        {words.length === 0 ? <div className="empty-vocabulary"><div><BookOpen size={31} /></div><h2>{query ? 'No words found.' : 'A home for your new words.'}</h2><p>{query ? 'Try another word or translation.' : 'Click the bookmark on a word popup to save it here. Your vocabulary stays on this computer.'}</p>{!query && <span>YOUR FIRST WORD IS JUST A SELECTION AWAY</span>}</div> : <div className="word-list">{words.map(word => <article key={word.word} className="saved-word"><div className="saved-heading"><h2>{word.word}<small>{word.partOfSpeech}</small></h2><button className="icon-button" aria-label={`Remove ${word.word}`} onClick={() => void perform(window.buddy.removeWord(word.word))}><Trash2 size={16} /></button></div><p className="saved-translation">{word.translation || 'Translation unavailable'}</p><p>{word.definition}</p>{word.synonyms.length > 0 && <div className="synonyms">{word.synonyms.map(item => <span key={item}>{item}</span>)}</div>}<div className="saved-date">Saved {new Date(word.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}<button onClick={() => void perform(window.buddy.lookup(word.word))}>Look up again ↗</button></div></article>)}</div>}
      </>}
      <footer className="settings-footer">Made for curious minds.<span>Local vocabulary. No account needed.</span></footer>
    </main>
  </div>;
}
