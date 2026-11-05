const {negotiatedProtocol, safeFetch} = require('./safe-fetch');

const LIMITS = {
  css: 6,
  js: 8,
  images: 20,
  internalLinks: 12,
  externalLinks: 6,
  pdfs: 3,
  fonts: 8,
  sitemapPages: 5,
};
const DEADLINE_MS = 14000;
const CONCURRENCY = 14;

const quiet = promise =>
  promise.catch(error => ({error: error.code || 'fetch_failed'}));

const stripWww = host => host.replace(/^www\./, '');
const sameSite = (a, b) => stripWww(a) === stripWww(b);

function absolute(href, base) {
  try {
    const url = new URL(href, base);

    url.hash = '';

    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

// Runs async jobs with bounded concurrency and a global deadline
function createPool(startedAt) {
  let running = 0;
  const queue = [];

  const next = () => {
    while (running < CONCURRENCY && queue.length) {
      const {job, resolve} = queue.shift();

      if (Date.now() - startedAt > DEADLINE_MS) {
        resolve({error: 'skipped'});
        continue;
      }
      running += 1;
      job()
        .then(resolve, () => resolve({error: 'fetch_failed'}))
        .finally(() => {
          running -= 1;
          next();
        });
    }
  };

  return job =>
    new Promise(resolve => {
      queue.push({job, resolve});
      next();
    });
}

function fontUrls(cssList) {
  const urls = [];

  cssList.forEach(sheet => {
    const faces = sheet.body.match(/@font-face\s*{[^}]*}/gi) || [];

    faces.forEach(face => {
      const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
      let match = re.exec(face);

      while (match) {
        if (!match[1].startsWith('data:')) {
          urls.push(absolute(match[1], sheet.url));
        }
        match = re.exec(face);
      }
    });
  });

  return unique(urls).slice(0, LIMITS.fonts);
}

async function gatherResources({$, page, origin, sitemap, robots}) {
  const startedAt = Date.now();
  const pool = createPool(startedAt);
  const base = page.url;
  const host = new URL(base).hostname;

  const hrefs = selector =>
    unique(
      $(selector)
        .map((_, el) => absolute($(el).attr('href') || $(el).attr('src'), base))
        .get(),
    );

  const cssUrls = hrefs('link[rel~="stylesheet" i]').slice(0, LIMITS.css);
  const jsUrls = hrefs('script[src]').slice(0, LIMITS.js);
  const imgUrls = unique(
    $('img[src]')
      .map((_, el) => absolute($(el).attr('src'), base))
      .get(),
  ).slice(0, LIMITS.images);

  const links = unique(
    $('a[href]')
      .map((_, el) => absolute($(el).attr('href'), base))
      .get(),
  ).filter(url => url !== base);
  const pdfs = links.filter(url => /\.pdf($|\?)/i.test(url));
  const pages = links.filter(
    url =>
      !/\.(pdf|zip|png|jpe?g|gif|webp|svg|mp4|mp3|css|js|xml|json)($|\?)/i.test(
        url,
      ),
  );
  const internal = pages
    .filter(url => sameSite(new URL(url).hostname, host))
    .slice(0, LIMITS.internalLinks);
  const external = pages
    .filter(url => !sameSite(new URL(url).hostname, host))
    .slice(0, LIMITS.externalLinks);

  const canonicalHref = absolute(
    $('link[rel="canonical" i]').attr('href'),
    base,
  );
  const sitemapPages =
    sitemap && sitemap.status === 200 && /<urlset/i.test(sitemap.body)
      ? unique(
          [...sitemap.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m =>
            absolute(m[1], origin),
          ),
        ).slice(0, LIMITS.sitemapPages)
      : [];

  const fetchText = (url, maxBytes) => () =>
    safeFetch(url, {maxBytes, timeout: 5000});
  const fetchHead =
    (url, maxRedirects = 3) =>
    () =>
      safeFetch(url, {maxBytes: 1024, timeout: 5000, maxRedirects});

  const [css, js, images, internalChecks, externalChecks, pdfChecks] =
    await Promise.all([
      Promise.all(
        cssUrls.map(url =>
          pool(fetchText(url, 400000)).then(res => ({url, ...res})),
        ),
      ),
      Promise.all(
        jsUrls.map(url =>
          pool(fetchText(url, 600000)).then(res => ({url, ...res})),
        ),
      ),
      Promise.all(
        imgUrls.map(url => pool(fetchHead(url)).then(res => ({url, ...res}))),
      ),
      Promise.all(
        internal.map(url =>
          pool(fetchHead(url)).then(res => ({url, internal: true, ...res})),
        ),
      ),
      Promise.all(
        external.map(url =>
          pool(fetchHead(url)).then(res => ({url, internal: false, ...res})),
        ),
      ),
      Promise.all(
        pdfs
          .slice(0, LIMITS.pdfs)
          .map(url => pool(fetchHead(url)).then(res => ({url, ...res}))),
      ),
    ]);

  const goodCss = css.filter(sheet => sheet.body !== undefined);
  const fontList = fontUrls(goodCss);

  const [fonts, sitemapSamples, canonical, llms, protocol] = await Promise.all([
    Promise.all(
      fontList.map(url => pool(fetchHead(url)).then(res => ({url, ...res}))),
    ),
    Promise.all(
      sitemapPages.map(url =>
        pool(fetchText(url, 120000)).then(res => ({url, ...res})),
      ),
    ),
    canonicalHref && canonicalHref !== base
      ? pool(fetchHead(canonicalHref, 5)).then(res => ({
          url: canonicalHref,
          ...res,
        }))
      : Promise.resolve(null),
    pool(fetchText(`${origin}/llms.txt`, 100000)),
    base.startsWith('https:') ? quiet(negotiatedProtocol(host)) : null,
  ]);

  return {
    host,
    css: goodCss,
    js: js.filter(file => file.body !== undefined),
    images: images.filter(img => img.status !== undefined || img.error),
    links: [...internalChecks, ...externalChecks],
    pdfs: pdfChecks,
    fonts,
    sitemapSamples,
    canonical,
    llms: llms && llms.status === 200 ? llms : null,
    protocol: typeof protocol === 'string' ? protocol : null,
    robots,
    sameSite: url => {
      try {
        return sameSite(new URL(url).hostname, host);
      } catch {
        return false;
      }
    },
  };
}

module.exports = {gatherResources, sameSite};
