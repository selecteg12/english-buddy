import type { BuddyApi } from '../shared/schema';
declare global { interface Window { buddy: BuddyApi; buddyPage: { subscribe(callback: (page: string) => void): () => void } } }
export {};
