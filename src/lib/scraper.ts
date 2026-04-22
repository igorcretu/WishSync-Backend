// scraper.ts — multi-layer product data extraction

export interface ScrapeResult {
  title: string | null;
  image: string | null;
  price: number | null;
  currency: string | null;
  store: string | null;
  storeUrl?: string | null;
  _note?: string;
}

// ---- Currency helpers ----

const ISO_TO_SYMBOL: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥',
  AUD: 'A$', CAD: 'C$', CHF: 'CHF', SEK: 'kr', NOK: 'kr',
  DKK: 'kr', PLN: 'zł', CZK: 'Kč', HUF: 'Ft', INR: '₹',
  BRL: 'R$', MXN: 'MX$', SGD: 'S$', HKD: 'HK$', NZD: 'NZ$',
  RON: 'lei', HRK: 'kn', BGN: 'лв', TRY: '₺', KRW: '₩',
  ZAR: 'R', SAR: '﷼', AED: 'د.إ', THB: '฿', MYR: 'RM',
};

function isoToSymbol(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return ISO_TO_SYMBOL[iso.toUpperCase()] ?? iso;
}

// Currency by Amazon domain
const AMAZON_CURRENCY: Record<string, string> = {
  'amazon.com': '$', 'amazon.de': '€', 'amazon.fr': '€', 'amazon.it': '€',
  'amazon.es': '€', 'amazon.nl': '€', 'amazon.se': 'kr', 'amazon.pl': 'zł',
  'amazon.co.uk': '£', 'amazon.ca': 'C$', 'amazon.com.au': 'A$',
  'amazon.co.jp': '¥', 'amazon.in': '₹', 'amazon.com.br': 'R$',
  'amazon.com.mx': 'MX$', 'amazon.ae': 'د.إ', 'amazon.sg': 'S$',
};

// Guess currency from TLD / hostname
function currencyFromHost(host: string): string | null {
  if (/\.de$|\.at$|\.be$|\.nl$|\.fr$|\.it$|\.es$|\.pt$|\.fi$|\.gr$|\.lu$|\.ie$/.test(host)) return '€';
  if (/\.co\.uk$|\.uk$/.test(host)) return '£';
  if (/\.se$/.test(host)) return 'kr';
  if (/\.pl$/.test(host)) return 'zł';
  if (/\.cz$/.test(host)) return 'Kč';
  if (/\.ro$/.test(host)) return 'lei';
  if (/\.au$/.test(host)) return 'A$';
  if (/\.ca$/.test(host)) return 'C$';
  if (/\.jp$/.test(host)) return '¥';
  if (/\.in$/.test(host)) return '₹';
  if (/\.br$/.test(host)) return 'R$';
  if (/\.tr$/.test(host)) return '₺';
  if (/\.kr$/.test(host)) return '₩';
  if (/\.za$/.test(host)) return 'R';
  if (/\.th$/.test(host)) return '฿';
  if (/\.my$/.test(host)) return 'RM';
  if (/\.sg$/.test(host)) return 'S$';
  return null;
}

// ---- Price parsing ----

function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  let s = String(raw).trim();
  // Remove common noise
  s = s.replace(/^(?:from|ab|à partir de|vanaf|da|od|fra|starting at)\s+/i, '');
  s = s.replace(/\s*\/\s*(?:month|mo|yr|year|week|wk|day|stk|pc|piece|m²).*$/i, '');
  const digits = s.replace(/[^\d.,]/g, '');
  if (!digits) return null;
  // EU: 1.299,99 or 29,99
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(digits))
    return parseFloat(digits.replace(/\./g, '').replace(',', '.'));
  // US: 1,299.99 or 29.99
  if (/^\d{1,3}(,\d{3})*\.\d{1,2}$/.test(digits))
    return parseFloat(digits.replace(/,/g, ''));
  // Plain comma decimal: 29,9 or 29,99
  if (/^\d+,\d{1,2}$/.test(digits))
    return parseFloat(digits.replace(',', '.'));
  // Plain number or integer price (e.g. 1299)
  const n = parseFloat(digits.replace(/,/g, ''));
  return isNaN(n) || n <= 0 ? null : n;
}

// ---- Amazon ----

export function tryAmazonUrl(url: string): { asin: string | null; store: string; currency: string } | null {
  if (!/amazon\.(com|de|co\.uk|fr|it|es|jp|ca|com\.au|in|nl|se|pl|com\.br|com\.mx|ae|sg)(\/|$)/.test(url)) return null;
  const asin = url.match(/\/dp\/([A-Z0-9]{10})/i)?.[1] ?? null;
  const store = url.match(/https?:\/\/(?:www\.)?([^/]+)/)?.[1] ?? 'Amazon';
  const currency = AMAZON_CURRENCY[store] ?? '$';
  return { asin, store, currency };
}

export async function tryAmazon(url: string): Promise<(ScrapeResult & { store: string }) | null> {
  const meta = tryAmazonUrl(url);
  if (!meta) return null;
  const { asin, store, currency } = meta;

  // Try fetching the real page — residential Pi IP has a good chance of working
  for (const ua of UAS.slice(0, 3)) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 12000);
      const r = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Referer': 'https://www.google.com/',
          'DNT': '1',
        },
      });
      clearTimeout(tid);
      if (!r.ok) continue;
      const html = await r.text();

      // Bail out if we got a bot challenge page
      if (/To discuss automated access to Amazon data/.test(html) || /<title[^>]*>Robot Check/.test(html)) continue;

      const meta2 = metaFrom(html);
      // Amazon uses <title> not og:title — clean up the "Amazon.com : " prefix
      const rawTitle = meta2('og:title') ?? meta2('twitter:title')
        ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
      const title = rawTitle
        ? rawTitle.replace(/^Amazon\.[a-z.]+\s*[:\|]\s*/i, '').replace(/\s*[:\|]\s*(?:Electronics|Home|Clothing|Garden|Books|Toys|Sports|Health|Beauty|Automotive|Grocery|Patio|Tools|Office|Industrial|Musical|Video Games|Pet Supplies|Baby|Movies|Music|Software|Cell Phones|Computers|Camera|Wearable Technology).*$/i, '').trim()
        : null;

      // Image: find the first real product image from the CDN (not a logo or icon)
      const imgMatch = html.match(/https:\/\/m\.media-amazon\.com\/images\/I\/([A-Za-z0-9%+]+)\._[^"'\s]*/);
      const image = imgMatch
        ? `https://m.media-amazon.com/images/I/${imgMatch[1]}._AC_SL500_.jpg`
        : (meta2('og:image') ?? null);

      // Price: Amazon buries the price in spans — try to grab it from JSON-LD or script tags
      const scripts = extractScripts(html);
      let price: number | null = null;
      for (const s of scripts) {
        // JSON-LD Product
        if (s.includes('"@type"') && s.includes('Product')) {
          try {
            const m = s.match(/\{[\s\S]*?"@type"\s*:\s*"Product"[\s\S]*?\}/);
            if (m) {
              const obj = JSON.parse(m[0]);
              const p = obj?.offers?.price ?? obj?.offers?.[0]?.price;
              if (p) { price = parsePrice(String(p)); break; }
            }
          } catch {}
        }
      }
      // Fallback: look for priceAmount in HTML
      if (!price) {
        const pm = html.match(/["']priceAmount["']\s*[:=]\s*["']?([\d.,]+)/);
        if (pm) price = parsePrice(pm[1]);
      }
      if (!price) {
        const pm = html.match(/class="a-price-whole"[^>]*>([^<]+)<\/span>/);
        if (pm) price = parsePrice(pm[1]);
      }

      if (title) return { title, image, price, currency, store, storeUrl: url };
    } catch {}
  }

  // Fallback: derive title from URL slug — better than nothing
  const slugMatch = url.match(/amazon\.[^/]+(?:\/-\/[a-z]+)?\/([^/?]+)\/dp\//i);
  const slug = slugMatch?.[1];
  const title = slug ? decodeURIComponent(slug).replace(/-/g, ' ').replace(/\s{2,}/g, ' ').trim() : null;
  return { title, image: null, price: null, currency, store };
}

// ---- Script tag extractor ----

function extractScripts(html: string): string[] {
  const scripts: string[] = [];
  const re = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1].trim()) scripts.push(m[1]);
  }
  return scripts;
}

// ---- Meta tag extractor ----

function metaFrom(html: string) {
  return (prop: string): string | null => {
    const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
    const r2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
    return (html.match(r1) ?? html.match(r2))?.[1]?.trim() ?? null;
  };
}

// ---- JSON-LD ----

function extractJsonLd(html: string): Partial<ScrapeResult> {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    try {
      const raw = block.replace(/<\/?script[^>]*>/gi, '').trim();
      const json = JSON.parse(raw);
      const nodes: any[] = Array.isArray(json) ? json : json['@graph'] ? json['@graph'] : [json];
      for (const node of nodes) {
        if (!['Product', 'IndividualProduct', 'ProductGroup'].includes(node['@type'])) continue;
        const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        const img = node.image;
        const price = offers ? parsePrice(String(offers.price ?? offers.lowPrice ?? offers.highPrice ?? '')) : null;
        return {
          title: node.name ?? null,
          image: typeof img === 'string' ? img : Array.isArray(img) ? img[0] : img?.url ?? null,
          price,
          currency: isoToSymbol(offers?.priceCurrency) ?? null,
        };
      }
    } catch {}
  }
  return {};
}

// ---- Next.js __NEXT_DATA__ ----

const NAME_KEYS  = ['name', 'title', 'productName', 'displayName', 'articleName', 'heading',
                    'label', 'itemName', 'productTitle', 'shortName', 'longName', 'caption'];
const PRICE_KEYS = ['price', 'salePrice', 'currentPrice', 'lowestPrice', 'offerPrice',
                    'regularPrice', 'discountedPrice', 'amount', 'value', 'finalPrice',
                    'sellingPrice', 'priceValue', 'numericPrice', 'listPrice', 'basePrice'];
const IMAGE_KEYS = ['image', 'imageUrl', 'src', 'primaryImage', 'mainImage', 'heroImage',
                    'coverImage', 'largeImageUrl', 'imageHref', 'imageUri', 'thumbnail',
                    'featuredImage', 'defaultImageUrl', 'cdnImageUrl'];
const SKIP_KEYS  = new Set(['_', '__', 'style', 'css', 'className', 'children', 'i18n',
                            'locale', 'translations', 'messages', 'config', 'analytics',
                            'seo', 'meta', 'head', 'scripts', 'links', 'fonts', 'icons']);

function walkForProduct(obj: any, depth: number): Partial<ScrapeResult> {
  if (depth > 12 || !obj || typeof obj !== 'object') return {};

  const hasName  = NAME_KEYS.some(k  => typeof obj[k] === 'string' && obj[k].length > 1 && obj[k].length < 300);
  const hasPrice = PRICE_KEYS.some(k => obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '');

  if (hasName && hasPrice) {
    const nk = NAME_KEYS.find(k  => typeof obj[k] === 'string' && obj[k].length > 1 && obj[k].length < 300)!;
    const pk = PRICE_KEYS.find(k => obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '')!;
    const ik = IMAGE_KEYS.find(k => typeof obj[k] === 'string' && obj[k].length > 4 && /^https?:\/\//.test(obj[k]));
    const priceVal = obj[pk];
    const price = parsePrice(typeof priceVal === 'object' ? String(priceVal?.amount ?? priceVal?.value ?? '') : String(priceVal));
    if (price) return { title: obj[nk], price, image: ik ? obj[ik] : null };
  }

  let best: Partial<ScrapeResult> = {};
  for (const key of Object.keys(obj)) {
    if (SKIP_KEYS.has(key) || key.startsWith('_') || key.startsWith('$')) continue;
    const child = obj[key];
    if (!child || typeof child !== 'object') continue;
    const found = walkForProduct(child, depth + 1);
    if (found.title && found.price) return found;
    if (found.title && !best.title) best = found;
  }
  return best;
}

function extractNextData(html: string): Partial<ScrapeResult> {
  const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return {};
  try { return walkForProduct(JSON.parse(m[1]), 0); } catch { return {}; }
}

// ---- GTM dataLayer ----

function extractDataLayer(scripts: string[]): Partial<ScrapeResult> {
  const items: any[] = [];

  for (const s of scripts) {
    // Initial assignment
    const initM = s.match(/dataLayer\s*=\s*(\[[\s\S]*?\])\s*;/);
    if (initM) {
      try { items.push(...JSON.parse(initM[1])); } catch {}
    }
    // Individual pushes
    const pushRe = /dataLayer\.push\(\s*(\{[\s\S]*?\})\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = pushRe.exec(s)) !== null) {
      try { items.push(JSON.parse(m[1])); } catch {}
    }
  }

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    // GA4 view_item
    const ga4Items = item?.ecommerce?.items;
    if (Array.isArray(ga4Items) && ga4Items[0]) {
      const p = ga4Items[0];
      const name = p.item_name ?? p.name;
      const price = parsePrice(String(p.price ?? ''));
      if (name) return { title: name, price };
    }
    // UA enhanced ecommerce detail / productClick
    const uaProducts = item?.ecommerce?.detail?.products
                    ?? item?.ecommerce?.click?.products
                    ?? item?.ecommerce?.impressions;
    if (Array.isArray(uaProducts) && uaProducts[0]) {
      const p = uaProducts[0];
      if (p.name) return { title: p.name, price: parsePrice(String(p.price ?? '')) };
    }
    // Plain product key
    if (item?.product?.name) {
      return { title: item.product.name, price: parsePrice(String(item.product.price ?? '')) };
    }
  }
  return {};
}

// ---- Nuxt.js ----

function extractNuxtData(scripts: string[]): Partial<ScrapeResult> {
  for (const s of scripts) {
    const m = s.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*$/);
    if (m) {
      try { const r = walkForProduct(JSON.parse(m[1]), 0); if (r.title) return r; } catch {}
    }
    // __NUXT_DATA__ is a serialised array — too complex to decode reliably, skip
  }
  return {};
}

// ---- Apollo / GraphQL state ----

function extractApolloState(scripts: string[]): Partial<ScrapeResult> {
  for (const s of scripts) {
    const m = s.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!m) continue;
    try {
      const state = JSON.parse(m[1]);
      for (const val of Object.values(state)) {
        const obj = val as any;
        if (!obj || typeof obj !== 'object') continue;
        if (obj.__typename === 'Product' || obj.__typename === 'Listing' || obj.__typename === 'Item') {
          const title = obj.title ?? obj.name ?? obj.listingTitle;
          const priceObj = obj.price ?? obj.salePrice ?? obj.currentPrice;
          const price = priceObj
            ? parsePrice(typeof priceObj === 'object' ? String(priceObj.amount ?? priceObj.value ?? '') : String(priceObj))
            : null;
          const image = obj.mainImage?.url ?? obj.primaryImage?.url ?? obj.images?.[0]?.url ?? obj.imageUrl;
          if (title) return { title, price, image };
        }
      }
    } catch {}
  }
  return {};
}

// ---- Generic window.X product patterns ----

function extractWindowProduct(scripts: string[]): Partial<ScrapeResult> {
  const patterns = [
    /window\.(?:pdpData|productData|__product__|currentProduct|pageData|__DATA__|__APP_DATA__|initialData|bootstrapData)\s*=\s*(\{[\s\S]*?\})\s*;/,
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/,
    /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/,
    /window\.__REDUX_STATE__\s*=\s*(\{[\s\S]*?\})\s*;/,
    /window\.__STATE__\s*=\s*(\{[\s\S]*?\})\s*;/,
    /window\.__store\s*=\s*(\{[\s\S]*?\})\s*;/,
  ];
  for (const s of scripts) {
    for (const pat of patterns) {
      const m = s.match(pat);
      if (!m) continue;
      try {
        const r = walkForProduct(JSON.parse(m[1]), 0);
        if (r.title) return r;
      } catch {}
    }
  }
  return {};
}

// ---- Embedded JSON blocks in scripts ----

function extractInlineJson(scripts: string[]): Partial<ScrapeResult> {
  // Look for var/const/let product = {...} or product: {...}
  const patterns = [
    /(?:var|const|let)\s+product\s*=\s*(\{[\s\S]*?\})\s*;/,
    /["']product["']\s*:\s*(\{[\s\S]*?\})\s*(?:,|\})/,
    /["']item["']\s*:\s*(\{[\s\S]*?\})\s*(?:,|\})/,
    /["']listing["']\s*:\s*(\{[\s\S]*?\})\s*(?:,|\})/,
  ];
  for (const s of scripts) {
    for (const pat of patterns) {
      const m = s.match(pat);
      if (!m) continue;
      try {
        const r = walkForProduct(JSON.parse(m[1]), 0);
        if (r.title && r.price) return r;
      } catch {}
    }
  }
  return {};
}

// ---- Microdata ----

function extractMicrodata(html: string): Partial<ScrapeResult> {
  const name  = (html.match(/itemprop=["']name["'][^>]+content=["']([^"']+)/i)
             ?? html.match(/itemprop=["']name["'][^>]*>([^<]+)/i))?.[1]?.trim() ?? null;
  const priceRaw = (html.match(/itemprop=["']price["'][^>]+content=["']([^"']+)/i)
                ?? html.match(/itemprop=["']price["'][^>]*>([^<]+)/i))?.[1] ?? null;
  const image = html.match(/itemprop=["']image["'][^>]+(?:src|content)=["']([^"']+)/i)?.[1] ?? null;
  const currencyRaw = html.match(/itemprop=["']priceCurrency["'][^>]+content=["']([^"']+)/i)?.[1] ?? null;
  return { title: name, price: parsePrice(priceRaw), image, currency: isoToSymbol(currencyRaw) };
}

// ---- site-specific handlers ----

function tryEbay(html: string, url: string): Partial<ScrapeResult> | null {
  if (!url.includes('ebay.')) return null;
  // eBay embeds product data in a specific script
  const m = html.match(/s\.src\s*=.*?LISTING_ITEM\s*=\s*(\{[\s\S]*?\})\s*;/)
         ?? html.match(/"displayImgUrl"\s*:\s*"([^"]+)"/);
  const title = html.match(/<h1[^>]+class=["'][^"']*x-item-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim()
             ?? html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]?.trim()
             ?? null;
  const priceRaw = html.match(/itemprop=["']price["'][^>]+content=["']([^"']+)/i)?.[1]
                ?? html.match(/data-testid=["'](?:ux-price-section|price)["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1]?.replace(/<[^>]+>/g, '').trim()
                ?? null;
  const image = html.match(/"image"\s*:\s*\{\s*"imageUrl"\s*:\s*"([^"]+)"/)?.[1]
              ?? html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1]
              ?? null;
  if (!title) return null;
  return { title, price: parsePrice(priceRaw), image };
}

function tryEtsy(html: string, url: string): Partial<ScrapeResult> | null {
  if (!url.includes('etsy.com')) return null;
  const scripts = extractScripts(html);
  for (const s of scripts) {
    const m = s.match(/"listing"\s*:\s*(\{[\s\S]*?\})\s*,\s*["'](?:shop|images)/);
    if (m) {
      try {
        const listing = JSON.parse(m[1]);
        const title = listing.title ?? listing.listing_title;
        const price = parsePrice(String(listing.price ?? listing.original_price ?? ''));
        if (title) return { title, price };
      } catch {}
    }
  }
  // Fallback to Apollo state
  const apollo = extractApolloState(scripts);
  if (apollo.title) return apollo;
  return null;
}

function tryIkea(html: string, url: string): Partial<ScrapeResult> | null {
  if (!url.includes('ikea.')) return null;
  const scripts = extractScripts(html);
  for (const s of scripts) {
    const m = s.match(/"product"\s*:\s*(\{[\s\S]*?\})\s*,\s*["'](?:availability|price)/);
    if (m) {
      try {
        const p = JSON.parse(m[1]);
        const title = p.name ?? p.mainImageAlt;
        const price = parsePrice(String(p?.price?.wholeDecimalPriceProps?.integer ?? p?.price?.regular?.value ?? ''));
        if (title) return { title, price };
      } catch {}
    }
  }
  return null;
}

function tryAsos(html: string, url: string): Partial<ScrapeResult> | null {
  if (!url.includes('asos.')) return null;
  const m = html.match(/<script[^>]+id=["']page-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const r = walkForProduct(data, 0);
      if (r.title) return r;
    } catch {}
  }
  return null;
}

// ---- Currency detection ----

function heuristicCurrency(html: string, host: string): string | null {
  const iso = html.match(/(?:product:price:currency|og:price:currency)[^>]+content=["']([A-Z]{3})["']/i)?.[1]
           ?? html.match(/content=["']([A-Z]{3})["'][^>]*(?:product:price:currency|og:price:currency)/i)?.[1];
  if (iso) return isoToSymbol(iso);
  if (/data-currency=["']EUR["']/i.test(html) || /"priceCurrency"\s*:\s*"EUR"/i.test(html)) return '€';
  if (/data-currency=["']GBP["']/i.test(html) || /"priceCurrency"\s*:\s*"GBP"/i.test(html)) return '£';
  if (/data-currency=["']USD["']/i.test(html) || /"priceCurrency"\s*:\s*"USD"/i.test(html)) return '$';
  const fromTld = currencyFromHost(host);
  if (fromTld) return fromTld;
  if (/€/.test(html)) return '€';
  if (/£/.test(html)) return '£';
  if (/¥/.test(html)) return '¥';
  return null;
}

// ---- Heuristic price scan ----

function heuristicPrice(html: string): number | null {
  const patterns = [
    /data-(?:price|sale-price|current-price|offer-price|final-price)=["'](\d[\d.,]*)/gi,
    /(?:€|EUR|GBP|\$|£|zł|kr|CHF)\s*(\d{1,6}[.,]\d{2})\b/g,
    /\b(\d{1,6}[.,]\d{2})\s*(?:€|EUR|GBP|\$|£|zł|kr|CHF)/g,
    /class=["'][^"']*\bprice\b[^"']*["'][^>]*>[^<]*?(\d{1,6}[.,]\d{2})/gi,
    /"price"\s*:\s*(\d+(?:\.\d+)?)/g,
    /"amount"\s*:\s*(\d+(?:\.\d+)?)/g,
  ];
  const hits: number[] = [];
  for (const pat of patterns) {
    const re = new RegExp(pat.source, pat.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && hits.length < 30) {
      const p = parsePrice(m[1]);
      if (p && p > 0.5 && p < 100000) hits.push(p);
    }
  }
  if (!hits.length) return null;
  const freq = new Map<number, number>();
  for (const p of hits) freq.set(p, (freq.get(p) ?? 0) + 1);
  let best = hits[0], bestN = 0;
  for (const [p, n] of freq) {
    if (n > bestN || (n === bestN && p < best)) { best = p; bestN = n; }
  }
  return best;
}

// ---- Title cleanup ----

function cleanTitle(raw: string | null): string | null {
  if (!raw) return null;
  let t = raw.trim();
  // Decode HTML entities
  t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Remove trailing "| Store" or "- Store" or "– Store"
  t = t.replace(/\s*[\|–—-]\s*[^|–—-]{2,60}$/, '').trim() || raw.trim();
  return t || null;
}

// ---- Image URL normalization ----

function resolveImage(img: string | null, baseUrl: string): string | null {
  if (!img) return null;
  img = img.trim();
  if (!img) return null;
  if (img.startsWith('http://') || img.startsWith('https://')) return img;
  if (img.startsWith('//')) return 'https:' + img;
  if (img.startsWith('/')) {
    const base = baseUrl.match(/^(https?:\/\/[^/]+)/)?.[1] ?? '';
    return base + img;
  }
  return null;
}

// ---- Assemble result ----

function parseHtml(html: string, url: string): ScrapeResult {
  const host = url.match(/https?:\/\/(?:www\.)?([^/]+)/)?.[1] ?? '';
  const meta  = metaFrom(html);
  const scripts = extractScripts(html);

  // Site-specific (highest priority)
  const ebay = tryEbay(html, url);
  const etsy = tryEtsy(html, url);
  const ikea = tryIkea(html, url);
  const asos = tryAsos(html, url);
  const siteSpecific = ebay ?? etsy ?? ikea ?? asos;

  // Structured extraction layers
  const ld    = extractJsonLd(html);
  const next  = extractNextData(html);
  const dl    = extractDataLayer(scripts);
  const nuxt  = extractNuxtData(scripts);
  const apollo = extractApolloState(scripts);
  const winProd = extractWindowProduct(scripts);
  const inlineJson = extractInlineJson(scripts);
  const micro = extractMicrodata(html);

  // Priority: JSON-LD > Next.js > site-specific > dataLayer > Nuxt > Apollo > window > inline > microdata > OG
  const sources = [ld, next, siteSpecific ?? {}, dl, nuxt, apollo, winProd, inlineJson, micro];

  const rawTitle = sources.map(s => s?.title).find(t => t)
    ?? meta('og:title') ?? meta('twitter:title')
    ?? html.match(/<h1[^>]*>([^<]{4,200})<\/h1>/i)?.[1]?.trim()
    ?? html.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim()
    ?? null;

  const rawImage = sources.map(s => s?.image).find(img => img)
    ?? meta('og:image') ?? meta('twitter:image') ?? meta('twitter:image:src')
    ?? null;

  const priceFromMeta = parsePrice(meta('og:price:amount') ?? meta('product:price:amount'));
  const price = sources.map(s => s?.price).find(p => p != null && p > 0)
    ?? priceFromMeta
    ?? heuristicPrice(html);

  const store = meta('og:site_name') ?? host ?? null;
  const storeUrl = meta('og:url') ?? html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] ?? null;

  const currencyIso = meta('product:price:currency') ?? meta('og:price:currency');
  const currency = isoToSymbol(currencyIso)
    ?? sources.map(s => s?.currency).find(c => c)
    ?? heuristicCurrency(html, host);

  return {
    title: cleanTitle(rawTitle),
    image: resolveImage(rawImage, url),
    price,
    currency,
    store,
    storeUrl,
  };
}

// ---- HTTP layer ----

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
];

export async function scrapeHttp(url: string): Promise<ScrapeResult | null> {
  const ua = UAS[Math.floor(Math.random() * UAS.length)];
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://www.google.com/',
        'Sec-Ch-Ua': '"Chromium";v="125", "Google Chrome";v="125", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'DNT': '1',
      },
      redirect: 'follow',
    } as RequestInit);
    clearTimeout(tid);
    if (!r.ok) return null;
    const html = await r.text();
    const result = parseHtml(html, url);
    return result.title ? result : null;
  } catch {
    return null;
  }
}

// ---- Puppeteer layer ----

export async function scrapeBrowser(url: string): Promise<ScrapeResult | null> {
  let browser: any = null;
  try {
    const puppeteerExtra = await import('puppeteer-extra');
    const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
    const pup = puppeteerExtra.default ?? (puppeteerExtra as any);
    pup.use((StealthPlugin.default ?? StealthPlugin)());

    const execPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';

    browser = await pup.launch({
      executablePath: execPath,
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--window-size=1280,800', '--lang=en-US,en',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(UAS[0]);
    await page.setViewport({ width: 1280, height: 800 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.google.com/',
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    // Wait for JS to settle — some SPAs need more time
    await new Promise(r => setTimeout(r, 2000));

    // If the page looks like a bot challenge / loading screen, wait longer for redirect
    const earlyTitle: string = await page.evaluate(() => (globalThis as any).document?.title ?? '').catch(() => '');
    const challengeWords = ['hang on', 'just a moment', 'checking your browser', 'please wait', 'one moment', 'verifying'];
    if (challengeWords.some(w => earlyTitle.toLowerCase().includes(w))) {
      await new Promise(r => setTimeout(r, 5000));
    }

    // Extract dataLayer from live JS context (much more reliable than regex)
    const dlData = await page.evaluate(() => {
      try {
        const dl = ((globalThis as any).window ?? globalThis).dataLayer ?? [];
        for (const item of dl) {
          const ga4Items = item?.ecommerce?.items;
          if (Array.isArray(ga4Items) && ga4Items[0]?.item_name)
            return { title: ga4Items[0].item_name, price: ga4Items[0].price };
          const uaProds = item?.ecommerce?.detail?.products ?? item?.ecommerce?.click?.products;
          if (Array.isArray(uaProds) && uaProds[0]?.name)
            return { title: uaProds[0].name, price: uaProds[0].price };
        }
      } catch {}
      return null;
    }).catch(() => null);

    const html: string = await page.content();
    const result = parseHtml(html, url);

    // Merge browser-native dataLayer result
    if (dlData?.title && !result.title) {
      result.title = dlData.title;
      if (!result.price && dlData.price) result.price = parsePrice(String(dlData.price));
    }

    return result.title ? result : null;
  } catch {
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
