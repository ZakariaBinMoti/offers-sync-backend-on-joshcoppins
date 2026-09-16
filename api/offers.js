const { scrapeYamaha } = require('../lib/scrape-yamaha');
const { scrapeSuzuki } = require('../lib/scrape-suzuki');

// Set this to your storefront domain in Vercel's env vars once you know it,
// e.g. https://joshcoppinsmotorcycles.co.nz
// Using '*' works too and is simplest, but restricting it to your own domain
// stops other random sites from calling your endpoint from a browser.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Cache at Vercel's edge for 6 hours, and keep serving the cached copy for
  // up to a day while a fresh scrape happens in the background. This means
  // most real visitors get an instant cached response instead of waiting on
  // a live scrape, and Yamaha/Suzuki's servers aren't hit on every pageview.
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');

  const result = {
    updatedAt: new Date().toISOString(),
    yamaha: [],
    suzuki: [],
    errors: {},
  };

  try {
    result.yamaha = await scrapeYamaha();
  } catch (err) {
    result.errors.yamaha = String(err.message || err);
  }

  try {
    result.suzuki = await scrapeSuzuki();
  } catch (err) {
    result.errors.suzuki = String(err.message || err);
  }

  res.status(200).json(result);
};
