'use strict';
// jimbo-backup -- status GUI.
//
// Standard library only: no npm install, no node_modules, nothing to go stale.
// The dashboard it serves is built from web/ at image build time (jimbo.ui:
// React + Tailwind); at runtime it's just static files. This server is a *view*. backup.sh owns all state; the GUI only reads
// state.json and the log files, and shells out to backup.sh to start a run.

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const LOG_DIR = process.env.LOG_DIR || '/logs';
const STATE_FILE = path.join(LOG_DIR, 'state.json');
const LOCK_INFO = path.join(LOG_DIR, '.lock', 'info.json');
// The look picked on the Brand page. On the logs volume, so it survives rebuilds.
const THEME_FILE = path.join(LOG_DIR, 'theme.json');
// The built dashboard (web/, compiled by the Dockerfile's first stage).
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(__dirname, 'public'));
const BACKUP_SH = process.env.BACKUP_SH || '/app/scripts/backup.sh';
// The host's volumes directory (HOST_VOLUMES_DIR) as mounted in the container.
const HOST_VOLUMES_DIR = (process.env.HOST_VOLUMES_DIR || '/Volumes').replace(/\/+$/, '');
const CONTAINER_VOLUMES_DIR = process.env.CONTAINER_VOLUMES_DIR || '/host-volumes';

const PORT = Number(process.env.GUI_PORT || 4343);
const STALE_WARN_HOURS = Number(process.env.STALE_WARN_HOURS || 48);
const SCHEDULE = {
  interval: process.env.BACKUP_INTERVAL || 'daily',
  time: process.env.BACKUP_TIME || '03:00',
  day: process.env.BACKUP_DAY || 'sunday',
};

// --- helpers ---------------------------------------------------------------

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// Every volume mounted on the host, by listing the volumes directory itself --
// deliberately never reading inside a volume. This is polled every few seconds,
// and anything that opens a drive on a timer keeps macOS reporting it as in
// use, so it can't be ejected. Whether a job's folders really exist is checked
// by backup.sh, right before it copies anything.
async function listVolumes() {
  try {
    const names = await fsp.readdir(CONTAINER_VOLUMES_DIR);
    return names.filter((n) => !n.startsWith('.') && n !== 'com.apple.TimeMachine.localsnapshots').sort();
  } catch {
    return [];
  }
}

// /Volumes/media/Music -> "media"; paths outside the volumes directory -> null.
function volumeOf(hostPath) {
  if (typeof hostPath !== 'string' || !hostPath.startsWith(HOST_VOLUMES_DIR + '/')) return null;
  return hostPath.slice(HOST_VOLUMES_DIR.length + 1).split('/')[0] || null;
}

// The job files, as backup.sh reads them. Cached briefly: jobs change only when
// someone edits a file, and this is asked for on every poll.
let jobsCache = { at: 0, jobs: [], error: null };
function listJobs() {
  if (Date.now() - jobsCache.at < 5000) return Promise.resolve(jobsCache);
  return new Promise((resolve) => {
    execFile(BACKUP_SH, ['--list'], { timeout: 15000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      let jobs = [];
      let error = null;
      try {
        if (err) throw err;
        jobs = JSON.parse(stdout);
      } catch (e) {
        error = `Couldn't read the job files (${e.message.split('\n')[0]})`;
      }
      jobsCache = { at: Date.now(), jobs, error };
      resolve(jobsCache);
    });
  });
}

async function readState() {
  try {
    return JSON.parse(await fsp.readFile(STATE_FILE, 'utf8'));
  } catch {
    return { jobs: {} };
  }
}

// The lock is a directory created by backup.sh. If the pid it names is gone the
// lock is stale, so report nothing running rather than jamming the buttons.
async function readRunning() {
  try {
    const info = JSON.parse(await fsp.readFile(LOCK_INFO, 'utf8'));
    try {
      process.kill(info.pid, 0);
    } catch {
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

async function listLogs(limit = 100) {
  let names;
  try {
    names = await fsp.readdir(LOG_DIR);
  } catch {
    return [];
  }
  const logs = [];
  for (const name of names) {
    if (!name.endsWith('.log')) continue;
    try {
      const st = await fsp.stat(path.join(LOG_DIR, name));
      logs.push({ name, size: st.size, mtime: st.mtime.toISOString() });
    } catch { /* vanished mid-listing */ }
  }
  logs.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return logs.slice(0, limit);
}

// Only ever read a plain *.log filename directly inside LOG_DIR.
function safeLogPath(name) {
  if (typeof name !== 'string' || !name.endsWith('.log')) return null;
  if (name !== path.basename(name)) return null;
  return path.join(LOG_DIR, name);
}

async function tailFile(file, maxBytes = 200 * 1024) {
  const st = await fsp.stat(file);
  const start = Math.max(0, st.size - maxBytes);
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(st.size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = `… (truncated, showing last ${Math.round(maxBytes / 1024)} KB)\n` + text;
    return text;
  } finally {
    await fh.close();
  }
}

function readBody(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// --- theme (jimbo-ui's server contract) -------------------------------------
// Accent and background are always set. Everything else is optional and stored
// only when sent, so a missing highlight or support stays missing and the UI
// infers it. Values are checked for shape and range, not meaning: the UI owns
// what a font key or backdrop pattern means.

const HEX = /^#[0-9a-f]{6}$/i;
const KEY = /^[a-z0-9-]{1,40}$/;
const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

// Returns the cleaned value, undefined to leave it out, or null if it's invalid.
function cleanFonts(f) {
  if (typeof f !== 'object' || Array.isArray(f)) return null;
  const out = {};
  for (const k of ['headings', 'body']) {
    if (f[k] == null) continue;
    if (typeof f[k] !== 'string' || !KEY.test(f[k])) return null;
    out[k] = f[k];
  }
  for (const k of ['headingsWeight', 'bodyWeight']) {
    if (f[k] == null) continue;
    if (!num(f[k], 100, 900)) return null;
    out[k] = f[k];
  }
  for (const k of ['headingsTracking', 'bodyTracking']) {
    if (f[k] == null) continue;
    if (!num(f[k], -0.2, 0.5)) return null;
    out[k] = f[k];
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanBackdrop(b) {
  if (typeof b !== 'object' || Array.isArray(b)) return null;
  const out = {};
  if (b.pattern != null) { if (typeof b.pattern !== 'string' || !KEY.test(b.pattern)) return null; out.pattern = b.pattern; }
  if (b.base != null) { if (!['solid', 'gradient', 'glow'].includes(b.base)) return null; out.base = b.base; }
  if (b.intensity != null) { if (!num(b.intensity, 0, 1)) return null; out.intensity = b.intensity; }
  if (b.scale != null) { if (!num(b.scale, 0.5, 2)) return null; out.scale = b.scale; }
  if (b.contrast != null) { if (!num(b.contrast, 0.3, 2)) return null; out.contrast = b.contrast; }
  if (b.saturation != null) { if (!num(b.saturation, 0, 1.6)) return null; out.saturation = b.saturation; }
  return Object.keys(out).length ? out : undefined;
}

async function readTheme() {
  try {
    const t = JSON.parse(await fsp.readFile(THEME_FILE, 'utf8'));
    return t && HEX.test(t.accent) && HEX.test(t.background) ? t : null;
  } catch {
    return null;
  }
}

async function writeTheme(input) {
  if (!input || !HEX.test(input.accent) || !HEX.test(input.background)) return null;
  const theme = { accent: input.accent, background: input.background };
  for (const k of ['highlight', 'support']) {
    if (input[k] == null) continue;
    if (!HEX.test(input[k])) return null;
    theme[k] = input[k];
  }
  if (input.infer != null) {
    if (!['contrast', 'tonal'].includes(input.infer)) return null;
    theme.infer = input.infer;
  }
  if (input.vibrancy != null) {
    if (!num(input.vibrancy, 0.4, 1.5)) return null;
    theme.vibrancy = input.vibrancy;
  }
  if (input.contrast != null) {
    if (!num(input.contrast, 0.8, 1.6)) return null;
    theme.contrast = input.contrast;
  }
  for (const [k, clean] of [['fonts', cleanFonts], ['backdrop', cleanBackdrop]]) {
    if (input[k] == null) continue;
    const v = clean(input[k]);
    if (v === null) return null;
    if (v !== undefined) theme[k] = v;
  }
  const tmp = `${THEME_FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(theme));
  await fsp.rename(tmp, THEME_FILE);
  return theme;
}

// --- API -------------------------------------------------------------------

async function getStatus() {
  const [state, running, volumes, list] = await Promise.all([readState(), readRunning(), listVolumes(), listJobs()]);
  const mounted = new Set(volumes);
  const vol = (p) => {
    const name = volumeOf(p);
    return name ? { name, detected: mounted.has(name) } : null;
  };

  const staleMs = STALE_WARN_HOURS * 3600 * 1000;
  const jobs = list.jobs.map((job) => {
    const j = state.jobs?.[job.id] || {};
    const lastSuccess = j.lastSuccess ? new Date(j.lastSuccess) : null;
    return {
      ...job,
      status: j.status || 'never',
      lastStart: j.lastStart || null,
      lastEnd: j.lastEnd || null,
      lastSuccess: j.lastSuccess || null,
      durationSec: j.durationSec ?? null,
      message: j.message || '',
      logFile: j.logFile || null,
      stale: lastSuccess ? Date.now() - lastSuccess.getTime() > staleMs : true,
      sourceVolume: vol(job.source),
      destVolume: vol(job.dest),
    };
  });

  const used = new Set(jobs.flatMap((j) => [j.sourceVolume?.name, j.destVolume?.name]).filter(Boolean));
  return {
    now: new Date().toISOString(),
    schedule: SCHEDULE,
    staleWarnHours: STALE_WARN_HOURS,
    volumesDir: HOST_VOLUMES_DIR,
    volumes: volumes.map((name) => ({ name, used: used.has(name) })),
    running,
    jobs,
    jobsError: list.error,
  };
}

async function startBackup(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(id)) return { code: 400, body: { error: 'bad job id' } };
  const { jobs } = await listJobs();
  const job = jobs.find((j) => j.id === id);
  if (!job) return { code: 404, body: { error: `There's no backup called ${id}.` } };
  if (job.error) return { code: 409, body: { error: job.error } };

  const running = await readRunning();
  if (running) {
    return { code: 409, body: { error: `${running.title || running.job} is already running.`, running } };
  }

  // Fail loudly here rather than at spawn time, so a missing or non-executable
  // script is a clear message instead of a dead dashboard.
  try {
    await fsp.access(BACKUP_SH, fs.constants.X_OK);
  } catch {
    return { code: 500, body: { error: `${BACKUP_SH} is missing or not executable` } };
  }

  // Detached: the run outlives this request. backup.sh takes the real lock and
  // checks the source and backup location itself; a missing one is recorded as
  // a failed run, not an error here.
  const child = spawn(BACKUP_SH, [id], { detached: true, stdio: 'ignore' });
  // An unhandled 'error' event here would crash the whole server.
  child.on('error', (err) => console.error('failed to start backup.sh:', err.message));
  child.unref();
  return { code: 202, body: { started: id } };
}

// --- static ----------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Files in PUBLIC_DIR only. /assets/* names carry a content hash, so they can
// be cached for good; everything else is revalidated so a rebuild shows up.
async function serveFile(res, rel) {
  const file = path.resolve(PUBLIC_DIR, '.' + path.posix.normalize('/' + rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  let body;
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) return false;
    body = await fsp.readFile(file);
  } catch {
    return false;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Length': body.length,
  });
  res.end(body);
  return true;
}

// The dashboard is a single-page app: any page URL (/runs, /settings…) gets
// index.html and the app routes it. Missing files with an extension are 404s.
async function serveApp(res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel && (await serveFile(res, rel))) return;
  if (path.extname(rel)) return json(res, 404, { error: 'not found' });
  if (await serveFile(res, 'index.html')) return;
  res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`The dashboard hasn't been built (no index.html in ${PUBLIC_DIR}). Rebuild the image: docker compose up -d --build\n`);
}

// --- server ----------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    // Deliberately touches no filesystem: this is what the container healthcheck
    // polls, and it must never reach for the backup drives.
    if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true });

    if (req.method === 'GET' && p === '/api/status') return json(res, 200, await getStatus());

    if (req.method === 'GET' && p === '/api/logs') return json(res, 200, { logs: await listLogs() });

    if (req.method === 'GET' && p === '/api/log') {
      let name = url.searchParams.get('file');
      if (name === 'current') {
        const running = await readRunning();
        if (!running?.logFile) return json(res, 200, { name: null, text: 'Nothing is running.' });
        name = running.logFile;
      }
      const file = safeLogPath(name);
      if (!file) return json(res, 400, { error: 'bad log name' });
      try {
        return json(res, 200, { name, text: await tailFile(file) });
      } catch {
        return json(res, 404, { error: 'log not found' });
      }
    }

    if (req.method === 'GET' && p === '/api/public/theme') {
      return json(res, 200, { theme: await readTheme(), faviconUrl: null });
    }
    if (req.method === 'PUT' && p === '/api/admin/theme') {
      let parsed;
      try { parsed = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { error: 'bad json' }); }
      const saved = await writeTheme(parsed);
      if (!saved) return json(res, 400, { error: "That theme doesn't look right: accent and background are required as #RRGGBB, and the rest must be in range." });
      return json(res, 200, { ok: true, theme: saved });
    }
    if (req.method === 'DELETE' && p === '/api/admin/theme') {
      await fsp.rm(THEME_FILE, { force: true });
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/backup') {
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'bad json' }); }
      const { code, body: out } = await startBackup(parsed.job);
      return json(res, code, out);
    }

    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    if (req.method === 'GET' || req.method === 'HEAD') return serveApp(res, p);
    return json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('request failed:', err);
    return json(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[gui] jimbo-backup listening on ${PORT}`);
  console.log(`[gui] volumes: ${HOST_VOLUMES_DIR} (as ${CONTAINER_VOLUMES_DIR}), schedule: ${SCHEDULE.interval} ${SCHEDULE.time}`);
});
