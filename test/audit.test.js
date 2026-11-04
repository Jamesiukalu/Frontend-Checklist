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

    expect(r['head-doctype']).to.equal('pass');
    expect(r['head-charset']).to.equal('pass');
    expect(r['head-language-attribute']).to.equal('pass');
    expect(r['seo-use-a-single-descriptive-h1']).to.equal('pass');
    expect(r['images-provide-meaningful-alt-text-for-images']).to.equal('pass');
  });

  it('flags a poor page', () => {
    const r = run(bad);

    expect(r['head-doctype']).to.equal('fail');
    expect(r['head-viewport']).to.equal('fail');
    expect(r['head-language-attribute']).to.equal('fail');
    expect(r['accessibility-maintain-logical-heading-order']).to.equal('fail');
    expect(r['images-provide-meaningful-alt-text-for-images']).to.equal('fail');
  });
});
