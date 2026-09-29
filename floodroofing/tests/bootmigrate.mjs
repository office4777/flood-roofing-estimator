// THE NIGHT ONE DROPPED CONNECTION TOOK THE SITE DOWN (2026-09-30).
//
// roofmap.co.nz served 502 for twenty-seven minutes. Nothing had been
// deployed to the backend — the shipped commit changed app.html and four
// test files — and the cause was entirely in the boot migration:
//
//   • the migration's pg Client had no 'error' listener, so a connection
//     that went away was raised as an UNCAUGHT EXCEPTION, and this process
//     exits on those for the platform to restart it;
//   • the restart ran the migration again, the database was still away, and
//     it exited again: a crash loop that never came up to answer;
//   • one client ran all 150 statements with no reconnect, so every one
//     after the first failure said "not queryable" — and the alarm read
//     "150 schema statement(s) failing at boot", which points at the schema
//     when the truth was "the database went away once".
//
// Pinned here: a mid-migration disconnect is survived and the run finishes;
// it is never reported as 150 broken statements; a client error can never
// become an uncaught exception; the first connection is retried; and when
// the database really is gone it stops, says so once, and lets the process
// live so the service still answers.
import { fileURLToPath as _f } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';
import { pathToFileURL } from 'node:url';
const _ROOT = _j(_d(_f(import.meta.url)), '..');
import { startFakePostgrest } from './fakepgrst.mjs';

const results = [];
function check(n, ok, d){ results.push(!!ok); console.log((ok?'PASS':'FAIL')+'  '+n+(d?('  — '+d):'')); }

// ── a pg Client that can be made to misbehave exactly as the real one did ──
// node-pg's contract, in the parts this code touches: connect() may reject;
// query() may reject; and a connection that drops EMITS 'error' on the client
// rather than rejecting anything — which is the part that killed the process.
let plan = {};
const opened = [];          // every client built, in order
class FakeClient {
  constructor(opts){ this.opts = opts; this.listeners = {}; this.queries = 0; this.ended = false; opened.push(this); }
  on(ev, fn){ (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; }
  emit(ev, arg){ (this.listeners[ev] || []).forEach(fn => fn(arg)); return (this.listeners[ev] || []).length > 0; }
  async connect(){
    this.n = opened.indexOf(this);
    if (plan.connectFailsFirst && this.n < plan.connectFailsFirst) throw new Error('Failed to connect to database: timeout');
    this.connected = true;
  }
  async query(sql){
    this.queries++;
    const total = FakeClient.totalQueries = (FakeClient.totalQueries || 0) + 1;
    if (plan.dropAt && total === plan.dropAt){
      // The real shape: the socket dies, the client tells anyone listening,
      // and the in-flight query rejects.
      this.dead = true;
      this.emit('error', new Error('Connection terminated unexpectedly'));
      throw new Error('Connection terminated unexpectedly');
    }
    if (this.dead) throw new Error('Client has encountered a connection error and is not queryable');
    if (plan.deadForever) { this.dead = true; throw new Error('Connection terminated unexpectedly'); }
    return { rows: [] };
  }
  async end(){ this.ended = true; }
}

// ── boot the server with the fake in place of pg ──────────────────
// The fake needs every table the boot touches: a read of one it does not
// carry throws inside the fake, and server.js exits the process on an
// uncaught exception — which would end this suite mid-run.
const db = { __missing: [], profiles: [], company_users: [], companies: [], user_settings: [],
  jobs: [], invoices: [], platform_state: [], comms_tasks: [], schedule_rows: [], schedule_blocks: [],
  usage_events: [], company_domains: [], company_mail_domains: [], subscriptions: [], waitlist: [],
  mail_accounts: [], mail_threads: [], job_revisions: [], company_invites: [] };
const { port } = await startFakePostgrest(db);
process.env.SUPABASE_URL = 'http://127.0.0.1:' + port;
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.JWT_SECRET = 'test-secret';
process.env.PORT = process.env.TEST_PORT || '34655';
process.env.BILLING_ENABLED = 'false';
process.env.EMAIL_ENABLED = 'false';
process.env.DATABASE_URL = 'postgres://fake/db';
process.env.MIGRATE_CONNECT_TRIES = '3';
process.env.MIGRATE_RECONNECTS = '2';
globalThis.__TEST_PG_CLIENT = FakeClient;
// Every alert the boot raises, so the wording can be read back.
const alerts = [];
globalThis.__TEST_RECORD_ERROR = (kind, err) => alerts.push({ kind, msg: String(err && err.message || err) });

const mod = await import(pathToFileURL(_j(_ROOT, 'backend', 'server.js')).href);
const _ensureSchema = mod._ensureSchema || globalThis.__ensureSchema;
// The boot runs this migration itself. Let that settle before driving it by
// hand, or its clients and its alarms land in the middle of a check.
await (async () => {
  for (let i = 0; i < 40; i++){
    const n = opened.length, a = alerts.length;
    await new Promise(r => setTimeout(r, 150));
    if (opened.length === n && alerts.length === a && i > 2) return;
  }
})();
check('the boot migration is reachable from a test', typeof _ensureSchema === 'function',
  typeof _ensureSchema);

function reset(p){ plan = p || {}; opened.length = 0; FakeClient.totalQueries = 0; alerts.length = 0; }

// ── a clean run ───────────────────────────────────────────────────
reset({});
let r = await _ensureSchema();
const TOTAL = r.ok;
check('a healthy database applies every statement on one connection',
  r.ok > 100 && r.failed === 0 && !r.wentAway && opened.length === 1, JSON.stringify({ ok: r.ok, failed: r.failed, clients: opened.length }));
check('…and raises no alarm', alerts.length === 0, JSON.stringify(alerts));

// ── THE FAULT: the connection goes away mid-migration ─────────────
reset({ dropAt: 12 });
r = await _ensureSchema();
check('a connection that goes away mid-migration is reconnected, and the run finishes',
  r.ok === TOTAL && r.reconnects === 1 && !r.wentAway, JSON.stringify({ ok: r.ok, reconnects: r.reconnects, wentAway: r.wentAway }));
check('…the statement that was in flight is retried, not skipped', r.ok === TOTAL, r.ok + ' of ' + TOTAL);
// THE ASK: the alarm said "150 schema statement(s) failing at boot" for one
// dropped connection, which points at the schema instead of the database.
check('…and it is never reported as a pile of broken schema statements',
  r.failed === 0 && !alerts.some(a => /schema statement\(s\) failing/.test(a.msg)), JSON.stringify(alerts));
check('…nor does a survived blip raise any alarm at all', alerts.length === 0, JSON.stringify(alerts));

// ── the uncaught exception that killed the process ────────────────
// Every client this code builds must be listening, or node-pg turns the drop
// into an uncaught exception and the process exits on it.
reset({ dropAt: 12 });
await _ensureSchema();
check('every connection it opens is listening for the drop, so it can never become an uncaught exception',
  opened.length >= 2 && opened.every(c => (c.listeners.error || []).length > 0), opened.length + ' clients');
check('…and each dead connection is closed rather than left dangling',
  opened.slice(0, -1).every(c => c.ended), opened.map(c => c.ended).join(','));

// ── the first connection is retried, because boot races the database ──
reset({ connectFailsFirst: 2 });
r = await _ensureSchema();
check('a database not ready at boot is waited for rather than given up on',
  r.ok === TOTAL && opened.length === 3 && !r.connectError, JSON.stringify({ ok: r.ok, clients: opened.length, err: r.connectError }));

// ── when the database really is gone ──────────────────
reset({ connectFailsFirst: 99 });
r = await _ensureSchema();
check('a database that never answers gives up after its tries, without throwing',
  !!r.connectError && opened.length === 3, JSON.stringify({ err: r.connectError, clients: opened.length }));
check('…and says the connection is the problem, once', alerts.length === 1 && /could not connect/.test(alerts[0].msg), JSON.stringify(alerts));

reset({ deadForever: true });
r = await _ensureSchema();
check('a connection that dies on every statement stops instead of grinding through all 150',
  !!r.wentAway && r.ok < 10 && r.reconnects === 2, JSON.stringify({ ok: r.ok, reconnects: r.reconnects, wentAway: r.wentAway }));
check('…and the one alarm names the database going away, not the schema',
  alerts.length === 1 && /database went away/.test(alerts[0].msg) && !/schema statement\(s\) failing/.test(alerts[0].msg), JSON.stringify(alerts));
check('…and says the schema will finish itself on a later boot',
  alerts.length === 1 && /completes on the next boot/.test(alerts[0].msg), JSON.stringify(alerts));

// ── the process is still alive, which is the whole point ──────────
check('the process survived all of it', process.exitCode === undefined || process.exitCode === 0, String(process.exitCode));

const bad = results.filter(x => !x).length;
console.log('\n' + (results.length - bad) + '/' + results.length + ' passed');
process.exit(bad ? 1 : 0);
