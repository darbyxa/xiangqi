/**
 * Saves every room to a JSON file so games survive the server being stopped and started again
 * (closing the terminal, rebooting the laptop, Android killing Termux…).
 *
 * Writes are debounced (many changes in quick succession → one write) and atomic
 * (write a temp file, then rename), so a crash mid-write can't leave a half-written save.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RoomService, RoomsSnapshot } from './RoomService';

const SAVE_DELAY_MS = 250;

export class RoomStore {
  private file: string;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    dataDir: string,
    private service: RoomService,
  ) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'rooms.json');
  }

  /** Load the saved rooms (if any) and start saving on every change. Returns how many rooms were loaded. */
  attach(): number {
    let loaded = 0;
    if (fs.existsSync(this.file)) {
      try {
        loaded = this.service.restore(JSON.parse(fs.readFileSync(this.file, 'utf8')) as RoomsSnapshot);
      } catch (err) {
        // Keep the unreadable file for inspection rather than overwriting it with an empty save.
        const backup = `${this.file}.broken-${Date.now()}`;
        fs.renameSync(this.file, backup);
        console.error(`[store] could not read saved games (moved to ${backup}):`, err);
      }
    }
    this.service.onChange = () => this.scheduleSave();
    return loaded;
  }

  private scheduleSave(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveNow();
    }, SAVE_DELAY_MS);
  }

  saveNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.service.snapshot()));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] could not save games:', err);
    }
  }

  /** Flush any pending save and stop listening. */
  close(): void {
    if (this.service.onChange) {
      this.service.onChange = null;
      this.saveNow();
    }
  }
}
