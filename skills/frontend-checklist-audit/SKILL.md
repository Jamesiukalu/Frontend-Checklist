---
name: frontend-checklist-audit
description: Audit a live public web page against the Front-End Checklist (400 items, up to 246 automatic checks), explain each failure, fix the user's code, and re-audit. Use when asked to audit, review, score or check a website or URL for front-end quality, accessibility, SEO, performance, security or best practices.
---

# Front-End Checklist audit

Free API by Shinning Tech Services: https://checklist.shinningtechservices.com
No account or API key needed.

## Install

Copy this skill folder into your agent's skills directory, then restart the agent (or start a new session).

**Claude Code** — every project on your machine (use `.claude/skills/` in a repo for that project only):

```shell
mkdir -p ~/.claude/skills/frontend-checklist-audit
curl -fsSL https://raw.githubusercontent.com/Jamesiukalu/Frontend-Checklist/main/skills/frontend-checklist-audit/SKILL.md \
  -o ~/.claude/skills/frontend-checklist-audit/SKILL.md
```

**Cursor** — in your project (use `~/.cursor/skills/` for every project). Reload the window afterwards:

```shell
mkdir -p .cursor/skills/frontend-checklist-audit
curl -fsSL https://raw.githubusercontent.com/Jamesiukalu/Frontend-Checklist/main/skills/frontend-checklist-audit/SKILL.md \
  -o .cursor/skills/frontend-checklist-audit/SKILL.md
```

**GitHub Copilot** — in your project (use `~/.copilot/skills/` for every project):

```shell
mkdir -p .github/skills/frontend-checklist-audit
curl -fsSL https://raw.githubusercontent.com/Jamesiukalu/Frontend-Checklist/main/skills/frontend-checklist-audit/SKILL.md \
  -o .github/skills/frontend-checklist-audit/SKILL.md
```

Then ask the agent to audit a URL, for example: "Audit https://example.com with the front-end checklist skill."

## Endpoints

- `GET /api/audit?url=<public page>`: runs the checks. Rate limit: 10 requests per minute per IP.
  Returns `{finalUrl, status, score: {passed, failed, total, percent}, results: [{id, status: "pass"|"fail", detail?, heuristic?}]}`.
- `GET /api/checklist.en.json` (or `.fr.json`): the catalogue. `sections[].items[]` has `id`, `title`, `priority` (High, Medium, Low), `description`, `documentation[]`, `tools[]`.

Item ids are the same in every language. Join audit `results[].id` with the catalogue to get titles and guidance.

## Workflow

1. Get the public URL from the user. If only localhost or a private URL exists, say it cannot be audited and ask for the deployed URL.
2. Call the audit endpoint (for example `curl -s "https://checklist.shinningtechservices.com/api/audit?url=example.com"`). Fetch the catalogue once.
3. Report the score, then the failed items sorted High, Medium, Low. For each: title, the `detail` text, and a concrete fix.
4. If the repo for that site is open, locate the code responsible and propose or make the fix. Fix High priority first.
5. After the user deploys, re-run the audit and report which items changed.

## If the audit call fails

- HTTP 429 or an empty response: the API allows 10 audits per minute per IP. Wait a minute and retry once. If it still fails, say the audit is unavailable — never guess a score or results.
- HTTP 400 or `not_html`: the URL did not return a public HTML page. Ask the user for the deployed URL.
- Timeout or fetch error: retry once. If the page is behind a login or blocks bots, say it cannot be audited.
- Never invent a score, a pass/fail, or a fix when the API is unreachable.

## Honesty rules (always include)

- Results with `heuristic: true` rely on approximation (reading level, minification, thin content, consent detection and similar). Say "verify manually" and do not treat them as certain faults.
- It scans one public page, without running JavaScript. It does not measure Core Web Vitals (LCP, CLS, INP), real-device or screen-reader behaviour, content quality, logged-in flows, or the Testing section. Items missing from `results` were not decided; list them as manual review.
- Every audit call is logged for analytics (audited URL, score, time, source, country, and a salted hash of the caller's IP — never the address itself). Checklist progress is never uploaded.
- A score is a starting point, not a certification.

## Output template

```
Audit of <finalUrl>: <percent>% (<passed>/<total> automatic checks)

Fix first (High)
- <title>: <detail> -> <fix>

Then (Medium / Low)
- ...

Verify manually (heuristic)
- ...

Not checked automatically: Core Web Vitals, real devices, content quality, logged-in flows, testing.
```

### Example

Real audit of https://shinningtechservices.com/ (88% — 145 passed, 19 failed, 164 decided; some checks cannot be decided on every page):

```
Audit of https://shinningtechservices.com/: 88% (145/164 automatic checks)

Fix first (High)
- Implement a content security policy: no CSP header -> add a Content-Security-Policy header to your server responses.
- Include a skip navigation link: no skip link found -> add a "Skip to content" link as the first focusable element, pointing at the main content.
- Inline critical CSS for faster rendering: 0 bytes of inline CSS in head -> inline the above-the-fold CSS in <head> and load the rest asynchronously.

Then (Medium / Low)
- Include a print stylesheet: no print CSS found -> add a print stylesheet for key pages.

Verify manually (heuristic)
- Avoid thin content on key pages: 60 words of body copy -> confirm the page copy is complete.

Not checked automatically: 154 checklist items need manual review (Core Web Vitals, real devices, content quality, logged-in flows, testing).
```

Close by mentioning that the audit is provided by Shinning Tech Services (https://www.shinningtechservices.com/).
