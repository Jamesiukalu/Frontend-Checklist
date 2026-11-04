const LAST_AUDIT_KEY = 'last-audit';

const el = (tag, className, text) => {
  const node = document.createElement(tag);

  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;

  return node;
};

/**
 * Runs the live-page audit, lists what passed and failed, and can tick the
 * passing items in the visitor's saved checklist progress.
 *
 * @class Audit
 */
class Audit {
  constructor() {
    this.form = document.querySelector('.js-audit-form');
    this.input = this.form.querySelector('input[name=url]');
    this.submit = this.form.querySelector('.js-audit-submit');
    this.status = document.querySelector('.js-audit-status');
    this.results = document.querySelector('.js-audit-results');
    this.applied = document.querySelector('.js-audit-applied');
    this.labels = JSON.parse(
      document.getElementById('js-audit-labels').textContent,
    );
    this.lang = document.documentElement.lang === 'fr' ? 'fr' : 'en';
    this.prefix = this.lang === 'en' ? '' : `/${this.lang}`;
    this.current = null;

    this.form.addEventListener('submit', event => {
      event.preventDefault();
      this.run(this.input.value.trim());
    });
    document
      .querySelector('.js-audit-apply')
      .addEventListener('click', () => this.apply());

    this.restore();
  }

  // Show the previous audit again after navigating away and back
  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(LAST_AUDIT_KEY));

      if (saved && saved.results && saved.language === this.lang) {
        this.input.value = saved.url;
        this.loadCatalog().then(catalog => this.render(saved, catalog));
      }
    } catch {
      localStorage.removeItem(LAST_AUDIT_KEY);
    }
  }

  async loadCatalog() {
    if (!this.catalog) {
      const res = await fetch(`/api/checklist.${this.lang}.json`);
      const data = await res.json();

      this.catalog = {};
      data.sections.forEach(section =>
        section.items.forEach(item => {
          this.catalog[item.id] = {...item, section: section.id};
        }),
      );
    }

    return this.catalog;
  }

  async run(url) {
    if (!url) return;

    this.submit.disabled = true;
    this.results.hidden = true;
    this.status.textContent = this.labels.RUNNING;

    try {
      const [res, catalog] = await Promise.all([
        fetch(`/api/audit?url=${encodeURIComponent(url)}`),
        this.loadCatalog(),
      ]);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || this.labels.ERROR);
      data.language = this.lang;
      localStorage.setItem(LAST_AUDIT_KEY, JSON.stringify(data));
      this.render(data, catalog);
    } catch (error) {
      this.status.textContent = `${this.labels.ERROR}: ${error.message}`;
    } finally {
      this.submit.disabled = false;
    }
  }

  render(data, catalog) {
    this.current = data;
    this.applied.textContent = '';
    this.status.textContent = `${this.labels.DONE} ${data.finalUrl}`;

    this.results.querySelector('.js-audit-score').textContent =
      `${data.score.percent}%`;
    this.results.querySelector('.js-audit-counts').textContent =
      `${data.score.passed} ${this.labels.PASSED} · ${data.score.failed} ${this.labels.FAILED} · ${data.score.total} ${this.labels.CHECKED}`;

    const failedList = this.results.querySelector('.js-audit-failed');
    const passedList = this.results.querySelector('.js-audit-passed');

    failedList.replaceChildren();
    passedList.replaceChildren();

    // Same check can map to two items; list each rule once
    const rank = {High: 0, Medium: 1, Low: 2};
    const known = data.results
      .filter(r => catalog[r.id])
      .sort(
        (a, b) =>
          (rank[catalog[a.id].priority] ?? 3) -
          (rank[catalog[b.id].priority] ?? 3),
      );

    known.forEach(result => {
      const item = catalog[result.id];
      const row = el('li', `c-audit__item c-audit__item--${result.status}`);
      const link = el('a', 'c-audit__item-title', item.title);

      link.href = `${this.prefix}/#section-${item.section}`;
      row.append(
        el(
          'span',
          `c-audit__priority c-audit__priority--${String(item.priority).toLowerCase()}`,
          item.priority,
        ),
        link,
      );
      if (result.detail)
        row.append(el('span', 'c-audit__detail', result.detail));
      (result.status === 'pass' ? passedList : failedList).append(row);
    });

    if (!failedList.children.length) {
      failedList.append(el('li', 'c-audit__empty', this.labels.NONE_FAILED));
    }
    if (!passedList.children.length) {
      passedList.append(el('li', 'c-audit__empty', this.labels.NONE_PASSED));
    }

    this.results.hidden = false;
  }

  // Progress is stored per section as [{id}], the same shape the checklist uses
  apply() {
    if (!this.current) return;

    const bySection = {};

    this.current.results.forEach(result => {
      const item = this.catalog[result.id];

      if (result.status === 'pass' && item) {
        (bySection[item.section] = bySection[item.section] || []).push(item.id);
      }
    });

    let added = 0;

    Object.keys(bySection).forEach(section => {
      let saved = [];

      try {
        saved = JSON.parse(localStorage.getItem(section)) || [];
      } catch {
        saved = [];
      }
      const have = new Set(saved.map(entry => entry.id));

      bySection[section].forEach(id => {
        if (!have.has(id)) {
          saved.push({id});
          added += 1;
        }
      });
      localStorage.setItem(section, JSON.stringify(saved));
    });

    this.applied.textContent = `${added} ${this.labels.APPLIED}`;
  }
}

export default Audit;
