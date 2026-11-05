# Front-End Checklist

A free front-end quality checklist you can work through by hand, or partly automate by auditing a live page.

**Live:** https://checklist.shinningtechservices.com · English and French

Built and maintained by [Shinning Tech Services](https://www.shinningtechservices.com/). Free for freelancers, agencies, developers and engineers. No account, no tracking of your progress: it stays in your browser.

## What you get

- **The checklist:** 408 items in 13 sections (accessibility, CSS, HTML, head, i18n, images, JavaScript, performance, privacy, security, SEO, testing, web fonts), each with a priority, documentation links and tools. Tick items off, filter by tag, hide sections, light and dark theme.
- **Live page audit:** paste a public URL and about 200 automatic checks run against its HTML, CSS, JS, images, links, fonts, sitemap and response headers. You get a score, the failed items by priority, and one click to tick the passing items in your checklist.
- **Shareable reports:** download or copy Markdown, copy a share link (`/audit?url=…`), or print/save as PDF. Reports state which results are heuristic ("verify") and what the scan cannot check.
- **Public JSON API:** `GET /api/checklist.en.json` (or `.fr.json`) and `GET /api/audit?url=…`. Rate limit: 10 audits per minute per IP.
- **AI assistants:** an [agent skill](skills/frontend-checklist-audit/SKILL.md) and an [MCP server](mcp/README.md) so Copilot, Claude or Cursor can audit a URL and fix the failures.

## What the audit cannot check

It reads one public page without running JavaScript. It does not measure Core Web Vitals (LCP, CLS, INP), real-device or screen-reader behaviour, content quality, logged-in flows, or the Testing section. Heuristic results are flagged "verify". A score is a starting point, not a certification.

## Run it locally

Requires Node 22.11 or newer.

```shell
npm ci
npm start        # dev server with live reload and a local /api/audit
npm run build    # production build into dist/
npm test         # unit and server tests
npm run lint && npm run lint:css
```

## Project layout

| Path | Purpose |
| --- | --- |
| `data/<lang>/items`, `data/<lang>/project` | Checklist content and UI strings (en, fr) |
| `src/` | Pug views, SCSS, client scripts |
| `server/`, `api/audit.js` | Audit engine (SSRF-safe fetcher, checks) and Vercel function |
| `mcp/`, `skills/` | MCP server and agent skill |
| `gulpfile.mjs` | Build and dev tasks |

Deployed on Vercel (`vercel.json`): static `dist/` plus the `api/audit` function.

## Add a language

1. Copy `data/en` to `data/<lang>` and translate the JSON files, starting with `project/`.
2. Run `npx gulp dev --l <lang>`. After editing JSON, stop the dev server, run `npx gulp jsonRebuild`, then start it again.
3. Add the language link to `src/views/base/header.pug` and create the matching index view.

## Contributing

Issues and pull requests are welcome. See [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md).

## Support

The tool is free. If it saves you time you can [buy me a coffee](https://paystack.shop/pay/gs24kq1bgi).

## License and credits

Application code: MIT. The checklist content is derived from the [Front-End Checklist](https://github.com/thedaviddias/Front-End-Checklist) by David Dias, used under the MIT License. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).
