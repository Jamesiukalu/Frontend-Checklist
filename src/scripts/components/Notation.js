let instance = null;

// Module-level cache: the frozen singleton instance cannot gain fields.
let metaCache;
/**
 *
 *
 * @class Notation
 */
class Notation {
  constructor() {
    if (!instance) {
      instance = this;
    }

    this.main = document.getElementById('js-main');
    this.notationDetails = document.querySelector('.c-notation__details');
    this.items = document.querySelectorAll('.js-item');
    this.priority = [];

    return instance;
  }

  /** Parsed #js-checklist-meta JSON, or null when the page has none. */
  checklistMeta() {
    if (metaCache !== undefined) return metaCache;
    const el = document.getElementById('js-checklist-meta');
    if (!el) {
      metaCache = null;
      return metaCache;
    }
    try {
      metaCache = JSON.parse(el.textContent);
    } catch {
      metaCache = null;
    }

    return metaCache;
  }

  /** Saved checked-item ids for one section (never throws). */
  storedItems(sectionName) {
    try {
      const stored = JSON.parse(localStorage.getItem(sectionName) || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  }

  updatePriority() {
    const meta = this.checklistMeta();
    this.priority.forEach(el => {
      let checkedCounter;
      if (meta && meta.total > 0) {
        // Count from localStorage + the priority map, so sections that
        // have not been loaded yet still count towards the header totals.
        checkedCounter = 0;
        Object.keys(meta.sections).forEach(name => {
          this.storedItems(name).forEach(saved => {
            if (meta.priorityById[saved.id] === el) checkedCounter += 1;
          });
        });
      } else {
        checkedCounter = document.querySelectorAll(
          `[data-item-priority=${el}][data-item-check='true']`,
        ).length;
      }
      const number = document.querySelectorAll(`.js-detail-${el}`);
      number[0].querySelectorAll('.js-notation-checked')[0].innerHTML =
        checkedCounter;
    });
  }

  /**
   * Read the localStorage about the number of items by priority
   *
   * @param {any} priorityId
   * @memberof Notation
   */
  readPriority(priorityId) {
    const meta = this.checklistMeta();
    if (meta && meta.total > 0) {
      // Every priority in the catalogue, not just the ones in the DOM —
      // only the first section is rendered on first paint. Mutate the
      // array in place: the frozen instance cannot reassign the field.
      const all = [...new Set(Object.values(meta.priorityById))];
      this.priority.splice(0, this.priority.length, ...all);
    } else {
      this.items.forEach((el, i) => {
        const currentPriority = el.getAttribute('data-item-priority');
        if (this.priority.indexOf(currentPriority) === -1) {
          this.priority.push(currentPriority);
        }
      });
    }
    instance.updatePriority();
  }

  /**
   * Update the letter for the global notation
   *
   * @memberof Notation
   */
  updateNotation() {
    const meta = this.checklistMeta();
    let items;
    let mainCount;
    if (meta && meta.total > 0) {
      // Total and checked counts from metadata + localStorage, so the
      // letter grade is right even while most sections are still shells.
      items = meta.total;
      mainCount = 0;
      Object.keys(meta.sections).forEach(name => {
        mainCount += Math.min(
          this.storedItems(name).length,
          meta.sections[name],
        );
      });
    } else {
      items = this.main.querySelectorAll('.js-item').length;
      mainCount = this.main.querySelectorAll('[data-item-check="true"]').length;
    }

    const getPercent = items ? parseInt((mainCount / items) * 100, 10) : 0;

    const notation = document.getElementById('js-notation');
    const notationLetter =
      notation.getElementsByClassName('c-notation__letter')[0];

    notation.setAttribute('data-notation', getPercent);

    switch (true) {
      case getPercent <= 20:
        notationLetter.innerHTML = 'F';
        break;

      case getPercent <= 40:
        notationLetter.innerHTML = 'E';
        break;

      case getPercent <= 60:
        notationLetter.innerHTML = 'D';
        break;

      case getPercent <= 80:
        notationLetter.innerHTML = 'C';
        break;

      case getPercent < 100:
        notationLetter.innerHTML = 'B';
        break;
      case getPercent === 100:
        notationLetter.innerHTML = 'A';
        break;
      default:
    }
  }
}

const Instance = new Notation();
Object.freeze(Instance);

export default Notation;
