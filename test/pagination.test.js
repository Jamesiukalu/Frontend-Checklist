const fs = require('fs');
const path = require('path');
const {expect} = require('chai');
// jsdom-global replaces global atob with jsdom's strict window.atob,
// which rejects the base64 blob cheerio's bundled `entities` decodes at
// import time. Restore Node's lenient atob/btoa before requiring cheerio.
global.atob = data => Buffer.from(data, 'base64').toString('binary');
global.btoa = data => Buffer.from(data, 'binary').toString('base64');
const cheerio = require('cheerio');
const {JSDOM} = require('jsdom');
const pug = require('pug');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const itemsEn = require('../data/en/_items.json');
const itemsFr = require('../data/fr/_items.json');

const SECTION_ORDER = [
  'head',
  'html',
  'webfonts',
  'css',
  'javascript',
  'images',
  'accessibility',
  'performance',
  'seo',
  'security',
  'privacy',
  'testing',
  'i18n',
];

describe('pagination: one section up front, the rest on demand', () => {
  it('renders every section as a fragment with the right items and ids', () => {
    const project = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'data/en/_project.json'), 'utf8'),
    );
    SECTION_ORDER.forEach((key, index) => {
      const html = pug.renderFile(
        path.join(ROOT, 'src/views/section-fragment.pug'),
        {
          ...project,
          sectionKey: key,
          sectionTitle: key === 'i18n' ? 'i18n' : key[0].toUpperCase() + key.slice(1),
          sectionIndex: index,
        },
      );
      const $ = cheerio.load(html);
      const section = $('.js-section');
      expect(section.attr('data-section'), key).to.equal(key);
      expect(section.attr('data-section-id'), key).to.equal(String(index));
      expect($('.js-item').length, key).to.equal(itemsEn[key].length);
      // Every favicon image carries a real 1x/2x srcset: the 16px Google
      // favicon as 1x and the 32px one as 2x — two different assets.
      $('img[srcset]').each((_, el) => {
        const srcset = $(el).attr('srcset');
        expect(srcset, key).to.include('sz=16 1x');
        expect(srcset, key).to.include('sz=32 2x');
      });
      expect($('img[srcset]').length, key).to.be.above(0);
    });
  });

  describe('built site', () => {
    const built = fs.existsSync(path.join(DIST, 'index.html'));

    before(function () {
      if (!built) this.skip();
    });

    it('renders only the first section into the initial HTML, under budget', () => {
      for (const [file, items] of [
        ['index.html', itemsEn],
        ['fr/index.html', itemsFr],
      ]) {
        const html = fs.readFileSync(path.join(DIST, file), 'utf8');
        const $ = cheerio.load(html);
        expect($('*').length, file).to.be.below(1500);
        expect($('.js-item').length, file).to.equal(12);
        expect($('.js-section').length, file).to.equal(13);
        expect($('.js-section[data-loaded="false"]').length, file).to.equal(
          12,
        );
        expect($('.js-section[data-section="head"]').attr('data-loaded'), file)
          .to.not.equal('false');
        // The tag filter survives: filtering is a first-class feature.
        expect($('.c-tag-filter').length, file).to.equal(1);
        expect($('.js-filter-tag').length, file).to.be.above(0);
        // Page weight as the audit measures it: HTML + CSS + JS + images.
        const weight =
          Buffer.byteLength(html) +
          fs.statSync(path.join(DIST, 'styles/main.min.css')).size +
          fs.statSync(path.join(DIST, 'scripts/app.bundle.js')).size +
          fs.statSync(path.join(DIST, 'img/icons/1x1.png')).size;
        expect(weight, file).to.be.below(1500 * 1024);
        // The metadata block the client uses for progress without the DOM.
        const meta = JSON.parse($('#js-checklist-meta').text());
        expect(meta.total, file).to.equal(400);
        expect(meta.sections, file).to.deep.equal(
          Object.fromEntries(
            Object.entries(items).map(([k, v]) => [k, v.length]),
          ),
        );
        expect(Object.keys(meta.priorityById).length, file).to.equal(400);
        // Every favicon image in the initial HTML has a real 2x source.
        expect($('img[srcset]').length, file).to.equal($('img').length);
      }
    });

    it('builds one fragment per section per language, with matching counts', () => {
      for (const [lang, items] of [
        ['en', itemsEn],
        ['fr', itemsFr],
      ]) {
        SECTION_ORDER.forEach((key, index) => {
          const html = fs.readFileSync(
            path.join(DIST, 'sections', lang, `${key}.html`),
            'utf8',
          );
          const $ = cheerio.load(html);
          expect($('.js-section').attr('data-section'), `${lang}/${key}`).to.equal(key);
          expect($('.js-section').attr('data-section-id'), `${lang}/${key}`).to.equal(String(index));
          expect($('.js-item').length, `${lang}/${key}`).to.equal(items[key].length);
        });
      }
    });
  });

  describe('section loader (jsdom, real built pages)', () => {
    const built = fs.existsSync(path.join(DIST, 'index.html'));
    let SectionLoader;
    let Storage;
    let Notation;
    let Filter;
    let dom;

    before(async function () {
      if (!built) this.skip();

      const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
      dom = new JSDOM(html, {url: 'http://localhost/'});
      global.window = dom.window;
      global.document = dom.window.document;
      global.localStorage = dom.window.localStorage;
      global.CustomEvent = dom.window.CustomEvent;
      global.Element = dom.window.Element;
      global.HTMLElement = dom.window.HTMLElement;
      global.Node = dom.window.Node;

      // Never auto-fire: tests drive loading explicitly.
      global.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      global.window.IntersectionObserver = global.IntersectionObserver;

      // Serve the built fragments (and nothing else) from disk.
      global.fetch = url =>
        Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              fs.readFileSync(path.join(DIST, url), 'utf8'),
            ),
        });

      // A returning reader: one checked item in Head (rendered) and one
      // in SEO (still a shell).
      const headId = itemsEn.head[0].id;
      const seoId = itemsEn.seo[0].id;
      dom.window.localStorage.setItem('head', JSON.stringify([{id: headId}]));
      dom.window.localStorage.setItem('seo', JSON.stringify([{id: seoId}]));

      SectionLoader = (await import('../src/scripts/components/SectionLoader')).default;
      Storage = (await import('../src/scripts/components/Storage')).default;
      Notation = (await import('../src/scripts/components/Notation')).default;
      Filter = (await import('../src/scripts/components/Filter')).default;
    });

    it('shows stored progress on shells without loading them', () => {
      new SectionLoader().init();

      const seoShell = document.querySelector(
        '.js-section[data-section="seo"]',
      );
      expect(seoShell.getAttribute('data-loaded')).to.equal('false');
      // 1 of 93 checked.
      expect(seoShell.querySelector('.js-progress').getAttribute('value')).to.equal('1');
      expect(
        document.querySelector('#js-nav-seo').getAttribute('data-notation'),
      ).to.equal('1');
      // Only the first section's items are in the DOM.
      expect(document.querySelectorAll('.js-item').length).to.equal(12);
    });

    it('never wipes saved progress for a section that is not loaded yet', () => {
      const seoShell = document.querySelector(
        '.js-section[data-section="seo"]',
      );
      new Storage().readItems(seoShell, 8, [seoShell]);

      const stored = JSON.parse(dom.window.localStorage.getItem('seo'));
      expect(stored).to.deep.equal([{id: itemsEn.seo[0].id}]);
    });

    it('loads a section on demand and restores its checked state', async () => {
      await new SectionLoader().loadSection('seo');

      expect(
        document.querySelectorAll('.js-section[data-loaded="false"]').length,
      ).to.equal(11);
      expect(document.querySelectorAll('.js-item').length).to.equal(12 + 93);

      const saved = document.querySelector(
        `.js-item[data-item-id="${itemsEn.seo[0].id}"]`,
      );
      expect(saved.getAttribute('data-item-check')).to.equal('true');
      expect(saved.querySelector('input[type=checkbox]').checked).to.equal(true);

      const seo = document.querySelector('.js-section[data-section="seo"]');
      expect(seo.querySelector('.js-progress').getAttribute('value')).to.equal('1');
    });

    it('counts the global notation from metadata, not just loaded DOM', () => {
      new Notation().readPriority();
      new Notation().updateNotation();
      new Notation().updatePriority();

      // 2 of 400 checked.
      expect(
        document.querySelector('#js-notation').getAttribute('data-notation'),
      ).to.equal('0');
      const checkedByPriority = {};
      [itemsEn.head[0], itemsEn.seo[0]].forEach(item => {
        const key = item.priority.toLowerCase();
        checkedByPriority[key] = (checkedByPriority[key] || 0) + 1;
      });
      for (const [priority, count] of Object.entries(checkedByPriority)) {
        expect(
          document
            .querySelector(`.js-detail-${priority} .js-notation-checked`)
            .textContent,
        ).to.equal(String(count));
      }
    });

    it('loads every section before applying a tag filter', async function () {
      this.timeout(10000);
      new Filter().enableFilter('tag', 'data-tag', '.js-filter-tag');
      const button = document.querySelector(
        '.js-filter-tag:not([data-tag="all"])',
      );
      button.click();

      // Loading is async; poll until every section is in the DOM.
      for (let i = 0; i < 50; i++) {
        if (
          document.querySelectorAll('.js-section[data-loaded="false"]').length ===
          0
        ) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      expect(
        document.querySelectorAll('.js-section[data-loaded="false"]').length,
      ).to.equal(0);
      expect(document.querySelectorAll('.js-item').length).to.equal(400);
      const tag = button.getAttribute('data-tag');
      const visible = [...document.querySelectorAll('.js-item')].filter(
        el => el.getAttribute('data-item-visible') === 'true',
      );
      expect(visible.length).to.be.above(0);
      expect(visible.length).to.be.below(400);
      visible.forEach(el => {
        expect(el.className).to.include(tag);
      });
    });
  });
});
