/**
 * Memory-Efficient Streaming Processor
 * 
 * Handles large datasets with minimal memory footprint:
 * - Streaming data processing
 * - Batch processing with backpressure
 * - Memory monitoring and throttling
 * - Efficient data transformations
 * - Progressive results output
 */

const { Transform, Readable, Writable } = require('stream');
const { pipeline } = require('stream/promises');

/**
 * Memory Monitor
 */
class MemoryMonitor {
    constructor(logger, options = {}) {
        this.logger = logger;
        this.maxMemoryMB = options.maxMemoryMB || 512;
        this.warningThreshold = options.warningThreshold || 0.8; // 80%
        this.checkInterval = options.checkInterval || 5000; // 5 seconds
        this.interval = null;
        this.metrics = {
            current: 0,
            peak: 0,
            warnings: 0,
        };
    }

    /**
     * Start monitoring memory usage
     */
    start() {
        this.interval = setInterval(() => {
            this.checkMemory();
        }, this.checkInterval);

        this.logger.info('Memory monitoring started', {
            maxMemoryMB: this.maxMemoryMB,
            warningThreshold: this.warningThreshold,
        });
    }

    /**
     * Stop monitoring
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.logger.info('Memory monitoring stopped');
    }

    /**
     * Check current memory usage
     */
    checkMemory() {
        const usage = process.memoryUsage();
        const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
        const externalMB = Math.round(usage.external / 1024 / 1024);

        this.metrics.current = heapUsedMB;
        this.metrics.peak = Math.max(this.metrics.peak, heapUsedMB);

        const usagePercent = heapUsedMB / this.maxMemoryMB;

        if (usagePercent > this.warningThreshold) {
            this.metrics.warnings++;
            this.logger.warn('High memory usage detected', {
                heapUsedMB,
                heapTotalMB,
                externalMB,
                maxMemoryMB: this.maxMemoryMB,
                usagePercent: `${(usagePercent * 100).toFixed(1)}%`,
            });

            if (usagePercent > 0.95) {
                this.logger.error('Critical memory usage - forcing garbage collection');
                if (global.gc) {
                    global.gc();
                }
            }
        }

        return {
            heapUsedMB,
            heapTotalMB,
            externalMB,
            usagePercent,
        };
    }

    /**
     * Get memory metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            current: this.checkMemory(),
        };
    }
}

/**
 * Batch Stream Processor
 * Processes items in batches to optimize memory usage
 */
class BatchProcessor extends Transform {
    constructor(options = {}) {
        super({ objectMode: true });

        this.batchSize = options.batchSize || 100;
        this.processFn = options.processFn;
        this.logger = options.logger;
        this.batch = [];
        this.processedCount = 0;
    }

    async _transform(chunk, encoding, callback) {
        try {
            this.batch.push(chunk);

            // Process batch when full
            if (this.batch.length >= this.batchSize) {
                await this.processBatch();
            }

            callback();
        } catch (error) {
            callback(error);
        }
    }

    async _flush(callback) {
        try {
            // Process remaining items
            if (this.batch.length > 0) {
                await this.processBatch();
            }
            callback();
        } catch (error) {
            callback(error);
        }
    }

    async processBatch() {
        if (this.batch.length === 0) return;

        const batchToProcess = [...this.batch];
        this.batch = []; // Clear batch for next round

        try {
            const results = await this.processFn(batchToProcess);

            // Push results downstream
            for (const result of results) {
                this.push(result);
            }

            this.processedCount += batchToProcess.length;

            if (this.logger) {
                this.logger.debug(`Batch processed`, {
                    batchSize: batchToProcess.length,
                    totalProcessed: this.processedCount,
                });
            }
        } catch (error) {
            if (this.logger) {
                this.logger.error('Batch processing failed', error);
            }
            throw error;
        }
    }
}

/**
 * Throttled Stream
 * Controls flow rate to prevent overwhelming downstream systems
 */
class ThrottledStream extends Transform {
    constructor(options = {}) {
        super({ objectMode: true });

        this.itemsPerSecond = options.itemsPerSecond || 10;
        this.logger = options.logger;
        this.processedCount = 0;
        this.lastEmitTime = Date.now();
        this.delayMs = 1000 / this.itemsPerSecond;
    }

    async _transform(chunk, encoding, callback) {
        try {
            const now = Date.now();
            const timeSinceLastEmit = now - this.lastEmitTime;

            // Throttle if needed
            if (timeSinceLastEmit < this.delayMs) {
                const waitTime = this.delayMs - timeSinceLastEmit;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            this.push(chunk);
            this.processedCount++;
            this.lastEmitTime = Date.now();

            callback();
        } catch (error) {
            callback(error);
        }
    }
}

/**
 * Progress Tracker Stream
 * Tracks and reports processing progress
 */
class ProgressStream extends Transform {
    constructor(options = {}) {
        super({ objectMode: true });

        this.total = options.total || 0;
        this.logger = options.logger;
        this.onProgress = options.onProgress;
        this.reportInterval = options.reportInterval || 100; // Report every N items
        this.processed = 0;
        this.startTime = Date.now();
    }

    _transform(chunk, encoding, callback) {
        this.processed++;

        // Report progress
        if (this.processed % this.reportInterval === 0 || this.processed === this.total) {
            const progress = this.getProgress();

            if (this.logger) {
                this.logger.info('Processing progress', progress);
            }

            if (this.onProgress) {
                this.onProgress(progress);
            }
        }

        this.push(chunk);
        callback();
    }

    getProgress() {
        const elapsed = Date.now() - this.startTime;
        const rate = this.processed / (elapsed / 1000);
        const remaining = this.total - this.processed;
        const eta = remaining / rate;

        return {
            processed: this.processed,
            total: this.total,
            percentage: this.total > 0 ? ((this.processed / this.total) * 100).toFixed(1) : 0,
            elapsed: `${(elapsed / 1000).toFixed(1)}s`,
            rate: `${rate.toFixed(1)}/s`,
            eta: this.total > 0 && eta > 0 ? `${eta.toFixed(1)}s` : 'N/A',
        };
    }
}

/**
 * Memory-Efficient Data Aggregator
 * Aggregates streaming data with minimal memory footprint
 */
class StreamingAggregator {
    constructor(logger) {
        this.logger = logger;
        this.stats = {
            count: 0,
            sum: {},
            min: {},
            max: {},
            uniqueValues: new Map(),
        };
    }

    /**
     * Update aggregates with new data point
     */
    update(data) {
        this.stats.count++;

        // Aggregate numeric fields
        Object.entries(data).forEach(([key, value]) => {
            if (typeof value === 'number') {
                this.stats.sum[key] = (this.stats.sum[key] || 0) + value;
                this.stats.min[key] = Math.min(this.stats.min[key] || Infinity, value);
                this.stats.max[key] = Math.max(this.stats.max[key] || -Infinity, value);
            }

            // Track unique values (with limit to prevent memory issues)
            if (!this.stats.uniqueValues.has(key)) {
                this.stats.uniqueValues.set(key, new Set());
            }

            const uniqueSet = this.stats.uniqueValues.get(key);
            if (uniqueSet.size < 1000) { // Limit to 1000 unique values per field
                uniqueSet.add(value);
            }
        });
    }

    /**
     * Get computed statistics
     */
    getStats() {
        const averages = {};
        Object.entries(this.stats.sum).forEach(([key, sum]) => {
            averages[key] = sum / this.stats.count;
        });

        const uniqueCounts = {};
        this.stats.uniqueValues.forEach((set, key) => {
            uniqueCounts[key] = set.size;
        });

        return {
            count: this.stats.count,
            averages,
            min: this.stats.min,
            max: this.stats.max,
            uniqueCounts,
        };
    }

    /**
     * Clear statistics (free memory)
     */
    clear() {
        this.stats = {
            count: 0,
            sum: {},
            min: {},
            max: {},
            uniqueValues: new Map(),
        };
    }
}

/**
 * Streaming Pipeline Manager
 * Orchestrates complex streaming pipelines
 */
class StreamPipeline {
    constructor(logger, options = {}) {
        this.logger = logger;
        this.memoryMonitor = new MemoryMonitor(logger, options.memory);
        this.stages = [];
    }

    /**
     * Add processing stage to pipeline
     */
    addStage(name, stream) {
        this.stages.push({ name, stream });
        return this;
    }

    /**
     * Execute pipeline
     */
    async execute(source, destination) {
        this.logger.info('Starting streaming pipeline', {
            stages: this.stages.length,
        });

        this.memoryMonitor.start();

        try {
            const streams = [
                source,
                ...this.stages.map(s => s.stream),
                destination,
            ];

            await pipeline(...streams);

            this.logger.info('Pipeline completed successfully', {
                memoryMetrics: this.memoryMonitor.getMetrics(),
            });
        } catch (error) {
            this.logger.error('Pipeline failed', error);
            throw error;
        } finally {
            this.memoryMonitor.stop();
        }
    }
}

/**
 * Array to Stream converter
 */
function arrayToStream(array) {
    let index = 0;

    return new Readable({
        objectMode: true,
        read() {
            if (index < array.length) {
                this.push(array[index]);
                index++;
            } else {
                this.push(null); // Signal end of stream
            }
        },
    });
}

/**
 * Stream to Array collector
 */
async function streamToArray(stream) {
    const results = [];

    const collector = new Writable({
        objectMode: true,
        write(chunk, encoding, callback) {
            results.push(chunk);
            callback();
        },
    });

    await pipeline(stream, collector);
    return results;
}

module.exports = {
    MemoryMonitor,
    BatchProcessor,
    ThrottledStream,
    ProgressStream,
    StreamingAggregator,
    StreamPipeline,
    arrayToStream,
    streamToArray,
};