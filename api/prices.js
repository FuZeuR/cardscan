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
  const lang = searchParams.get('lang') || 'F';
  const condition = searchParams.get('condition') || 'EX';
  const productUrl = searchParams.get('url') || '';

  const apiKey = process.env.SCRAPER_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Clé API manquante.' }), { status: 500, headers });
  }

  if (!productUrl) return new Response(JSON.stringify({ error: 'URL manquante' }), { status: 400, headers });

  const langId = LANG_MAP[lang] || '4';
  const condId = COND_MAP[condition] || '2';
  const filteredUrl = `${productUrl}?idLanguage=${langId}&minCondition=${condId}`;

  try {
    const scraperUrl = `http://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(filteredUrl)}&render=false`;
    const res = await fetch(scraperUrl);

    if (res.status === 403) {
      return new Response(JSON.stringify({
        error: 'quota_exceeded',
        message: 'Limite mensuelle atteinte (1000 requêtes gratuites). Renouvellement le 1er du mois prochain.'
      }), { status: 429, headers });
    }
    if (!res.ok) throw new Error(`Erreur ScraperAPI (${res.status})`);

    const html = await res.text();
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

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message || 'Erreur serveur' }), { status: 500, headers });
  }
}
