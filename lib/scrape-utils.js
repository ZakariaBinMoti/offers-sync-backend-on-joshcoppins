const cheerio = require('cheerio');

/**
 * A full set of browser-like request headers that mimic a real Chrome desktop
 * browser session. Using a sparse header set (e.g. just User-Agent) is often
 * flagged by WAF/bot-protection systems (Akamai, Cloudflare, etc.) that check
 * for the *combination* of headers a real browser sends.
 */
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-NZ,en;q=0.9,en-US;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-CH-UA':
    '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

/**
 * Fetches a URL as text with a timeout and full browser-like headers.
 *
 * Enhanced: we now send the complete set of headers a real Chrome browser
 * would send (Accept-Language, Sec-Fetch-*, Sec-CH-UA, etc.), not just
 * User-Agent. Many WAF/bot-detection systems (Akamai, Cloudflare, Imperva)
 * flag requests that have a browser User-Agent but are missing the
 * accompanying headers that real browsers always include.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number, extraHeaders?: Record<string,string> }} [opts]
 */
async function fetchHtml(url, { timeoutMs = 15000, extraHeaders = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { ...BROWSER_HEADERS, ...extraHeaders },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed for ${url}: ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches a URL via ScraperAPI (https://www.scraperapi.com/) which routes the
 * request through residential/rotating IPs that bypass datacenter-IP blocks.
 *
 * ScraperAPI free tier: 1,000 requests/month — more than enough for a once-
 * or twice-daily single-page scrape.
 *
 * Set the SCRAPER_API_KEY environment variable in Vercel to enable this path.
 * Leave it unset and this function is never called (the direct fetch is tried
 * first, so there's no degradation if the key isn't configured).
 *
 * @param {string} url  The target URL to scrape
 * @param {{ timeoutMs?: number }} [opts]
 */
async function fetchHtmlViaProxy(url, { timeoutMs = 30000 } = {}) {
  const apiKey = process.env.SCRAPER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'SCRAPER_API_KEY env var is not set — cannot use proxy fetch'
    );
  }
  // country_code=nz: request appears to originate from NZ, so geo-restricted
  // content (e.g. NZ-only promotions) is not affected.
  // render=false: the Yamaha page is server-rendered, so we don't need a
  // headless-browser render (and it's faster/cheaper without it).
  const proxyUrl =
    `https://api.scraperapi.com/?api_key=${apiKey}` +
    `&url=${encodeURIComponent(url)}` +
    `&country_code=nz` +
    `&render=false`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(proxyUrl, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(
        `Proxy fetch failed for ${url}: ${res.status} ${res.statusText}`
      );
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Diagnostic helper. Fetches a URL and returns metadata useful for debugging
 * WAF/bot-protection blocks: HTTP status, response length, a short text
 * snippet, and whether the response looks like a bot-challenge page.
 *
 * Used by /api/offers?debug=1 so you can see exactly what Yamaha's server
 * sends back to Vercel's serverless IPs without deploying a one-off test
 * function.
 *
 * @param {string} url
 */
async function fetchDebugInfo(url) {
  const BOT_BLOCK_SIGNS = [
    'captcha',
    'cloudflare',
    'just a moment',
    'access denied',
    'enable javascript',
    'akamai',
    'forbidden',
    'blocked',
    'bot detection',
    'ddos-guard',
    'imperva',
    'incapsula',
    'please wait',
    'checking your browser',
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: BROWSER_HEADERS,
    });
    const text = await res.text();
    const lc = text.toLowerCase();
    const matchedBlockSigns = BOT_BLOCK_SIGNS.filter((s) => lc.includes(s));

    return {
      status: res.status,
      statusText: res.statusText,
      htmlLength: text.length,
      snippet: text.slice(0, 800).replace(/\s+/g, ' '),
      likelyBlocked: matchedBlockSigns.length > 0,
      matchedBlockSigns,
      responseHeaders: Object.fromEntries(res.headers.entries()),
    };
  } catch (err) {
    return {
      status: null,
      statusText: null,
      htmlLength: 0,
      snippet: null,
      likelyBlocked: false,
      matchedBlockSigns: [],
      error: String(err.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generic "offer card" extractor.
 *
 * Strategy: rather than depending on brittle CSS class names (which change
 * whenever a site is redesigned), this looks for every <a> tag whose href
 * matches a known URL pattern for that brand's individual offer/model pages,
 * and pulls a title/description/image out of each one. This is more
 * resilient to styling changes, but can still need tweaking if a site
 * changes its URL structure - see README "If scraping breaks" section.
 *
 * @param {string} html raw HTML of the offers listing page
 * @param {string} baseUrl used to resolve relative links/images
 * @param {RegExp} linkPattern regex the offer link's pathname must match
 * @param {RegExp} [excludePattern] regex to exclude non-offer matches (filters, sorting, etc.)
 */
function extractCardsByLinkPattern(html, baseUrl, linkPattern, excludePattern) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const cards = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    let absoluteUrl;
    try {
      absoluteUrl = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    const path = new URL(absoluteUrl).pathname + new URL(absoluteUrl).search;
    if (!linkPattern.test(path)) return;
    if (excludePattern && excludePattern.test(path)) return;
    if (seen.has(absoluteUrl)) return;
    seen.add(absoluteUrl);

    const $el = $(el);

    // Try to find a heading-like element inside the link for the title.
    let title = '';
    const heading = $el.find('h1,h2,h3,h4,strong,b').first();
    if (heading.length) {
      title = heading.text().trim();
    }

    // Grab all text, then strip the title out of it to build a description.
    let fullText = $el.text().replace(/\s+/g, ' ').trim();
    // Strip common call-to-action suffixes.
    fullText = fullText.replace(/\b(view offer|learn more|find out more|shop now)\b\.?$/i, '').trim();

    if (!title) {
      // Fall back: assume the first ~6 words (or up to the first capital-letter
      // run) is the title, rest is description. This is a rough heuristic -
      // adjust if it doesn't fit a given site's layout.
      const words = fullText.split(' ');
      title = words.slice(0, Math.min(6, words.length)).join(' ');
    }

    let description = fullText;
    if (title && description.startsWith(title)) {
      description = description.slice(title.length).trim();
    }

    const img = $el.find('img').first();
    let image = null;
    if (img.length) {
      const src = img.attr('src') || img.attr('data-src');
      if (src) {
        try {
          image = new URL(src, baseUrl).toString();
        } catch {
          image = null;
        }
      }
    }

    if (!title) return; // skip anything we couldn't get any text out of

    cards.push({
      title,
      description,
      url: absoluteUrl,
      image,
    });
  });

  return cards;
}

module.exports = {
  fetchHtml,
  fetchHtmlViaProxy,
  fetchDebugInfo,
  extractCardsByLinkPattern,
};
