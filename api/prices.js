export const config = { runtime: 'edge' };

// Codes langue Cardmarket (idLanguage dans l'URL)
const LANG_MAP = {
  F: '2',   // Français
  E: '1',   // Anglais
  G: '3',   // Allemand
  S: '4',   // Espagnol
  I: '5',   // Italien
  PT: '8',  // Portugais
  KO: '9',  // Coréen
  TW: '10', // Chinois traditionnel
  SC: '11', // Chinois simplifié
  J: '6',   // Japonais
  PL: '12', // Polonais
  RU: '13', // Russe
};

// Positions du sprite des drapeaux dans le CSS Cardmarket
// background-position dans ssMain2.png
const LANG_FLAG_POS = {
  '1': '-16px -0px',   // Anglais
  '2': '-32px -0px',   // Français
  '3': '-48px -0px',   // Allemand
  '4': '-64px -0px',   // Espagnol
  '5': '-80px -0px',   // Italien
  '6': '-96px -0px',   // Japonais
  '7': '-112px -0px',  // Chinois simplifié
  '8': '-128px -0px',  // Portugais
  '9': '-144px -0px',  // Coréen
  '10': '-160px -0px', // Chinois traditionnel
  '11': '-176px -0px', // Polonais
  '12': '-192px -0px', // Russe
};

// Codes condition Cardmarket
const COND_MAP = {
  MT: '1',  // Mint
  NM: '2',  // Near Mint
  EX: '3',  // Excellent
  GD: '4',  // Good
  LP: '5',  // Light Played
  PL: '6',  // Played
  PO: '7',  // Poor
};

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
    return new Response(JSON.stringify({ error: 'Clé API manquante.' }), { status: 500, headers });
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
      const pattern = /<a\s+href="(\/fr\/Pokemon\/Products\/Singles\/[^"?]+)"\s+class="[^"]*galleryBox[^"]*">[\s\S]*?&nbsp;([^<]+)<\/h2>/gi;
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

    // ── ACTION 2 : prix filtrés par langue ET condition ──
    if (action === 'prices') {
      if (!productUrl) return new Response(JSON.stringify({ error: 'URL manquante' }), { status: 400, headers });

      const langId = LANG_MAP[lang] || '2';
      const condId = COND_MAP[condition] || '3';
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

      // Découpage par ligne d'article
      const prices = [];
      const langFlagPos = LANG_FLAG_POS[langId];

      // Pattern pour chaque ligne article
      const rowPattern = /class="row g-0 article-row">([\s\S]*?)(?=class="row g-0 article-row"|table-footer|loadMore)/g;
      let rowMatch;

      while ((rowMatch = rowPattern.exec(html)) !== null) {
        const rowHtml = rowMatch[1];

        // Vérifier la langue : chercher la position du drapeau dans cette ligne
        // ssMain2.png contient les drapeaux avec des background-position spécifiques
        const hasLang = langFlagPos
          ? rowHtml.includes(`background-position: ${langFlagPos}`) ||
            rowHtml.includes(`background-position:${langFlagPos}`)
          : true;

        if (!hasLang) continue;

        // Extraire le prix
        const priceMatch = rowHtml.match(/fw-bold[^"]*">\s*([0-9]+,[0-9]{2})\s*€/);
        if (!priceMatch) continue;

        const price = parseFloat(priceMatch[1].replace(',', '.'));
        if (price > 0 && price < 10000) {
          prices.push(price);
        }

        if (prices.length >= 20) break;
      }

      // Fallback si le filtre par drapeau n'a rien trouvé
      if (prices.length === 0) {
        const fallbackPattern = /fw-bold[^"]*">\s*([0-9]+,[0-9]{2})\s*€/g;
        let m;
        while ((m = fallbackPattern.exec(html)) !== null && prices.length < 20) {
          const price = parseFloat(m[1].replace(',', '.'));
          if (price > 0 && price < 10000) prices.push(price);
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

      return new Response(JSON.stringify({ prices: top5, productUrl: filteredUrl }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Action inconnue' }), { status: 400, headers });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message || 'Erreur serveur' }), { status: 500, headers });
  }
}
