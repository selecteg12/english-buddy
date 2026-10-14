import type { LearningMode } from '../../shared/schema';
export function ModeToggle({ mode, onChange }: { mode: LearningMode; onChange: (mode: LearningMode) => void }) {
  return <div className="mode-toggle" aria-label="Learning mode">
    <button aria-pressed={mode === 'ru'} className={mode === 'ru' ? 'selected' : ''} onClick={() => onChange('ru')}>RU <span>Translation</span></button>
    <button aria-pressed={mode === 'en'} className={mode === 'en' ? 'selected' : ''} onClick={() => onChange('en')}>EN <span>Definition</span></button>
  </div>;
}
