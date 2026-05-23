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
  const action = searchParams.get('action') || 'search';
  const query = searchParams.get('q') || '';
  const lang = searchParams.get('lang') || 'F';
  const condition = searchParams.get('condition') || 'EX';
  const productUrl = searchParams.get('url') || '';

  const fetchHeaders = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9',
  };

  try {
    // ── ACTION 1 : suggestions de recherche ──────────────
    if (action === 'suggest') {
      if (!query) return new Response(JSON.stringify({ results: [] }), { status: 200, headers });

      const url = `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: fetchHeaders });
      if (!res.ok) throw new Error(`Cardmarket inaccessible (${res.status})`);
      const html = await res.text();

      // Extraction des résultats de recherche
      const results = [];
      // Pattern pour les cartes dans les résultats de recherche Cardmarket
      const cardPattern = /href="(\/fr\/Pokemon\/Products\/Singles\/[^"]+)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
      let match;
      while ((match = cardPattern.exec(html)) !== null && results.length < 15) {
        const path = match[1];
        const name = match[2].trim();
        if (name && !results.find(r => r.path === path)) {
          results.push({ name, path, url: `https://www.cardmarket.com${path}` });
        }
      }

      // Fallback : extraction plus large si le pattern précédent ne trouve rien
      if (results.length === 0) {
        const fallback = /href="(\/fr\/Pokemon\/Products\/Singles\/([^"\/]+)\/([^"]+))"/gi;
        while ((match = fallback.exec(html)) !== null && results.length < 15) {
          const path = match[1];
          const setSlug = match[2];
          const cardSlug = match[3].split('?')[0];
          const name = cardSlug.replace(/-/g, ' ');
          if (!results.find(r => r.path === path)) {
            results.push({ name, path, url: `https://www.cardmarket.com${path}` });
          }
        }
      }

      return new Response(JSON.stringify({ results, searchUrl: url }), { status: 200, headers });
    }

    // ── ACTION 2 : prix d'une carte précise ──────────────
    if (action === 'prices') {
      if (!productUrl) return new Response(JSON.stringify({ error: 'URL manquante' }), { status: 400, headers });

      const langId = LANG_MAP[lang] || '4';
      const condId = COND_MAP[condition] || '2';
      const filteredUrl = `${productUrl}?idLanguage=${langId}&minCondition=${condId}`;

      const res = await fetch(filteredUrl, { headers: fetchHeaders });
      if (!res.ok) throw new Error(`Cardmarket inaccessible (${res.status})`);
      const html = await res.text();

      const prices = [];
      const pricePattern = /([0-9]+,[0-9]{2})\s*€/g;
      let match;
      while ((match = pricePattern.exec(html)) !== null && prices.length < 20) {
        const price = parseFloat(match[1].replace(',', '.'));
        if (price > 0.01 && price < 10000 && !prices.includes(price)) {
          prices.push(price);
        }
      }

      prices.sort((a, b) => a - b);
      const top5 = prices.slice(0, 5);

      if (top5.length === 0) {
        return new Response(JSON.stringify({
          error: 'Aucune offre trouvée avec ces filtres',
          productUrl: filteredUrl
        }), { status: 404, headers });
      }

      return new Response(JSON.stringify({
        prices: top5,
        productUrl: filteredUrl
      }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Action inconnue' }), { status: 400, headers });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message || 'Erreur serveur' }), { status: 500, headers });
  }
}
