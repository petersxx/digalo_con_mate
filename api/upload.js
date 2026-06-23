/*
 * ============================================================
 *  api/upload.js  —  Subida de archivos a Vercel Blob
 * ============================================================
 *
 *  ¿QUÉ HACE ESTE ARCHIVO?
 *  Permite subir imágenes y modelos 3D (.glb) desde el
 *  navegador (página upload.html) a Vercel Blob, que es el
 *  servicio de almacenamiento de archivos de Vercel.
 *
 *  ¿POR QUÉ NO SUBIMOS DIRECTO DESDE EL NAVEGADOR?
 *  El token de acceso a Vercel Blob (BLOB_READ_WRITE_TOKEN)
 *  debe mantenerse en el servidor. Si lo ponemos en el
 *  navegador, cualquier persona podría verlo y subir archivos
 *  a nuestra cuenta.
 *
 *  FLUJO COMPLETO:
 *    1. Usuario elige un archivo en upload.html
 *    2. El navegador lo manda con POST a /api/upload?filename=foto.jpg
 *    3. Este servidor recibe el archivo y lo sube a Vercel Blob
 *    4. Vercel Blob devuelve una URL pública permanente
 *    5. Este servidor le manda esa URL de vuelta al navegador
 *    6. El usuario copia la URL y la pega en Notion
 *
 *  CÓMO LLAMAR A ESTE ENDPOINT:
 *    POST /api/upload?filename=mi-foto.jpg
 *    Body: el contenido binario del archivo
 *
 *  RESPUESTA EXITOSA:
 *    { "url": "https://...vercel-storage.com/mi-foto.jpg", "filename": "mi-foto.jpg" }
 * ============================================================
 */

// Importamos la función "put" de la librería oficial de Vercel Blob.
// "put" sube un archivo y devuelve su URL pública.
const { put } = require('@vercel/blob');


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

  // ── Verificar que venga el nombre del archivo ──────────────
  // El nombre del archivo se manda como parámetro en la URL:
  //   /api/upload?filename=mi-guampa.glb
  // Lo necesitamos para saber con qué nombre guardar el archivo
  // y para validar la extensión.
  const filename = req.query.filename;
  if (!filename) return res.status(400).json({ error: 'Falta el parámetro filename' });

  // ── Validar la extensión del archivo ──────────────────────
  // Solo permitimos ciertos tipos de archivo por seguridad.
  // Extraemos la extensión (lo que está después del último punto).
  // Ej: "foto.jpg" → "jpg"
  const ext = filename.split('.').pop().toLowerCase();
  const allowed = [
    'glb',  // Modelos 3D (para model-viewer)
    'gltf', // Modelos 3D (formato alternativo)
    'jpg',  // Imágenes JPEG
    'jpeg', // Imágenes JPEG (extensión alternativa)
    'png',  // Imágenes PNG (con transparencia)
    'webp', // Imágenes WebP (formato moderno, más liviano)
  ];

  if (!allowed.includes(ext)) {
    return res.status(400).json({ error: `Extensión no permitida: .${ext}` });
  }

  try {
    // ── Leer el archivo completo de la petición ────────────
    // Esperamos a recibir todos los datos del archivo
    const buffer = await readBody(req);

    // ── Subir el archivo a Vercel Blob ─────────────────────
    // "put" recibe el nombre, el contenido y opciones:
    //   access: 'public' → la URL generada será accesible por cualquiera
    //     (necesario para que las imágenes se muestren en la web y para
    //      que model-viewer pueda cargar los .glb)
    //   addRandomSuffix: true → agrega un sufijo aleatorio al nombre
    //     para evitar conflictos si subís dos archivos con el mismo nombre.
    //     Ej: "guampa.glb" se guarda como "guampa-a3x9k2.glb"
    const blob = await put(filename, buffer, {
      access: 'public',
      addRandomSuffix: true,
    });

    // ── Devolver la URL al navegador ───────────────────────
    // blob.url  → URL completa y permanente del archivo subido
    // blob.pathname → ruta relativa dentro del Blob store
    res.json({ url: blob.url, filename: blob.pathname });

  } catch (err) {
    // Si algo falló (Blob caído, token inválido, archivo muy grande, etc.),
    // logueamos el error en Vercel y devolvemos error 500
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
