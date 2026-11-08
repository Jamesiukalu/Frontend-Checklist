import Checkboxes from './Checkboxes';
import Dropdown from './Dropdown';
import Filter from './Filter';
import Notation from './Notation';
import ProgressBar from './ProgressBar';
import Storage from './Storage';
import Tools from './Tools';

let instance = null;

// Module-level state: the frozen singleton instance cannot gain fields
// (or have its fields reassigned) after construction.
let metaCache;
let initialised = false;
let observer = null;

/**
 * Loads checklist sections on demand.
 *
 * The homepage only renders the first section into the initial HTML; the
 * other sections start as lightweight shells (header, progress bar and
 * tools, no items). Their items are compiled at build time to standalone
 * HTML fragments (dist/sections/<lang>/<section>.html) and fetched here
 * when the reader scrolls to a section, opens it from the sidebar, or
 * uses a feature that needs every item (tag filter, print). The first
 * load therefore genuinely carries one section, not all 400 items.
 *
 * @class SectionLoader
 */
class SectionLoader {
  constructor() {
    if (!instance) {
      instance = this;
    }

    this.loading = new Map();
    this.lang = (document.documentElement.lang || 'en').split('-')[0];

    return instance;
  }

  /** Parsed #js-checklist-meta JSON (per-section counts, catalogue total,
   *  and each item's priority), or an empty shape when the page has none. */
  meta() {
    if (metaCache === undefined) {
      const el = document.getElementById('js-checklist-meta');
      let parsed = {total: 0, sections: {}, priorityById: {}};
      if (el) {
        try {
          parsed = JSON.parse(el.textContent);
        } catch {
          parsed = {total: 0, sections: {}, priorityById: {}};
        }
      }
      metaCache = parsed;
    }

    return metaCache;
  }

  sections() {
    return [...document.querySelectorAll('.js-section')];
  }

  shells() {
    return this.sections().filter(
      el => el.getAttribute('data-loaded') === 'false',
    );
  }

  isLoaded(name) {
    const el = document.querySelector(`.js-section[data-section="${name}"]`);

    return !!el && el.getAttribute('data-loaded') !== 'false';
  }

  /** Fetch one section's fragment and swap it in for its shell. Concurrent
   *  calls for the same section share one fetch. */
  loadSection(name) {
    if (this.isLoaded(name)) return Promise.resolve();
    if (this.loading.has(name)) return this.loading.get(name);

    const promise = fetch(`/sections/${this.lang}/${name}.html`)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(html => {
        this.insertSection(name, html);
      })
      .catch(error => {
        this.markFailed(name, error);
        throw error;
      })
      .finally(() => {
        this.loading.delete(name);
      });

    this.loading.set(name, promise);

    return promise;
  }

  /** Fetch every section that is still a shell. Used by features that need
   *  the whole catalogue in the DOM (tag filter, print). */
  loadAll() {
    return Promise.all(
      this.shells().map(el =>
        this.loadSection(el.getAttribute('data-section')),
      ),
    );
  }

  insertSection(name, html) {
    const shell = document.querySelector(`.js-section[data-section="${name}"]`);
    if (!shell) return;

    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const section = template.content.firstElementChild;
    if (!section) return;

    // The fragment has no load state of its own; mark it loaded and keep
    // the item count on the element so progress bars can use it.
    section.setAttribute('data-loaded', 'true');
    const count = this.meta().sections[name];
    if (count) section.setAttribute('data-section-count', String(count));

    shell.replaceWith(section);
    this.initSection(section);

    document.dispatchEvent(
      new CustomEvent('section-loaded', {detail: {section: name}}),
    );
  }

  /** Wire a freshly inserted section up exactly like a section that was
   *  rendered into the initial HTML. */
  initSection(section) {
    // Restore checked state and the section progress bar from localStorage.
    // readItems takes the section's index within the array it is given.
    new Storage().readItems(section, 0, [section]);

    // Dropdowns start collapsed, as on first load.
    new Dropdown().collapseAllDropdown({section});
    new Dropdown().enableDropdown(section.querySelectorAll('.js-dropdown'));

    // Checkboxes and section tools in the new markup only.
    new Checkboxes().enableCheckbox(section);
    new Tools().enableTools(section);

    // Re-apply the active tag filter so newly loaded items match it.
    const stored = this.storedFilter();
    new Filter().selectBy(stored);

    // The global notation counts from localStorage + metadata, so it stays
    // right as sections arrive.
    new Notation().updateNotation();
    new Notation().updatePriority();
  }

  storedFilter() {
    try {
      const stored = JSON.parse(localStorage.getItem('tag') || 'null');
      if (stored && stored.length) return stored[stored.length - 1].filter;
    } catch {
      // Fall through to 'all' on unreadable storage.
    }

    return 'all';
  }

  /** Show correct progress on shells from localStorage, without their DOM. */
  readStoredProgress() {
    const meta = this.meta();
    this.shells().forEach(shell => {
      const name = shell.getAttribute('data-section');
      let checked = 0;
      try {
        const stored = JSON.parse(localStorage.getItem(name) || '[]');
        checked = Array.isArray(stored) ? stored.length : 0;
      } catch {
        checked = 0;
      }
      const total = meta.sections[name] || 0;
      if (total > 0) checked = Math.min(checked, total);
      new ProgressBar().updateProgressBar(shell, checked);
    });
  }

  markFailed(name, error) {
    const shell = document.querySelector(`.js-section[data-section="${name}"]`);
    if (!shell) return;

    const body = shell.querySelector('.js-checklist-body');
    if (!body) return;

    const loadingText = body.textContent.trim() || 'Loading…';
    const message = (document.documentElement.lang || 'en').startsWith('fr')
      ? 'Impossible de charger cette section. Réessayer.'
      : 'Couldn’t load this section. Try again.';
    const retry = (document.documentElement.lang || 'en').startsWith('fr')
      ? 'Réessayer'
      : 'Try again';
    body.innerHTML = `<p class="c-checklist__loading">${message} <button type="button" class="js-section-retry">${retry}</button></p>`;
    body.querySelector('.js-section-retry').addEventListener('click', () => {
      body.innerHTML = `<p class="c-checklist__loading">${loadingText}</p>`;
      this.loadSection(name).catch(() => {});
    });

    // Keep the failure visible in the console for debugging.

    console.error(`Failed to load checklist section "${name}":`, error);
  }

  /** Sidebar links load their section first, then scroll to it. */
  bindNav() {
    document.querySelectorAll('.c-nav__link').forEach(link => {
      link.addEventListener('click', event => {
        const href = link.getAttribute('href') || '';
        const match = href.match(/#section-(.+)$/);
        if (!match) return;

        const name = match[1];
        if (this.isLoaded(name)) return;

        event.preventDefault();
        this.loadSection(name)
          .then(() => {
            const target = document.getElementById(`section-${name}`);
            if (target) target.scrollIntoView({behavior: 'smooth'});
            if (history.pushState) history.pushState(null, null, href);
          })
          .catch(() => {});
      });
    });
  }

  /** Load sections as they approach the viewport, and the section named
   *  by the URL hash (if any) right away. */
  observe() {
    if (!('IntersectionObserver' in window)) {
      // No observer support: load everything, as the old page did.
      this.loadAll().catch(() => {});
      return;
    }

    observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const name = entry.target.getAttribute('data-section');
          observer.unobserve(entry.target);
          this.loadSection(name).catch(() => {});
        });
      },
      {rootMargin: '600px 0px'},
    );

    this.shells().forEach(shell => observer.observe(shell));

    const hash = window.location.hash.match(/#section-(.+)$/);
    if (hash && !this.isLoaded(hash[1])) {
      this.loadSection(hash[1]).catch(() => {});
    }
  }

  init() {
    if (!document.querySelector('.js-section')) return instance;
    if (initialised) return instance;
    initialised = true;

    // Other features ask for sections through events so no module has to
    // import this loader (which would create an import cycle).
    document.addEventListener('section-load-request', event => {
      const name = event.detail && event.detail.section;
      if (name) this.loadSection(name).catch(() => {});
    });
    document.addEventListener('sections-load-all-request', () => {
      this.loadAll()
        .then(() => {
          document.dispatchEvent(new CustomEvent('sections-loaded-all'));
        })
        .catch(() => {
          document.dispatchEvent(new CustomEvent('sections-loaded-all'));
        });
    });

    this.readStoredProgress();
    this.bindNav();
    this.observe();

    // A stored tag filter from a previous visit only matches items that
    // are in the DOM; load everything so it applies to the whole catalogue.
    const filter = this.storedFilter();
    if (filter && filter !== 'all') {
      this.loadAll()
        .then(() => new Filter().selectBy(filter))
        .catch(() => {});
    }

    return instance;
  }
}

const Instance = new SectionLoader();
Object.freeze(Instance);

export default SectionLoader;
