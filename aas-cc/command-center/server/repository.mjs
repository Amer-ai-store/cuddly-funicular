import { initialLiveState, normalizeLiveState } from './state.mjs';

export class D1Repository {
  constructor(db) { this.db = db; }
  async load() {
    let row = await this.db.prepare('SELECT revision, document, updated_at FROM aas_app_state WHERE id = ?').bind('organization').first();
    if (!row) {
      await this.db.prepare('INSERT OR IGNORE INTO aas_app_state (id, revision, document, updated_at) VALUES (?, ?, ?, ?)').bind('organization', 0, JSON.stringify(initialLiveState()), new Date().toISOString()).run();
      row = await this.db.prepare('SELECT revision, document, updated_at FROM aas_app_state WHERE id = ?').bind('organization').first();
    }
    if (!row) throw new Error('D1 state initialization failed');
    return { state: normalizeLiveState(JSON.parse(row.document)), revision: row.revision, updatedAt: row.updated_at };
  }
  async compareAndSet(expectedRevision, state) {
    const updatedAt = new Date().toISOString();
    const result = await this.db.prepare('UPDATE aas_app_state SET revision = revision + 1, document = ?, updated_at = ? WHERE id = ? AND revision = ?').bind(JSON.stringify(state), updatedAt, 'organization', expectedRevision).run();
    if (result.meta.changes !== 1) return null;
    return { state, revision: expectedRevision + 1, updatedAt };
  }
}
