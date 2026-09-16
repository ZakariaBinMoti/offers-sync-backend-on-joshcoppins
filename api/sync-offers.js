const { scrapeYamaha } = require('../lib/scrape-yamaha');
const { scrapeSuzuki } = require('../lib/scrape-suzuki');
const { buildOffersHtml } = require('../lib/build-html');
const { publishOffersToShopify } = require('../lib/shopify');

/**
 * Only allow this endpoint to be triggered by Vercel Cron or someone who
 * knows the CRON_SECRET. Without this, anyone who finds the URL could spam
 * your Shopify page with update calls.
 */
function isAuthorized(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // no secret configured - open (fine for local/dev testing only)

  const authHeader = req.headers['authorization'] || '';
  if (authHeader === `Bearer ${expected}`) return true;

  const querySecret = req.query && req.query.secret;
  if (querySecret === expected) return true;

  return false;
}

module.exports = async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const result = {
    startedAt: new Date().toISOString(),
    yamaha: { count: 0, error: null },
    suzuki: { count: 0, error: null },
    shopify: { updated: false, error: null },
  };

  let yamahaOffers = [];
  let suzukiOffers = [];

  try {
    yamahaOffers = await scrapeYamaha();
    result.yamaha.count = yamahaOffers.length;
  } catch (err) {
    result.yamaha.error = String(err.message || err);
  }

  try {
    suzukiOffers = await scrapeSuzuki();
    result.suzuki.count = suzukiOffers.length;
  } catch (err) {
    result.suzuki.error = String(err.message || err);
  }

  // If BOTH scrapes failed, don't touch the live Shopify page - better to
  // leave the last-known-good offers up than wipe the page with an empty state.
  if (result.yamaha.error && result.suzuki.error) {
    result.shopify.error = 'Both scrapers failed - Shopify page was not touched.';
    res.status(502).json(result);
    return;
  }

  try {
    const html = buildOffersHtml({ yamaha: yamahaOffers, suzuki: suzukiOffers });
    await publishOffersToShopify(html);
    result.shopify.updated = true;
  } catch (err) {
    result.shopify.error = String(err.message || err);
  }

  result.finishedAt = new Date().toISOString();
  const ok = result.shopify.updated;
  res.status(ok ? 200 : 500).json(result);
};
