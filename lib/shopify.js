const API_VERSION = '2025-10';

function getConfig() {
  const shop = process.env.SHOPIFY_STORE_DOMAIN; // e.g. joshcoppinsmotorcycles.myshopify.com
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const pageHandle = process.env.SHOPIFY_PAGE_HANDLE || 'offers';

  if (!shop || !token) {
    throw new Error(
      'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN environment variables.'
    );
  }
  return { shop, token, pageHandle };
}

async function shopifyGraphql(query, variables) {
  const { shop, token } = getConfig();
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

async function getPageIdByHandle(handle) {
  const query = `
    query FindPage($q: String!) {
      pages(first: 1, query: $q) {
        edges {
          node {
            id
            handle
            title
          }
        }
      }
    }
  `;
  const data = await shopifyGraphql(query, { q: `handle:${handle}` });
  const edge = data.pages.edges[0];
  if (!edge) {
    throw new Error(
      `No Shopify page found with handle "${handle}". Check SHOPIFY_PAGE_HANDLE matches the page's URL handle in Shopify admin.`
    );
  }
  return edge.node.id;
}

async function updatePageBody(pageId, bodyHtml) {
  const mutation = `
    mutation UpdatePage($id: ID!, $page: PageUpdateInput!) {
      pageUpdate(id: $id, page: $page) {
        page { id handle title }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphql(mutation, { id: pageId, page: { body: bodyHtml } });
  const errors = data.pageUpdate.userErrors;
  if (errors && errors.length) {
    throw new Error(`Shopify pageUpdate userErrors: ${JSON.stringify(errors)}`);
  }
  return data.pageUpdate.page;
}

/**
 * High-level helper: finds the configured page by handle and overwrites its body.
 */
async function publishOffersToShopify(html) {
  const { pageHandle } = getConfig();
  const pageId = await getPageIdByHandle(pageHandle);
  return updatePageBody(pageId, html);
}

module.exports = { publishOffersToShopify };
