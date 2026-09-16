const { fetchHtml, extractCardsByLinkPattern } = require('./scrape-utils');

const YAMAHA_URL = 'https://www.yamaha-motor.co.nz/buying/offers';

// Individual offer pages look like:
//   /buying/offers/2026/august/10-per-hp
// The listing/filter/sort links look like:
//   /buying/offers?f=category%3dRoad   or  /buying/offers?pg=1
// so we require a year + month + slug after /buying/offers/, and explicitly
// exclude anything that is just query-string filters on the listing page itself.
const OFFER_LINK_PATTERN = /^\/buying\/offers\/\d{4}\/[a-z]+\/[a-z0-9-]+\/?$/i;

async function scrapeYamaha() {
  const html = await fetchHtml(YAMAHA_URL);
  const cards = extractCardsByLinkPattern(html, YAMAHA_URL, OFFER_LINK_PATTERN);
  return cards.map((c) => ({ ...c, brand: 'Yamaha' }));
}

module.exports = { scrapeYamaha, YAMAHA_URL };
