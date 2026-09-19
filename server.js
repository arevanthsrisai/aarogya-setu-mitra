require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeDatabase, seedDatabase } = require('./src/database');
const { authMiddleware } = require('./src/middleware');
const { createRoutes } = require('./src/routes');

const app = express();
const PORT = process.env.PORT || 3000;

async function main() {
  // Initialize DB (Neon Postgres via async shim; DATABASE_URL required)
  const db = await initializeDatabase();
  await seedDatabase(db);
  console.log('Database ready (Neon Postgres).');

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  // Auth middleware for API routes
  app.use(authMiddleware(db));

  // API routes
  app.use('/api', createRoutes(db));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' });
  });

  // SPA fallback - serve index.html for all non-API requests
  app.use((req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
      res.status(404).json({ error: 'API endpoint not found' });
    }
  });

  app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║         🏥  AAROGYA SETU MITRA  v2.0                     ║
║         Rural Healthcare Continuity Platform              ║
║                                                           ║
║  URL:  http://localhost:${PORT}                             ║
║                                                           ║
║  Demo Accounts:                                           ║
║  ┌─────────────┬────────────┬──────────────┐              ║
║  │ Role        │ Username   │ Password     │              ║
║  ├─────────────┼────────────┼──────────────┤              ║
║  │ ASHA Worker │ asha1      │ asha123      │              ║
║  │ ANM         │ anm1       │ anm123       │              ║
║  │ PHC Doctor  │ doctor1    │ doctor123    │              ║
║  │ Hospital Dr │ doctor2    │ doctor123    │              ║
║  │ THO Officer │ tho1       │ tho123       │              ║
║  │ DHO Officer │ dho1       │ dho123       │              ║
║  │ State MSIS  │ state1     │ state123     │              ║
║  │ Caregiver   │ caregiver1 │ care123      │              ║
║  │ Facility    │ facility1  │ facility123  │              ║
║  └─────────────┴────────────┴──────────────┘              ║
║                                                           ║
║  Modules: Triage | Referrals | RADAR | Dashboard          ║
║           ANC/HBNC | Immunizations | NCD | OCR | FHIR     ║
╚═══════════════════════════════════════════════════════════╝
  `);
  });
}

main().catch((err) => {
  console.error('Fatal boot error:', err.message);
  process.exit(1);
});

module.exports = app;
