const {createHash} = require('node:crypto');

let clientPromise;

// Private usage log. Write-only from the app; nothing reads it back publicly.
const getCollection = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri) return null;
  if (!clientPromise) {
    const {MongoClient} = require('mongodb');

    clientPromise = new MongoClient(uri, {
      serverSelectionTimeoutMS: 2000,
    }).connect();
  }

  const client = await clientPromise;

  return client
    .db(process.env.MONGODB_DB_NAME || 'shinningtechservices')
    .collection('checklist_audits');
};

const source = req => {
  const ua = String(req.headers['user-agent'] || '');

  if (ua.includes('frontend-checklist-mcp')) return 'mcp';

  return /checklist\.shinningtechservices\.com|localhost/.test(
    String(req.headers.referer || ''),
  )
    ? 'web'
    : 'api';
};

// The IP is stored only as a salted hash, enough to count unique users.
const hashIp = ip =>
  ip
    ? createHash('sha256')
        .update(`${process.env.ANALYTICS_SALT || 'checklist'}:${ip}`)
        .digest('hex')
        .slice(0, 16)
    : null;

// Never throws and never blocks the response for more than ~2.5s.
const recordAudit = async (req, entry) => {
  try {
    const collection = await getCollection();

    if (!collection) return;
    const ip = String(req.headers['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();

    await Promise.race([
      collection.insertOne({
        at: new Date(),
        source: source(req),
        ipHash: hashIp(ip),
        country: req.headers['x-vercel-ip-country'] || null,
        ...entry,
      }),
      new Promise(resolve => setTimeout(resolve, 2500)),
    ]);
  } catch {
    clientPromise = undefined;
  }
};

module.exports = {recordAudit};
