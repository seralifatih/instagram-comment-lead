/**
 * Graceful Shutdown Handler
 * 
 * Handles application shutdown gracefully:
 * - Cleanup of resources
 * - Completion of in-flight requests
 * - Proper connection closing
 * - State persistence
 * - Health check integration
 */

const { EventEmitter } = require('events');

class GracefulShutdown extends EventEmitter {
    constructor(logger, options = {}) {
        super();

        this.logger = logger;
        this.isShuttingDown = false;
        this.shutdownTimeout = options.shutdownTimeout || 30000; // 30 seconds
        this.handlers = [];
        this.healthCheckInterval = null;
        this.healthStatus = {
            status: 'healthy',
            uptime: 0,
            startTime: Date.now(),
        };

        this.setupSignalHandlers();
        this.startHealthCheck();
    }

    /**
     * Setup process signal handlers
     */
    setupSignalHandlers() {
        const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

        signals.forEach(signal => {
            process.on(signal, () => {
                this.logger.info(`Received ${signal}, initiating graceful shutdown`);
                this.shutdown(signal);
            });
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            this.logger.fatal('Uncaught exception, forcing shutdown', error);
            this.forceShutdown(1);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            this.logger.fatal('Unhandled promise rejection, forcing shutdown', null, {
                reason: reason?.toString(),
                promise: promise?.toString(),
            });
            this.forceShutdown(1);
        });

        this.logger.info('Signal handlers registered');
    }

    /**
     * Register cleanup handler
     */
    registerHandler(name, handler, options = {}) {
        const {
            priority = 100, // Lower priority runs first (0-999)
            timeout = 5000,
        } = options;

        this.handlers.push({
            name,
            handler,
            priority,
            timeout,
        });

        // Sort handlers by priority
        this.handlers.sort((a, b) => a.priority - b.priority);

        this.logger.debug(`Registered shutdown handler: ${name}`, {
            priority,
            timeout,
            totalHandlers: this.handlers.length,
        });
    }

    /**
     * Execute graceful shutdown
     */
    async shutdown(signal = 'SIGTERM') {
        if (this.isShuttingDown) {
            this.logger.warn('Shutdown already in progress');
            return;
        }

        this.isShuttingDown = true;
        this.healthStatus.status = 'shutting_down';
        this.emit('shutdown:start', signal);

        this.logger.info('Starting graceful shutdown', {
            signal,
            handlersCount: this.handlers.length,
            timeout: this.shutdownTimeout,
        });

        try {
            // Set overall timeout
            const shutdownPromise = this.executeHandlers();
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Shutdown timeout')), this.shutdownTimeout)
            );

            await Promise.race([shutdownPromise, timeoutPromise]);

            this.logger.info('Graceful shutdown completed successfully');
            this.emit('shutdown:complete');
            process.exit(0);
        } catch (error) {
            this.logger.error('Error during graceful shutdown', error);
            this.emit('shutdown:error', error);
            this.forceShutdown(1);
        }
    }

    /**
     * Execute all registered handlers
     */
    async executeHandlers() {
        const results = [];

        for (const { name, handler, timeout } of this.handlers) {
            try {
                this.logger.info(`Executing shutdown handler: ${name}`);

                const handlerPromise = Promise.resolve(handler());
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Handler timeout: ${name}`)), timeout)
                );

                await Promise.race([handlerPromise, timeoutPromise]);

                results.push({ name, status: 'success' });
                this.logger.info(`Shutdown handler completed: ${name}`);
            } catch (error) {
                results.push({ name, status: 'error', error: error.message });
                this.logger.error(`Shutdown handler failed: ${name}`, error);
            }
        }

        this.logger.info('All shutdown handlers executed', {
            total: results.length,
            successful: results.filter(r => r.status === 'success').length,
            failed: results.filter(r => r.status === 'error').length,
        });

        return results;
    }

    /**
     * Force immediate shutdown
     */
    forceShutdown(exitCode = 1) {
        this.logger.fatal('Forcing immediate shutdown', null, { exitCode });
        this.emit('shutdown:force', exitCode);

        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        process.exit(exitCode);
    }

    /**
     * Health check mechanism
     */
    startHealthCheck() {
        this.healthCheckInterval = setInterval(() => {
            this.healthStatus.uptime = Math.floor((Date.now() - this.healthStatus.startTime) / 1000);

            if (!this.isShuttingDown) {
                this.emit('health:check', this.healthStatus);
            }
        }, 5000); // Check every 5 seconds
    }

    /**
     * Get current health status
     */
    getHealthStatus() {
        return {
            ...this.healthStatus,
            isShuttingDown: this.isShuttingDown,
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Mark as unhealthy
     */
    markUnhealthy(reason) {
        this.healthStatus.status = 'unhealthy';
        this.healthStatus.reason = reason;
        this.logger.warn('Application marked as unhealthy', { reason });
        this.emit('health:unhealthy', reason);
    }
}

/**
 * Resource Manager for tracking and cleaning up resources
 */
class ResourceManager {
    constructor(logger) {
        this.logger = logger;
        this.resources = new Map();
    }

    /**
     * Register a resource for cleanup
     */
    register(id, resource, cleanup) {
        this.resources.set(id, { resource, cleanup });
        this.logger.debug(`Resource registered: ${id}`, {
            totalResources: this.resources.size,
        });
    }

    /**
     * Unregister a resource
     */
    unregister(id) {
        this.resources.delete(id);
        this.logger.debug(`Resource unregistered: ${id}`, {
            totalResources: this.resources.size,
        });
    }

    /**
     * Get resource by ID
     */
    get(id) {
        return this.resources.get(id)?.resource;
    }

    /**
     * Cleanup all resources
     */
    async cleanupAll() {
        this.logger.info('Cleaning up all resources', {
            count: this.resources.size,
        });

        const cleanupPromises = [];

        for (const [id, { resource, cleanup }] of this.resources.entries()) {
            cleanupPromises.push(
                (async () => {
                    try {
                        this.logger.debug(`Cleaning up resource: ${id}`);
                        await cleanup(resource);
                        this.logger.debug(`Resource cleaned up: ${id}`);
                    } catch (error) {
                        this.logger.error(`Failed to cleanup resource: ${id}`, error);
                    }
                })()
            );
        }

        await Promise.all(cleanupPromises);
        this.resources.clear();

        this.logger.info('All resources cleaned up');
    }

    /**
     * Get resource statistics
     */
    getStats() {
        return {
            totalResources: this.resources.size,
            resourceIds: Array.from(this.resources.keys()),
        };
    }
}

/**
 * Request Tracker for monitoring in-flight requests
 */
class RequestTracker {
    constructor(logger) {
        this.logger = logger;
        this.requests = new Map();
        this.completedCount = 0;
        this.failedCount = 0;
    }

    /**
     * Start tracking a request
     */
    start(requestId, metadata = {}) {
        this.requests.set(requestId, {
            id: requestId,
            startTime: Date.now(),
            status: 'in_progress',
            ...metadata,
        });

        this.logger.debug(`Request started: ${requestId}`, {
            activeRequests: this.requests.size,
        });
    }

    /**
     * Mark request as completed
     */
    complete(requestId, result = {}) {
        const request = this.requests.get(requestId);

        if (request) {
            const duration = Date.now() - request.startTime;
            this.requests.delete(requestId);
            this.completedCount++;

            this.logger.debug(`Request completed: ${requestId}`, {
                duration: `${duration}ms`,
                activeRequests: this.requests.size,
            });
        }
    }

    /**
     * Mark request as failed
     */
    fail(requestId, error) {
        const request = this.requests.get(requestId);

        if (request) {
            const duration = Date.now() - request.startTime;
            this.requests.delete(requestId);
            this.failedCount++;

            this.logger.debug(`Request failed: ${requestId}`, {
                duration: `${duration}ms`,
                error: error?.message,
                activeRequests: this.requests.size,
            });
        }
    }

    /**
     * Wait for all requests to complete
     */
    async waitForCompletion(timeout = 30000) {
        const startTime = Date.now();

        while (this.requests.size > 0) {
            if (Date.now() - startTime > timeout) {
                throw new Error(`Timeout waiting for ${this.requests.size} requests to complete`);
            }

            this.logger.info(`Waiting for ${this.requests.size} requests to complete`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        this.logger.info('All requests completed');
    }

    /**
     * Get request statistics
     */
    getStats() {
        return {
            active: this.requests.size,
            completed: this.completedCount,
            failed: this.failedCount,
            total: this.completedCount + this.failedCount,
            successRate: this.completedCount / (this.completedCount + this.failedCount || 1),
        };
    }
}

module.exports = {
    GracefulShutdown,
    ResourceManager,
    RequestTracker,
};