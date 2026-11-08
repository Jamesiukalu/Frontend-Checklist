const {expect} = require('chai');
const cheerio = require('cheerio');
const items = require('../data/en/_items.json');
const {checks, runChecks} = require('../server/checks');
const {isBlockedAddress, parseTarget} = require('../server/safe-fetch');

const knownIds = new Set(
  Object.values(items).flatMap(list => list.map(item => item.id)),
);

describe('audit: safe fetch guards', () => {
  it('blocks private, loopback and metadata addresses', () => {
    [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.5',
      '172.20.0.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      '::ffff:127.0.0.1',
    ].forEach(ip => expect(isBlockedAddress(ip), ip).to.equal(true));
    expect(isBlockedAddress('93.184.216.34')).to.equal(false);
  });

  it('rejects unsafe targets', () => {
    [
      'ftp://example.com',
      'http://localhost',
      'http://127.0.0.1',
      'http://[::1]',
      'https://user:pw@example.com',
      'https://example.com:8080',
    ].forEach(url => expect(() => parseTarget(url), url).to.throw());
  });

  it('adds https when the scheme is missing', () => {
    expect(parseTarget('example.com').href).to.equal('https://example.com/');
  });
});

describe('audit: checks', () => {
  it('only references existing checklist item ids', () => {
    checks.forEach(check =>
      check.ids.forEach(id => expect(knownIds.has(id), id).to.equal(true)),
    );
  });

  it('keeps the documented totals true', () => {
    // The README, skill and site copy say 400 checklist items with up to
    // 246 automatic checks. If either number moves, update the copy too.
    const catalogueTotal = Object.values(items).flat().length;
    const automaticTotal = new Set(checks.flatMap(check => check.ids)).size;

    expect(catalogueTotal).to.equal(400);
    expect(automaticTotal).to.equal(246);
    expect(catalogueTotal - automaticTotal).to.equal(154);
  });

  const good = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>A perfectly reasonable page title</title></head>
    <body><main><h1>Hello</h1><h2>Sub</h2><img src="a.png" alt="" width="1" height="1"></main></body></html>`;
  const bad =
    '<html><head></head><body><h1>A</h1><h3>B</h3><img src="a.png"></body></html>';
  const run = html =>
    Object.fromEntries(
      runChecks({
        $: cheerio.load(html),
        html,
        headers: {},
        finalUrl: 'https://example.com/',
        redirects: [],
      }).map(r => [r.id, r.status]),
    );

  it('passes a well-formed page', () => {
    const r = run(good);

    expect(r['html-use-the-html5-doctype']).to.equal('pass');
    expect(r['html-declare-utf-8-character-encoding']).to.equal('pass');
    expect(r['html-set-the-page-lang-attribute']).to.equal('pass');
    expect(r['seo-use-a-single-descriptive-h1']).to.equal('pass');
    expect(r['images-provide-meaningful-alt-text-for-images']).to.equal('pass');
  });

  it('flags a poor page', () => {
    const r = run(bad);

    expect(r['html-use-the-html5-doctype']).to.equal('fail');
    expect(r['head-viewport']).to.equal('fail');
    expect(r['html-set-the-page-lang-attribute']).to.equal('fail');
    expect(r['accessibility-maintain-logical-heading-order']).to.equal('fail');
    expect(r['images-provide-meaningful-alt-text-for-images']).to.equal('fail');
  });

  // Same harness, but with the extra context (resources, sitemap) that
  // some checks need. A check that returns NA is absent from the map.
  const runWith = (html, extra = {}) =>
    Object.fromEntries(
      runChecks({
        $: cheerio.load(html),
        html,
        headers: {},
        finalUrl: 'https://example.com/',
        redirects: [],
        ...extra,
      }).map(r => [r.id, r.status]),
    );

  it('counts each subresource URL once for the request budget', () => {
    // One placeholder image reused 1,348 times is one request, not 1,348.
    const reused = `<html><head><link rel="stylesheet" href="a.css"></head><body>
      <script src="a.js"></script>
      ${'<img src="1x1.png" alt="">'.repeat(10)}</body></html>`;

    expect(run(reused)['performance-minimize-http-requests']).to.equal('pass');

    const many = `<html><body>${Array.from(
      {length: 61},
      (_, i) => `<img src="img${i}.png" alt="">`,
    ).join('')}</body></html>`;

    expect(run(many)['performance-minimize-http-requests']).to.equal('fail');
  });

  it('accepts a sitemap with an XML comment before the root element', () => {
    const commented = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Bump <lastmod> when a page's content changes. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://example.com/</loc><lastmod>2026-11-08</lastmod></url>
</urlset>`;

    expect(
      runWith(good, {sitemap: {status: 200, body: commented}})[
        'seo-keep-xml-sitemaps-valid'
      ],
    ).to.equal('pass');
    expect(
      runWith(good, {
        sitemap: {
          status: 200,
          body: '<urlset><url><lastmod>2026-11-08</lastmod></url></urlset>',
        },
      })['seo-keep-xml-sitemaps-valid'],
    ).to.equal('fail');
  });

  it('treats non-prose as undecidable for reading ease, not unreadable', () => {
    // A catalogue of fragments: many words, almost no sentence ends.
    const fragments =
      '<html lang="en"><body><main>' +
      Array.from({length: 40}, () => 'checklist item title description tool').join(
        ' ',
      ) +
      '</main></body></html>';
    const fragmentRun = run(fragments);

    expect(fragmentRun['seo-write-at-a-clear-reading-level']).to.equal(
      undefined,
    );
    expect(fragmentRun['accessibility-write-in-plain-language']).to.equal(
      undefined,
    );

    // Dense real prose still fails; simple prose still passes.
    const denseSentence =
      'The implementation of comprehensive authentication methodologies necessitates considerable organizational commitment and cross-functional collaboration. ';
    const dense = `<html lang="en"><body><main><p>${denseSentence.repeat(
      10,
    )}</p></main></body></html>`;

    expect(run(dense)['seo-write-at-a-clear-reading-level']).to.equal('fail');

    const simple = `<html lang="en"><body><main><p>${'The cat sat on the mat. The dog ran to the park. We had a good day. '.repeat(
      10,
    )}</p></main></body></html>`;

    expect(run(simple)['seo-write-at-a-clear-reading-level']).to.equal('pass');
  });

  it('ignores svg titles and lone symbols in visible-label matching', () => {
    const icons = `<html><body>
      <button aria-label="Open the description section"><svg aria-hidden="true"><title>Arrow</title></svg></button>
      <button aria-label="Close help">×</button>
    </body></html>`;

    expect(
      run(icons)['accessibility-align-visible-labels-with-accessible-names'],
    ).to.equal('pass');

    const mismatch = `<html><body>
      <button aria-label="Open the menu">Settings</button>
    </body></html>`;

    expect(
      run(mismatch)['accessibility-align-visible-labels-with-accessible-names'],
    ).to.equal('fail');
  });

  it('ignores fixed-size icons for srcset, not content images', () => {
    const iconOnly = `<html><body>
      ${'<img src="1x1.png" alt="" width="16" height="16">'.repeat(5)}
    </body></html>`;

    expect(
      run(iconOnly)['images-implement-responsive-images-with-srcset'],
    ).to.equal(undefined);

    const content = `<html><body>
      <img src="photo.jpg" alt="" width="800" height="600">
    </body></html>`;

    expect(
      run(content)['images-implement-responsive-images-with-srcset'],
    ).to.equal('fail');
    expect(
      run(content.replace('height="600"', 'height="600" srcset="photo-400.jpg 400w"'))[
        'images-implement-responsive-images-with-srcset'
      ],
    ).to.equal('pass');
  });

  it('ignores tiny raster images for modern image formats', () => {
    const tiny = {
      resources: {
        images: [
          {headers: {'content-type': 'image/png', 'content-length': '68'}},
        ],
      },
    };

    expect(
      runWith(good, tiny)['images-use-modern-image-formats-webp-avif'],
    ).to.equal(undefined);

    const large = {
      resources: {
        images: [
          {headers: {'content-type': 'image/jpeg', 'content-length': '120000'}},
        ],
      },
    };

    expect(
      runWith(good, large)['images-use-modern-image-formats-webp-avif'],
    ).to.equal('fail');
  });
});
