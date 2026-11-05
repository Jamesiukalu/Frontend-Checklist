/**
 * Opens the "use with AI" dialog and copies its snippets.
 *
 * @class Connect
 */
class Connect {
  constructor() {
    this.dialog = document.querySelector('.js-ai');
    if (!this.dialog || typeof this.dialog.showModal !== 'function') return;

    document
      .querySelectorAll('.js-ai-open')
      .forEach(button =>
        button.addEventListener('click', () => this.dialog.showModal()),
      );
    this.dialog
      .querySelector('.js-ai-close')
      .addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('click', event => {
      if (event.target === this.dialog) this.dialog.close();
    });

    this.dialog.querySelectorAll('.js-copy').forEach(button =>
      button.addEventListener('click', async () => {
        const text = document.getElementById(button.dataset.target).textContent;
        const label = button.textContent;

        try {
          await navigator.clipboard.writeText(text);
          button.textContent = button.dataset.done;
          setTimeout(() => {
            button.textContent = label;
          }, 1500);
        } catch (error) {
          // Clipboard is unavailable on insecure origins; the text stays selectable
        }
      }),
    );
  }
}

export default Connect;
