const { scrapeYamaha, YAMAHA_URL } = require('../lib/scrape-yamaha');
const { scrapeSuzuki, SUZUKI_URL } = require('../lib/scrape-suzuki');
const { fetchDebugInfo } = require('../lib/scrape-utils');

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

  const isDebug = req.query && req.query.debug === '1';

  if (isDebug) {
    // Debug mode: never cache; return raw fetch diagnostics so you can see
    // exactly what Yamaha/Suzuki's servers return to Vercel's IPs.
    res.setHeader('Cache-Control', 'no-store');
    const [yamahaDebug, suzukiDebug] = await Promise.all([
      fetchDebugInfo(YAMAHA_URL),
      fetchDebugInfo(SUZUKI_URL),
    ]);
    res.status(200).json({ debug: { yamaha: yamahaDebug, suzuki: suzukiDebug } });
    return;
  }

  // Cache at Vercel's edge for 2 days (48 hours = 172800s), and allow serving
  // stale cached data for up to 7 days while background revalidation runs.
  // Real visitors always get an instant cached response (<50ms) with zero delay.
  res.setHeader('Cache-Control', 'public, s-maxage=172800, stale-while-revalidate=604800');

  const result = {
    updatedAt: new Date().toISOString(),
    yamaha: [],
    suzuki: [],
    errors: {},
  };

  // Run both scrapers in parallel — Yamaha's proxy can take 15-25s, so we
  // must not block Suzuki behind it. Promise.allSettled means one brand
  // failing or timing out never blocks or errors out the other.
  const [yamahaResult, suzukiResult] = await Promise.allSettled([
    scrapeYamaha(),
    scrapeSuzuki(),
  ]);

  if (yamahaResult.status === 'fulfilled') {
    result.yamaha = yamahaResult.value;
  } else {
    result.errors.yamaha = String(yamahaResult.reason?.message || yamahaResult.reason);
  }

  if (suzukiResult.status === 'fulfilled') {
    result.suzuki = suzukiResult.value;
  } else {
    result.errors.suzuki = String(suzukiResult.reason?.message || suzukiResult.reason);
  }

  res.status(200).json(result);
};
