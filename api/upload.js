/*
 * ============================================================
 *  api/upload.js  —  URL firmada para subir a Cloudflare R2
 * ============================================================
 *
 *  ¿QUÉ HACE ESTE ARCHIVO?
 *  Genera una URL temporal ("presigned URL") que le permite al
 *  navegador subir un archivo DIRECTO a Cloudflare R2, sin que
 *  el archivo pase por esta función.
 *
 *  ¿POR QUÉ DIRECTO Y NO A TRAVÉS DEL SERVIDOR?
 *  Las funciones de Vercel tienen un límite de tamaño de
 *  request (~4.5MB). Las fotos de celular suelen pesar más que
 *  eso, así que si el archivo pasara por acá, subidas grandes
 *  fallarían. Subiendo directo del navegador a R2 no hay ese
 *  límite.
 *
 *  ¿POR QUÉ NO SUBIMOS DIRECTO SIN PASAR POR AQUÍ TAMPOCO?
 *  Las credenciales de acceso a R2 (R2_ACCESS_KEY_ID /
 *  R2_SECRET_ACCESS_KEY) deben mantenerse en el servidor. Si las
 *  ponemos en el navegador, cualquier persona podría verlas y
 *  subir archivos a nuestra cuenta. Por eso esta función genera
 *  una URL firmada que solo sirve para subir UN archivo puntual
 *  y vence a los pocos minutos.
 *
 *  FLUJO COMPLETO:
 *    1. Usuario elige un archivo en upload.html
 *    2. El navegador pide una URL firmada:
 *       POST /api/upload?filename=foto.jpg
 *    3. Este servidor responde con { uploadUrl, publicUrl }
 *    4. El navegador hace PUT directo a uploadUrl con el archivo
 *    5. El navegador guarda publicUrl y la pega en Notion
 *
 *  RESPUESTA EXITOSA:
 *    { "uploadUrl": "https://...cloudflarestorage.com/...&Signature=...",
 *      "publicUrl": "https://pub-xxxx.r2.dev/mi-foto-a3x9k2.jpg" }
 *
 *  VARIABLES DE ENTORNO NECESARIAS:
 *    R2_ENDPOINT           → https://<account_id>.r2.cloudflarestorage.com
 *    R2_ACCESS_KEY_ID
 *    R2_SECRET_ACCESS_KEY
 *    R2_BUCKET             → nombre del bucket (ej: jakayu-media)
 *    R2_PUBLIC_URL         → URL pública del bucket (r2.dev o dominio propio)
 * ============================================================
 */

const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { checkAdminPassword } = require('./_auth');

const CONTENT_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/*
 * handler(req, res)
 * ─────────────────
 * Función principal que Vercel ejecuta cuando alguien hace
 * POST a /api/upload. Devuelve una URL firmada, no sube nada.
 */
module.exports = async function handler(req, res) {

  // ── Verificar que sea un POST ──────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Verificar contraseña de administrador ──────────────────
  // Solo el panel admin (upload.html) puede pedir URLs de subida.
  // La contraseña viaja en el header 'x-admin-password' y se
  // compara (en tiempo constante) contra ADMIN_PASSWORD.
  if (!checkAdminPassword(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  // ── Verificar que venga el nombre del archivo ──────────────
  // El nombre del archivo se manda como parámetro en la URL:
  //   /api/upload?filename=mi-guampa.jpg
  const filename = req.query.filename;
  if (!filename) return res.status(400).json({ error: 'Falta el parámetro filename' });

  // ── Validar la extensión del archivo ──────────────────────
  // Solo permitimos ciertos tipos de archivo por seguridad.
  const ext = filename.split('.').pop().toLowerCase();
  if (!CONTENT_TYPES[ext]) {
    return res.status(400).json({ error: `Extensión no permitida: .${ext}` });
  }

  try {
    // Le agregamos un sufijo aleatorio al nombre para evitar
    // conflictos si subís dos archivos con el mismo nombre.
    // Ej: "guampa.jpg" se guarda como "guampa-a3x9k2.jpg"
    const base = filename.slice(0, -(ext.length + 1)).replace(/[^a-zA-Z0-9_-]/g, '_');
    const key = `${base}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

    // URL firmada válida por 5 minutos: solo permite subir
    // ese archivo puntual (Key + ContentType fijos).
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        ContentType: CONTENT_TYPES[ext],
      }),
      { expiresIn: 300 }
    );

    const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
    res.json({ uploadUrl, publicUrl, contentType: CONTENT_TYPES[ext] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
