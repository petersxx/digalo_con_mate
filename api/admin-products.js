const { validateToken } = require('./_auth');

const PROD_DB = '388459f1-13f9-813d-927f-dab6a371335f';
const NOTION_VER = '2022-06-28';

function headers() {
  return {
    'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': NOTION_VER,
    'Content-Type': 'application/json',
  };
}

async function notionQuery(body = {}) {
  const res = await fetch(`https://api.notion.com/v1/databases/${PROD_DB}/query`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
  return res.json();
}

async function notionPatch(pageId, body) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH', headers: headers(), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
  return res.json();
}

async function notionCreate(properties) {
  const res = await fetch(`https://api.notion.com/v1/pages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ parent: { database_id: PROD_DB }, properties }),
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
  return res.json();
}

function mapRow(r) {
  const p = r.properties || {};
  const catId = p['Categoría']?.relation?.[0]?.id || null;
  const fotoFile = p.Foto?.files?.[0];
  const img = fotoFile
    ? (fotoFile.type === 'external' ? fotoFile.external?.url : fotoFile.file?.url)
    : (p['Imagen URL']?.url || null);
  return {
    id:          r.id,
    name:        p.Nombre?.title[0]?.plain_text       || '',
    categoryId:  catId,
    price:       p.Precio?.number                     || 0,
    description: p['Descripción']?.rich_text[0]?.plain_text || '',
    badge:       p.Badge?.rich_text[0]?.plain_text    || '',
    img,
    available:   p.Disponible?.checkbox               ?? true,
    destacado:   p.Destacado?.checkbox                || false,
  };
}

function buildProperties(data) {
  const props = {};
  if (data.name !== undefined)
    props.Nombre = { title: [{ text: { content: data.name } }] };
  if (data.price !== undefined)
    props.Precio = { number: Number(data.price) || 0 };
  if (data.description !== undefined)
    props['Descripción'] = { rich_text: data.description ? [{ text: { content: data.description } }] : [] };
  if (data.badge !== undefined)
    props.Badge = { rich_text: data.badge ? [{ text: { content: data.badge } }] : [] };
  if (data.img !== undefined) {
    props['Imagen URL'] = { url: data.img || null };
    props.Foto = data.img
      ? { files: [{ name: 'imagen', type: 'external', external: { url: data.img } }] }
      : { files: [] };
  }
  if (data.available !== undefined)
    props.Disponible = { checkbox: Boolean(data.available) };
  if (data.destacado !== undefined)
    props.Destacado = { checkbox: Boolean(data.destacado) };
  if (data.categoryId !== undefined)
    props['Categoría'] = { relation: data.categoryId ? [{ id: data.categoryId }] : [] };
  return props;
}

module.exports = async function handler(req, res) {
  if (!validateToken(req.headers.authorization)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    if (req.method === 'GET') {
      const data = await notionQuery({ sorts: [{ property: 'Nombre', direction: 'ascending' }] });
      return res.json({ products: data.results.map(mapRow) });
    }

    if (req.method === 'POST') {
      const props = buildProperties(req.body || {});
      const page = await notionCreate(props);
      return res.json({ product: mapRow(page) });
    }

    if (req.method === 'PUT') {
      const { id, ...data } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID requerido' });
      const props = buildProperties(data);
      const page = await notionPatch(id, { properties: props });
      return res.json({ product: mapRow(page) });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'ID requerido' });
      await notionPatch(id, { archived: true });
      return res.json({ ok: true });
    }

    res.status(405).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
