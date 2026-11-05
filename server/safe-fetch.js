const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const zlib = require('node:zlib');

const blocked = new net.BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
].forEach(([ip, prefix]) => blocked.addSubnet(ip, prefix, 'ipv4'));
[
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
].forEach(([ip, prefix]) => blocked.addSubnet(ip, prefix, 'ipv6'));

class AuditError extends Error {
  constructor(message, code = 'bad_request') {
    super(message);
    this.code = code;
  }
}

function isBlockedAddress(address) {
  const family = net.isIPv6(address) ? 'ipv6' : 'ipv4';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);

  if (mapped) return blocked.check(mapped[1], 'ipv4');

  return blocked.check(address, family);
}

function parseTarget(input) {
  let url;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !/^https?:\/\//i.test(input)) {
    throw new AuditError('Only http and https URLs are supported');
  }

  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new AuditError('Invalid URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new AuditError('Only http and https URLs are supported');
  }
  if (url.username || url.password) {
    throw new AuditError('URLs with credentials are not allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new AuditError('Target resolves to a blocked address');
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new AuditError('Target resolves to a blocked address');
  }
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');

  if (!['80', '443'].includes(port)) {
    throw new AuditError('Only ports 80 and 443 are allowed');
  }

  return url;
}

// Resolves once, validates every address, and pins the connection to it so a
// second DNS answer (DNS rebinding) cannot point us at an internal address.
function pinnedLookup(hostname, options, callback) {
  dns.lookup(hostname, {all: true, verbatim: true}, (err, addresses) => {
    if (err) return callback(err);
    const safe = addresses.filter(a => !isBlockedAddress(a.address));

    if (!safe.length || safe.length !== addresses.length) {
      return callback(new AuditError('Target resolves to a blocked address'));
    }
    if (options && options.all) return callback(null, safe);

    return callback(null, safe[0].address, safe[0].family);
  });
}

function decode(res, maxBytes) {
  const encoding = (res.headers['content-encoding'] || '').toLowerCase();
  let stream = res;

  if (encoding === 'gzip') stream = res.pipe(zlib.createGunzip());
  else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
  else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    stream.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        res.destroy();
        stream.destroy();
        return resolve({body: Buffer.concat(chunks), truncated: true});
      }
      chunks.push(chunk);
    });
    stream.on('end', () =>
      resolve({body: Buffer.concat(chunks), truncated: false}),
    );
    stream.on('error', reject);
    res.on('error', reject);
  });
}

function requestOnce(url, {timeout, maxBytes}) {
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = client.request(
      url,
      {
        method: 'GET',
        lookup: pinnedLookup,
        timeout,
        headers: {
          'user-agent':
            'FrontEndChecklistAudit/1.0 (+https://checklist.shinningtechservices.com)',
          accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'accept-encoding': 'gzip, br',
        },
      },
      res => {
        const ttfb = Date.now() - started;

        decode(res, maxBytes)
          .then(({body, truncated}) =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: body.toString('utf8'),
              truncated,
              ttfb,
            }),
          )
          .catch(reject);
      },
    );

    req.on('timeout', () =>
      req.destroy(new AuditError('Request timed out', 'timeout')),
    );
    req.on('error', reject);
    req.end();
  });
}

// Follows redirects manually so every hop is validated again.
async function safeFetch(
  input,
  {timeout = 8000, maxBytes = 2 * 1024 * 1024, maxRedirects = 5} = {},
) {
  let url = parseTarget(input);
  const redirects = [];

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const res = await requestOnce(url, {timeout, maxBytes});
    const location = res.headers.location;

    if (res.status >= 300 && res.status < 400 && location) {
      redirects.push({url: url.href, status: res.status});
      url = parseTarget(new URL(location, url).href);
    } else {
      return {...res, url: url.href, redirects};
    }
  }
  throw new AuditError('Too many redirects', 'redirects');
}

// Which protocol the server negotiates over TLS (h2, http/1.1), via ALPN
function negotiatedProtocol(hostname) {
  return new Promise(resolve => {
    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        servername: hostname,
        ALPNProtocols: ['h2', 'http/1.1'],
        lookup: pinnedLookup,
        timeout: 4000,
      },
      () => {
        const protocol = socket.alpnProtocol || null;

        socket.destroy();
        resolve(protocol);
      },
    );

    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

module.exports = {
  AuditError,
  isBlockedAddress,
  negotiatedProtocol,
  parseTarget,
  safeFetch,
};
