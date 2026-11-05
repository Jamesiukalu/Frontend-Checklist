#!/usr/bin/env node
// Minimal MCP server (stdio, no dependencies) over the Front-End Checklist API.
import {createInterface} from 'node:readline';

const BASE = process.env.CHECKLIST_BASE_URL || 'https://checklist.shinningtechservices.com';
const catalogs = {};

const loadCatalog = async (lang = 'en') => {
  const code = lang === 'fr' ? 'fr' : 'en';

  if (!catalogs[code]) {
    const res = await fetch(`${BASE}/api/checklist.${code}.json`);

    if (!res.ok) throw new Error(`Catalogue request failed (${res.status})`);
    const data = await res.json();
    const items = {};

    data.sections.forEach(section =>
      section.items.forEach(item => {
        items[item.id] = {...item, section: section.id};
      }),
    );
    catalogs[code] = {sections: data.sections, items};
  }

  return catalogs[code];
};

const rank = {High: 0, Medium: 1, Low: 2};

const tools = [
  {
    name: 'audit_page',
    description:
      'Audit a public web page against the Front-End Checklist (up to 246 automatic checks). Returns the score, failed items sorted by priority with guidance, and the sections not checked automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {type: 'string', description: 'Public page URL, e.g. example.com'},
        language: {type: 'string', enum: ['en', 'fr'], default: 'en'},
      },
      required: ['url'],
    },
  },
  {
    name: 'get_checklist_item',
    description: 'Get one checklist item (title, priority, description, docs, tools) by id.',
    inputSchema: {
      type: 'object',
      properties: {id: {type: 'string'}, language: {type: 'string', enum: ['en', 'fr']}},
      required: ['id'],
    },
  },
  {
    name: 'search_checklist',
    description: 'Search checklist items by keyword, optionally within a section id.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {type: 'string'},
        section: {type: 'string'},
        language: {type: 'string', enum: ['en', 'fr']},
      },
      required: ['query'],
    },
  },
];

const handlers = {
  async audit_page({url, language}) {
    const catalog = await loadCatalog(language);
    const res = await fetch(`${BASE}/api/audit?url=${encodeURIComponent(url)}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(data.error || `Audit failed (${res.status})`);

    const known = data.results.filter(r => catalog.items[r.id]);
    const failed = known
      .filter(r => r.status === 'fail')
      .map(r => ({...catalog.items[r.id], detail: r.detail, heuristic: Boolean(r.heuristic)}))
      .sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3))
      .map(({id, title, priority, description, detail, heuristic, section, documentation}) => ({
        id, title, priority, section, description, detail, verifyManually: heuristic,
        docs: (documentation || []).slice(0, 2),
      }));
    const decided = new Set(data.results.map(r => r.id));
    const notChecked = {};

    Object.values(catalog.items).forEach(item => {
      if (!decided.has(item.id)) notChecked[item.section] = (notChecked[item.section] || 0) + 1;
    });

    return {
      url: data.finalUrl,
      score: data.score,
      failed,
      passedCount: known.filter(r => r.status === 'pass').length,
      notCheckedAutomatically: notChecked,
      limitations:
        'One public page, no JavaScript executed. Core Web Vitals, real devices, content quality, logged-in flows and the Testing section are manual. Items with verifyManually=true are heuristic and may be false positives.',
      providedBy: 'Shinning Tech Services - https://www.shinningtechservices.com/',
    };
  },

  async get_checklist_item({id, language}) {
    const item = (await loadCatalog(language)).items[id];

    if (!item) throw new Error(`Unknown item id: ${id}`);

    return item;
  },

  async search_checklist({query, section, language}) {
    const {items} = await loadCatalog(language);
    const q = query.toLowerCase();

    return Object.values(items)
      .filter(
        i =>
          (!section || i.section === section) &&
          `${i.title} ${i.description}`.toLowerCase().includes(q),
      )
      .slice(0, 25)
      .map(({id, title, priority, section: s}) => ({id, title, priority, section: s}));
  },
};

const send = message => process.stdout.write(`${JSON.stringify({jsonrpc: '2.0', ...message})}\n`);

const handle = async msg => {
  const {id, method, params} = msg;

  if (id === undefined) return; // notifications need no reply

  try {
    if (method === 'initialize') {
      return send({
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: {tools: {}},
          serverInfo: {name: 'frontend-checklist', version: '1.0.0'},
        },
      });
    }
    if (method === 'ping') return send({id, result: {}});
    if (method === 'tools/list') return send({id, result: {tools}});
    if (method === 'tools/call') {
      const run = handlers[params.name];

      if (!run) throw new Error(`Unknown tool: ${params.name}`);
      try {
        const out = await run(params.arguments || {});

        return send({id, result: {content: [{type: 'text', text: JSON.stringify(out, null, 2)}]}});
      } catch (error) {
        return send({id, result: {isError: true, content: [{type: 'text', text: error.message}]}});
      }
    }

    return send({id, error: {code: -32601, message: `Method not found: ${method}`}});
  } catch (error) {
    return send({id, error: {code: -32603, message: error.message}});
  }
};

createInterface({input: process.stdin}).on('line', line => {
  try {
    handle(JSON.parse(line));
  } catch {
    send({id: null, error: {code: -32700, message: 'Parse error'}});
  }
});
