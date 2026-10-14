import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import type { AppState } from '../shared/schema';
import { FloatingFlag } from './components/Flag';
import { Popup } from './components/Popup';
import { SettingsPage } from './pages/Settings';
import './styles/app.css';
import './styles/synonyms.css';
import './styles/readability.css';

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const view = new URLSearchParams(location.search).get('view') ?? 'settings';
  useEffect(() => {
    let live = true;
    const unsubscribe = window.buddy.subscribe(next => { if (live) setState(next); });
    void window.buddy.getState().then(next => { if (live) setState(next); }).catch(() => { if (live) setError('Could not connect to English Buddy. Please restart the app.'); });
    return () => { live = false; unsubscribe(); };
  }, []);
  if (error) return <p className="boot-error">{error}</p>;
  if (!state) return null;
  return view === 'flag' ? <FloatingFlag state={state} /> : view === 'popup' ? <Popup state={state} /> : <SettingsPage state={state} initialPage={view} />;
}
createRoot(document.getElementById('root')!).render(<App />);
