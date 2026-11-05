const cheerio = require('cheerio');
const {AuditError, parseTarget, safeFetch} = require('./safe-fetch');
const {runChecks} = require('./checks');
const {gatherResources} = require('./resources');

const quiet = promise => promise.catch(() => null);

async function audit(input) {
  const target = parseTarget(input);
  const page = await safeFetch(target.href);
  const origin = new URL(page.url).origin;

  if (!/html/i.test(page.headers['content-type'] || '')) {
    throw new AuditError('The URL did not return an HTML page', 'not_html');
  }

  const probeUrl = new URL(page.url);

  probeUrl.protocol = 'http:';
  probeUrl.port = '';

  const [robots, sitemap, notFound, httpProbe] = await Promise.all([
    quiet(safeFetch(`${origin}/robots.txt`, {maxBytes: 200000, timeout: 5000})),
    quiet(
      safeFetch(`${origin}/sitemap.xml`, {maxBytes: 200000, timeout: 5000}),
    ),
    quiet(
      safeFetch(`${origin}/__audit-404-${Date.now().toString(36)}`, {
        maxBytes: 200000,
        timeout: 5000,
        maxRedirects: 0,
      }),
    ),
    quiet(safeFetch(probeUrl.href, {maxBytes: 20000, timeout: 5000})),
  ]);

  const $ = cheerio.load(page.body);
  const resources = await gatherResources({$, page, origin, sitemap, robots});

  const results = runChecks({
    $,
    resources,
    ttfb: page.ttfb,
    status: page.status,
    html: page.body,
    headers: page.headers,
    finalUrl: page.url,
    redirects: page.redirects,
    robots,
    sitemap,
    notFound,
    httpProbe,
  });
  const passed = results.filter(r => r.status === 'pass').length;

  return {
    url: target.href,
    finalUrl: page.url,
    status: page.status,
    truncated: page.truncated,
    fetchedAt: new Date().toISOString(),
    score: {
      passed,
      failed: results.length - passed,
      total: results.length,
      percent: results.length ? Math.round((passed / results.length) * 100) : 0,
    },
    results,
  };
}

module.exports = {audit};
