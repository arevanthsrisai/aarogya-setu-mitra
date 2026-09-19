const path = require('path');
const fs = require('fs');
const { createPgShim } = require('../db/pg-shim');

const ROLE_CHECK = `CONSTRAINT users_role_check CHECK (role IN ('ASHA','ANM','PHC_DOCTOR','HOSPITAL_DOCTOR','THO','DHO','STATE_MSIS','CAREGIVER','PATIENT','FACILITY_STAFF'))`;

async function initializeDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Neon Postgres is required (SQLite path removed).');
  }
  const db = createPgShim(connectionString);

  const migDir = path.join(__dirname, '..', 'migrations');
  const schemaSql = fs.readFileSync(path.join(migDir, '001_schema.sql'), 'utf8');
  await db.exec(schemaSql);

  // Bring pre-existing databases (seeded before FACILITY_STAFF existed) up to date.
  await db.exec(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await db.exec(`ALTER TABLE users ADD ${ROLE_CHECK}`);
  await db.exec(`ALTER TABLE sync_queue ADD COLUMN IF NOT EXISTS client_mutation_id TEXT`);
  await db.exec(`ALTER TABLE sync_queue ADD COLUMN IF NOT EXISTS result TEXT`);
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_queue_client_mutation_id ON sync_queue(client_mutation_id)`);

  return db;
}

async function seedDatabase(db) {
  const seedSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '002_seed.sql'), 'utf8');
  await db.exec(seedSql);
}

module.exports = { initializeDatabase, seedDatabase };
