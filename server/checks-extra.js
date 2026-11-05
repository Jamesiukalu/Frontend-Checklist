// Extra checks that need the fetched CSS/JS/images/links (ctx.resources).
// Same contract as checks.js: return {pass, detail} or null when undecidable.
const ok = (cond, detail) => ({pass: Boolean(cond), detail: detail || ''});
const NA = null;

const header = (ctx, name) => {
  const value = ctx.headers[name];

  return Array.isArray(value) ? value.join(', ') : value || '';
};
const text = el => (el.text() || '').replace(/\s+/g, ' ').trim();
const meta = ($, name) =>
  $(`meta[name="${name}" i], meta[property="${name}" i]`)
    .first()
    .attr('content');
const list = items => items.slice(0, 3).join(', ');
const kb = bytes => `${Math.round(bytes / 1024)} KB`;

const ARIA_ATTRIBUTES = new Set(
  `activedescendant atomic autocomplete braillelabel brailleroledescription busy checked colcount colindex colindextext colspan controls current describedby description details disabled dropeffect errormessage expanded flowto grabbed haspopup hidden invalid keyshortcuts label labelledby level live modal multiline multiselectable orientation owns placeholder posinset pressed readonly relevant required roledescription rowcount rowindex rowindextext rowspan selected setsize sort valuemax valuemin valuenow valuetext`
    .split(' ')
    .map(name => `aria-${name}`),
);
const ARIA_ROLES = new Set(
  `alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem`.split(
    ' ',
  ),
);
const DEPRECATED_ROLES = new Set(['directory']);
const ROLE_REQUIRED_ATTRS = {
  checkbox: ['aria-checked'],
  switch: ['aria-checked'],
  radio: ['aria-checked'],
  menuitemcheckbox: ['aria-checked'],
  menuitemradio: ['aria-checked'],
  slider: ['aria-valuenow'],
  scrollbar: ['aria-controls', 'aria-valuenow'],
  combobox: ['aria-expanded', 'aria-controls'],
  heading: ['aria-level'],
  option: ['aria-selected'],
};
const REQUIRED_CHILDREN = {
  list: ['listitem'],
  menu: ['menuitem', 'menuitemcheckbox', 'menuitemradio', 'group'],
  menubar: ['menuitem', 'menuitemcheckbox', 'menuitemradio', 'group'],
  tablist: ['tab'],
  listbox: ['option', 'group'],
  tree: ['treeitem', 'group'],
};
const REQUIRED_PARENTS = {
  listitem: ['list', 'group'],
  tab: ['tablist'],
  menuitem: ['menu', 'menubar', 'group'],
  option: ['listbox', 'group'],
  treeitem: ['tree', 'group'],
};

const roleOf = (el, $) =>
  ($(el).attr('role') || '').trim().split(/\s+/)[0].toLowerCase();

function accessibleName($, el) {
  const $el = $(el);
  const direct = ($el.attr('aria-label') || '').trim();

  if (direct) return direct;

  const labelledby = ($el.attr('aria-labelledby') || '').trim();

  if (labelledby) {
    const name = labelledby
      .split(/\s+/)
      .map(id => text($(`[id="${id}"]`).first()))
      .join(' ')
      .trim();

    if (name) return name;
  }
  if (($el.attr('title') || '').trim()) return $el.attr('title').trim();

  const tag = el.tagName;

  if (tag === 'input') {
    const type = ($el.attr('type') || 'text').toLowerCase();

    if (['submit', 'button', 'reset'].includes(type)) {
      return ($el.attr('value') || '').trim();
    }
    if (type === 'image') return ($el.attr('alt') || '').trim();
  }
  const id = $el.attr('id');

  if (id && text($(`label[for="${id}"]`).first())) {
    return text($(`label[for="${id}"]`).first());
  }
  const wrapping = $el.closest('label');

  if (wrapping.length && text(wrapping)) return text(wrapping);

  if (['button', 'a', 'summary'].includes(tag) || $el.attr('role')) {
    const content = text($el);

    if (content) return content;
    if ($el.find('img[alt]:not([alt=""]), svg title').length) return 'image';
    if ($el.find('[aria-label]').length) return 'nested';
  }

  return '';
}

const CONTROL_SELECTOR =
  'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea';

const without = ($, selector) =>
  $(selector).filter((_, el) => !accessibleName($, el));

function cssOf(ctx) {
  const inline = ctx
    .$('style')
    .map((_, el) => ctx.$(el).text())
    .get()
    .join('\n');
  const files = ctx.resources ? ctx.resources.css.map(c => c.body) : [];

  return {text: [inline, ...files].join('\n'), hasFiles: files.length > 0};
}

function firstPartyScripts(ctx) {
  const inline = ctx
    .$('script:not([src])')
    .filter((_, el) => {
      const type = (ctx.$(el).attr('type') || '').toLowerCase();

      return !type || /javascript|module/.test(type);
    })
    .map((_, el) => ({url: 'inline script', body: ctx.$(el).text()}))
    .get();
  const files = ctx.resources
    ? ctx.resources.js.filter(file => ctx.resources.sameSite(file.url))
    : [];

  return [...inline, ...files];
}

const isMinified = body => {
  const lines = body.split('\n').length;

  return body.length > 2000 && body.length / lines > 150;
};

const THIRD_PARTY_TRACKERS =
  /google-analytics\.com|googletagmanager\.com|doubleclick\.net|facebook\.net|connect\.facebook|hotjar\.com|clarity\.ms|segment\.(com|io)|mixpanel\.com|fullstory\.com|tiktok\.com\/i18n|snap\.licdn|ads-twitter|static\.ads|criteo\./i;
const CONSENT_TOOLS =
  /cookiebot|onetrust|cookieconsent|cookie-consent|cookie_consent|termly|iubenda|osano|complianz|didomi|quantcast|usercentrics|klaro|axeptio|tarteaucitron|cookie-law|borlabs|cc-window|cookie banner|cookie-banner/i;

const JSON_LD_TYPES = ctx => {
  const types = [];
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      [].concat(node['@type'] || []).forEach(t => types.push(String(t)));
      Object.values(node).forEach(walk);
    }
  };

  ctx.$('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse(ctx.$(el).text()));
    } catch {
      // Invalid blocks are reported by the JSON-LD validity check
    }
  });

  return types;
};

const bodyText = $ => {
  const clone = $('body').clone();

  clone.find('script,style,noscript,nav,header,footer,svg').remove();

  return text(clone);
};

const STOP_WORDS = new Set(
  'the and for are but not you all any can had her was one our out has have this that with from they will would there their what about which when your said each she how use been more than them then these some into only over also very just like such most make made does did get got its let'.split(
    ' ',
  ),
);

function fleschReadingEase(content) {
  const sentences = Math.max(1, (content.match(/[.!?]+(\s|$)/g) || []).length);
  const words = content.match(/[A-Za-z']+/g) || [];
  const syllables = words.reduce((total, word) => {
    const groups = word
      .toLowerCase()
      .replace(/e$/, '')
      .match(/[aeiouy]+/g);

    return total + Math.max(1, groups ? groups.length : 1);
  }, 0);

  return (
    206.835 -
    1.015 * (words.length / sentences) -
    84.6 * (syllables / Math.max(1, words.length))
  );
}

const LIBRARIES = [
  {
    name: 'jQuery',
    re: /jquery[-.@/ v]*(\d+)\.(\d+)\.(\d+)/i,
    bad: (a, b) => a < 3 || (a === 3 && b < 5),
    need: '3.5.0+',
  },
  {
    name: 'Bootstrap',
    re: /bootstrap[-.@/ v]*(\d+)\.(\d+)\.(\d+)/i,
    bad: (a, b) => a < 3 || (a === 3 && b < 4) || (a === 4 && b < 3),
    need: '4.3.1+ / 3.4.1+',
  },
  {
    name: 'AngularJS',
    re: /angular(?:js)?[-.@/ v]*(1)\.(\d+)\.(\d+)/i,
    bad: () => true,
    need: 'a supported framework (AngularJS is end-of-life)',
  },
  {
    name: 'Lodash',
    re: /lodash[-.@/ v]*(\d+)\.(\d+)\.(\d+)/i,
    bad: (a, b, c) => a < 4 || (a === 4 && (b < 17 || (b === 17 && c < 21))),
    need: '4.17.21+',
  },
  {
    name: 'Moment.js',
    re: /moment[-.@/ v]*(\d+)\.(\d+)\.(\d+)/i,
    bad: (a, b, c) => a === 2 && (b < 29 || (b === 29 && c < 4)),
    need: '2.29.4+',
  },
];

function detectLibraries(ctx) {
  const found = [];
  const sources = ctx
    .$('script[src]')
    .map((_, el) => ctx.$(el).attr('src'))
    .get();

  const files = ctx.resources ? ctx.resources.js : [];

  LIBRARIES.forEach(lib => {
    const hits = new Set();

    sources.forEach(src => {
      const match = lib.re.exec(src);

      if (match) hits.add(match.slice(1, 4).join('.'));
    });
    files.forEach(file => {
      const match = lib.re.exec(file.body.slice(0, 600));

      if (match) hits.add(match.slice(1, 4).join('.'));
    });
    hits.forEach(version => {
      const [a, b, c] = version.split('.').map(Number);

      found.push({...lib, version, outdated: lib.bad(a, b, c)});
    });
  });

  return found;
}

const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/sk_live_[0-9a-zA-Z]{16,}/, 'Stripe live secret key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/xox[baprs]-[0-9A-Za-z-]{10,}/, 'Slack token'],
  [/mongodb(\+srv)?:\/\/[^\s:@/]+:[^\s@/]+@/, 'database connection string'],
  [/AIza[0-9A-Za-z_-]{35}(?=['"\s]|$)/, 'Google API key (check restrictions)'],
  [/SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, 'SendGrid key'],
];

const checks = [];
const add = (ids, run) => checks.push({ids, run});

// Present means pass, absent means "not applicable" so niche features
// never penalise a page.
const adopt = (ids, regex, scope = 'css') =>
  add(ids, ctx => {
    const source =
      scope === 'css'
        ? cssOf(ctx).text
        : firstPartyScripts(ctx)
            .map(s => s.body)
            .join('\n');

    return regex.test(source) ? ok(true, 'in use') : NA;
  });

// ---------- Accessibility: names, ARIA, structure ----------

add(['accessibility-do-not-use-aria-hidden-on-the-document-body'], ({$}) =>
  ok($('body[aria-hidden="true"]').length === 0),
);

add(
  [
    'accessibility-ensure-all-input-fields-have-accessible-names',
    'accessibility-provide-accessible-names-for-toggle-fields',
  ],
  ({$}) => {
    const controls = $(CONTROL_SELECTOR);

    if (!controls.length) return NA;
    const bad = without($, CONTROL_SELECTOR).length;

    return ok(!bad, bad ? `${bad} of ${controls.length} without a name` : '');
  },
);

add(['accessibility-provide-accessible-names-for-select-elements'], ({$}) => {
  if (!$('select').length) return NA;
  const bad = without($, 'select').length;

  return ok(!bad, bad ? `${bad} select(s) without a name` : '');
});

add(['accessibility-provide-accessible-names-for-buttons'], ({$}) => {
  const selector =
    'button, [role=button], input[type=submit], input[type=button], input[type=reset]';

  if (!$(selector).length) return NA;
  const bad = without($, selector).length;

  return ok(!bad, bad ? `${bad} button(s) without a name` : '');
});

add(
  [
    'accessibility-provide-accessible-names-for-all-interactive-elements',
    'accessibility-provide-accessible-names-for-aria-command-elements',
  ],
  ({$}) => {
    const selector =
      'a[href], button, [role=button], [role=link], [role=menuitem]';
    const bad = without($, selector).length;

    return ok(!bad, bad ? `${bad} interactive element(s) without a name` : '');
  },
);

add(['accessibility-provide-alt-text-for-image-buttons'], ({$}) => {
  const buttons = $('input[type=image]');

  if (!buttons.length) return NA;
  const bad = buttons.filter((_, el) => !($(el).attr('alt') || '').trim());

  return ok(!bad.length);
});

add(
  [
    'accessibility-provide-accessible-names-for-progress-bars',
    'accessibility-provide-accessible-names-for-meter-elements',
  ],
  ({$}) => {
    const selector = 'progress, meter, [role=progressbar], [role=meter]';

    if (!$(selector).length) return NA;

    return ok(!without($, selector).length);
  },
);

add(['accessibility-ensure-dialogs-have-an-accessible-name'], ({$}) => {
  const selector = 'dialog, [role=dialog], [role=alertdialog]';

  if (!$(selector).length) return NA;
  const bad = $(selector).filter(
    (_, el) =>
      !($(el).attr('aria-label') || $(el).attr('aria-labelledby') || '').trim(),
  );

  return ok(!bad.length, bad.length ? `${bad.length} unnamed dialog(s)` : '');
});

add(['accessibility-provide-alternative-text-for-objects'], ({$}) => {
  const objects = $('object, embed');

  if (!objects.length) return NA;
  const bad = objects.filter((_, el) => !accessibleName($, el) && !text($(el)));

  return ok(!bad.length);
});

add(['accessibility-align-visible-labels-with-accessible-names'], ({$}) => {
  const bad = [];

  $('a[aria-label], button[aria-label]').each((_, el) => {
    const visible = text($(el)).toLowerCase();
    const label = $(el).attr('aria-label').toLowerCase();

    if (visible && !label.includes(visible)) bad.push(visible);
  });

  return ok(!bad.length, bad.length ? `e.g. "${bad[0]}"` : '');
});

add(['accessibility-do-not-disable-pinch-zoom'], ({$}) => {
  const viewport = meta($, 'viewport') || '';
  const scale = /maximum-scale\s*=\s*([\d.]+)/i.exec(viewport);
  const blocked =
    /user-scalable\s*=\s*(no|0)/i.test(viewport) ||
    (scale && Number(scale[1]) < 2);

  return ok(!blocked, blocked ? viewport : '');
});

add(['accessibility-ensure-aria-attributes-are-valid'], ({$}) => {
  const bad = new Set();

  $('*').each((_, el) => {
    Object.keys(el.attribs || {}).forEach(name => {
      if (name.startsWith('aria-') && !ARIA_ATTRIBUTES.has(name)) bad.add(name);
    });
  });

  return ok(!bad.size, bad.size ? list([...bad]) : '');
});

add(
  [
    'accessibility-use-valid-aria-role-values',
    'accessibility-avoid-using-deprecated-aria-roles',
  ],
  ({$}) => {
    const bad = new Set();
    const deprecated = new Set();

    $('[role]').each((_, el) => {
      ($(el).attr('role') || '')
        .trim()
        .split(/\s+/)
        .forEach(role => {
          const name = role.toLowerCase();

          if (DEPRECATED_ROLES.has(name)) deprecated.add(name);
          else if (
            name &&
            !ARIA_ROLES.has(name) &&
            !name.startsWith('doc-') &&
            !name.startsWith('graphics-')
          ) {
            bad.add(name);
          }
        });
    });
    const all = [...bad, ...deprecated];

    return ok(!all.length, all.length ? list(all) : '');
  },
);

add(['accessibility-use-unique-ids-for-aria-references'], ({$}) => {
  const missing = [];
  const refs = [
    'aria-labelledby',
    'aria-describedby',
    'aria-controls',
    'aria-owns',
  ];

  refs.forEach(attr => {
    $(`[${attr}]`).each((_, el) => {
      $(el)
        .attr(attr)
        .trim()
        .split(/\s+/)
        .forEach(id => {
          if (id && !$(`[id="${id}"]`).length) missing.push(`${attr}="${id}"`);
        });
    });
  });

  return ok(!missing.length, missing.length ? list(missing) : '');
});

add(['accessibility-use-unique-ids-for-active-elements'], ({$}) => {
  const seen = new Map();
  const dupes = new Set();

  $(
    'a[id], button[id], input[id], select[id], textarea[id], [tabindex][id]',
  ).each((_, el) => {
    const id = $(el).attr('id');

    if (seen.has(id)) dupes.add(id);
    seen.set(id, true);
  });
  $('[id]').each((_, el) => {
    const id = $(el).attr('id');

    if (seen.has(id) && $(`[id="${id}"]`).length > 1) dupes.add(id);
  });

  return ok(!dupes.size, dupes.size ? list([...dupes]) : '');
});

add(['accessibility-ensure-accesskey-values-are-unique'], ({$}) => {
  const keys = $('[accesskey]')
    .map((_, el) => $(el).attr('accesskey').toLowerCase())
    .get();

  if (!keys.length) return NA;

  return ok(new Set(keys).size === keys.length);
});

add(['accessibility-avoid-autoplaying-media'], ({$}) => {
  const media = $('video[autoplay], audio[autoplay]').filter(
    (_, el) => $(el).attr('muted') === undefined,
  );

  return ok(!media.length, media.length ? `${media.length} autoplaying` : '');
});

add(['accessibility-provide-captions-for-video-content'], ({$}) => {
  const videos = $('video');

  if (!videos.length) return NA;
  const bad = videos.filter(
    (_, el) =>
      !$(el).find('track[kind="captions"], track[kind="subtitles"]').length,
  );

  return ok(
    !bad.length,
    bad.length ? `${bad.length} video(s) without captions` : '',
  );
});

add(['accessibility-use-appropriate-tabindex-values'], ({$}) => {
  const bad = $('[tabindex]').filter(
    (_, el) => Number($(el).attr('tabindex')) > 0,
  );

  return ok(!bad.length, bad.length ? `${bad.length} positive tabindex` : '');
});

add(['accessibility-avoid-autofocus-on-form-fields'], ({$}) =>
  ok($('[autofocus]').length === 0),
);

add(['accessibility-allow-pasting-into-form-inputs'], ({$}) => {
  const blocked = $('input, textarea').filter((_, el) =>
    /return\s+false|preventDefault/i.test($(el).attr('onpaste') || ''),
  );

  return ok(!blocked.length);
});

add(['accessibility-match-lang-and-xml-lang-attributes'], ({$}) => {
  const xml = ($('html').attr('xml:lang') || '').toLowerCase();
  const lang = ($('html').attr('lang') || '').toLowerCase();

  if (!xml) return NA;

  return ok(xml.split('-')[0] === lang.split('-')[0]);
});

add(
  [
    'accessibility-place-list-items-within-list-containers',
    'accessibility-use-correct-list-structure',
    'accessibility-use-semantic-list-elements',
  ],
  ({$}) => {
    const stray = $('li').filter(
      (_, el) =>
        !$(el).parent().is('ul, ol, menu') &&
        !['list'].includes(roleOf($(el).parent()[0] || {}, $)),
    );
    const badChildren = $('ul > *, ol > *').filter(
      (_, el) => !['li', 'script', 'template'].includes(el.tagName),
    );

    return ok(
      !stray.length && !badChildren.length,
      stray.length
        ? `${stray.length} li outside a list`
        : badChildren.length
          ? `${badChildren.length} invalid list child(ren)`
          : '',
    );
  },
);

add(
  [
    'accessibility-use-correct-definition-list-structure',
    'accessibility-wrap-definition-items-in-a-definition-list',
  ],
  ({$}) => {
    if (!$('dl, dt, dd').length) return NA;
    const stray = $('dt, dd').filter((_, el) => !$(el).parent().is('dl, div'));
    const badChildren = $('dl > *').filter(
      (_, el) =>
        !['dt', 'dd', 'div', 'script', 'template'].includes(el.tagName),
    );

    return ok(!stray.length && !badChildren.length);
  },
);

add(
  [
    'accessibility-define-proper-table-headers',
    'accessibility-ensure-table-headers-associate-with-data-cells',
    'accessibility-use-semantic-table-markup-for-screen-readers',
  ],
  ({$}) => {
    const tables = $('table').filter(
      (_, el) => !/presentation|none/.test($(el).attr('role') || ''),
    );

    if (!tables.length) return NA;
    const bad = tables.filter((_, el) => !$(el).find('th').length);

    return ok(
      !bad.length,
      bad.length ? `${bad.length} table(s) without th` : '',
    );
  },
);

add(['accessibility-ensure-tables-have-unique-accessible-names'], ({$}) => {
  const tables = $('table');

  if (tables.length < 2) return NA;
  const names = tables
    .map(
      (_, el) =>
        text($(el).find('caption').first()) || $(el).attr('aria-label') || '',
    )
    .get();

  return ok(names.every(Boolean) && new Set(names).size === names.length);
});

add(
  [
    'accessibility-ensure-aria-roles-contain-required-child-roles',
    'accessibility-ensure-aria-roles-are-contained-by-required-parent-roles',
  ],
  ({$}) => {
    const problems = [];

    Object.entries(REQUIRED_CHILDREN).forEach(([role, children]) => {
      $(`[role="${role}"]`).each((_, el) => {
        const found = $(el)
          .find('[role]')
          .filter((__, child) => children.includes(roleOf(child, $))).length;

        if (!found && !$(el).find('li, option').length) problems.push(role);
      });
    });
    Object.entries(REQUIRED_PARENTS).forEach(([role, parents]) => {
      $(`[role="${role}"]`).each((_, el) => {
        const hasParent = $(el)
          .parents('[role]')
          .filter((__, parent) => parents.includes(roleOf(parent, $))).length;
        const nativeParent = $(el).parents('ul, ol, select, datalist').length;

        if (!hasParent && !nativeParent) problems.push(role);
      });
    });

    if (!$('[role]').length) return NA;

    return ok(!problems.length, problems.length ? list(problems) : '');
  },
);

add(['accessibility-include-required-aria-attributes-for-roles'], ({$}) => {
  const problems = [];

  Object.entries(ROLE_REQUIRED_ATTRS).forEach(([role, attrs]) => {
    $(`[role="${role}"]`).each((_, el) => {
      if (
        [
          'input',
          'select',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'option',
        ].includes(el.tagName)
      ) {
        return;
      }
      attrs.forEach(attr => {
        if ($(el).attr(attr) === undefined)
          problems.push(`${role} needs ${attr}`);
      });
    });
  });

  if (!$('[role]').length) return NA;

  return ok(!problems.length, problems.length ? list(problems) : '');
});

add(
  ['accessibility-remove-focusable-elements-from-aria-hidden-containers'],
  ({$}) => {
    const bad = $('[aria-hidden="true"]').filter(
      (_, el) =>
        $(el).is('a[href], button, input, select, textarea') ||
        $(el).find(
          'a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ).length > 0,
    );

    return ok(!bad.length, bad.length ? `${bad.length} container(s)` : '');
  },
);

add(['accessibility-avoid-redundant-image-alternative-text'], ({$}) => {
  const bad = $('img[alt]').filter((_, el) => {
    const alt = $(el).attr('alt').trim().toLowerCase();
    const file = (
      ($(el).attr('src') || '').split('/').pop() || ''
    ).toLowerCase();

    return (
      /^(image|picture|photo|graphic|icon|logo)( of)?\b/.test(alt) ||
      /\.(png|jpe?g|gif|svg|webp)$/.test(alt) ||
      (alt && alt === file)
    );
  });

  return ok(!bad.length, bad.length ? `${bad.length} image(s)` : '');
});

add(['accessibility-use-a-single-label-for-each-form-field'], ({$}) => {
  const seen = new Map();

  $('label[for]').each((_, el) => {
    const id = $(el).attr('for');

    seen.set(id, (seen.get(id) || 0) + 1);
  });

  return ok(![...seen.values()].some(count => count > 1));
});

add(
  ['accessibility-ensure-identical-links-have-consistent-destinations'],
  ({$, finalUrl}) => {
    const byText = new Map();

    $('a[href]').each((_, el) => {
      const label = text($(el)).toLowerCase();
      const href = $(el).attr('href');

      if (!label || /^(#|javascript:|mailto:|tel:)/i.test(href)) return;
      let target;

      try {
        target = new URL(href, finalUrl).href.replace(/#.*$/, '');
      } catch {
        return;
      }
      if (!byText.has(label)) byText.set(label, new Set());
      byText.get(label).add(target);
    });
    const conflicts = [...byText.entries()].filter(([, set]) => set.size > 1);

    return ok(
      !conflicts.length,
      conflicts.length
        ? `"${conflicts[0][0]}" points to ${conflicts[0][1].size} places`
        : '',
    );
  },
);

add(['accessibility-use-landmark-regions-correctly'], ({$}) => {
  const mains = $('main, [role=main]').length;
  const navs = $('nav, [role=navigation]');
  const unnamed = navs.filter(
    (_, el) =>
      !($(el).attr('aria-label') || $(el).attr('aria-labelledby') || '').trim(),
  );

  return ok(
    mains === 1 && (navs.length < 2 || !unnamed.length),
    mains !== 1
      ? `${mains} main landmarks`
      : unnamed.length && navs.length > 1
        ? 'multiple nav landmarks need names'
        : '',
  );
});

add(['accessibility-respect-reduced-motion-preferences'], ctx => {
  const css = cssOf(ctx);

  if (!css.text) return NA;
  const animated = /@keyframes|animation\s*:|transition\s*:/i.test(css.text);

  if (!animated) return NA;

  return ok(/prefers-reduced-motion/i.test(css.text));
});

// ---------- HTML ----------

add(['html-use-semantic-html-elements'], ({$}) => {
  const present = [
    'header',
    'nav',
    'main',
    'footer',
    'section, article, aside',
  ].filter(selector => $(selector).length);

  return ok(
    present.length >= 3 && $('main').length,
    `${present.length}/5 landmark groups`,
  );
});

add(['html-use-semantic-input-type-attributes'], ({$}) => {
  const bad = $('input:not([type]), input[type=text]').filter((_, el) => {
    const hint = `${$(el).attr('name') || ''} ${$(el).attr('id') || ''} ${$(el).attr('autocomplete') || ''} ${$(el).attr('placeholder') || ''}`;

    return /e-?mail|phone|tel\b|password|\burl\b|website/i.test(hint);
  });

  return ok(
    !bad.length,
    bad.length ? `${bad.length} input(s) should use a specific type` : '',
  );
});

add(['html-provide-noscript-fallback-content'], ({$}) =>
  ok($('noscript').length > 0 || bodyText($).length > 500),
);

add(['html-remove-comments-and-debug-code-in-production'], ctx => {
  const comments = (
    ctx.html.match(/<!--(?!\[if|<!|\s*\[endif)[\s\S]*?-->/g) || []
  ).length;
  const debug = firstPartyScripts(ctx).some(s => /\bdebugger\b/.test(s.body));

  return ok(
    comments <= 5 && !debug,
    `${comments} HTML comment(s)${debug ? ', debugger statement' : ''}`,
  );
});

add(['html-set-text-direction-for-rtl-languages'], ({$}) => {
  const lang = ($('html').attr('lang') || '').toLowerCase().split('-')[0];
  const dir = ($('html').attr('dir') || '').toLowerCase();
  const rtl = ['ar', 'he', 'fa', 'ur'].includes(lang);

  return rtl
    ? ok(dir === 'rtl', dir || 'dir missing')
    : ok(true, dir || 'defaults to ltr');
});

add(['html-implement-favicons-for-all-devices'], ({$}) =>
  ok(
    $('link[rel~="icon" i]').length > 0 &&
      $('link[rel="apple-touch-icon" i]').length > 0,
    $('link[rel="apple-touch-icon" i]').length
      ? ''
      : 'apple-touch-icon missing',
  ),
);

add(['head-apple-web-app-meta'], ({$}) =>
  ok(
    $('link[rel="apple-touch-icon" i]').length > 0 ||
      meta($, 'apple-mobile-web-app-capable') ||
      meta($, 'apple-mobile-web-app-title'),
  ),
);

add(['head-x-ua-compatible'], ({$, headers}) =>
  ok(
    $('meta[http-equiv="X-UA-Compatible" i]').length > 0 ||
      /ie=/i.test(headers['x-ua-compatible'] || ''),
  ),
);

add(['head-windows-tiles'], ({$}) => {
  const present =
    meta($, 'msapplication-TileColor') ||
    $('meta[name="msapplication-config" i]').length;

  return present ? ok(true) : NA;
});

add(['head-rss-feed'], ({$}) => {
  const feed = $(
    'link[type="application/rss+xml" i], link[type="application/atom+xml" i]',
  ).length;

  return feed ? ok(true) : NA;
});

add(
  ['head-alternate-language', 'i18n-add-hreflang-tags-for-multilingual-sites'],
  ({$}) => {
    const alternates = $('link[rel="alternate" i][hreflang]');

    if (!alternates.length) return NA;
    const hasDefault = alternates.filter(
      (_, el) => $(el).attr('hreflang').toLowerCase() === 'x-default',
    ).length;

    return ok(hasDefault, hasDefault ? '' : 'x-default missing');
  },
);

add(['css-inline-critical-css-for-faster-rendering'], ({$}) => {
  const inline = $('head style')
    .map((_, el) => $(el).text().length)
    .get()
    .reduce((a, b) => a + b, 0);

  return ok(inline > 300, `${inline} bytes of inline CSS in head`);
});

add(['head-css-order', 'css-order-css-files-correctly'], ({$}) => {
  const order = $('head link[rel~="stylesheet" i], head script[src]')
    .map((_, el) => (el.tagName === 'link' ? 'css' : 'js'))
    .get();

  if (!order.includes('css')) return NA;
  const firstJs = order.indexOf('js');
  const lastCss = order.lastIndexOf('css');

  return ok(firstJs === -1 || lastCss < firstJs);
});

add(['css-load-css-without-blocking-render'], ({$}) => {
  const blocking = $('head link[rel~="stylesheet" i]').filter((_, el) => {
    const media = ($(el).attr('media') || '').toLowerCase();

    return !media || media === 'all' || media === 'screen';
  });

  return ok(
    blocking.length <= 1,
    `${blocking.length} render-blocking stylesheet(s)`,
  );
});

add(['css-avoid-embedded-and-inline-css'], ({$}) => {
  const inlineAttrs = $('[style]').length;
  const embedded = $('style')
    .map((_, el) => $(el).text().length)
    .get()
    .reduce((a, b) => a + b, 0);

  return ok(
    inlineAttrs <= 10 && embedded <= 20000,
    `${inlineAttrs} style attributes, ${kb(embedded)} embedded`,
  );
});

add(['javascript-avoid-inline-javascript'], ({$}) => {
  const handlers = $('*').filter((_, el) =>
    Object.keys(el.attribs || {}).some(name => /^on[a-z]+$/.test(name)),
  ).length;

  return ok(
    handlers === 0,
    handlers ? `${handlers} inline event handler(s)` : '',
  );
});

add(['javascript-use-es-modules-import-export'], ({$}) => {
  if (!$('script[src], script:not([src])').length) return NA;

  return $('script[type="module"]').length ? ok(true) : NA;
});

// ---------- CSS content ----------

const cssCheck = (ids, fn) =>
  add(ids, ctx => {
    const css = cssOf(ctx);

    if (!css.text.trim()) return NA;

    return fn(css.text, ctx);
  });

cssCheck(
  ['css-minify-all-css-files', 'performance-optimize-css-file-size'],
  (_, ctx) => {
    const sheets = ctx.resources
      ? ctx.resources.css.filter(sheet => !sheet.truncated)
      : [];

    if (!sheets.length) return NA;
    const heavy = sheets.filter(
      sheet => !isMinified(sheet.body) && sheet.body.length > 2000,
    );
    const large = sheets.filter(sheet => sheet.body.length > 150 * 1024);

    return ok(
      !heavy.length && !large.length,
      heavy.length
        ? `${heavy.length} file(s) look unminified`
        : large.length
          ? `${kb(large[0].body.length)} stylesheet`
          : '',
    );
  },
);

cssCheck(['css-include-a-print-stylesheet'], (cssText, {$}) =>
  ok(/@media\s+print/i.test(cssText) || $('link[media="print" i]').length > 0),
);

cssCheck(['css-support-dark-mode-with-prefers-color-scheme'], (cssText, {$}) =>
  ok(
    /prefers-color-scheme/i.test(cssText) ||
      meta($, 'color-scheme') ||
      /color-scheme\s*:/i.test(cssText),
  ),
);

cssCheck(['css-use-css-custom-properties-for-design-tokens'], cssText =>
  ok(/--[\w-]+\s*:/.test(cssText) && /var\(--/.test(cssText)),
);

cssCheck(['css-use-relative-units-for-responsive-layouts'], cssText => {
  const sizes = cssText.match(/font-size\s*:\s*[^;}]+/gi) || [];

  if (sizes.length < 3) return NA;
  const px = sizes.filter(size => /\d\s*px/i.test(size)).length;

  return ok(px / sizes.length < 0.5, `${px}/${sizes.length} font sizes in px`);
});

cssCheck(['css-use-readable-font-sizes-on-mobile'], cssText => {
  const tiny = (
    cssText.match(/font-size\s*:\s*(\d+(\.\d+)?)px/gi) || []
  ).filter(size => Number(/(\d+(\.\d+)?)px/.exec(size)[1]) < 12);

  return ok(tiny.length < 3, `${tiny.length} font size(s) below 12px`);
});

cssCheck(['css-use-a-css-reset-or-normalize-stylesheet'], cssText =>
  ok(
    /normalize|text-size-adjust|box-sizing\s*:\s*border-box|\*\s*,\s*\*::?before|margin\s*:\s*0\s*;?\s*padding\s*:\s*0/i.test(
      cssText,
    ),
  ),
);

cssCheck(['css-provide-visible-custom-focus-indicators'], cssText => {
  const hasFocus =
    /:focus(-visible)?\b[^{]*{[^}]*(outline|box-shadow|border)/i.test(cssText);
  const removes = /outline\s*:\s*(none|0)/i.test(cssText);

  return ok(
    hasFocus || !removes,
    hasFocus ? '' : removes ? 'outline removed without a replacement' : '',
  );
});

cssCheck(['css-use-transform-and-opacity-for-animations'], cssText => {
  const transitions = cssText.match(/transition(-property)?\s*:[^;}]+/gi) || [];
  const heavy = transitions.filter(t =>
    /\b(all|width|height|top|left|right|bottom|margin|padding)\b/i.test(t),
  );

  if (!transitions.length) return NA;

  return ok(
    heavy.length === 0,
    heavy.length ? `${heavy.length} transition(s) on layout properties` : '',
  );
});

cssCheck(['css-keep-css-specificity-low-and-flat'], cssText => {
  const important = (cssText.match(/!important/g) || []).length;

  return ok(important <= 20, `${important} !important`);
});

adopt(
  ['css-use-container-queries-for-component-level-responsiveness'],
  /@container\b|container-type\s*:/i,
);
adopt(
  ['css-use-has-to-style-parent-elements-based-on-their-descendants'],
  /:has\(/,
);
adopt(['css-use-layer-to-manage-css-cascade-order-explicitly'], /@layer\b/);
adopt(
  ['css-use-css-subgrid-to-align-nested-grid-items-to-parent-tracks'],
  /subgrid/,
);
adopt(
  ['css-use-oklch-and-oklab-for-perceptually-uniform-colour-palettes'],
  /\b(oklch|oklab)\(/,
);
adopt(
  ['css-register-css-custom-properties-with-property-for-animation-a'],
  /@property\b/,
);
adopt(
  ['css-use-css-logical-properties-for-i18n-and-rtl-support'],
  /(margin|padding|border)-(inline|block)(-start|-end)?\s*:|inset-inline|inline-size|block-size/i,
);
add(
  ['css-use-the-view-transitions-api-for-smooth-page-and-component-t'],
  ctx => {
    const source = `${cssOf(ctx).text}\n${firstPartyScripts(ctx)
      .map(s => s.body)
      .join('\n')}`;

    return /view-transition|startViewTransition/.test(source)
      ? ok(true, 'in use')
      : NA;
  },
);
adopt(
  ['css-use-css-grid-for-two-dimensional-layouts'],
  /display\s*:\s*(inline-)?grid/i,
);
adopt(['css-apply-flexbox-best-practices'], /display\s*:\s*(inline-)?flex/i);

// ---------- JavaScript content (first-party only) ----------

const jsCheck = (ids, fn) =>
  add(ids, ctx => {
    const files = firstPartyScripts(ctx);

    if (!files.length) return NA;

    return fn(files, ctx);
  });

jsCheck(
  ['javascript-never-use-eval-or-unsafe-dynamic-code-execution'],
  files => {
    const bad = files.filter(file =>
      /(^|[^.\w$])eval\s*\(|new\s+Function\s*\(|document\.write\s*\(/.test(
        file.body,
      ),
    );

    return ok(
      !bad.length,
      bad.length ? list(bad.map(file => file.url.split('/').pop())) : '',
    );
  },
);

jsCheck(['javascript-remove-console-statements-in-production'], files => {
  const bad = files.filter(file =>
    /console\.(log|debug|trace)\s*\(/.test(file.body),
  );

  return ok(
    !bad.length,
    bad.length ? list(bad.map(file => file.url.split('/').pop())) : '',
  );
});

add(['javascript-minify-all-javascript-files'], ({resources}) => {
  const files = resources
    ? resources.js.filter(file => !file.truncated && file.body.length > 3000)
    : [];

  if (!files.length) return NA;
  const bad = files.filter(file => !isMinified(file.body));

  return ok(
    !bad.length,
    bad.length ? list(bad.map(file => file.url.split('/').pop())) : '',
  );
});

add(
  [
    'performance-optimize-javascript-bundle-size',
    'javascript-split-large-javascript-bundles',
  ],
  ({resources}) => {
    if (!resources || !resources.js.length) return NA;
    const big = resources.js.filter(
      file => file.truncated || file.body.length > 300 * 1024,
    );

    return ok(
      !big.length,
      big.length ? `${big.length} bundle(s) over ~300 KB` : '',
    );
  },
);

add(
  ['performance-provide-source-maps-for-production-debugging'],
  ({resources}) => {
    const own = resources
      ? resources.js.filter(file => resources.sameSite(file.url))
      : [];

    if (!own.length) return NA;

    return ok(
      own.some(file => /sourceMappingURL=/.test(file.body.slice(-400))) ||
        own.some(f => /sourcemap/i.test(JSON.stringify(f.headers || {}))),
    );
  },
);

jsCheck(
  ['performance-register-a-service-worker-for-caching-and-offline-support'],
  files =>
    ok(files.some(file => /serviceWorker\s*\.\s*register/.test(file.body))),
);

add(['performance-remove-duplicate-javascript-libraries'], ({$}) => {
  const counts = new Map();

  $('script[src]').each((_, el) => {
    const file = ($(el).attr('src') || '')
      .split('?')[0]
      .split('/')
      .pop()
      .toLowerCase();
    const lib = /^(jquery|react|vue|angular|lodash|moment|bootstrap)/.exec(
      file,
    );

    if (lib) counts.set(lib[1], (counts.get(lib[1]) || 0) + 1);
  });
  const dupes = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);

  return ok(!dupes.length, dupes.length ? list(dupes) : '');
});

add(
  [
    'performance-use-secure-and-up-to-date-js-libraries',
    'security-audit-dependencies-for-known-vulnerabilities',
  ],
  ctx => {
    const found = detectLibraries(ctx);

    if (!found.length) return NA;
    const outdated = found.filter(lib => lib.outdated);

    return ok(
      !outdated.length,
      outdated.length
        ? list(
            outdated.map(lib => `${lib.name} ${lib.version} (use ${lib.need})`),
          )
        : `checked ${list(found.map(lib => `${lib.name} ${lib.version}`))}`,
    );
  },
);

add(['security-leaked-environment-variables'], ctx => {
  const sources = [
    {url: 'the HTML', body: ctx.html},
    ...(ctx.resources ? ctx.resources.js : []),
  ];
  const hits = [];

  sources.forEach(source => {
    SECRET_PATTERNS.forEach(([re, label]) => {
      if (re.test(source.body))
        hits.push(
          `${label} in ${String(source.url).split('/').pop() || 'page'}`,
        );
    });
  });

  return ok(
    !hits.length,
    hits.length ? list(hits) : 'no known secret patterns found',
  );
});

// ---------- Performance (headers, timing, weight) ----------

add(['performance-reduce-time-to-first-byte-ttfb'], ({ttfb}) =>
  typeof ttfb === 'number'
    ? ok(ttfb <= 800, `${ttfb} ms from the audit server`)
    : NA,
);

add(['performance-enable-http-2-or-http-3'], ({resources, headers}) => {
  if (!resources || !resources.protocol) return NA;
  const h3 = /h3/.test(headers['alt-svc'] || '');

  return ok(
    resources.protocol === 'h2' || h3,
    h3 ? 'HTTP/3 advertised' : resources.protocol,
  );
});

add(['performance-use-a-content-delivery-network'], ctx => {
  const h = JSON.stringify(ctx.headers).toLowerCase();
  const cdn =
    /cf-ray|x-vercel-id|x-amz-cf-id|x-served-by|x-fastly|akamai|x-azure-ref|x-nf-request-id|x-cdn|server":"(cloudflare|netlify|vercel|bunnycdn|keycdn)/.test(
      h,
    );

  return ok(cdn, cdn ? '' : 'no CDN headers detected');
});

add(['performance-enable-browser-caching'], ({resources}) => {
  if (!resources) return NA;
  const own = [...resources.css, ...resources.js].filter(
    file => file.headers && resources.sameSite(file.url),
  );

  if (!own.length) return NA;
  const uncached = own.filter(file => {
    const cache = String(file.headers['cache-control'] || '');
    const maxAge = /max-age=(\d+)/.exec(cache);

    return (
      /no-store|no-cache/.test(cache) ||
      (!maxAge && !file.headers.expires && !file.headers.etag) ||
      (maxAge && Number(maxAge[1]) < 3600 && !file.headers.etag)
    );
  });

  return ok(
    !uncached.length,
    uncached.length ? `${uncached.length} asset(s) without caching` : '',
  );
});

add(['performance-keep-page-weight-under-1500kb'], ({resources, html}) => {
  if (!resources) return NA;
  const sizeOf = file =>
    Number(file.headers && file.headers['content-length']) ||
    (file.body ? file.body.length : 0);
  const total =
    Buffer.byteLength(html) +
    [
      ...resources.css,
      ...resources.js,
      ...resources.images,
      ...resources.fonts,
    ].reduce((sum, file) => sum + sizeOf(file), 0);

  return ok(
    total <= 1500 * 1024,
    `${kb(total)} measured (HTML, CSS, JS, images, fonts)`,
  );
});

add(['performance-minimize-http-requests'], ({$}) => {
  const requests = $('script[src], link[rel~="stylesheet" i], img[src]').length;

  return ok(requests <= 60, `${requests} subresource requests in the HTML`);
});

add(['performance-reduce-dom-size-and-complexity'], ({$}) => {
  const nodes = $('*').length;

  return ok(nodes <= 1500, `${nodes} elements`);
});

add(['performance-optimize-pages-for-back-forward-cache'], ctx =>
  ok(
    !/no-store/i.test(header(ctx, 'cache-control')),
    header(ctx, 'cache-control'),
  ),
);

add(['performance-optimize-third-party-script-loading'], ({$, finalUrl}) => {
  const host = new URL(finalUrl).hostname.replace(/^www\./, '');
  const thirdParty = $('script[src]').filter((_, el) => {
    try {
      return (
        new URL($(el).attr('src'), finalUrl).hostname.replace(/^www\./, '') !==
        host
      );
    } catch {
      return false;
    }
  });

  if (!thirdParty.length) return NA;
  const blocking = thirdParty.filter(
    (_, el) => !$(el).is('[async], [defer], [type=module]'),
  );

  return ok(
    !blocking.length,
    blocking.length ? `${blocking.length} blocking third-party script(s)` : '',
  );
});

add(
  [
    'performance-use-resource-hints-for-faster-loading',
    'performance-use-preconnect-for-critical-third-party-origins',
  ],
  ({$, finalUrl}) => {
    const host = new URL(finalUrl).hostname;
    const external = $('script[src], link[rel~="stylesheet" i]').filter(
      (_, el) => {
        try {
          return (
            new URL($(el).attr('src') || $(el).attr('href'), finalUrl)
              .hostname !== host
          );
        } catch {
          return false;
        }
      },
    );

    if (!external.length) return NA;

    return ok(
      $(
        'link[rel="preconnect" i], link[rel="dns-prefetch" i], link[rel="preload" i]',
      ).length > 0,
    );
  },
);

add(
  [
    'performance-disable-lazy-loading-for-above-the-fold-content',
    'images-prioritize-loading-critical-images',
  ],
  ({$}) => {
    const firstImages = $('img').slice(0, 2);

    if (!firstImages.length) return NA;
    const lazy = firstImages.filter(
      (_, el) => ($(el).attr('loading') || '').toLowerCase() === 'lazy',
    );

    return ok(!lazy.length, lazy.length ? 'first images are lazy-loaded' : '');
  },
);

add(['performance-convert-animated-gifs-to-video'], ({resources}) => {
  const gifs = resources
    ? resources.images.filter(img => /\.gif($|\?)/i.test(img.url))
    : [];

  if (!gifs.length) return NA;
  const big = gifs.filter(
    img => Number(img.headers && img.headers['content-length']) > 100 * 1024,
  );

  return ok(!big.length, big.length ? `${big.length} large GIF(s)` : '');
});

add(['performance-avoid-javascript-based-redirects'], ctx => {
  const bad = ctx
    .$('script:not([src])')
    .filter((_, el) =>
      /^\s*(window\.)?location(\.href)?\s*=|location\.replace\(/.test(
        ctx.$(el).text(),
      ),
    );

  return ok(!bad.length);
});

// ---------- Images ----------

const imageCheck = (ids, fn) =>
  add(ids, ctx => {
    const images = ctx.resources ? ctx.resources.images : [];

    if (!images.length) return NA;

    return fn(images, ctx);
  });

const typeOf = img =>
  String((img.headers && img.headers['content-type']) || '').toLowerCase();
const sizeOfImage = img =>
  Number(img.headers && img.headers['content-length']) || 0;

imageCheck(['images-fix-broken-images'], images => {
  const broken = images.filter(img => img.error || img.status >= 400);

  return ok(
    !broken.length,
    broken.length
      ? `${broken.length} broken: ${list(broken.map(img => img.url.split('/').pop()))}`
      : '',
  );
});

imageCheck(
  [
    'images-keep-image-file-sizes-within-recommended-limits',
    'images-compress-images-without-quality-loss',
    'images-optimise-images-for-faster-loading',
    'images-optimize-all-images-for-web',
  ],
  images => {
    const big = images.filter(img => sizeOfImage(img) > 250 * 1024);

    return ok(
      !big.length,
      big.length
        ? `${big.length} image(s) over 250 KB (largest ${kb(Math.max(...big.map(sizeOfImage)))})`
        : '',
    );
  },
);

imageCheck(
  [
    'images-use-modern-image-formats-webp-avif',
    'images-use-webp-format-with-fallbacks',
    'images-use-avif-format-for-modern-browsers',
  ],
  (images, {$}) => {
    const raster = images.filter(img => /jpeg|png/.test(typeOf(img)));
    const modern =
      images.filter(img => /webp|avif/.test(typeOf(img))).length +
      $('picture source[type*="webp"], picture source[type*="avif"]').length;

    if (!raster.length && !modern) return NA;

    return ok(
      modern > 0 && modern >= raster.length / 2,
      `${raster.length} JPEG/PNG, ${modern} WebP/AVIF`,
    );
  },
);

add(
  [
    'images-implement-responsive-images-with-srcset',
    'images-use-srcset-for-responsive-images',
    'images-support-high-dpi-retina-displays',
  ],
  ({$}) => {
    const raster = $('img').filter(
      (_, el) =>
        !/\.svg($|\?)/i.test($(el).attr('src') || '') &&
        !/^data:/.test($(el).attr('src') || ''),
    );

    if (!raster.length) return NA;

    return ok(
      $('img[srcset], picture source[srcset]').length > 0,
      `${raster.length} image(s), ${$('img[srcset]').length} with srcset`,
    );
  },
);

add(['images-use-picture-with-an-img-fallback'], ({$}) => {
  const pictures = $('picture');

  if (!pictures.length) return NA;

  return ok(!pictures.filter((_, el) => !$(el).find('img').length).length);
});

add(['images-use-figure-and-figcaption-for-image-captions'], ({$}) => {
  const figures = $('figure');

  if (!figures.length) return NA;

  const bare = figures.filter((_, el) => !$(el).find('figcaption').length);

  return ok(
    !bare.length,
    bare.length ? `${bare.length} figure(s) without figcaption` : '',
  );
});

add(['images-use-descriptive-image-filenames'], ({$}) => {
  const bad = $('img[src]').filter((_, el) => {
    const file = (
      ($(el).attr('src') || '').split('?')[0].split('/').pop() || ''
    ).toLowerCase();

    return (
      /^(img|dsc|image|photo|untitled|screenshot|pic|download)[-_ ]?\(?\d*\)?\./.test(
        file,
      ) || /^\d+\.\w+$/.test(file)
    );
  });

  if (!$('img[src]').length) return NA;

  return ok(!bad.length, bad.length ? `${bad.length} generic filename(s)` : '');
});

add(
  ['images-optimize-svg-files', 'images-manage-inline-svg-size-and-complexity'],
  ({$}) => {
    const svgs = $('svg');

    if (!svgs.length) return NA;
    const bad = svgs.filter((_, el) => {
      const markup = $.html(el);

      return (
        markup.length > 10000 ||
        /sodipodi|inkscape|<metadata|illustrator/i.test(markup)
      );
    });

    return ok(
      !bad.length,
      bad.length ? `${bad.length} heavy or unclean inline SVG(s)` : '',
    );
  },
);

// ---------- Web fonts ----------

add(
  ['webfonts-webfont-format', 'css-optimize-web-font-formats'],
  ({resources}) => {
    if (!resources || !resources.fonts.length) return NA;
    const legacy = resources.fonts.filter(font =>
      /\.(eot|svg)($|\?)/i.test(font.url),
    );
    const woff2 = resources.fonts.some(font => /\.woff2($|\?)/i.test(font.url));

    return ok(!legacy.length && woff2, woff2 ? '' : 'no WOFF2 fonts found');
  },
);

add(['webfonts-webfont-size'], ({resources}) => {
  if (!resources || !resources.fonts.length) return NA;
  const total = resources.fonts.reduce(
    (sum, font) =>
      sum + (Number(font.headers && font.headers['content-length']) || 0),
    0,
  );

  return ok(total <= 2 * 1024 * 1024, `${kb(total)} total`);
});

add(['performance-optimize-web-font-loading'], ctx => {
  const css = cssOf(ctx).text;
  const faces = css.match(/@font-face\s*{[^}]*}/gi) || [];

  if (!faces.length) return NA;
  const swap = faces.filter(face =>
    /font-display\s*:\s*(swap|optional|fallback)/i.test(face),
  );

  return ok(
    swap.length === faces.length,
    `${swap.length}/${faces.length} @font-face with font-display`,
  );
});

// ---------- Links ----------

const OK_LIKE = new Set([401, 403, 405, 429, 999]);
const broken = link =>
  link.error || (link.status >= 400 && !OK_LIKE.has(link.status));

add(
  [
    'html-check-for-broken-links',
    'seo-resolve-internal-broken-links',
    'seo-fix-invalid-links',
  ],
  ({resources}) => {
    const internal = resources
      ? resources.links.filter(
          link =>
            (link.internal && link.status !== undefined) ||
            (link.internal && link.error),
        )
      : [];

    if (!internal.length) return NA;
    const bad = internal.filter(broken);

    return ok(
      !bad.length,
      bad.length
        ? `${bad.length}/${internal.length} sampled internal links broken`
        : `${internal.length} internal links checked`,
    );
  },
);

add(['seo-fix-or-remove-broken-external-links'], ({resources}) => {
  const external = resources
    ? resources.links.filter(link => !link.internal)
    : [];

  if (!external.length) return NA;
  const bad = external.filter(broken);

  return ok(
    !bad.length,
    bad.length
      ? `${bad.length}/${external.length} sampled external links broken`
      : `${external.length} external links checked`,
  );
});

add(['seo-link-directly-to-final-destination-urls'], ({resources}) => {
  const internal = resources
    ? resources.links.filter(link => link.internal && link.redirects)
    : [];

  if (!internal.length) return NA;
  const redirected = internal.filter(
    link => link.redirects.length > 0 && !link.error,
  );

  return ok(
    !redirected.length,
    redirected.length ? `${redirected.length} internal link(s) redirect` : '',
  );
});

add(['seo-keep-linked-pdfs-under-60-mb'], ({resources}) => {
  if (!resources || !resources.pdfs.length) return NA;
  const big = resources.pdfs.filter(
    pdf =>
      Number(pdf.headers && pdf.headers['content-length']) > 60 * 1024 * 1024,
  );

  return ok(!big.length);
});

add(['seo-avoid-nofollow-on-internal-links'], ({$, finalUrl}) => {
  const host = new URL(finalUrl).hostname.replace(/^www\./, '');
  const bad = $('a[rel~="nofollow" i]').filter((_, el) => {
    try {
      return (
        new URL($(el).attr('href'), finalUrl).hostname.replace(/^www\./, '') ===
        host
      );
    } catch {
      return false;
    }
  });

  return ok(
    !bad.length,
    bad.length ? `${bad.length} internal nofollow link(s)` : '',
  );
});

add(['seo-add-internal-links-to-key-pages'], ({$, finalUrl}) => {
  const host = new URL(finalUrl).hostname.replace(/^www\./, '');
  const internal = $('a[href]').filter((_, el) => {
    try {
      const url = new URL($(el).attr('href'), finalUrl);

      return (
        url.hostname.replace(/^www\./, '') === host &&
        url.href.replace(/#.*$/, '') !== finalUrl
      );
    } catch {
      return false;
    }
  });

  return ok(internal.length >= 3, `${internal.length} internal link(s)`);
});

add(['seo-use-descriptive-anchor-text'], ({$}) => {
  const vague = $('a[href]').filter((_, el) =>
    /^(click here|here|read more|more|learn more|link|cliquez ici|ici|en savoir plus|lire la suite|plus)$/i.test(
      text($(el)),
    ),
  );

  return ok(!vague.length, vague.length ? `${vague.length} vague link(s)` : '');
});

add(['seo-link-to-active-social-profiles'], ({$}) =>
  ok(
    $(
      'a[href*="facebook.com"], a[href*="twitter.com"], a[href*="x.com/"], a[href*="linkedin.com"], a[href*="instagram.com"], a[href*="youtube.com"], a[href*="github.com"], a[href*="tiktok.com"]',
    ).length > 0,
  ),
);

const linkMatches = ($, hrefRe, textRe) =>
  $('a[href]').filter(
    (_, el) => hrefRe.test($(el).attr('href')) || textRe.test(text($(el))),
  ).length > 0;

add(['seo-create-a-dedicated-about-page'], ({$}) =>
  ok(
    linkMatches(
      $,
      /about|a-propos|qui-sommes/i,
      /^(about|about us|à propos|qui sommes-nous)/i,
    ),
  ),
);
add(['seo-create-a-comprehensive-contact-page'], ({$}) =>
  ok(linkMatches($, /contact|mailto:|tel:/i, /^(contact|nous contacter)/i)),
);

// ---------- SEO: crawl/index signals ----------

add(['seo-make-important-pages-indexable'], ctx => {
  const robotsMeta = (meta(ctx.$, 'robots') || '').toLowerCase();
  const tag = header(ctx, 'x-robots-tag').toLowerCase();
  const blocked = /noindex|none/.test(robotsMeta) || /noindex|none/.test(tag);
  let disallowed = false;

  if (ctx.robots && ctx.robots.status === 200) {
    const path = new URL(ctx.finalUrl).pathname;
    let applies = false;

    ctx.robots.body.split('\n').forEach(line => {
      const [key, ...rest] = line.split('#')[0].split(':');
      const value = rest.join(':').trim();

      if (/^user-agent$/i.test(key.trim())) applies = value === '*';
      else if (
        applies &&
        /^disallow$/i.test(key.trim()) &&
        value &&
        path.startsWith(value)
      )
        disallowed = true;
    });
  }

  return ok(
    !blocked && !disallowed && ctx.status < 400,
    blocked ? 'noindex set' : disallowed ? 'blocked by robots.txt' : '',
  );
});

add(
  [
    'seo-avoid-conflicting-indexability-signals',
    'seo-robots-meta-conflict',
    'seo-schema-noindex-conflict',
  ],
  ctx => {
    const robotsMeta = (meta(ctx.$, 'robots') || '').toLowerCase();
    const tag = header(ctx, 'x-robots-tag').toLowerCase();
    const conflict =
      (/noindex/.test(robotsMeta) &&
        /\bindex\b/.test(robotsMeta.replace('noindex', ''))) ||
      (/noindex/.test(tag) !== /noindex/.test(robotsMeta) &&
        (tag || robotsMeta)) ||
      (/noindex/.test(robotsMeta) &&
        ctx.$('link[rel="canonical" i]').attr('href'));

    return ok(
      !conflict,
      conflict ? 'robots meta, X-Robots-Tag and canonical disagree' : '',
    );
  },
);

add(['seo-avoid-nosnippet-on-important-pages'], ctx => {
  const value =
    `${meta(ctx.$, 'robots') || ''} ${header(ctx, 'x-robots-tag')}`.toLowerCase();

  return ok(!/nosnippet|max-snippet\s*:\s*0/.test(value));
});

add(['seo-sync-html-canonical-tags-and-link-headers'], ctx => {
  const link = header(ctx, 'link');
  const fromHeader = /<([^>]+)>\s*;\s*rel="?canonical"?/i.exec(link);

  if (!fromHeader) return NA;
  const html = ctx.$('link[rel="canonical" i]').attr('href');

  return ok(
    html &&
      new URL(html, ctx.finalUrl).href ===
        new URL(fromHeader[1], ctx.finalUrl).href,
  );
});

add(['seo-avoid-redirect-chains-on-canonical-urls'], ({resources}) => {
  if (!resources || !resources.canonical || resources.canonical.error)
    return NA;

  return ok(
    resources.canonical.redirects.length === 0,
    `canonical redirects ${resources.canonical.redirects.length} time(s)`,
  );
});

add(['seo-og-url-match'], ({$, finalUrl}) => {
  const og = meta($, 'og:url');
  const canonical = $('link[rel="canonical" i]').attr('href');

  if (!og || !canonical) return NA;
  const normalise = url => new URL(url, finalUrl).href.replace(/\/$/, '');

  return ok(normalise(og) === normalise(canonical));
});

add(['seo-meta-tags-in-body'], ({$}) => {
  const stray = $('body meta').filter(
    (_, el) => !$(el).attr('itemprop') && !$(el).closest('noscript').length,
  );

  return ok(
    !stray.length,
    stray.length ? `${stray.length} meta tag(s) in body` : '',
  );
});

add(['seo-fix-malformed-html-structure'], ({html, $}) => {
  const rootTags = (html.match(/<html[\s>]/gi) || []).length;
  const bodies = (html.match(/<body[\s>]/gi) || []).length;
  const misplaced =
    $('body title').filter((_, el) => !$(el).closest('svg').length).length +
    $('body base').length;

  return ok(
    rootTags <= 1 && bodies <= 1 && !misplaced,
    `${rootTags} html, ${bodies} body tag(s)`,
  );
});

add(['seo-keep-html-documents-under-crawl-limits'], ({html}) =>
  ok(Buffer.byteLength(html) < 2 * 1024 * 1024, kb(Buffer.byteLength(html))),
);

add(['seo-keep-urls-concise'], ({finalUrl}) => {
  const url = new URL(finalUrl);

  return ok(url.pathname.length + url.search.length <= 100);
});
add(['seo-use-lowercase-urls'], ({finalUrl}) =>
  ok(new URL(finalUrl).pathname === new URL(finalUrl).pathname.toLowerCase()),
);
add(['seo-use-hyphens-in-urls'], ({finalUrl}) =>
  ok(!/_/.test(new URL(finalUrl).pathname)),
);
add(['seo-url-special-characters'], ({finalUrl}) =>
  ok(!/[%\s&$+,;=@#]/.test(new URL(finalUrl).pathname)),
);
add(['seo-limit-unnecessary-url-parameters'], ({finalUrl}) =>
  ok([...new URL(finalUrl).searchParams.keys()].length <= 3),
);

// ---------- SEO: sitemap & structured data ----------

add(['seo-keep-xml-sitemaps-valid'], ({sitemap}) => {
  if (!sitemap || sitemap.status !== 200) return NA;
  const body = sitemap.body;
  const valid =
    /^\s*(<\?xml[^>]*>\s*)?<(urlset|sitemapindex)[\s>]/i.test(body) &&
    /<loc>/i.test(body) &&
    /<\/(urlset|sitemapindex)>\s*$/i.test(body);

  return ok(valid && !sitemap.truncated);
});

add(['seo-keep-sitemap-urls-on-the-correct-domain'], ({sitemap, resources}) => {
  if (!sitemap || sitemap.status !== 200 || !/<urlset/i.test(sitemap.body))
    return NA;
  const urls = [...sitemap.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(
    m => m[1],
  );
  const foreign = urls.filter(url => !resources.sameSite(url));

  return ok(
    !foreign.length,
    foreign.length ? `${foreign.length} URL(s) on another domain` : '',
  );
});

add(['seo-4xx-pages-in-sitemap'], ({resources}) => {
  if (!resources || !resources.sitemapSamples.length) return NA;
  const bad = resources.sitemapSamples.filter(
    page => page.status >= 400 || page.error,
  );

  return ok(
    !bad.length,
    bad.length
      ? `${bad.length} sampled sitemap URL(s) fail`
      : `${resources.sitemapSamples.length} sampled`,
  );
});

add(['seo-noindex-in-sitemap'], ({resources}) => {
  if (!resources || !resources.sitemapSamples.length) return NA;
  const bad = resources.sitemapSamples.filter(
    page =>
      page.body &&
      (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(page.body) ||
        /noindex/i.test(String(page.headers['x-robots-tag'] || ''))),
  );

  return ok(
    !bad.length,
    bad.length ? `${bad.length} noindex page(s) in sitemap` : '',
  );
});

add(['seo-include-indexable-pages-in-your-sitemap'], ({sitemap, finalUrl}) => {
  if (!sitemap || sitemap.status !== 200 || !/<urlset/i.test(sitemap.body))
    return NA;
  const normalise = url =>
    url.replace(/\/$/, '').replace(/^https?:\/\/(www\.)?/, '');

  return ok(
    sitemap.body
      .split(/<loc>/i)
      .slice(1)
      .some(
        chunk => normalise(chunk.split('<')[0].trim()) === normalise(finalUrl),
      ) || sitemap.truncated,
    'this page is not listed',
  );
});

add(['seo-mime-type-validation'], ({sitemap, robots, resources}) => {
  const problems = [];

  if (
    sitemap &&
    sitemap.status === 200 &&
    !/xml/i.test(sitemap.headers['content-type'] || '')
  )
    problems.push('sitemap.xml');
  if (
    robots &&
    robots.status === 200 &&
    !/text\/plain/i.test(robots.headers['content-type'] || '')
  )
    problems.push('robots.txt');
  (resources ? resources.css : []).forEach(sheet => {
    if (
      sheet.headers &&
      !/text\/css/i.test(sheet.headers['content-type'] || '')
    )
      problems.push('CSS');
  });
  (resources ? resources.js : []).forEach(file => {
    if (
      file.headers &&
      !/javascript|ecmascript/i.test(file.headers['content-type'] || '')
    )
      problems.push('JS');
  });

  return ok(
    !problems.length,
    problems.length ? `wrong type: ${list([...new Set(problems)])}` : '',
  );
});

add(['seo-publish-llms-txt-for-documentation-heavy-sites'], ({resources}) =>
  resources && resources.llms ? ok(true) : NA,
);

const hasType = (ctx, re) => JSON_LD_TYPES(ctx).some(type => re.test(type));

add(['seo-add-organization-schema-markup'], ctx =>
  ok(
    hasType(
      ctx,
      /^(Organization|Corporation|LocalBusiness|ProfessionalService|NGO|EducationalOrganization)$/,
    ),
  ),
);
add(['seo-add-localbusiness-schema-markup'], ctx =>
  hasType(
    ctx,
    /LocalBusiness|Store|Restaurant|ProfessionalService|Dentist|Hotel/,
  )
    ? ok(true)
    : NA,
);
add(['seo-add-product-schema-markup'], ctx =>
  hasType(ctx, /^Product$/) ? ok(true) : NA,
);
add(['seo-add-faqpage-schema-markup'], ctx =>
  hasType(ctx, /^FAQPage$/) ? ok(true) : NA,
);
add(['seo-add-review-schema-markup'], ctx =>
  hasType(ctx, /^(Review|AggregateRating)$/) ? ok(true) : NA,
);
add(['seo-add-videoobject-schema-to-video-pages'], ctx =>
  ctx.$('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length
    ? ok(hasType(ctx, /^VideoObject$/))
    : NA,
);
add(['seo-implement-valid-article-structured-data'], ctx =>
  ctx.$('article').length || hasType(ctx, /Article|BlogPosting/)
    ? ok(hasType(ctx, /Article|BlogPosting|NewsArticle/))
    : NA,
);
add(['seo-implement-valid-breadcrumblist-schema'], ctx =>
  ctx.$('[aria-label*="breadcrumb" i], .breadcrumb, nav.breadcrumbs').length ||
  hasType(ctx, /^BreadcrumbList$/)
    ? ok(hasType(ctx, /^BreadcrumbList$/))
    : NA,
);
add(['seo-website-search-schema'], ctx =>
  hasType(ctx, /^SearchAction$/) ? ok(true) : NA,
);

add(['seo-show-published-and-updated-dates'], ({$, html}) => {
  const present =
    $('time[datetime]').length ||
    meta($, 'article:published_time') ||
    /datePublished|dateModified/.test(html);

  return present ? ok(true) : NA;
});

add(['seo-display-a-physical-business-address'], ({$, html}) =>
  $('address').length || /streetAddress/.test(html) ? ok(true) : NA,
);

// ---------- SEO: content quality (heuristic) ----------

add(['seo-avoid-thin-content-on-key-pages'], ({$}) => {
  const words = (bodyText($).match(/\S+/g) || []).length;

  return ok(words >= 250, `${words} words of body copy`);
});

add(['seo-avoid-keyword-stuffing'], ({$}) => {
  const words = (
    bodyText($)
      .toLowerCase()
      .match(/[a-zà-ÿ']{4,}/g) || []
  ).filter(word => !STOP_WORDS.has(word));

  if (words.length < 150) return NA;
  const counts = new Map();

  words.forEach(word => counts.set(word, (counts.get(word) || 0) + 1));
  const [top, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  return ok(
    count / words.length < 0.06,
    `"${top}" is ${Math.round((count / words.length) * 100)}% of the copy`,
  );
});

add(
  [
    'seo-write-at-a-clear-reading-level',
    'accessibility-write-in-plain-language',
  ],
  ({$}) => {
    const lang = ($('html').attr('lang') || '').toLowerCase();
    const content = bodyText($);

    if (!lang.startsWith('en') || (content.match(/\S+/g) || []).length < 100)
      return NA;
    const score = Math.round(fleschReadingEase(content));

    return ok(score >= 40, `Flesch reading ease ${score} (40+ is readable)`);
  },
);

add(['seo-make-content-easy-for-llms-to-parse'], ({$}) =>
  ok(
    ($('main').length || $('article').length) &&
      $('h2, h3').length >= 2 &&
      bodyText($).length > 300,
  ),
);

// ---------- Security & privacy ----------

add(['security-secure-password-input-fields'], ({$}) => {
  const fields = $('input[type=password]');

  if (!fields.length) return NA;
  const bad = fields.filter(
    (_, el) =>
      !/^(current-password|new-password|one-time-code)$/.test(
        $(el).attr('autocomplete') || '',
      ),
  );

  return ok(
    !bad.length,
    bad.length ? `${bad.length} password field(s) without autocomplete` : '',
  );
});

add(
  ['security-prevent-stack-trace-exposure-in-production-error-responses'],
  ({notFound}) => {
    if (!notFound || notFound.error) return NA;

    return ok(
      !/(\bat\s+[\w$.<>]+\s+\(.*:\d+:\d+\))|Traceback \(most recent|Exception in thread|node_modules|\.php on line \d+|Stack trace:/i.test(
        notFound.body,
      ),
    );
  },
);

add(
  ['security-set-secure-httponly-and-samesite-flags-on-session-cookies'],
  ({headers}) => {
    const cookies = [].concat(headers['set-cookie'] || []);

    if (!cookies.length) return NA;
    const weak = cookies.filter(
      cookie =>
        !/;\s*secure/i.test(cookie) ||
        !/;\s*httponly/i.test(cookie) ||
        !/;\s*samesite=/i.test(cookie),
    );

    return ok(
      !weak.length,
      weak.length
        ? `${weak.length}/${cookies.length} cookie(s) missing Secure/HttpOnly/SameSite`
        : '',
    );
  },
);

add(
  ['security-use-coop-coep-and-corp-for-cross-origin-isolation-when-neede'],
  ctx => (header(ctx, 'cross-origin-opener-policy') ? ok(true) : NA),
);

add(['security-protect-public-forms-with-captcha'], ({$, html}) => {
  const forms = $('form').filter((_, el) => {
    const method = ($(el).attr('method') || 'get').toLowerCase();

    return (
      method === 'post' &&
      $(el).find('input[type=text], input[type=email], textarea').length > 0
    );
  });

  if (!forms.length) return NA;

  return ok(
    /g-recaptcha|hcaptcha|cf-turnstile|turnstile|recaptcha/i.test(html),
    'no CAPTCHA detected',
  );
});

add(['privacy-avoid-third-party-cookies'], ctx => {
  const html = ctx.html;
  const trackers = new Set(
    (html.match(new RegExp(THIRD_PARTY_TRACKERS.source, 'gi')) || []).map(t =>
      t.toLowerCase(),
    ),
  );

  return ok(
    !trackers.size,
    trackers.size ? `trackers: ${list([...trackers])}` : '',
  );
});

add(['privacy-show-a-cookie-consent-notice'], ctx => {
  const hasTrackers = THIRD_PARTY_TRACKERS.test(ctx.html);
  const hasBanner =
    CONSENT_TOOLS.test(ctx.html) ||
    (ctx.resources &&
      ctx.resources.js.some(file =>
        CONSENT_TOOLS.test(file.body.slice(0, 3000)),
      ));

  if (!hasTrackers && !hasBanner) return NA;

  return ok(
    hasBanner,
    hasBanner ? '' : 'trackers found but no consent tool detected',
  );
});

add(['performance-implement-google-consent-mode-v2'], ({html}) => {
  if (!/googletagmanager\.com|gtag\(/i.test(html)) return NA;

  return ok(
    /gtag\(\s*['"]consent['"]\s*,\s*['"]default['"]/i.test(html) ||
      /ad_user_data/.test(html),
    'Google tags without consent defaults',
  );
});

add(['performance-optimize-google-tag-manager-implementation'], ({html}) => {
  const containers = new Set(html.match(/GTM-[A-Z0-9]{4,}/g) || []);

  if (!containers.size) return NA;

  return ok(containers.size === 1, `${containers.size} GTM container(s)`);
});

module.exports = {extraChecks: checks, JSON_LD_TYPES};
