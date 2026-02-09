/**
 * Structured Logging Utility
 * 
 * Provides consistent, structured logging across the application with:
 * - Multiple log levels (DEBUG, INFO, WARN, ERROR, FATAL)
 * - JSON and human-readable formats
 * - Request/response tracking
 * - Performance metrics
 * - Error context preservation
 */

const util = require('util');

// Log levels with numeric priorities
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    FATAL: 4,
};

// ANSI color codes for terminal output
const COLORS = {
    DEBUG: '\x1b[36m',    // Cyan
    INFO: '\x1b[32m',     // Green
    WARN: '\x1b[33m',     // Yellow
    ERROR: '\x1b[31m',    // Red
    FATAL: '\x1b[35m',    // Magenta
    RESET: '\x1b[0m',
};

class Logger {
    constructor(options = {}) {
        this.context = options.context || 'app';
        this.minLevel = LOG_LEVELS[options.logLevel?.toUpperCase()] ?? LOG_LEVELS.INFO;
        this.format = options.format || 'human'; // 'human' or 'json'
        this.enableColors = options.enableColors ?? true;
        this.startTime = Date.now();
        this.requestId = options.requestId || this.generateRequestId();
    }

    /**
     * Generate unique request ID for tracing
     */
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Format log entry based on configuration
     */
    formatLog(level, message, meta = {}) {
        const timestamp = new Date().toISOString();
        const uptime = Date.now() - this.startTime;

        const logEntry = {
            timestamp,
            level,
            context: this.context,
            requestId: this.requestId,
            message,
            uptime,
            ...meta,
        };

        if (this.format === 'json') {
            return JSON.stringify(logEntry);
        }

        // Human-readable format
        const color = this.enableColors ? COLORS[level] : '';
        const reset = this.enableColors ? COLORS.RESET : '';
        const metaStr = Object.keys(meta).length > 0
            ? ` | ${util.inspect(meta, { colors: this.enableColors, depth: 3 })}`
            : '';

        return `${color}[${timestamp}] [${level}] [${this.context}]${reset} ${message}${metaStr}`;
    }

    /**
     * Core logging method
     */
    log(level, message, meta = {}) {
        const levelValue = LOG_LEVELS[level];

        if (levelValue < this.minLevel) {
            return; // Skip logs below minimum level
        }

        const formatted = this.formatLog(level, message, meta);

        if (levelValue >= LOG_LEVELS.ERROR) {
            console.error(formatted);
        } else if (levelValue >= LOG_LEVELS.WARN) {
            console.warn(formatted);
        } else {
            console.log(formatted);
        }
    }

    /**
     * Debug level - detailed diagnostic info
     */
    debug(message, meta = {}) {
        this.log('DEBUG', message, meta);
    }

    /**
     * Info level - general informational messages
     */
    info(message, meta = {}) {
        this.log('INFO', message, meta);
    }

    /**
     * Warn level - warning messages
     */
    warn(message, meta = {}) {
        this.log('WARN', message, meta);
    }

    /**
     * Error level - error messages with stack traces
     */
    error(message, error = null, meta = {}) {
        const errorMeta = error ? {
            errorMessage: error.message,
            errorCode: error.code,
            errorStack: error.stack,
            ...meta,
        } : meta;

        this.log('ERROR', message, errorMeta);
    }

    /**
     * Fatal level - critical errors that require immediate attention
     */
    fatal(message, error = null, meta = {}) {
        const errorMeta = error ? {
            errorMessage: error.message,
            errorCode: error.code,
            errorStack: error.stack,
            ...meta,
        } : meta;

        this.log('FATAL', message, errorMeta);
    }

    /**
     * Log API request
     */
    logRequest(method, url, options = {}) {
        this.info(`API Request: ${method} ${url}`, {
            method,
            url,
            headers: options.headers,
            params: options.params,
        });
    }

    /**
     * Log API response
     */
    logResponse(method, url, status, duration, data = {}) {
        const level = status >= 400 ? 'ERROR' : status >= 300 ? 'WARN' : 'INFO';

        this.log(level, `API Response: ${method} ${url}`, {
            method,
            url,
            status,
            duration: `${duration}ms`,
            dataSize: JSON.stringify(data).length,
        });
    }

    /**
     * Log performance metrics
     */
    logPerformance(operation, duration, meta = {}) {
        this.info(`Performance: ${operation}`, {
            operation,
            duration: `${duration}ms`,
            ...meta,
        });
    }

    /**
     * Log data processing metrics
     */
    logProcessing(stage, stats) {
        this.info(`Processing: ${stage}`, {
            stage,
            ...stats,
        });
    }

    /**
     * Create child logger with additional context
     */
    child(additionalContext = {}) {
        return new Logger({
            context: `${this.context}:${additionalContext.context || 'child'}`,
            logLevel: Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === this.minLevel),
            format: this.format,
            enableColors: this.enableColors,
            requestId: this.requestId,
        });
    }

    /**
     * Measure execution time of async function
     */
    async measure(operation, fn, meta = {}) {
        const start = Date.now();
        this.debug(`Starting: ${operation}`, meta);

        try {
            const result = await fn();
            const duration = Date.now() - start;
            this.logPerformance(operation, duration, { status: 'success', ...meta });
            return result;
        } catch (error) {
            const duration = Date.now() - start;
            this.error(`Failed: ${operation}`, error, { duration: `${duration}ms`, ...meta });
            throw error;
        }
    }
}

/**
 * Create singleton logger instance
 */
function createLogger(options = {}) {
    return new Logger({
        context: options.context || 'app',
        logLevel: process.env.LOG_LEVEL || 'INFO',
        format: process.env.LOG_FORMAT || 'human',
        enableColors: process.env.LOG_COLORS !== 'false',
        ...options,
    });
}

module.exports = {
    Logger,
    createLogger,
    LOG_LEVELS,
};