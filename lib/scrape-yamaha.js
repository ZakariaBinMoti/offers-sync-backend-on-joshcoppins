const {
  fetchHtml,
  fetchHtmlViaProxy,
  extractCardsByLinkPattern,
} = require('./scrape-utils');

const YAMAHA_URL = 'https://www.yamaha-motor.co.nz/buying/offers';

// Individual offer pages look like:
//   /buying/offers/2026/august/10-per-hp
// The listing/filter/sort links look like:
//   /buying/offers?f=category%3dRoad   or  /buying/offers?pg=1
// so we require a year + month + slug after /buying/offers/, and explicitly
// exclude anything that is just query-string filters on the listing page itself.
const OFFER_LINK_PATTERN = /^\/buying\/offers\/\d{4}\/[a-z]+\/[a-z0-9-]+\/?$/i;

/**
 * Fetches the Yamaha NZ offers page, trying to work around any bot-protection
 * that blocks Vercel's datacenter IPs.
 *
 * Strategy (in order):
 *   1. Direct fetch with full browser-like headers (cheap; works if Yamaha's
 *      WAF is doing only lightweight header-fingerprint checks).
 *   2. If that returns 0 cards AND SCRAPER_API_KEY is set, retry via
 *      ScraperAPI which routes through residential IPs and bypasses IP-based
 *      blocks. The proxy is only used as a fallback, not for every request,
 *      so free-tier credits aren't wasted when the direct path works.
 *
 * To enable the proxy fallback:
 *   - Sign up at https://www.scraperapi.com (free: 1,000 req/month — plenty
 *     for a once-daily cron scrape of a single page).
 *   - Add SCRAPER_API_KEY=<your key> to Vercel's environment variables.
 */
async function scrapeYamaha() {
  // --- Attempt 1: direct fetch with full browser headers ---
  let html = await fetchHtml(YAMAHA_URL);
  let cards = extractCardsByLinkPattern(html, YAMAHA_URL, OFFER_LINK_PATTERN);

  if (cards.length > 0) {
    // Direct fetch worked — return immediately without touching the proxy.
    return cards.map((c) => ({ ...c, brand: 'Yamaha' }));
  }

  // --- Attempt 2: proxy via ScraperAPI (only if key is configured) ---
  if (process.env.SCRAPER_API_KEY) {
    html = await fetchHtmlViaProxy(YAMAHA_URL);
    cards = extractCardsByLinkPattern(html, YAMAHA_URL, OFFER_LINK_PATTERN);
  }

  return cards.map((c) => ({ ...c, brand: 'Yamaha' }));
}

module.exports = { scrapeYamaha, YAMAHA_URL };
