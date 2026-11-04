const MARK = 'data-audit';

/**
 * Runs the live-page audit and reflects the results on the checklist:
 * passing items are ticked, failing items are flagged.
 *
 * @class Audit
 */
class Audit {
  constructor() {
    this.form = document.querySelector('.js-audit-form');
    if (!this.form) return;

    this.input = this.form.querySelector('input[name=url]');
    this.submit = this.form.querySelector('.js-audit-submit');
    this.status = document.querySelector('.js-audit-status');
    this.summary = document.querySelector('.js-audit-summary');
    this.labels = JSON.parse(
      document.getElementById('js-audit-labels').textContent,
    );

    this.form.addEventListener('submit', event => {
      event.preventDefault();
      this.run(this.input.value.trim());
    });
    document
      .querySelector('.js-audit-clear')
      .addEventListener('click', () => this.clear());
  }

  async run(url) {
    if (!url) return;

    this.clear();
    this.submit.disabled = true;
    this.status.textContent = this.labels.RUNNING;

    try {
      const res = await fetch(`/api/audit?url=${encodeURIComponent(url)}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || this.labels.ERROR);
      this.apply(data);
    } catch (error) {
      this.status.textContent = `${this.labels.ERROR}: ${error.message}`;
    } finally {
      this.submit.disabled = false;
    }
  }

  apply(data) {
    data.results.forEach(result => {
      const item = document.querySelector(
        `.js-item[data-item-id="${result.id}"]`,
      );

      if (!item) return;
      item.setAttribute(MARK, result.status);

      if (result.status === 'pass') {
        const box = item.querySelector('input[type=checkbox]');

        // Click so the normal handler stores progress and updates counters
        if (box && !box.checked) box.click();
      } else {
        const badge = document.createElement('span');

        badge.className = 'c-audit__badge';
        badge.textContent = result.detail
          ? `${this.labels.FAILED_BADGE}: ${result.detail}`
          : this.labels.FAILED_BADGE;
        item.querySelector('.c-checklist__body').appendChild(badge);
      }
    });

    this.status.textContent = `${this.labels.DONE} ${data.finalUrl}`;
    this.summary.hidden = false;
    this.summary.querySelector('.js-audit-score').textContent =
      `${data.score.percent}%`;
    this.summary.querySelector('.js-audit-counts').textContent =
      `${data.score.passed} ${this.labels.PASSED} · ${data.score.failed} ${this.labels.FAILED} · ${data.score.total} ${this.labels.CHECKED}`;
  }

  clear() {
    document
      .querySelectorAll(`[${MARK}]`)
      .forEach(el => el.removeAttribute(MARK));
    document.querySelectorAll('.c-audit__badge').forEach(el => el.remove());
    if (this.summary) this.summary.hidden = true;
    if (this.status) this.status.textContent = '';
  }
}

export default Audit;
