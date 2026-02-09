/**
 * Input Parameter Validator
 * 
 * Validates and sanitizes all input parameters with:
 * - Type checking
 * - Range validation
 * - Pattern matching
 * - Sanitization
 * - Default value assignment
 */

const { ValidationError, ERROR_CODES } = require('./errors');

/**
 * URL Pattern Validators
 */
const URL_PATTERNS = {
    INSTAGRAM_POST: /^https?:\/\/(www\.)?instagram\.com\/p\/[A-Za-z0-9_-]+\/?$/,
    WEBHOOK: /^https:\/\/.+$/,
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
};

/**
 * Enum Validators
 */
const VALID_ENUMS = {
    samplingMode: ['ALL', 'TOP_LIKED', 'RANDOM', 'RECENT', 'BALANCED'],
    outputFormat: ['json', 'csv', 'xlsx'],
    webhookFormat: ['json', 'slack', 'discord', 'custom'],
    openaiModel: ['gpt-4-turbo-preview', 'gpt-4', 'gpt-3.5-turbo'],
    intentTypes: ['purchase_intent', 'information_seeking', 'contact_request', 'feedback', 'spam', 'general_engagement'],
};

/**
 * Input Validator Class
 */
class InputValidator {
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * Main validation method
     */
    validate(input) {
        this.logger.info('Validating input parameters');

        const errors = [];
        const warnings = [];

        try {
            // Validate required fields
            this.validateRequiredFields(input, errors);

            // Validate individual parameters
            this.validatePostUrls(input, errors);
            this.validateNumericRanges(input, errors, warnings);
            this.validateEnums(input, errors);
            this.validateWebhook(input, errors);
            this.validateApiKeys(input, errors);
            this.validateArrayParameters(input, errors);
            this.validateConditionalParameters(input, warnings);

            // Apply defaults
            const validated = this.applyDefaults(input);

            // Sanitize input
            const sanitized = this.sanitize(validated);

            if (errors.length > 0) {
                throw new ValidationError('Input validation failed', {
                    errors,
                    warnings,
                });
            }

            if (warnings.length > 0) {
                this.logger.warn('Input validation warnings', { warnings });
            }

            this.logger.info('Input validation successful', {
                postCount: sanitized.postUrls?.length,
                samplingMode: sanitized.samplingMode,
                targetLeadCount: sanitized.targetLeadCount,
            });

            return sanitized;
        } catch (error) {
            if (error instanceof ValidationError) {
                throw error;
            }
            throw new ValidationError('Unexpected validation error', {
                originalError: error.message,
            });
        }
    }

    /**
     * Validate required fields
     */
    validateRequiredFields(input, errors) {
        const required = ['postUrls', 'instagramApiKey', 'openaiApiKey'];

        required.forEach(field => {
            if (!input[field]) {
                errors.push({
                    field,
                    message: `${field} is required`,
                    code: ERROR_CODES.MISSING_REQUIRED_FIELD,
                });
            }
        });
    }

    /**
     * Validate Instagram post URLs
     */
    validatePostUrls(input, errors) {
        if (!input.postUrls) return;

        if (!Array.isArray(input.postUrls)) {
            errors.push({
                field: 'postUrls',
                message: 'postUrls must be an array',
                code: ERROR_CODES.INVALID_FORMAT,
            });
            return;
        }

        if (input.postUrls.length === 0) {
            errors.push({
                field: 'postUrls',
                message: 'At least one post URL is required',
                code: ERROR_CODES.INVALID_PARAMETER,
            });
        }

        if (input.postUrls.length > 10) {
            errors.push({
                field: 'postUrls',
                message: 'Maximum 10 post URLs allowed',
                code: ERROR_CODES.PARAMETER_OUT_OF_RANGE,
            });
        }

        input.postUrls.forEach((url, index) => {
            if (typeof url !== 'string') {
                errors.push({
                    field: `postUrls[${index}]`,
                    message: 'URL must be a string',
                    code: ERROR_CODES.INVALID_FORMAT,
                });
            } else if (!URL_PATTERNS.INSTAGRAM_POST.test(url)) {
                errors.push({
                    field: `postUrls[${index}]`,
                    message: `Invalid Instagram post URL: ${url}`,
                    code: ERROR_CODES.INVALID_URL,
                    value: url,
                });
            }
        });
    }

    /**
     * Validate numeric ranges
     */
    validateNumericRanges(input, errors, warnings) {
        const numericFields = [
            { name: 'maxComments', min: 10, max: 5000, default: 1000 },
            { name: 'minLeadScore', min: 0.0, max: 1.0, default: 0.4 },
            { name: 'samplingProbability', min: 0.01, max: 1.0, default: 0.5 },
            { name: 'spamFilterThreshold', min: 0.0, max: 1.0, default: 0.7 },
            { name: 'targetLeadCount', min: 0, max: 1000, default: 50 },
            { name: 'minLikes', min: 0, max: 10000, default: 0 },
            { name: 'minFollowerCount', min: 0, max: 10000000, default: 0 },
            { name: 'maxConcurrency', min: 1, max: 20, default: 5 },
            { name: 'requestDelayMs', min: 100, max: 10000, default: 1000 },
            { name: 'cacheExpirationHours', min: 1, max: 720, default: 24 },
        ];

        numericFields.forEach(({ name, min, max, default: defaultValue }) => {
            if (input[name] === undefined || input[name] === null) {
                return; // Will be set by defaults
            }

            const value = Number(input[name]);

            if (isNaN(value)) {
                errors.push({
                    field: name,
                    message: `${name} must be a number`,
                    code: ERROR_CODES.INVALID_FORMAT,
                });
                return;
            }

            if (value < min || value > max) {
                errors.push({
                    field: name,
                    message: `${name} must be between ${min} and ${max}`,
                    code: ERROR_CODES.PARAMETER_OUT_OF_RANGE,
                    value,
                    min,
                    max,
                });
            }

            // Warnings for suboptimal values
            if (name === 'maxComments' && value > 2000) {
                warnings.push({
                    field: name,
                    message: 'High maxComments value may result in slow processing and high costs',
                    value,
                });
            }

            if (name === 'minLeadScore' && value < 0.3) {
                warnings.push({
                    field: name,
                    message: 'Low minLeadScore may result in many low-quality leads',
                    value,
                });
            }
        });
    }

    /**
     * Validate enum values
     */
    validateEnums(input, errors) {
        Object.entries(VALID_ENUMS).forEach(([field, validValues]) => {
            if (input[field] !== undefined && !validValues.includes(input[field])) {
                errors.push({
                    field,
                    message: `Invalid ${field}. Must be one of: ${validValues.join(', ')}`,
                    code: ERROR_CODES.INVALID_PARAMETER,
                    value: input[field],
                    validValues,
                });
            }
        });
    }

    /**
     * Validate webhook configuration
     */
    validateWebhook(input, errors) {
        if (input.webhookUrl) {
            if (typeof input.webhookUrl !== 'string') {
                errors.push({
                    field: 'webhookUrl',
                    message: 'webhookUrl must be a string',
                    code: ERROR_CODES.INVALID_FORMAT,
                });
            } else if (!URL_PATTERNS.WEBHOOK.test(input.webhookUrl)) {
                errors.push({
                    field: 'webhookUrl',
                    message: 'webhookUrl must be a valid HTTPS URL',
                    code: ERROR_CODES.INVALID_URL,
                    value: input.webhookUrl,
                });
            }
        }

        if (input.notifyOnHighScoreLeads && !input.webhookUrl) {
            errors.push({
                field: 'notifyOnHighScoreLeads',
                message: 'webhookUrl is required when notifyOnHighScoreLeads is enabled',
                code: ERROR_CODES.INVALID_PARAMETER,
            });
        }
    }

    /**
     * Validate API keys
     */
    validateApiKeys(input, errors) {
        if (input.openaiApiKey && typeof input.openaiApiKey === 'string') {
            if (!input.openaiApiKey.startsWith('sk-')) {
                errors.push({
                    field: 'openaiApiKey',
                    message: 'OpenAI API key must start with "sk-"',
                    code: ERROR_CODES.INVALID_PARAMETER,
                });
            }
        }

        if (input.instagramApiKey && typeof input.instagramApiKey === 'string') {
            if (input.instagramApiKey.length < 10) {
                errors.push({
                    field: 'instagramApiKey',
                    message: 'Instagram API key appears to be invalid',
                    code: ERROR_CODES.INVALID_PARAMETER,
                });
            }
        }
    }

    /**
     * Validate array parameters
     */
    validateArrayParameters(input, errors) {
        const arrayFields = ['intentFilters', 'excludeKeywords', 'requireKeywords'];

        arrayFields.forEach(field => {
            if (input[field] !== undefined) {
                if (!Array.isArray(input[field])) {
                    errors.push({
                        field,
                        message: `${field} must be an array`,
                        code: ERROR_CODES.INVALID_FORMAT,
                    });
                } else if (field === 'intentFilters') {
                    // Validate intent types
                    input[field].forEach((intent, index) => {
                        if (!VALID_ENUMS.intentTypes.includes(intent)) {
                            errors.push({
                                field: `${field}[${index}]`,
                                message: `Invalid intent type: ${intent}`,
                                code: ERROR_CODES.INVALID_PARAMETER,
                                validValues: VALID_ENUMS.intentTypes,
                            });
                        }
                    });
                }
            }
        });
    }

    /**
     * Validate conditional parameters
     */
    validateConditionalParameters(input, warnings) {
        // Warn if sampling mode is RANDOM but probability is not set
        if (input.samplingMode === 'RANDOM' && !input.samplingProbability) {
            warnings.push({
                field: 'samplingProbability',
                message: 'samplingProbability not set for RANDOM sampling mode, will use default',
            });
        }

        // Warn if caching is disabled but high comment count
        if (input.enableCaching === false && input.maxComments > 500) {
            warnings.push({
                field: 'enableCaching',
                message: 'Caching disabled with high maxComments may result in repeated API costs',
            });
        }
    }

    /**
     * Apply default values
     */
    applyDefaults(input) {
        const defaults = {
            maxComments: 1000,
            samplingMode: 'TOP_LIKED',
            samplingProbability: 0.5,
            minLikes: 0,
            targetLeadCount: 50,
            minLeadScore: 0.4,
            excludeSpam: true,
            spamFilterThreshold: 0.7,
            includeContactInfo: true,
            intentFilters: [],
            includeVerifiedOnly: false,
            minFollowerCount: 0,
            excludeKeywords: [],
            requireKeywords: [],
            webhookFormat: 'json',
            notifyOnHighScoreLeads: false,
            outputFormat: 'json',
            includeAnalytics: true,
            openaiModel: 'gpt-4-turbo-preview',
            maxConcurrency: 5,
            requestDelayMs: 1000,
            enableCaching: true,
            cacheExpirationHours: 24,
            debugMode: false,
            customPrompt: '',
        };

        return { ...defaults, ...input };
    }

    /**
     * Sanitize input
     */
    sanitize(input) {
        const sanitized = { ...input };

        // Trim strings
        if (sanitized.webhookUrl) {
            sanitized.webhookUrl = sanitized.webhookUrl.trim();
        }

        if (sanitized.customPrompt) {
            sanitized.customPrompt = sanitized.customPrompt.trim();
        }

        // Trim URLs
        if (sanitized.postUrls) {
            sanitized.postUrls = sanitized.postUrls.map(url => url.trim());
        }

        // Sanitize keywords
        if (sanitized.excludeKeywords) {
            sanitized.excludeKeywords = sanitized.excludeKeywords
                .map(k => k.trim().toLowerCase())
                .filter(k => k.length > 0);
        }

        if (sanitized.requireKeywords) {
            sanitized.requireKeywords = sanitized.requireKeywords
                .map(k => k.trim().toLowerCase())
                .filter(k => k.length > 0);
        }

        // Remove duplicates from arrays
        if (sanitized.intentFilters) {
            sanitized.intentFilters = [...new Set(sanitized.intentFilters)];
        }

        return sanitized;
    }
}

module.exports = InputValidator;