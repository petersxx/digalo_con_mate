const CAT_DB  = '388459f1-13f9-81ff-8fdb-dd059d486bfe';
const PROD_DB = '388459f1-13f9-813d-927f-dab6a371335f';

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

module.exports = async function handler(req, res) {
  try {
    // Categorías activas ordenadas
    const catData = await notionQuery(CAT_DB, {
      filter: { property: 'Activa', checkbox: { equals: true } },
      sorts:  [{ property: 'Orden', direction: 'ascending' }],
    });

    const categories = catData.results.map(r => ({
      id:   r.id,
      name: r.properties.Nombre.title[0]?.plain_text || '',
      slug: r.properties.Slug.rich_text[0]?.plain_text || '',
    }));

    // Mapa ID de página → slug para resolver relaciones
    const catMap = Object.fromEntries(categories.map(c => [c.id, c.slug]));

    // Productos disponibles
    const prodData = await notionQuery(PROD_DB, {
      filter: { property: 'Disponible', checkbox: { equals: true } },
      sorts:  [{ property: 'Nombre', direction: 'ascending' }],
    });

    const products = prodData.results.map(r => {
      const p = r.properties;
      const catId = p['Categoría']?.relation?.[0]?.id;

      // Foto: primero Files & Media, después Imagen URL como fallback
      const fotoFile = p.Foto?.files?.[0];
      const img = fotoFile
        ? (fotoFile.type === 'external' ? fotoFile.external.url : fotoFile.file.url)
        : (p['Imagen URL']?.url || null);

      return {
        id:          r.id,
        name:        p.Nombre.title[0]?.plain_text              || '',
        category:    catId ? catMap[catId] : '',
        price:       p.Precio?.number                           || 0,
        description: p['Descripción']?.rich_text[0]?.plain_text || '',
        badge:       p.Badge?.rich_text[0]?.plain_text          || null,
        img,
        model:       p['Modelo 3D']?.url                        || null,
        destacado:   p.Destacado?.checkbox                      || false,
      };
    });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.json({ categories, products });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
