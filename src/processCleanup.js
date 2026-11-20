const { execFileSync } = require('child_process'); // runs PowerShell/taskkill directly, no extra shell in between
const crypto = require('crypto'); // used to make a short unique name for the PID file
const fs = require('fs'); // reads/writes the PID file
const os = require('os'); // gives us the OS temp folder for the PID file
const path = require('path'); // builds absolute paths to this repo's scripts
const { logger } = require('./logger');

const REPO_ROOT = path.resolve(__dirname, '..'); // absolute path of this LumiBot checkout
const PID_FILE = path.join( // where the last running bot remembers its PID (outside the repo, so git never sees it)
  os.tmpdir(), // e.g. C:\Users\<you>\AppData\Local\Temp
  `lumibot-${crypto.createHash('sha1').update(REPO_ROOT.toLowerCase()).digest('hex').slice(0, 12)}.pid`, // one file per checkout
);

// Absolute script paths that belong to THIS repo only. A process is only killed if its command line contains one of these.
const TARGETS = [
  { kind: 'node', script: path.resolve(__dirname, 'index.js') }, // the bot itself when started with an absolute path
  { kind: 'node', script: path.resolve(REPO_ROOT, 'scripts', 'start-3080.js') }, // the 3080 launcher
  { kind: 'python', script: path.resolve(REPO_ROOT, 'python', 'chatbot_memory_service.py') }, // legacy memory service
  { kind: 'python', script: path.resolve(REPO_ROOT, 'python', 'chatbot_memory_service_vector.py') }, // vector memory service (spawned by chatbotStateStore)
  { kind: 'python', script: path.resolve(REPO_ROOT, 'python', 'chatbot_rag_service.py') }, // RAG service (spawned by ragClient)
];

function normalizeForMatch(text) { // makes paths comparable: lower-case and forward slashes
  return String(text || '').replace(/\\/g, '/').toLowerCase(); // Windows paths are case-insensitive and may use either slash
}

function listCandidateProcesses() { // asks Windows for every node/python process with its command line
  const script = [ // PowerShell pipeline; single quotes only so Node's argument quoting can't break it
    'Get-CimInstance Win32_Process',
    "| Where-Object { $_.Name -eq 'node.exe' -or $_.Name -like 'python*' }",
    '| Select-Object ProcessId, ParentProcessId, Name, CommandLine, CreationDate',
    '| ConvertTo-Json -Compress',
  ].join(' '); // glue it into one command line
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { // run PowerShell directly
    encoding: 'utf8', // we want a string back, not a Buffer
    stdio: ['ignore', 'pipe', 'pipe'], // no stdin; capture stdout/stderr
    windowsHide: true, // don't flash a console window
  }).trim(); // drop trailing newlines
  if (!output) return []; // no node/python processes at all
  const parsed = JSON.parse(output); // PowerShell gives an object (one result) or an array (several)
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({ // always hand back an array of plain objects
    pid: Number(row.ProcessId), // process id
    ppid: Number(row.ParentProcessId), // who started it
    name: String(row.Name || '').toLowerCase(), // exe name, e.g. node.exe
    commandLine: row.CommandLine || '', // may be empty for protected processes
    created: JSON.stringify(row.CreationDate ?? null), // start time as a stable string (used to defeat PID reuse)
  }));
}

function readPidFile() { // loads the PID + start time written by the previous bot run
  try {
    const [pid, created] = fs.readFileSync(PID_FILE, 'utf8').split('\n'); // line 1 = pid, line 2 = creation time
    return { pid: Number(pid), created: created || '' }; // parsed record
  } catch {
    return null; // no PID file yet (first run) or unreadable
  }
}

function writePidFile(self) { // remembers THIS process so the next start can clean it up
  if (!self) return; // we could not find our own row; skip quietly
  try {
    fs.writeFileSync(PID_FILE, `${self.pid}\n${self.created}`, 'utf8'); // pid + start time
  } catch (error) {
    logger.debug(`Could not write PID file ${PID_FILE}: ${error.message}`); // non-fatal
  }
}

function killTree(pid, reason) { // force-kills a process and its children (e.g. an old bot plus its python helpers)
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'pipe', windowsHide: true }); // /T = whole tree, /F = force
    logger.info(`Killed existing process: PID ${pid} (${reason})`); // tell the log what we did
  } catch (error) {
    logger.debug(`Could not kill PID ${pid}: ${error.message}`); // usually it already exited
  }
}

async function killExistingProcesses() {
  if (process.platform !== 'win32') { // this cleanup relies on PowerShell + taskkill
    logger.debug('Process cleanup skipped: only supported on Windows.'); // no-op elsewhere
    return; // nothing to do on Linux/macOS
  }

  const protectedPids = new Set([process.pid, process.ppid]); // never kill ourselves or our parent (e.g. the node --watch wrapper)

  let processes; // every node/python process on the machine
  try {
    processes = listCandidateProcesses(); // one PowerShell call for everything
  } catch (error) {
    logger.debug(`Process check failed: ${error.message}`); // PowerShell missing or blocked
    return; // safer to kill nothing than to guess
  }

  const self = processes.find((proc) => proc.pid === process.pid); // our own row (for the PID file)
  const previous = readPidFile(); // what the last run recorded
  const toKill = new Map(); // pid -> reason, so each process is killed once

  if (previous && !protectedPids.has(previous.pid)) { // the last bot run, unless that's us
    const match = processes.find((proc) => proc.pid === previous.pid && proc.created === previous.created && proc.name === 'node.exe'); // same pid AND same start time = really the old bot
    if (match) toKill.set(match.pid, 'previous LumiBot run (PID file)'); // catches `node src/index.js` started with a relative path
  }

  for (const proc of processes) { // check every node/python process against this repo's absolute script paths
    if (protectedPids.has(proc.pid) || proc.ppid === process.pid) continue; // skip us, our parent, and our own child services
    const cmd = normalizeForMatch(proc.commandLine); // comparable command line
    const target = TARGETS.find((t) => proc.name.startsWith(t.kind) && cmd.includes(normalizeForMatch(t.script))); // literal substring match, no regex
    if (target && !toKill.has(proc.pid)) toKill.set(proc.pid, path.relative(REPO_ROOT, target.script)); // remember why we're killing it
  }

  const ordered = [...toKill.entries()].sort((a, b) => { // kill node bots first so /T also takes their python children
    const aNode = processes.find((p) => p.pid === a[0])?.name === 'node.exe'; // is entry a a node process?
    const bNode = processes.find((p) => p.pid === b[0])?.name === 'node.exe'; // is entry b a node process?
    return Number(bNode) - Number(aNode); // node first, python after
  });
  for (const [pid, reason] of ordered) killTree(pid, reason); // do the killing

  writePidFile(self); // record this run for next time
}

module.exports = { killExistingProcesses };
