const { validateToken } = require('./_auth');

const CAT_DB = '388459f1-13f9-81ff-8fdb-dd059d486bfe';

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
  if (!res.ok) throw new Error(`Notion error ${res.status}: ${await res.text()}`);
  return res.json();
}

module.exports = async function handler(req, res) {
  if (!validateToken(req.headers.authorization)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const data = await notionQuery(CAT_DB, {
      sorts: [{ property: 'Orden', direction: 'ascending' }],
    });
    const categories = data.results.map(r => ({
      id:   r.id,
      name: r.properties.Nombre?.title[0]?.plain_text || '',
      slug: r.properties.Slug?.rich_text[0]?.plain_text || '',
    }));
    res.json({ categories });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
