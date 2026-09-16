const { fetchHtml, extractCardsByLinkPattern } = require('./scrape-utils');

const SUZUKI_URL = 'https://www.suzuki.co.nz/motorcycles/offers';

// Individual offer/model pages look like:
//   /motorcycles/model/gsx150/lams
//   /motorcycles/model/gsx-8s/street
const OFFER_LINK_PATTERN = /^\/motorcycles\/model\/[a-z0-9%-]+\/[a-z0-9%-]+\/?$/i;

async function scrapeSuzuki() {
  const html = await fetchHtml(SUZUKI_URL);
  const cards = extractCardsByLinkPattern(html, SUZUKI_URL, OFFER_LINK_PATTERN);
  return cards.map((c) => ({ ...c, brand: 'Suzuki' }));
}

module.exports = { scrapeSuzuki, SUZUKI_URL };
