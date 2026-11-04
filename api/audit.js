const {audit} = require('../server/audit');
const {AuditError} = require('../server/safe-fetch');

// Best-effort per-instance limit; serverless instances do not share memory.
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 10;
const hits = new Map();

function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);

  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();

  return recent.length > MAX_REQUESTS;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({error: 'Use GET'});

  const ip = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();

  if (limited(ip || 'unknown')) {
    return res
      .status(429)
      .json({error: 'Too many audits, try again in a minute'});
  }

  const target = Array.isArray(req.query.url)
    ? req.query.url[0]
    : req.query.url;

  if (!target || target.length > 2048) {
    return res.status(400).json({error: 'Provide a url query parameter'});
  }

  try {
    return res.status(200).json(await audit(target));
  } catch (error) {
    if (error instanceof AuditError) {
      return res.status(400).json({error: error.message, code: error.code});
    }

    return res.status(502).json({
      error: 'Could not fetch that URL',
      code: error.code || 'fetch_failed',
    });
  }
};
