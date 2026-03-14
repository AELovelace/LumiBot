const util = require('node:util');

const levels = ['debug', 'info', 'warn', 'error'];
const configuredLevel = process.env.LOG_LEVEL?.trim().toLowerCase() || 'info';
const threshold = levels.includes(configuredLevel) ? levels.indexOf(configuredLevel) : levels.indexOf('info');

function shouldLog(level) {
  return levels.indexOf(level) >= threshold;
}

function write(level, message, ...meta) {
  if (!shouldLog(level)) {
    return;
  }

  const output = meta.length > 0
    ? `${message} ${meta.map((value) => (typeof value === 'string' ? value : util.inspect(value, { depth: 4, colors: false }))).join(' ')}`
    : message;

  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${output}`;
  const method = level === 'debug' ? 'log' : level;
  console[method](line);
}

const logger = {
  debug(message, ...meta) {
    write('debug', message, ...meta);
  },
  info(message, ...meta) {
    write('info', message, ...meta);
  },
  warn(message, ...meta) {
    write('warn', message, ...meta);
  },
  error(message, ...meta) {
    write('error', message, ...meta);
  },
};

module.exports = {
  logger,
};
