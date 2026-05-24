export const config = { runtime: 'edge' };

const LANG_MAP = { F: '4', G: '3', E: '1', I: '7', S: '5', P: '9', J: '10' };
const COND_MAP = { NM: '1', EX: '2', GD: '3', LP: '4', PL: '5', PO: '6' };

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'suggest';
  const query = searchParams.get('q') || '';
  const lang = searchParams.get('lang') || 'F';
  const condition = searchParams.get('condition') || 'EX';
  const productUrl = searchParams.get('url') || '';

  const apiKey = process.env.SCRAPER_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Clé API manquante — configure SCRAPER_API_KEY dans Vercel.' }), { status: 500, headers });
  }

  async function scrape(targetUrl) {
    const scraperUrl = `http://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=false`;
    const res = await fetch(scraperUrl);
    if (res.status === 403) throw new Error('quota_exceeded');
    if (!res.ok) throw new Error(`Erreur ScraperAPI (${res.status})`);
    return res.text();
  }

  try {

    // ── ACTION 1 : suggestions ───────────────────────────
    if (action === 'suggest') {
      if (!query) return new Response(JSON.stringify({ results: [] }), { status: 200, headers });

      const searchUrl = `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(query)}`;
      let html;
      try {
        html = await scrape(searchUrl);
      } catch(e) {
        if (e.message === 'quota_exceeded') {
          return new Response(JSON.stringify({
            error: 'quota_exceeded',
            message: 'Limite mensuelle atteinte (1000 requêtes gratuites). Renouvellement le 1er du mois prochain.'
          }), { status: 429, headers });
        }
        throw e;
      }

      const results = [];

      // Pattern exact basé sur le vrai HTML de Cardmarket :
      // <a href="/fr/Pokemon/Products/Singles/SET/CARD" class="card ... galleryBox">
      // ...
      // <h2 class="card-title h3">...[icon]...&nbsp;NOM DE LA CARTE  (SET 000)</h2>
      const pattern = /<a\s+href="(\/fr\/Pokemon\/Products\/Singles\/[^"]+)"\s+class="[^"]*galleryBox[^"]*">[\s\S]*?<h2[^>]*>[\s\S]*?&nbsp;([^<]+)<\/h2>/gi;
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const path = match[1];
        const name = match[2].trim();
        if (name && name.length > 1 && !results.find(r => r.path === path)) {
          results.push({ name, path, url: `https://www.cardmarket.com${path}` });
        }
        if (results.length >= 30) break;
      }

      return new Response(JSON.stringify({ results, searchUrl, total: results.length }), { status: 200, headers });
    }

    // ── ACTION 2 : prix ──────────────────────────────────
    if (action === 'prices') {
      if (!productUrl) return new Response(JSON.stringify({ error: 'URL manquante' }), { status: 400, headers });

      const langId = LANG_MAP[lang] || '4';
      const condId = COND_MAP[condition] || '2';
      const filteredUrl = `${productUrl}?idLanguage=${langId}&minCondition=${condId}`;

      let html;
      try {
        html = await scrape(filteredUrl);
      } catch(e) {
        if (e.message === 'quota_exceeded') {
          return new Response(JSON.stringify({
            error: 'quota_exceeded',
            message: 'Limite mensuelle atteinte (1000 requêtes gratuites). Renouvellement le 1er du mois prochain.'
          }), { status: 429, headers });
        }
        throw e;
      }

      const prices = [];
      const pricePattern = /([0-9]+,[0-9]{2})\s*€/g;
      let match;
      while ((match = pricePattern.exec(html)) !== null) {
        const price = parseFloat(match[1].replace(',', '.'));
        if (price > 0.01 && price < 10000 && !prices.includes(price)) {
          prices.push(price);
        }
        if (prices.length >= 20) break;
      }

      prices.sort((a, b) => a - b);
      const top5 = prices.slice(0, 5);

      if (top5.length === 0) {
        return new Response(JSON.stringify({
          error: 'Aucune offre trouvée avec ces filtres',
          productUrl: filteredUrl
        }), { status: 404, headers });
      }

      return new Response(JSON.stringify({ prices: top5, productUrl: filteredUrl }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Action inconnue' }), { status: 400, headers });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message || 'Erreur serveur' }), { status: 500, headers });
  }
}
