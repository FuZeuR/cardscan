export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q') || '';

  if (!query) return new Response(JSON.stringify({ results: [] }), { status: 200, headers });

  const apiKey = process.env.SCRAPER_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'Clé API manquante.' }), { status: 500, headers });

  const searchUrl = `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(query)}&idCategory=51`;

  try {
    const scraperUrl = `http://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(searchUrl)}&render=false&timeout=8000`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(scraperUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.status === 403) {
      return new Response(JSON.stringify({
        error: 'quota_exceeded',
        message: 'Limite mensuelle atteinte (1000 requêtes gratuites). Renouvellement le 1er du mois prochain.'
      }), { status: 429, headers });
    }
    if (!res.ok) throw new Error(`Erreur ScraperAPI (${res.status})`);

    const html = await res.text();
    const results = [];

    // Pattern large basé sur le vrai HTML Cardmarket
    // <a href="/fr/Pokemon/Products/Singles/SET/CARTE" class="card ... galleryBox">
    // ...&nbsp;NOM (SET 000)</h2>
    const pattern = /<a\s+href="(\/fr\/Pokemon\/Products\/Singles\/[^"?]+)"\s+class="[^"]*galleryBox[^"]*">[\s\S]*?&nbsp;([^<]+)<\/h2>/gi;
    let match;

    while ((match = pattern.exec(html)) !== null) {
      const path = match[1];
      const name = match[2].replace(/\s+/g, ' ').trim();
      if (name && name.length > 1 && !results.find(r => r.path === path)) {
        results.push({ name, path, url: `https://www.cardmarket.com${path}` });
      }
      if (results.length >= 30) break;
    }

    // Fallback si le pattern principal ne trouve rien
    if (results.length === 0) {
      const fallback = /<a[^>]+href="(\/fr\/Pokemon\/Products\/Singles\/([^"?\/]+)\/([^"?\/]+))[^"]*"\s+class="[^"]*galleryBox[^"]*"/gi;
      while ((match = fallback.exec(html)) !== null && results.length < 30) {
        const path = match[1];
        const cardSlug = match[3].replace(/-/g, ' ');
        if (!results.find(r => r.path === path)) {
          results.push({ name: cardSlug, path, url: `https://www.cardmarket.com${path}` });
        }
      }
    }

    return new Response(JSON.stringify({ results, searchUrl, total: results.length }), { status: 200, headers });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message || 'Erreur serveur' }), { status: 500, headers });
  }
}
