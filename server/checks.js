// Each check maps to one or more checklist item ids and returns
// {pass: boolean, detail?: string}, or null when it cannot be decided.
const PASS = detail => ({pass: true, detail});
const FAIL = detail => ({pass: false, detail});
const ok = (cond, detail) => (cond ? PASS(detail) : FAIL(detail));

const header = (ctx, name) => {
  const value = ctx.headers[name];

  return Array.isArray(value) ? value.join(', ') : value || '';
};
const text = el => (el.text() || '').replace(/\s+/g, ' ').trim();
const meta = ($, name) =>
  $(`meta[name="${name}" i], meta[property="${name}" i]`)
    .first()
    .attr('content');

const NON_LABELED_INPUTS = /^(hidden|submit|button|image|reset)$/i;
const VAGUE_LINK_TEXT =
  /^(click here|here|read more|more|learn more|link|cliquez ici|ici|en savoir plus|lire la suite|plus)$/i;

const checks = [
  {
    ids: ['head-doctype', 'html-use-the-html5-doctype'],
    run: ctx => ok(/^\s*(<!--[\s\S]*?-->\s*)*<!doctype html>/i.test(ctx.html)),
  },
  {
    ids: ['head-charset', 'html-declare-utf-8-character-encoding'],
    run: ({$, headers}) => {
      const charset = ($('meta[charset]').attr('charset') || '').toLowerCase();
      const viaHeader = /charset=utf-8/i.test(headers['content-type'] || '');

      return ok(charset === 'utf-8' || viaHeader, charset || 'not declared');
    },
  },
  {
    ids: ['head-viewport', 'html-set-the-responsive-viewport-meta-tag'],
    run: ({$}) =>
      ok(/width\s*=\s*device-width/i.test(meta($, 'viewport') || '')),
  },
  {
    ids: ['head-title', 'seo-write-a-descriptive-page-title'],
    run: ({$}) => {
      const title = text($('head title').first());

      return ok(
        title.length >= 10 && title.length <= 70,
        `${title.length} characters (aim for 10-70)`,
      );
    },
  },
  {
    ids: ['head-description', 'seo-write-a-meta-description-for-each-page'],
    run: ({$}) => {
      const length = (meta($, 'description') || '').trim().length;

      return ok(
        length >= 50 && length <= 170,
        `${length} characters (aim for 50-170)`,
      );
    },
  },
  {
    ids: ['head-favicons', 'seo-add-a-favicon-to-every-page'],
    run: ({$}) => ok($('link[rel~="icon" i]').length > 0),
  },
  {
    ids: ['head-canonical', 'seo-set-canonical-urls-for-all-pages'],
    run: ({$}) => ok(Boolean($('link[rel="canonical" i]').attr('href'))),
  },
  {
    ids: ['head-language-attribute', 'html-set-the-page-lang-attribute'],
    run: ({$}) => {
      const lang = ($('html').attr('lang') || '').trim();

      return ok(Boolean(lang), lang || 'missing');
    },
  },
  {
    ids: ['head-facebook-open-graph', 'seo-open-graph-tags'],
    run: ({$}) => {
      const missing = ['og:title', 'og:description', 'og:image'].filter(
        p => !meta($, p),
      );

      return ok(
        !missing.length,
        missing.length ? `missing ${missing.join(', ')}` : '',
      );
    },
  },
  {
    ids: ['head-twitter-card', 'seo-add-twitter-card-meta-tags'],
    run: ({$}) => ok(Boolean(meta($, 'twitter:card'))),
  },
  {
    ids: ['html-link-a-web-app-manifest-for-installability'],
    run: ({$}) => ok($('link[rel="manifest" i]').length > 0),
  },
  {
    ids: ['seo-use-a-single-descriptive-h1'],
    run: ({$}) => {
      const h1 = $('h1');

      return ok(
        h1.length === 1 && text(h1.first()).length > 0,
        `${h1.length} h1 element(s)`,
      );
    },
  },
  {
    ids: [
      'accessibility-use-logical-heading-hierarchy',
      'accessibility-maintain-logical-heading-order',
    ],
    run: ({$}) => {
      let previous = 0;
      let skipped = null;

      $('h1,h2,h3,h4,h5,h6').each((_, el) => {
        const level = Number(el.tagName[1]);

        if (previous && level > previous + 1 && !skipped) {
          skipped = `h${previous} followed by h${level}`;
        }
        previous = level;
      });

      return ok(!skipped, skipped || '');
    },
  },
  {
    ids: ['accessibility-ensure-headings-contain-text'],
    run: ({$}) => {
      const empty = $('h1,h2,h3,h4,h5,h6').filter(
        (_, el) => !text($(el)) && !$(el).find('img[alt]').length,
      ).length;

      return ok(!empty, empty ? `${empty} empty heading(s)` : '');
    },
  },
  {
    ids: ['accessibility-use-exactly-one-main-landmark'],
    run: ({$}) => {
      const count = $('main, [role="main"]').length;

      return ok(count === 1, `${count} main landmark(s)`);
    },
  },
  {
    ids: ['html-use-navigation-landmark-regions'],
    run: ({$}) => ok($('nav, [role="navigation"]').length > 0),
  },
  {
    ids: [
      'accessibility-include-a-skip-navigation-link',
      'accessibility-implement-skip-to-content-links',
    ],
    run: ({$}) => {
      const found = $('a[href^="#"]')
        .slice(0, 8)
        .filter((_, el) =>
          /skip|aller au contenu|passer au contenu|contenu principal/i.test(
            text($(el)),
          ),
        ).length;

      return ok(found > 0);
    },
  },
  {
    ids: ['accessibility-provide-titles-for-iframes-and-frames'],
    run: ({$}) => {
      const missing = $('iframe, frame').filter(
        (_, el) => !($(el).attr('title') || '').trim(),
      ).length;

      return ok(!missing, missing ? `${missing} without title` : '');
    },
  },
  {
    ids: ['accessibility-associate-labels-with-form-controls'],
    run: ({$}) => {
      const unlabeled = $('input, select, textarea').filter((_, el) => {
        const field = $(el);

        if (NON_LABELED_INPUTS.test(field.attr('type') || '')) return false;
        if (field.attr('aria-label') || field.attr('aria-labelledby'))
          return false;
        if (field.attr('title')) return false;
        if (field.closest('label').length) return false;
        const id = field.attr('id');

        return !(id && $(`label[for="${id.replace(/"/g, '\\"')}"]`).length);
      }).length;

      return ok(!unlabeled, unlabeled ? `${unlabeled} unlabeled field(s)` : '');
    },
  },
  {
    ids: ['accessibility-avoid-meta-refresh-redirects'],
    run: ({$}) => ok($('meta[http-equiv="refresh" i]').length === 0),
  },
  {
    ids: ['accessibility-fix-empty-and-broken-links'],
    run: ({$}) => {
      const empty = $('a[href]').filter((_, el) => {
        const link = $(el);

        return (
          !text(link) &&
          !link.attr('aria-label') &&
          !link.attr('aria-labelledby') &&
          !link.attr('title') &&
          !link.find('img[alt]:not([alt=""]), svg[aria-label], svg title')
            .length
        );
      }).length;

      return ok(
        !empty,
        empty ? `${empty} link(s) without accessible name` : '',
      );
    },
  },
  {
    ids: ['accessibility-use-descriptive-link-text'],
    run: ({$}) => {
      const vague = $('a[href]').filter((_, el) =>
        VAGUE_LINK_TEXT.test(text($(el)).replace(/[.…»>]+$/, '')),
      ).length;

      return ok(!vague, vague ? `${vague} vague link(s)` : '');
    },
  },
  {
    ids: ['html-ensure-all-ids-are-unique'],
    run: ({$}) => {
      const seen = new Set();
      const dupes = new Set();

      $('[id]').each((_, el) => {
        const id = $(el).attr('id');

        if (seen.has(id)) dupes.add(id);
        seen.add(id);
      });

      return ok(
        !dupes.size,
        dupes.size ? `duplicate: ${[...dupes].slice(0, 3).join(', ')}` : '',
      );
    },
  },
  {
    ids: ['images-provide-meaningful-alt-text-for-images'],
    run: ({$}) => {
      const missing = $('img').filter(
        (_, el) => $(el).attr('alt') === undefined,
      ).length;

      return ok(!missing, missing ? `${missing} image(s) without alt` : '');
    },
  },
  {
    ids: ['images-set-explicit-width-and-height-on-images'],
    run: ({$}) => {
      const images = $('img');

      if (!images.length) return null;
      const missing = images.filter(
        (_, el) => !($(el).attr('width') && $(el).attr('height')),
      ).length;

      return ok(
        !missing,
        missing ? `${missing} image(s) without width/height` : '',
      );
    },
  },
  {
    ids: ['images-lazy-load-offscreen-images'],
    run: ({$}) => {
      const later = $('img').slice(3);

      if (!later.length) return null;
      const eager = later.filter(
        (_, el) => $(el).attr('loading') !== 'lazy',
      ).length;

      return ok(
        !eager,
        eager ? `${eager} below-the-fold image(s) not lazy` : '',
      );
    },
  },
  {
    ids: ['html-load-scripts-with-defer-async-or-type-module'],
    run: ({$}) => {
      const blocking = $('head script[src]').filter((_, el) => {
        const script = $(el);

        return (
          script.attr('defer') === undefined &&
          script.attr('async') === undefined &&
          (script.attr('type') || '').toLowerCase() !== 'module'
        );
      }).length;

      return ok(
        !blocking,
        blocking ? `${blocking} blocking script(s) in head` : '',
      );
    },
  },
  {
    ids: ['html-add-subresource-integrity-to-external-scripts'],
    run: ({$, finalUrl}) => {
      const host = new URL(finalUrl).hostname;
      const external = $('script[src]').filter((_, el) => {
        try {
          return new URL($(el).attr('src'), finalUrl).hostname !== host;
        } catch {
          return false;
        }
      });

      if (!external.length) return null;
      const missing = external.filter(
        (_, el) => !$(el).attr('integrity'),
      ).length;

      return ok(
        !missing,
        missing ? `${missing} external script(s) without integrity` : '',
      );
    },
  },
  {
    ids: ['security-serve-all-pages-over-https'],
    run: ({finalUrl}) => ok(finalUrl.startsWith('https://')),
  },
  {
    ids: ['security-redirect-http-to-https'],
    run: ({httpProbe}) =>
      httpProbe
        ? ok(httpProbe.url.startsWith('https://'), httpProbe.url)
        : null,
  },
  {
    ids: ['security-avoid-mixed-content-on-https-pages'],
    run: ({$, finalUrl}) => {
      if (!finalUrl.startsWith('https://')) return null;
      const mixed = $(
        'script[src^="http:"], link[rel="stylesheet"][href^="http:"], img[src^="http:"], iframe[src^="http:"], source[src^="http:"], video[src^="http:"], audio[src^="http:"]',
      ).length;

      return ok(!mixed, mixed ? `${mixed} insecure resource(s)` : '');
    },
  },
  {
    ids: ['security-submit-forms-over-https'],
    run: ({$}) => ok($('form[action^="http:"]').length === 0),
  },
  {
    ids: ['security-implement-a-content-security-policy'],
    run: ctx =>
      ok(
        Boolean(
          header(ctx, 'content-security-policy') ||
          ctx.$('meta[http-equiv="Content-Security-Policy" i]').length,
        ),
      ),
  },
  {
    ids: ['security-set-an-hsts-header'],
    run: ctx => {
      if (!ctx.finalUrl.startsWith('https://')) return null;
      const value = header(ctx, 'strict-transport-security');
      const maxAge = Number((/max-age=(\d+)/i.exec(value) || [])[1] || 0);

      return ok(maxAge >= 15552000, value || 'missing');
    },
  },
  {
    ids: ['security-set-an-x-frame-options-header'],
    run: ctx =>
      ok(
        Boolean(header(ctx, 'x-frame-options')) ||
          /frame-ancestors/i.test(header(ctx, 'content-security-policy')),
      ),
  },
  {
    ids: ['security-set-x-content-type-options-nosniff'],
    run: ctx => ok(/nosniff/i.test(header(ctx, 'x-content-type-options'))),
  },
  {
    ids: ['security-set-a-referrer-policy-header'],
    run: ctx =>
      ok(Boolean(header(ctx, 'referrer-policy') || meta(ctx.$, 'referrer'))),
  },
  {
    ids: ['security-set-a-permissions-policy-header'],
    run: ctx =>
      ok(
        Boolean(
          header(ctx, 'permissions-policy') || header(ctx, 'feature-policy'),
        ),
      ),
  },
  {
    ids: ['security-external-link-security'],
    run: ({$, finalUrl}) => {
      const host = new URL(finalUrl).hostname;
      const unsafe = $('a[target="_blank"]').filter((_, el) => {
        const link = $(el);

        if (/noopener|noreferrer/i.test(link.attr('rel') || '')) return false;
        try {
          return new URL(link.attr('href'), finalUrl).hostname !== host;
        } catch {
          return false;
        }
      }).length;

      return ok(
        !unsafe,
        unsafe ? `${unsafe} external link(s) without rel=noopener` : '',
      );
    },
  },
  {
    ids: ['seo-publish-a-robots-txt-file'],
    run: ({robots}) =>
      robots
        ? ok(
            robots.status === 200 && !/^\s*</.test(robots.body),
            `HTTP ${robots.status}`,
          )
        : null,
  },
  {
    ids: ['seo-create-and-submit-an-xml-sitemap'],
    run: ({robots, sitemap}) => {
      const listed = robots && /^\s*sitemap:/im.test(robots.body);
      const exists =
        sitemap &&
        sitemap.status === 200 &&
        /<(urlset|sitemapindex)/i.test(sitemap.body);

      return ok(Boolean(listed || exists));
    },
  },
  {
    ids: ['seo-set-robots-meta-directives-correctly'],
    run: ctx => {
      const noindex =
        /noindex/i.test(meta(ctx.$, 'robots') || '') ||
        /noindex/i.test(header(ctx, 'x-robots-tag'));

      return ok(!noindex, noindex ? 'page is set to noindex' : '');
    },
  },
  {
    ids: ['seo-avoid-multi-hop-redirect-chains'],
    run: ({redirects}) =>
      ok(redirects.length <= 1, `${redirects.length} redirect(s)`),
  },
  {
    ids: ['seo-do-not-link-from-https-to-http'],
    run: ({$, finalUrl}) => {
      if (!finalUrl.startsWith('https://')) return null;
      const host = new URL(finalUrl).hostname;
      const insecure = $('a[href^="http:"]').filter((_, el) => {
        try {
          return new URL($(el).attr('href')).hostname === host;
        } catch {
          return false;
        }
      }).length;

      return ok(!insecure, insecure ? `${insecure} internal http link(s)` : '');
    },
  },
  {
    ids: ['seo-add-structured-data-markup'],
    run: ({$}) => ok($('script[type="application/ld+json"]').length > 0),
  },
  {
    ids: ['seo-use-valid-json-ld-structured-data'],
    run: ({$}) => {
      const blocks = $('script[type="application/ld+json"]');

      if (!blocks.length) return null;
      const invalid = blocks.filter((_, el) => {
        try {
          JSON.parse($(el).text());

          return false;
        } catch {
          return true;
        }
      }).length;

      return ok(!invalid, invalid ? `${invalid} invalid block(s)` : '');
    },
  },
  {
    ids: ['performance-enable-text-based-compression'],
    run: ctx => {
      const encoding = header(ctx, 'content-encoding');

      return ok(/gzip|br|deflate|zstd/i.test(encoding), encoding || 'none');
    },
  },
  {
    ids: ['privacy-link-to-your-privacy-policy-in-the-footer'],
    run: ({$}) =>
      ok(
        $('a[href]').filter((_, el) =>
          /privacy|confidentialit|politique de/i.test(
            `${text($(el))} ${$(el).attr('href')}`,
          ),
        ).length > 0,
      ),
  },
  {
    ids: ['security-link-to-your-terms-of-service-in-the-footer'],
    run: ({$}) =>
      ok(
        $('a[href]').filter((_, el) =>
          /terms|conditions|cgu|cgv|tos/i.test(
            `${text($(el))} ${$(el).attr('href')}`,
          ),
        ).length > 0,
      ),
  },
  {
    ids: ['html-create-a-custom-404-error-page'],
    run: ({notFound}) =>
      notFound
        ? ok(
            notFound.status === 404 && notFound.body.length > 500,
            `HTTP ${notFound.status}`,
          )
        : null,
  },
];

const {extraChecks} = require('./checks-extra');

checks.push(...extraChecks);

function runChecks(ctx) {
  const results = [];
  const seen = new Set();

  checks.forEach(check => {
    let outcome;

    try {
      outcome = check.run(ctx);
    } catch {
      outcome = null;
    }
    if (!outcome) return;
    check.ids.forEach(id => {
      // First check that decides an item wins
      if (seen.has(id)) return;
      seen.add(id);
      results.push({
        id,
        status: outcome.pass ? 'pass' : 'fail',
        detail: outcome.detail || undefined,
      });
    });
  });

  return results;
}

module.exports = {checks, runChecks};
