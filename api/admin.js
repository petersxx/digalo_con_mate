const CAT_DB  = '388459f1-13f9-81ff-8fdb-dd059d486bfe';
const PROD_DB = '388459f1-13f9-813d-927f-dab6a371335f';

function notionHeaders() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };
}

async function queryAll(dbId, body = {}) {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify(cursor ? { ...body, start_cursor: cursor } : body),
    });
    if (!res.ok) throw new Error(`Notion ${res.status}`);
    const d = await res.json();
    results.push(...d.results);
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor);
  return results;
}

async function notionCreate(dbId, properties) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({ parent: { database_id: dbId }, properties }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.message || `Notion ${res.status}`);
  return d;
}

async function notionUpdate(pageId, properties, archived) {
  const body = { properties };
  if (archived !== undefined) body.archived = archived;
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(),
    body: JSON.stringify(body),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.message || `Notion ${res.status}`);
  return d;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// ── Mapeo Notion → objeto simple ─────────────────────────────

function parseProduct(r) {
  const p = r.properties;
  const fotoFiles = p.Foto?.files || [];
  const imgs = fotoFiles
    .map(f => (f.type === 'external' ? f.external?.url : f.file?.url))
    .filter(Boolean);
  if (!imgs.length && p['Imagen URL']?.url) imgs.push(p['Imagen URL'].url);
  return {
    id:          r.id,
    name:        p.Nombre?.title[0]?.plain_text        || '',
    categoryId:  p['Categoría']?.relation?.[0]?.id     || null,
    price:       p.Precio?.number                      || 0,
    priceOld:    p['Precio anterior']?.number          || null,
    description: p['Descripción']?.rich_text[0]?.plain_text || '',
    badge:       p.Badge?.rich_text[0]?.plain_text     || '',
    stock:       p.Stock?.number                       ?? null,
    disponible:  p.Disponible?.checkbox                ?? true,
    destacado:   p.Destacado?.checkbox                 ?? false,
    imgs,
    img:         imgs[0] || null,
    model:       p['Modelo 3D']?.url                   || null,
  };
}

function parseCategory(r) {
  const p = r.properties;
  return {
    id:     r.id,
    name:   p.Nombre?.title[0]?.plain_text           || '',
    slug:   p.Slug?.rich_text[0]?.plain_text         || '',
    order:  p.Orden?.number                          ?? 0,
    active: p.Activa?.checkbox                       ?? false,
  };
}

// ── Mapeo objeto simple → propiedades Notion ─────────────────

function productToNotion(data) {
  const props = {};
  if ('name' in data)
    props.Nombre = { title: [{ text: { content: String(data.name) } }] };
  if ('categoryId' in data)
    props['Categoría'] = { relation: data.categoryId ? [{ id: data.categoryId }] : [] };
  if ('price' in data)
    props.Precio = { number: Number(data.price) };
  if ('priceOld' in data)
    props['Precio anterior'] = { number: data.priceOld ? Number(data.priceOld) : null };
  if ('description' in data)
    props['Descripción'] = { rich_text: data.description ? [{ text: { content: String(data.description) } }] : [] };
  if ('badge' in data)
    props.Badge = { rich_text: data.badge ? [{ text: { content: String(data.badge) } }] : [] };
  if ('stock' in data)
    props.Stock = { number: data.stock !== null && data.stock !== '' ? Number(data.stock) : null };
  if ('disponible' in data)
    props.Disponible = { checkbox: Boolean(data.disponible) };
  if ('destacado' in data)
    props.Destacado = { checkbox: Boolean(data.destacado) };
  if ('imgs' in data)
    props.Foto = {
      files: (data.imgs || []).map(url => ({
        type: 'external',
        name: url.split('/').pop().split('?')[0] || 'image',
        external: { url },
      })),
    };
  if ('model' in data)
    props['Modelo 3D'] = { url: data.model || null };
  return props;
}

function categoryToNotion(data) {
  const props = {};
  if ('name' in data)
    props.Nombre = { title: [{ text: { content: String(data.name) } }] };
  if ('slug' in data)
    props.Slug = { rich_text: [{ text: { content: String(data.slug) } }] };
  if ('order' in data)
    props.Orden = { number: Number(data.order) };
  if ('active' in data)
    props.Activa = { checkbox: Boolean(data.active) };
  return props;
}

// ── Handler principal ─────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const { resource, id } = req.query;

  try {
    // GET — listar recursos
    if (req.method === 'GET') {
      if (resource === 'products') {
        const rows = await queryAll(PROD_DB, { sorts: [{ property: 'Nombre', direction: 'ascending' }] });
        return res.json(rows.map(parseProduct));
      }
      if (resource === 'categories') {
        const rows = await queryAll(CAT_DB, { sorts: [{ property: 'Orden', direction: 'ascending' }] });
        return res.json(rows.map(parseCategory));
      }
      return res.status(400).json({ error: 'resource inválido' });
    }

    const body = await readBody(req);

    // POST — crear
    if (req.method === 'POST') {
      if (resource === 'products') {
        const page = await notionCreate(PROD_DB, productToNotion(body));
        return res.json(parseProduct(page));
      }
      if (resource === 'categories') {
        const page = await notionCreate(CAT_DB, categoryToNotion(body));
        return res.json(parseCategory(page));
      }
    }

    // PATCH — actualizar
    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'Falta id' });
      if (resource === 'products') {
        const page = await notionUpdate(id, productToNotion(body));
        return res.json(parseProduct(page));
      }
      if (resource === 'categories') {
        const page = await notionUpdate(id, categoryToNotion(body));
        return res.json(parseCategory(page));
      }
    }

    // DELETE — archivar
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'Falta id' });
      await notionUpdate(id, {}, true);
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
