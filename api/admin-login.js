const crypto = require('crypto');
const { makeToken } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD no configurado' });

  const { password } = req.body || {};
  if (!password) return res.status(401).json({ error: 'Contraseña requerida' });

  let valid = false;
  try {
    const a = Buffer.from(password);
    const b = Buffer.from(ADMIN_PASSWORD);
    valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    valid = false;
  }

  if (!valid) return res.status(401).json({ error: 'Contraseña incorrecta' });

  const ts = Date.now();
  const token = makeToken(ts);
  res.json({ token, expiresAt: ts + 24 * 60 * 60 * 1000 });
};
