/**
 * shared/log.js
 * Tiện ích ghi log đa tầng chuẩn hóa cho toàn bộ hệ thống SOA HTQLNS
 */

const env = require('./env');

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

function formatMessage(level, service, message, extra) {
  const timestamp = new Date().toISOString();
  const lvl = level.toUpperCase().padEnd(5);
  let lvlColor = colors.green;
  if (level === 'warn') lvlColor = colors.yellow;
  if (level === 'error') lvlColor = colors.red;
  if (level === 'debug') lvlColor = colors.magenta;

  let line = `${colors.dim}[${timestamp}]${colors.reset} ${lvlColor}${lvl}${colors.reset} ${colors.cyan}[${service}]${colors.reset} ${message}`;
  if (extra !== undefined) {
    if (extra instanceof Error) {
      line += `\n${extra.stack || extra.message}`;
    } else if (typeof extra === 'object') {
      line += ` ${JSON.stringify(extra)}`;
    } else {
      line += ` ${extra}`;
    }
  }
  return line;
}

function createLogger(serviceName = 'htqlns') {
  const loggerFn = (msg, extra) => {
    console.log(formatMessage('info', serviceName, msg, extra));
  };

  loggerFn.info = (msg, extra) => {
    console.log(formatMessage('info', serviceName, msg, extra));
  };
  loggerFn.warn = (msg, extra) => {
    console.warn(formatMessage('warn', serviceName, msg, extra));
  };
  loggerFn.error = (msg, extra) => {
    console.error(formatMessage('error', serviceName, msg, extra));
  };
  loggerFn.debug = (msg, extra) => {
    if (env.NODE_ENV !== 'production') {
      console.log(formatMessage('debug', serviceName, msg, extra));
    }
  };

  return loggerFn;
}

module.exports = Object.assign(createLogger, {
  createLogger,
  logger: createLogger('system')
});
