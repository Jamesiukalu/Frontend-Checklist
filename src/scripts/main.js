'use strict';

import Init from './components/Init';
import Audit from './components/Audit';
import Help from './components/Help';

// The bundle loads async, so DOMContentLoaded may already have fired
const start = () => {
  new Help();

  if (document.querySelector('.js-section')) new Init();
  if (document.querySelector('.js-audit-form')) new Audit();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
