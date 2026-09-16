const cheerio = require('cheerio');

/**
 * Fetches a URL as text with a timeout and a normal browser User-Agent
 * (some sites block requests that don't look like a real browser).
 */
async function fetchHtml(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
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

module.exports = { fetchHtml, extractCardsByLinkPattern };
