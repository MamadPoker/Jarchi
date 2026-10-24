// The relay's Cloudflare bindings for tests (test/stats.test.js, test/support.test.js). D1: SQLite (node:sqlite) with
// relay/schema.sql, D1's ?NNN parameters made plain ? for node:sqlite, batch() in one transaction like D1's. KV: a Map.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'relay', 'schema.sql'), 'utf8'));
  const statement = (sql, args = []) => {
    const run = (how) => db.prepare(sql.replace(/\?\d+/g, '?'))[how](...[...sql.matchAll(/\?(\d+)/g)].map((m) => args[m[1] - 1]));
    const now = () => ({ meta: { changes: run('run').changes } });
    return {
      bind: (...a) => statement(sql, a),
      now,
      run: async () => now(),
      first: async () => run('get') ?? null,
      all: async () => ({ results: run('all') }),
    };
  };
  const batch = async (list) => {
    db.exec('BEGIN');
    try {
      const out = list.map((s) => s.now());
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  return { db, DB: { prepare: (sql) => statement(sql), batch } };
}

function kv() {
  const map = new Map();
  return { map, KV: {
    put: async (k, v) => void map.set(k, new Uint8Array(v)),
    get: async (k) => (map.has(k) ? map.get(k).slice().buffer : null), // as get(k, 'arrayBuffer')
    delete: async (k) => void map.delete(k),
  } };
}

module.exports = { d1, kv };
