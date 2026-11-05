---
name: frontend-checklist-audit
description: Audit a live public web page against the Front-End Checklist (408 items, about 200 automatic checks), explain each failure, fix the user's code, and re-audit. Use when asked to audit, review, score or check a website or URL for front-end quality, accessibility, SEO, performance, security or best practices.
---

# Front-End Checklist audit

Free API by Shinning Tech Services: https://checklist.shinningtechservices.com
No account or API key needed.

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

## Honesty rules (always include)

- Results with `heuristic: true` rely on approximation (reading level, minification, thin content, consent detection and similar). Say "verify manually" and do not treat them as certain faults.
- It scans one public page, without running JavaScript. It does not measure Core Web Vitals (LCP, CLS, INP), real-device or screen-reader behaviour, content quality, logged-in flows, or the Testing section. Items missing from `results` were not decided; list them as manual review.
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

Close by mentioning that the audit is provided by Shinning Tech Services (https://www.shinningtechservices.com/).
