/*
 * ============================================================
 *  api/sitemap.js  —  Sitemap XML dinámico
 * ============================================================
 *
 *  Genera /sitemap.xml (via rewrite en vercel.json) con la
 *  home y una URL por cada producto disponible en Notion, para
 *  que Google pueda descubrir e indexar cada producto.
 * ============================================================
 */

const PROD_DB = '388459f1-13f9-813d-927f-dab6a371335f';
const BASE_URL = 'https://jakay-u.com';

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function notionQuery(dbId, body = {}) {
  // Recorre todas las páginas de resultados de Notion (100 por página)
  // para que el sitemap incluya todos los productos del catálogo.
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cursor ? { ...body, start_cursor: cursor } : body),
    });
    if (!res.ok) throw new Error(`Notion error ${res.status}`);
    const d = await res.json();
    results.push(...d.results);
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor);
  return { results };
}

module.exports = async function handler(req, res) {
  const urls = [{ loc: `${BASE_URL}/`, priority: '1.0' }];

  try {
    const prodData = await notionQuery(PROD_DB, {
      filter: { property: 'Disponible', checkbox: { equals: true } },
    });

    prodData.results.forEach(r => {
      const name = r.properties.Nombre.title[0]?.plain_text || '';
      const shortId = r.id.replace(/-/g, '').slice(-8);
      const slug = `${slugify(name)}-${shortId}`;
      urls.push({ loc: `${BASE_URL}/producto/${slug}`, priority: '0.8' });
    });
  } catch (err) {
    console.error(err);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
};
