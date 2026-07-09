/*
 * ============================================================
 *  api/product.js  —  SSR de meta tags para /producto/:slug
 * ============================================================
 *
 *  ¿POR QUÉ EXISTE ESTE ARCHIVO?
 *  index.html es una SPA: el catálogo se carga con JS después
 *  de que la página ya llegó al navegador. Eso funciona bien
 *  para usuarios, pero los bots que generan la vista previa de
 *  un link (WhatsApp, Facebook, Twitter/X, Slack, etc.) NO
 *  ejecutan JavaScript — solo leen el <head> del HTML tal cual
 *  llega del servidor.
 *
 *  Por eso, cuando alguien visita /producto/:slug (vercel.json
 *  reescribe esa ruta hacia esta función), este archivo:
 *    1. Busca el producto correspondiente en Notion
 *    2. Toma el index.html tal cual
 *    3. Reemplaza el <title> y los meta tags (description, OG,
 *       Twitter, canonical) por los datos de ESE producto
 *    4. Devuelve el HTML resultante
 *
 *  El resto de la página (CSS, JS, SPA) queda intacto: una vez
 *  cargado, el mismo script de siempre detecta la URL y muestra
 *  el detalle del producto (ver "Enrutamiento inicial" en el
 *  <script> de index.html).
 * ============================================================
 */

const fs   = require('fs');
const path = require('path');

const PROD_DB = '388459f1-13f9-813d-927f-dab6a371335f';
const BASE_URL = 'https://jakay-u.com';
const DEFAULT_IMG = 'https://fdupxbdch3se0nwv.public.blob.vercel-storage.com/hero/hero-a.jpg';

// Debe coincidir con slugify()/productSlug() de index.html y api/sitemap.js
function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function notionQuery(dbId, body = {}) {
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion error ${res.status}`);
  return res.json();
}

// Reemplaza el content="..." de un meta tag (por name o property) manteniendo el resto del tag intacto
function replaceMetaContent(html, attr, key, value) {
  const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
  return html.replace(re, `$1${escapeHtml(value)}$2`);
}

module.exports = async function handler(req, res) {
  const baseHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const slugParam = String(req.query.slug || '');
  const shortId = slugParam.split('-').pop() || '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=50');

  try {
    const prodData = await notionQuery(PROD_DB, {
      filter: { property: 'Disponible', checkbox: { equals: true } },
    });

    const match = prodData.results.find(r => r.id.replace(/-/g, '').endsWith(shortId));
    if (!match) {
      // Producto no encontrado (link viejo, id mal formado, etc.):
      // servimos la home tal cual, el cliente redirige si hace falta.
      return res.status(200).send(baseHtml);
    }

    const p = match.properties;
    const name = p.Nombre.title[0]?.plain_text || "JAKAY'U";

    const fotoFiles = p.Foto?.files || [];
    const imgs = fotoFiles.map(f => (f.type === 'external' ? f.external.url : f.file.url));
    if (imgs.length === 0 && p['Imagen URL']?.url) imgs.push(p['Imagen URL'].url);
    const img = imgs[0] || DEFAULT_IMG;

    const rawDesc = (p['Descripción']?.rich_text[0]?.plain_text || '').replace(/\s+/g, ' ').trim();
    const description = (rawDesc || `Comprá ${name} en JAKAY'U, tienda de mate artesanal en Asunción, Paraguay. Envíos a todo el país.`).slice(0, 160);

    const canonicalSlug = `${slugify(name)}-${match.id.replace(/-/g, '').slice(-8)}`;
    const url = `${BASE_URL}/producto/${canonicalSlug}`;
    const title = `${name} | JAKAY'U — Tienda de Mates en Paraguay`;

    let html = baseHtml.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
    html = replaceMetaContent(html, 'name', 'description', description);
    html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`);
    html = replaceMetaContent(html, 'property', 'og:url', url);
    html = replaceMetaContent(html, 'property', 'og:title', title);
    html = replaceMetaContent(html, 'property', 'og:description', description);
    html = replaceMetaContent(html, 'property', 'og:image', img);
    html = replaceMetaContent(html, 'name', 'twitter:title', title);
    html = replaceMetaContent(html, 'name', 'twitter:description', description);
    html = replaceMetaContent(html, 'name', 'twitter:image', img);

    return res.status(200).send(html);
  } catch (err) {
    console.error(err);
    return res.status(200).send(baseHtml);
  }
};
