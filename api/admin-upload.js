const { validateToken } = require('./_auth');
const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (!validateToken(req.headers.authorization)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  if (req.method !== 'POST') return res.status(405).end();

  const { filename, contentType, data } = req.body || {};
  if (!filename || !contentType || !data) {
    return res.status(400).json({ error: 'Faltan parámetros: filename, contentType, data' });
  }

  const buffer = Buffer.from(data, 'base64');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const blob = await put(`products/${Date.now()}-${safeName}`, buffer, {
    access: 'public',
    contentType,
  });

  res.json({ url: blob.url });
};
