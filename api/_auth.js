const crypto = require('crypto');

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'jakay-u-fallback-secret-2024';
const TOKEN_TTL = 24 * 60 * 60 * 1000;

function makeToken(ts) {
  const hmac = crypto.createHmac('sha256', ADMIN_SECRET);
  hmac.update(`${process.env.ADMIN_PASSWORD}:${ts}`);
  return `${ts}.${hmac.digest('hex')}`;
}

function validateToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const dotIdx = token.indexOf('.');
  if (dotIdx === -1) return false;
  const ts = parseInt(token.slice(0, dotIdx), 10);
  if (isNaN(ts) || Date.now() - ts > TOKEN_TTL) return false;
  const expected = makeToken(ts);
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = { makeToken, validateToken };
