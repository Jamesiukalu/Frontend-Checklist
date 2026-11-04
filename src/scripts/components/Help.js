/**
 * Opens and closes the help dialog.
 *
 * @class Help
 */
class Help {
  constructor() {
    this.dialog = document.querySelector('.js-help');
    if (!this.dialog || typeof this.dialog.showModal !== 'function') return;

    document
      .querySelectorAll('.js-help-open')
      .forEach(button =>
        button.addEventListener('click', () => this.dialog.showModal()),
      );
    this.dialog
      .querySelector('.js-help-close')
      .addEventListener('click', () => this.dialog.close());

    // A click on the backdrop targets the dialog element itself
    this.dialog.addEventListener('click', event => {
      if (event.target === this.dialog) this.dialog.close();
    });
  }
}

export default Help;
