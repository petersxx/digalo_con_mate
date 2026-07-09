/*
 * ============================================================
 *  api/upload.js  —  Subida de archivos a Cloudflare R2
 * ============================================================
 *
 *  ¿QUÉ HACE ESTE ARCHIVO?
 *  Permite subir imágenes desde el navegador (página upload.html)
 *  a Cloudflare R2, un servicio de almacenamiento de archivos
 *  compatible con S3 (sin costo por transferencia de salida).
 *
 *  ¿POR QUÉ NO SUBIMOS DIRECTO DESDE EL NAVEGADOR?
 *  Las credenciales de acceso a R2 (R2_ACCESS_KEY_ID /
 *  R2_SECRET_ACCESS_KEY) deben mantenerse en el servidor. Si las
 *  ponemos en el navegador, cualquier persona podría verlas y
 *  subir archivos a nuestra cuenta.
 *
 *  FLUJO COMPLETO:
 *    1. Usuario elige un archivo en upload.html
 *    2. El navegador lo manda con POST a /api/upload?filename=foto.jpg
 *    3. Este servidor recibe el archivo y lo sube a R2
 *    4. Este servidor arma la URL pública (R2_PUBLIC_URL + nombre)
 *    5. Este servidor le manda esa URL de vuelta al navegador
 *    6. El usuario copia la URL y la pega en Notion
 *
 *  CÓMO LLAMAR A ESTE ENDPOINT:
 *    POST /api/upload?filename=mi-foto.jpg
 *    Body: el contenido binario del archivo
 *
 *  RESPUESTA EXITOSA:
 *    { "url": "https://pub-xxxx.r2.dev/mi-foto-a3x9k2.jpg", "filename": "mi-foto-a3x9k2.jpg" }
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
 * readBody(req)
 * ─────────────
 * Función auxiliar para leer el contenido binario del archivo
 * que viene en el cuerpo (body) de la petición HTTP.
 *
 * ¿Por qué no leemos req directamente?
 * Los datos llegan en pedazos (chunks) por la red, no todos
 * de una vez. Esta función espera a que lleguen todos los
 * pedazos, los junta en un Buffer (bloque de bytes) y lo
 * devuelve completo.
 *
 * Devuelve: Promise<Buffer> — el archivo completo en memoria
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; // Array donde vamos acumulando los pedazos

    // Cada vez que llega un pedazo del archivo, lo guardamos
    req.on('data', chunk => chunks.push(chunk));

    // Cuando terminaron de llegar todos los pedazos,
    // los unimos en un solo Buffer y resolvemos la Promise
    req.on('end', () => resolve(Buffer.concat(chunks)));

    // Si ocurre un error de red, rechazamos la Promise
    req.on('error', reject);
  });
}


/*
 * handler(req, res)
 * ─────────────────
 * Función principal que Vercel ejecuta cuando alguien hace
 * POST a /api/upload.
 */
module.exports = async function handler(req, res) {

  // ── Verificar que sea un POST ──────────────────────────────
  // Este endpoint solo acepta POST (subida de archivos).
  // Si alguien intenta GET, PUT, etc., rechazamos con error 405.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Verificar contraseña de administrador ──────────────────
  // Solo el panel admin (upload.html) puede subir archivos.
  // La contraseña viaja en el header 'x-admin-password' y se
  // compara (en tiempo constante) contra ADMIN_PASSWORD.
  if (!checkAdminPassword(req)) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  // ── Verificar que venga el nombre del archivo ──────────────
  // El nombre del archivo se manda como parámetro en la URL:
  //   /api/upload?filename=mi-guampa.jpg
  // Lo necesitamos para saber con qué nombre guardar el archivo
  // y para validar la extensión.
  const filename = req.query.filename;
  if (!filename) return res.status(400).json({ error: 'Falta el parámetro filename' });

  // ── Validar la extensión del archivo ──────────────────────
  // Solo permitimos ciertos tipos de archivo por seguridad.
  // Extraemos la extensión (lo que está después del último punto).
  // Ej: "foto.jpg" → "jpg"
  const ext = filename.split('.').pop().toLowerCase();
  if (!CONTENT_TYPES[ext]) {
    return res.status(400).json({ error: `Extensión no permitida: .${ext}` });
  }

  try {
    // ── Leer el archivo completo de la petición ────────────
    // Esperamos a recibir todos los datos del archivo
    const buffer = await readBody(req);

    // ── Subir el archivo a R2 ───────────────────────────────
    // Le agregamos un sufijo aleatorio al nombre para evitar
    // conflictos si subís dos archivos con el mismo nombre.
    // Ej: "guampa.jpg" se guarda como "guampa-a3x9k2.jpg"
    const base = filename.slice(0, -(ext.length + 1)).replace(/[^a-zA-Z0-9_-]/g, '_');
    const key = `${base}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: CONTENT_TYPES[ext],
    }));

    // ── Devolver la URL al navegador ───────────────────────
    const url = `${process.env.R2_PUBLIC_URL}/${key}`;
    res.json({ url, filename: key });

  } catch (err) {
    // Si algo falló (R2 caído, credenciales inválidas, archivo muy grande, etc.),
    // logueamos el error en Vercel y devolvemos error 500
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
