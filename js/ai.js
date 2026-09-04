/* AI drafting: plain-English description -> structured invoice fields.
   The browser posts to this site's /api/draft function, which holds the model key server-side. */
(function (root) {
  'use strict';

  const ENDPOINT = '/api/draft';

  async function draft(description, ctx) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description, ctx: ctx }),
      });
    } catch (e) {
      throw new Error('Network error reaching the drafting service. Check your connection.');
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* handled below */ }

    if (!res.ok) {
      throw new Error((data && data.error) || 'Drafting failed (' + res.status + '). Try again in a moment.');
    }
    if (!data || typeof data !== 'object') {
      throw new Error('Could not read the drafted invoice. Try rephrasing.');
    }
    return data;
  }

  root.AI = { draft: draft, ENDPOINT: ENDPOINT };
})(window);
