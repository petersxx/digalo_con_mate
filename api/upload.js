const { put } = require('@vercel/blob');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const filename = req.query.filename;
  if (!filename) return res.status(400).json({ error: 'Falta el parámetro filename' });

  const ext = filename.split('.').pop().toLowerCase();
  const allowed = ['glb', 'gltf', 'jpg', 'jpeg', 'png', 'webp'];
  if (!allowed.includes(ext)) {
    return res.status(400).json({ error: `Extensión no permitida: .${ext}` });
  }

  try {
    const buffer = await readBody(req);
    const blob = await put(filename, buffer, {
      access: 'public',
      addRandomSuffix: true,
    });
    res.json({ url: blob.url, filename: blob.pathname });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
