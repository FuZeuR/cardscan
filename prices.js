export const config = { runtime: 'edge' };

const LANG_MAP = { F: '4', G: '3', E: '1', I: '7', S: '5', P: '9', J: '10' };
const COND_MAP = { NM: '1', EX: '2', GD: '3', LP: '4', PL: '5', PO: '6' };

export default async function handler(req) {
  // CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  const { searchParams } = new URL(req.url);
  const cardName = searchParams.get('name') || '';
  const lang = searchParams.get('lang') || 'F';
  const condition = searchParams.get('condition') || 'EX';

  if (!cardName) {
    return new Response(JSON.stringify({ error: 'Nom de carte manquant' }), { status: 400, headers });
  }

  try {
    // Construction de l'URL de recherche Cardmarket
    const searchQuery = encodeURIComponent(cardName);
    const langId = LANG_MAP[lang] || '4';
    const condId = COND_MAP[condition] || '2';

    // Recherche sur Cardmarket
    const searchUrl = `https://www.cardmarket.com/fr/Pokemon/Products/Search?searchString=${searchQuery}&idLanguage=${langId}&minCondition=${condId}`;

    const searchRes = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Cache-Control': 'no-cache',
      }
    });

    if (!searchRes.ok) throw new Error(`Cardmarket inaccessible (${searchRes.status})`);

    const html = await searchRes.text();

    // Extraction du premier lien produit
    const productMatch = html.match(/href="(\/fr\/Pokemon\/Products\/Singles\/[^"]+)"/);
    if (!productMatch) {
      return new Response(JSON.stringify({
        error: 'Carte introuvable sur Cardmarket',
        searchUrl
      }), { status: 404, headers });
    }

    const productPath = productMatch[1];
    const productUrl = `https://www.cardmarket.com${productPath}?idLanguage=${langId}&minCondition=${condId}`;

    // Récupération de la page produit
    const productRes = await fetch(productUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      }
    });

    const productHtml = await productRes.text();

    // Extraction des prix
    const prices = [];

    // Pattern pour les prix dans les listings Cardmarket
    const pricePatterns = [
      /class="[^"]*price[^"]*"[^>]*>[\s]*([0-9]+,[0-9]{2})[\s]*€/gi,
      /([0-9]+,[0-9]{2})\s*€/g,
    ];

    for (const pattern of pricePatterns) {
      let match;
      while ((match = pattern.exec(productHtml)) !== null && prices.length < 10) {
        const priceStr = match[1].replace(',', '.');
        const price = parseFloat(priceStr);
        if (price > 0.01 && price < 10000 && !prices.includes(price)) {
          prices.push(price);
        }
      }
      if (prices.length >= 5) break;
    }

    // Tri et garde les 5 plus bas
    prices.sort((a, b) => a - b);
    const top5 = prices.slice(0, 5);

    if (top5.length === 0) {
      return new Response(JSON.stringify({
        error: 'Aucune offre trouvée avec ces filtres',
        productUrl
      }), { status: 404, headers });
    }

    return new Response(JSON.stringify({
      prices: top5,
      productUrl,
      cardName,
      lang,
      condition
    }), { status: 200, headers });

  } catch (e) {
    return new Response(JSON.stringify({
      error: e.message || 'Erreur serveur',
    }), { status: 500, headers });
  }
}
