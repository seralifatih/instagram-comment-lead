/**
 * Error Codes and Custom Error Classes
 * 
 * Provides standardized error handling with:
 * - Categorized error codes
 * - Retry logic with exponential backoff
 * - Circuit breaker pattern
 * - Error recovery strategies
 */

/**
 * Error Categories and Codes
 */
const ERROR_CODES = {
    // Input Validation Errors (1000-1099)
    INVALID_INPUT: 'ERR_1000',
    INVALID_URL: 'ERR_1001',
    INVALID_PARAMETER: 'ERR_1002',
    MISSING_REQUIRED_FIELD: 'ERR_1003',
    PARAMETER_OUT_OF_RANGE: 'ERR_1004',
    INVALID_FORMAT: 'ERR_1005',

    // API Errors (2000-2099)
    API_REQUEST_FAILED: 'ERR_2000',
    API_RATE_LIMIT: 'ERR_2001',
    API_TIMEOUT: 'ERR_2002',
    API_AUTHENTICATION: 'ERR_2003',
    API_AUTHORIZATION: 'ERR_2004',
    API_NOT_FOUND: 'ERR_2005',
    API_SERVER_ERROR: 'ERR_2006',

    // Instagram Specific Errors (2100-2199)
    INSTAGRAM_INVALID_POST: 'ERR_2100',
    INSTAGRAM_PRIVATE_ACCOUNT: 'ERR_2101',
    INSTAGRAM_POST_NOT_FOUND: 'ERR_2102',
    INSTAGRAM_RATE_LIMIT: 'ERR_2103',
    INSTAGRAM_AUTH_FAILED: 'ERR_2104',

    // OpenAI Specific Errors (2200-2299)
    OPENAI_RATE_LIMIT: 'ERR_2200',
    OPENAI_QUOTA_EXCEEDED: 'ERR_2201',
    OPENAI_INVALID_MODEL: 'ERR_2202',
    OPENAI_CONTEXT_LENGTH: 'ERR_2203',
    OPENAI_CONTENT_FILTER: 'ERR_2204',

    // Processing Errors (3000-3099)
    PROCESSING_FAILED: 'ERR_3000',
    PARSING_FAILED: 'ERR_3001',
    ANALYSIS_FAILED: 'ERR_3002',
    FILTERING_FAILED: 'ERR_3003',
    SCORING_FAILED: 'ERR_3004',

    // Resource Errors (4000-4099)
    OUT_OF_MEMORY: 'ERR_4000',
    STORAGE_FULL: 'ERR_4001',
    NETWORK_ERROR: 'ERR_4002',
    TIMEOUT: 'ERR_4003',

    // Configuration Errors (5000-5099)
    CONFIG_INVALID: 'ERR_5000',
    ENV_VAR_MISSING: 'ERR_5001',
    CACHE_ERROR: 'ERR_5002',

    // Unknown/System Errors (9000-9099)
    UNKNOWN_ERROR: 'ERR_9000',
    INTERNAL_ERROR: 'ERR_9001',
};

/**
 * Retry Configuration by Error Type
 */
const RETRY_CONFIG = {
    [ERROR_CODES.API_RATE_LIMIT]: {
        maxRetries: 5,
        initialDelay: 2000,
        maxDelay: 60000,
        backoffMultiplier: 2,
        retryable: true,
    },
    [ERROR_CODES.API_TIMEOUT]: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
        retryable: true,
    },
    [ERROR_CODES.API_SERVER_ERROR]: {
        maxRetries: 3,
        initialDelay: 2000,
        maxDelay: 15000,
        backoffMultiplier: 2,
        retryable: true,
    },
    [ERROR_CODES.INSTAGRAM_RATE_LIMIT]: {
        maxRetries: 5,
        initialDelay: 5000,
        maxDelay: 120000,
        backoffMultiplier: 2,
        retryable: true,
    },
    [ERROR_CODES.OPENAI_RATE_LIMIT]: {
        maxRetries: 5,
        initialDelay: 3000,
        maxDelay: 60000,
        backoffMultiplier: 2,
        retryable: true,
    },
    [ERROR_CODES.NETWORK_ERROR]: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
        retryable: true,
    },
    // Non-retryable errors
    [ERROR_CODES.INVALID_INPUT]: { retryable: false },
    [ERROR_CODES.API_AUTHENTICATION]: { retryable: false },
    [ERROR_CODES.API_AUTHORIZATION]: { retryable: false },
    [ERROR_CODES.OPENAI_QUOTA_EXCEEDED]: { retryable: false },
};

/**
 * Base Application Error
 */
class AppError extends Error {
    constructor(message, code = ERROR_CODES.UNKNOWN_ERROR, statusCode = 500, details = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.timestamp = new Date().toISOString();
        this.isOperational = true; // Distinguishes operational errors from programming errors
        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            error: {
                name: this.name,
                message: this.message,
                code: this.code,
                statusCode: this.statusCode,
                details: this.details,
                timestamp: this.timestamp,
            },
        };
    }
}

/**
 * Input Validation Error
 */
class ValidationError extends AppError {
    constructor(message, details = {}) {
        super(message, ERROR_CODES.INVALID_INPUT, 400, details);
    }
}

/**
 * API Error
 */
class APIError extends AppError {
    constructor(message, code = ERROR_CODES.API_REQUEST_FAILED, statusCode = 500, details = {}) {
        super(message, code, statusCode, details);
    }
}

/**
 * Rate Limit Error
 */
class RateLimitError extends APIError {
    constructor(message, service = 'API', retryAfter = null, details = {}) {
        const code = service === 'Instagram'
            ? ERROR_CODES.INSTAGRAM_RATE_LIMIT
            : service === 'OpenAI'
                ? ERROR_CODES.OPENAI_RATE_LIMIT
                : ERROR_CODES.API_RATE_LIMIT;

        super(message, code, 429, { service, retryAfter, ...details });
        this.retryAfter = retryAfter;
    }
}

/**
 * Processing Error
 */
class ProcessingError extends AppError {
    constructor(message, details = {}) {
        super(message, ERROR_CODES.PROCESSING_FAILED, 500, details);
    }
}

/**
 * Resource Error
 */
class ResourceError extends AppError {
    constructor(message, code = ERROR_CODES.NETWORK_ERROR, details = {}) {
        super(message, code, 500, details);
    }
}

/**
 * Retry Logic with Exponential Backoff
 */
class RetryHandler {
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * Calculate delay for exponential backoff with jitter
     */
    calculateDelay(attempt, config) {
        const baseDelay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt);
        const jitter = Math.random() * 0.3 * baseDelay; // Add 0-30% jitter
        return Math.min(baseDelay + jitter, config.maxDelay);
    }

    /**
     * Check if error is retryable
     */
    isRetryable(error) {
        const config = RETRY_CONFIG[error.code];

        if (!config) {
            // Default: retry on network/timeout errors, not on client errors
            return error.statusCode >= 500 || error.statusCode === 429;
        }

        return config.retryable === true;
    }

    /**
     * Execute function with retry logic
     */
    async executeWithRetry(fn, options = {}) {
        const {
            operationName = 'operation',
            maxRetries = 3,
            onRetry = null,
        } = options;

        let lastError;
        let attempt = 0;

        while (attempt <= maxRetries) {
            try {
                if (attempt > 0) {
                    this.logger.info(`Retry attempt ${attempt}/${maxRetries} for ${operationName}`);
                }

                return await fn();
            } catch (error) {
                lastError = error;

                // Check if we should retry
                if (attempt >= maxRetries || !this.isRetryable(error)) {
                    this.logger.error(`Operation failed after ${attempt} attempts: ${operationName}`, error);
                    throw error;
                }

                // Get retry configuration
                const config = RETRY_CONFIG[error.code] || {
                    initialDelay: 1000,
                    maxDelay: 10000,
                    backoffMultiplier: 2,
                };

                const delay = this.calculateDelay(attempt, config);

                this.logger.warn(`Retrying ${operationName} after ${delay}ms`, {
                    attempt,
                    maxRetries,
                    errorCode: error.code,
                    errorMessage: error.message,
                });

                // Call retry callback if provided
                if (onRetry) {
                    await onRetry(attempt, error, delay);
                }

                // Wait before retrying
                await this.sleep(delay);
                attempt++;
            }
        }

        throw lastError;
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Circuit Breaker Pattern
 * Prevents cascading failures by stopping requests to failing services
 */
class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000; // 1 minute
        this.monitoringPeriod = options.monitoringPeriod || 10000; // 10 seconds

        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failures = 0;
        this.lastFailureTime = null;
        this.successCount = 0;
    }

    /**
     * Execute function through circuit breaker
     */
    async execute(fn) {
        if (this.state === 'OPEN') {
            // Check if we should try half-open
            if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
                this.state = 'HALF_OPEN';
                this.successCount = 0;
            } else {
                throw new ResourceError('Circuit breaker is OPEN', ERROR_CODES.API_REQUEST_FAILED, {
                    state: this.state,
                    failures: this.failures,
                });
            }
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    onSuccess() {
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
            if (this.successCount >= 2) {
                // Reset to closed after 2 successful requests
                this.state = 'CLOSED';
                this.failures = 0;
            }
        }
    }

    onFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();

        if (this.failures >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }

    getState() {
        return {
            state: this.state,
            failures: this.failures,
            lastFailureTime: this.lastFailureTime,
        };
    }
}

module.exports = {
    ERROR_CODES,
    RETRY_CONFIG,
    AppError,
    ValidationError,
    APIError,
    RateLimitError,
    ProcessingError,
    ResourceError,
    RetryHandler,
    CircuitBreaker,
};