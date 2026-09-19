const jwt = require('jsonwebtoken');

function authMiddleware(db) {
  return async (req, res, next) => {
    // Skip auth for login and public routes
    if (req.path === '/api/auth/login' || req.path === '/api/auth/refresh' || req.path === '/api/health' || !req.path.startsWith('/api/')) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.type === 'refresh') {
        return res.status(401).json({ error: 'Refresh token cannot be used for API access' });
      }
      const user = await db.prepare('SELECT id, username, full_name, role, facility_id, language FROM users WHERE id = ? AND active = 1').get(decoded.userId);
      if (!user) {
        return res.status(401).json({ error: 'User not found or inactive' });
      }
      req.user = user;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}` });
    }
    next();
  };
}

async function auditLog(db, userId, action, resourceType, resourceId, details, ip) {
  const { v4: uuidv4 } = require('uuid');
  try {
    await db.prepare(`
      INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), userId, action, resourceType, resourceId, JSON.stringify(details), ip);
  } catch (err) {
    console.error('auditLog failed:', err.message);
  }
}

module.exports = { authMiddleware, requireRole, auditLog };
