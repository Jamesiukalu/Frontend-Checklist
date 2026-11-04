# Front-End Checklist App

[![Join the chat at https://gitter.im/Front-End-Checklist/Lobby][gitter-image]][gitter-url] [![Latest npm version][npm-image]][npm-url] [![Maintainability][codeclimate-maintainability-image]][codeclimate-maintainability-url] [![Test Coverage][codeclimate-coverage-image]][codeclimate-coverage-url] [![Front‑End_Checklist followed][frontendchecklist-image]] [![Backers on Open Collective][opencollective-backers-image]][opencollective-backers-url] [![Sponsors on Open Collective][opencollective-sponsors-image]][opencollective-sponsors-url]


[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)


## Table of Contents

- [Install](#install)
- [Install](#install)
- [Add new translation](#addnewtranslation)
- [Contribute](#contribute)
- [License](#license)



## Install

To install and run, open a terminal and use the following commands:

```shell
    npm install
    npm start (or npx gulp dev)
```
## Usage


## Add new translation

To add a new translation for the Front-End Checklist, you just need to translate the original JSON files in English to your own language.

- [ ] Duplicate `data/en` folder and change the name of the folder to:
  * jp for Japanese
  * es for Spanish
  * cn for Chinese
  * fr for French

- [ ] Launch the GULP development mode adding the `--l` argument and your language

  ```shell
    npx gulp dev --l jp
  ```

- [ ] Translate all JSON files starting with the `project` folder

> You'll need to stop the development mode, manually launch `npx gulp jsonRebuild`, and launch again the dev mode in order to see your changes on the view.

- [ ] Update the `views/base/header.pug` with the right flag and url (you can download your flag if not already in `src/img/flags` at http://flag-icon-css.lip.is/)

  ```haml
    li.s-header__lang__item
      a(href="/jp")
        img(src="/img/flags/jp.svg" width="20" height="15" alt="Japanese language")
  ```

## Contribute

## License

[![CC0](https://i.creativecommons.org/p/zero/1.0/88x31.png)](https://creativecommons.org/publicdomain/zero/1.0/)

**[⬆ back to top](#table-of-contents)**



[npm-image]: https://img.shields.io/npm/v/auto-changelog.svg
[npm-url]: https://www.npmjs.com/package/auto-changelog


[gitter-image]: https://badges.gitter.im/Front-End-Checklist/Lobby.svg
[gitter-url]: https://gitter.im/Front-End-Checklist/Lobby?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge

[opencollective-backers-image]: https://opencollective.com/front-end-checklist/backers/badge.svg
[opencollective-backers-url]: #backers

[opencollective-sponsors-image]: https://opencollective.com/front-end-checklist/sponsors/badge.svg
[opencollective-sponsors-url]: #sponsors

[frontendchecklist-image]: https://img.shields.io/badge/Front‑End_Checklist-followed-brightgreen.svg

[codeclimate-maintainability-image]: https://api.codeclimate.com/v1/badges/55642648e3348bfe38eb/maintainability
[codeclimate-maintainability-url]: https://codeclimate.com/repos/59f3015dd77fc102a50008ee/maintainability

[codeclimate-coverage-image]: https://api.codeclimate.com/v1/badges/55642648e3348bfe38eb/test_coverage
[codeclimate-coverage-url]: https://codeclimate.com/repos/59f3015dd77fc102a50008ee/test_coverage
