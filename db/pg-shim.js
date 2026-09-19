const { Pool, types } = require('pg');

// pg returns int8 (COUNT(*) etc.) as string by default; coerce to Number
// so `row.count` arithmetic behaves exactly like SQLite did.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

// Rewrite `?` placeholders to $1..$n, ignoring `?` inside single-quoted literals.
function rewritePlaceholders(sql) {
  let idx = 0;
  let out = '';
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      // handle '' escaped quote
      if (inStr && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (ch === '?' && !inStr) {
      idx++;
      out += '$' + idx;
      continue;
    }
    out += ch;
  }
  return out;
}

// SQLite-compat string transforms (safety net; source SQL is also fixed).
function rewriteCompat(sql) {
  let s = sql;
  s = s.replace(/datetime\s*\(\s*"now"\s*\)/gi, 'NOW()');
  s = s.replace(/datetime\s*\(\s*'now'\s*,\s*'([+-]?\d+)\s+hours?'\s*\)/gi, "NOW() - interval '$1 hours'");
  s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()');
  // LIKE (case-sensitive in PG) -> ILIKE to match SQLite semantics
  s = s.replace(/\bLIKE\b/g, 'ILIKE');
  // INSERT OR REPLACE -> PG upsert on (id)
  s = s.replace(/INSERT\s+OR\s+REPLACE\s+INTO\s+(\S+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/gi,
    (m, table, cols) => {
      const colList = cols.split(',').map((c) => c.trim()).filter(Boolean);
      if (!colList.includes('id')) return `INSERT INTO ${table} (${cols}) VALUES (${cols.split(',').map(() => '?').join(',')})`;
      const sets = colList.filter((c) => c !== 'id').map((c) => `${c}=EXCLUDED.${c}`).join(', ');
      return `INSERT INTO ${table} (${cols}) VALUES (${colList.map(() => '?').join(',')}) ON CONFLICT (id) DO UPDATE SET ${sets}`;
    });
  return s;
}

function normalizeValue(v) {
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return v;
}

// timestamptz comes back as Date; stringify to ISO so row shapes match SQLite.
function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (v instanceof Date) row[k] = v.toISOString();
    else row[k] = normalizeValue(v);
  }
  return row;
}

function prepareOn(queryFn, sql) {
  const text = rewritePlaceholders(rewriteCompat(sql));
  return {
    async run(...params) {
      if (params.length === 1 && Array.isArray(params[0])) params = params[0];
      const res = await queryFn(text, params);
      return { changes: res.rowCount, lastInsertRowid: undefined };
    },
    async get(...params) {
      if (params.length === 1 && Array.isArray(params[0])) params = params[0];
      const res = await queryFn(text, params);
      return res.rows.length ? normalizeRow(res.rows[0]) : undefined;
    },
    async all(...params) {
      if (params.length === 1 && Array.isArray(params[0])) params = params[0];
      const res = await queryFn(text, params);
      return res.rows.map(normalizeRow);
    },
  };
}

function createPgShim(connectionString) {
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });
  pool.on('error', (err) => console.error('pg pool error:', err.message));

  const shim = {
    pool,
    prepare(sql) {
      return prepareOn((text, params) => pool.query(text, params), sql);
    },
    async exec(sql) {
      // multi-statement schema strings: pg simple protocol handles these
      await pool.query(rewriteCompat(sql));
    },
    async run(sql, ...params) {
      return shim.prepare(sql).run(...params);
    },
    async get(sql, ...params) {
      return shim.prepare(sql).get(...params);
    },
    async all(sql, ...params) {
      return shim.prepare(sql).all(...params);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx = {
          prepare(sql) {
            return prepareOn((text, params) => client.query(text, params), sql);
          },
          async exec(sql) {
            await client.query(rewriteCompat(sql));
          },
          async run(sql, ...p) { return tx.prepare(sql).run(...p); },
          async get(sql, ...p) { return tx.prepare(sql).get(...p); },
          async all(sql, ...p) { return tx.prepare(sql).all(...p); },
        };
        const out = await fn(tx);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* noop */ }
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
  return shim;
}

module.exports = { createPgShim };
