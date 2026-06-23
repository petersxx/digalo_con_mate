/*
 * ============================================================
 *  api/notion.js  —  Proxy entre la web y Notion
 * ============================================================
 *
 *  ¿POR QUÉ EXISTE ESTE ARCHIVO?
 *  La página web NO puede hablar con Notion directamente
 *  desde el navegador, porque Notion bloquea esas peticiones
 *  por seguridad (CORS). Entonces usamos esta función de
 *  servidor (Vercel Serverless Function) como intermediario:
 *
 *    Navegador  →  /api/notion  →  Notion API  →  /api/notion  →  Navegador
 *
 *  Además, aquí guardamos el token secreto de Notion
 *  (NOTION_TOKEN) en el servidor, lejos del navegador.
 *
 *  Vercel ejecuta este archivo automáticamente cuando alguien
 *  visita la URL /api/notion de nuestra web.
 * ============================================================
 */

// ── IDs de las bases de datos en Notion ─────────────────────
// Estos IDs los podés ver en la URL de cada base de datos
// dentro de Notion. Son únicos e inamovibles.

const CAT_DB  = '388459f1-13f9-81ff-8fdb-dd059d486bfe'; // Base "Categorías"
const PROD_DB = '388459f1-13f9-813d-927f-dab6a371335f'; // Base "Productos"


/*
 * notionQuery(dbId, body)
 * ───────────────────────
 * Función auxiliar que hace una consulta (query) a una base
 * de datos de Notion y devuelve los resultados como JSON.
 *
 * Parámetros:
 *   dbId  → el ID de la base de datos que queremos consultar
 *   body  → filtros y ordenamientos opcionales (objeto JSON)
 *
 * Notion requiere que le mandemos el token de acceso en el
 * header "Authorization". Ese token está guardado como
 * variable de entorno (NOTION_TOKEN) en Vercel, nunca en
 * el código.
 */
async function notionQuery(dbId, body = {}) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      // El token se lee de las variables de entorno de Vercel,
      // nunca lo escribas directamente en el código
      'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,

      // Versión de la API de Notion que estamos usando
      'Notion-Version': '2022-06-28',

      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  // Si Notion responde con un error (ej: token inválido, DB no encontrada),
  // lanzamos una excepción para detener la ejecución y devolver error al cliente
  if (!res.ok) throw new Error(`Notion error ${res.status}`);

  return res.json();
}


/*
 * handler(req, res)
 * ─────────────────
 * Esta es la función principal que Vercel ejecuta cuando
 * alguien visita /api/notion. Recibe el pedido (req) y
 * envía la respuesta (res).
 *
 * Lo que hace en orden:
 *   1. Consulta las categorías activas de Notion
 *   2. Consulta los productos disponibles de Notion
 *   3. Combina todo en un JSON y lo manda al navegador
 */
module.exports = async function handler(req, res) {
  try {

    // ── PASO 1: Obtener Categorías ───────────────────────────
    //
    // Consultamos la base "Categorías" de Notion.
    // Filtramos solo las que tienen el checkbox "Activa" = true,
    // así podés desactivar categorías desde Notion sin borrarlas.
    // Las ordenamos por el campo "Orden" (número) de menor a mayor.
    const catData = await notionQuery(CAT_DB, {
      filter: { property: 'Activa', checkbox: { equals: true } },
      sorts:  [{ property: 'Orden', direction: 'ascending' }],
    });

    // Transformamos la respuesta de Notion (que es muy verbose)
    // a un objeto simple con solo los datos que necesitamos.
    // Notion devuelve cada campo adentro de "properties" con
    // su tipo (title, rich_text, number, etc.)
    const categories = catData.results.map(r => ({
      id:   r.id,   // ID único de la página en Notion (lo usamos para vincular productos)
      name: r.properties.Nombre.title[0]?.plain_text    || '', // Ej: "Guampas"
      slug: r.properties.Slug.rich_text[0]?.plain_text  || '', // Ej: "guampas" (para filtrar en la web)
    }));

    // ── PASO 2: Crear mapa de ID → slug ─────────────────────
    //
    // Los productos en Notion guardan la categoría como una
    // "relación" (relation), que es simplemente el ID de la
    // página de la categoría. Necesitamos convertir ese ID
    // al slug legible (ej: "guampas") para usarlo en la web.
    //
    // Este objeto queda así: { "388459f1-...": "guampas", ... }
    const catMap = Object.fromEntries(categories.map(c => [c.id, c.slug]));


    // ── PASO 3: Obtener Productos ────────────────────────────
    //
    // Consultamos la base "Productos" de Notion.
    // Filtramos solo los que tienen "Disponible" = true,
    // así podés ocultar productos temporalmente desde Notion.
    // Los ordenamos alfabéticamente por nombre.
    const prodData = await notionQuery(PROD_DB, {
      filter: { property: 'Disponible', checkbox: { equals: true } },
      sorts:  [{ property: 'Nombre', direction: 'ascending' }],
    });

    // Transformamos cada producto a un objeto simple
    const products = prodData.results.map(r => {
      const p = r.properties; // Acceso directo a las propiedades del producto

      // Buscamos la categoría: Notion guarda la relación como
      // un array de IDs. Tomamos el primer ID y lo convertimos
      // al slug usando el mapa que armamos arriba.
      const catId = p['Categoría']?.relation?.[0]?.id;

      // ── Imagen del producto ──────────────────────────────
      // Tenemos dos formas de guardar fotos en Notion:
      //
      //   Opción A — "Foto" (Files & Media):
      //     El usuario sube la imagen directamente en Notion.
      //     Notion la guarda en sus servidores y nos da una URL.
      //     Puede ser de tipo 'file' (subida por el usuario) o
      //     'external' (link externo pegado en Notion).
      //
      //   Opción B — "Imagen URL" (campo URL):
      //     El usuario pega directamente una URL de imagen
      //     externa (ej: de Vercel Blob, Cloudinary, etc.)
      //
      // Primero intentamos la Opción A. Si no hay foto subida,
      // usamos la Opción B. Si tampoco hay, img queda null.
      const fotoFile = p.Foto?.files?.[0];
      const img = fotoFile
        ? (fotoFile.type === 'external' ? fotoFile.external.url : fotoFile.file.url)
        : (p['Imagen URL']?.url || null);

      // Devolvemos el producto con solo los campos que necesita la web
      return {
        id:          r.id,          // ID único del producto en Notion
        name:        p.Nombre.title[0]?.plain_text              || '', // Nombre del producto
        category:    catId ? catMap[catId] : '',                       // Slug de la categoría (ej: "guampas")
        price:       p.Precio?.number                           || 0,  // Precio en Guaraníes
        description: p['Descripción']?.rich_text[0]?.plain_text || '', // Descripción larga
        badge:       p.Badge?.rich_text[0]?.plain_text          || null, // Etiqueta (ej: "Más vendido")
        img,                                                           // URL de la imagen
        model:       p['Modelo 3D']?.url                        || null, // URL del modelo .glb (opcional)
        destacado:   p.Destacado?.checkbox                      || false, // ¿Aparece destacado?
        stock:       p.Stock?.number                            ?? null,  // Unidades disponibles (null = sin control)
      };
    });


    // ── PASO 4: Enviar respuesta al navegador ────────────────
    //
    // Cache-Control le dice a Vercel que guarde esta respuesta
    // en caché durante 60 segundos. Durante ese tiempo, si otro
    // usuario visita la web, Vercel le da la respuesta guardada
    // sin volver a consultar Notion (más rápido).
    // Después de 60s, sirve la caché mientras renueva en segundo plano
    // (stale-while-revalidate=300 = hasta 5 minutos).
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    // Enviamos las categorías y productos juntos en un solo JSON
    res.json({ categories, products });

  } catch (err) {
    // Si algo salió mal (Notion caído, token inválido, etc.),
    // registramos el error en los logs de Vercel y devolvemos
    // un error 500 al navegador.
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
