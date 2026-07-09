// Prefijo "_" para que Vercel no trate este archivo como un endpoint propio.
const crypto = require('crypto');

/*
 * timingSafeEqualStr(a, b)
 * ────────────────────────
 * Compara dos strings en tiempo constante (no depende de en qué
 * posición difieren), para que un atacante no pueda adivinar la
 * contraseña de a un caracter por vez midiendo la respuesta.
 */
function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function checkAdminPassword(req) {
  const pw = req.headers['x-admin-password'];
  return Boolean(pw) && timingSafeEqualStr(pw, process.env.ADMIN_PASSWORD || '');
}

module.exports = { timingSafeEqualStr, checkAdminPassword };
