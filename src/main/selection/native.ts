import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { normalizeWord, requireWord } from '../../shared/validation';

const eventSchema = z.object({ type: z.enum(['ready', 'reading', 'selection', 'done']), word: z.string().max(64).optional(), explicitAction: z.boolean().optional(), found: z.boolean().optional(), protectedField: z.boolean().optional(), automatic: z.boolean().optional() });
export class NativeSelection {
  private child: ChildProcessWithoutNullStreams | null = null;
  private enabled = false;
  private closing = false;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private failures: number[] = [];
  private serial = 0;
  private capturePending = false;
  constructor(private path: string, private selection: (word: string, explicit: boolean) => void, private status: (value: string) => void, private missing: (protectedField: boolean) => void) {}
  start() {
    if (this.child || this.closing) return;
    this.status('Connecting to Windows…');
    const child = spawn(this.path, [String(process.pid)], { windowsHide: true, stdio: 'pipe', shell: false });
    this.child = child;
    child.stdin.on('error', () => { /* Exit handler owns recovery. */ });
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (line.length > 2048) return;
      const parsed = eventSchema.safeParse((() => { try { return JSON.parse(line) as unknown; } catch { return null; } })());
      if (!parsed.success) return;
      const event = parsed.data;
      if (event.type === 'ready') {
        this.status(event.automatic ? 'Windows selection ready' : 'Shortcut only: mouse listener unavailable');
        this.send({ type: 'enabled', value: this.enabled });
        if (this.capturePending) { this.capturePending = false; this.capture(); }
      } else if (event.type === 'reading') {
        clearTimeout(this.watchdog);
        this.watchdog = setTimeout(() => { child.kill(); if (event.explicitAction) this.missing(false); }, 4500);
      } else if (event.type === 'done') {
        clearTimeout(this.watchdog);
        if (event.explicitAction && !event.found) this.missing(event.protectedField ?? false);
      } else if (event.type === 'selection') {
        const word = normalizeWord(event.word);
        if (word) this.selection(word, event.explicitAction ?? false);
      }
    });
    child.once('error', () => this.status('Windows helper could not start'));
    child.once('close', () => {
      lines.close(); clearTimeout(this.watchdog); this.child = null;
      if (this.closing) return;
      this.failures = this.failures.filter(time => time > Date.now() - 60000);
      this.failures.push(Date.now());
      this.status('Windows accessibility did not respond. Copy a word and use “Use copied word”.');
      if (this.failures.length < 3) this.retry = setTimeout(() => this.start(), 3000);
    });
  }
  setEnabled(value: boolean) { this.enabled = value; this.send({ type: 'enabled', value }); }
  capture() {
    if (!this.child) { this.capturePending = true; this.failures = []; this.start(); return; }
    this.send({ type: 'capture', id: `shortcut-${++this.serial}` });
  }
  speak(word: string) { this.send({ type: 'speak', word: requireWord(word) }); }
  private send(value: object) { if (this.child?.stdin.writable) this.child.stdin.write(`${JSON.stringify(value)}\n`); }
  stop() {
    this.closing = true; clearTimeout(this.retry); clearTimeout(this.watchdog);
    this.send({ type: 'quit' });
    this.child?.kill(); this.child = null;
  }
}
