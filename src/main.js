import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, log, KeyValueStore } from 'crawlee';
import { devices } from 'playwright';
import natural from 'natural';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import crypto from 'crypto';
import { computeLeadScore } from './leadScore.js';
import { assessCommentQuality } from './commentQuality.js';
import { estimateCommercialValue } from './commercialValue.js';

// --- CONSTANTS ---
const DEFAULT_MAX_POSTS = 3; // If a profile URL is provided, how many recent posts?
const DEFAULT_MAX_COMMENTS = 1000; // Max comments per post
const DEVICE_PROFILE = devices['iPhone 14 Pro'];
const INSTAGRAM_APP_ID = '936619743392459';

// --- LEAD KEYWORDS (Purchase intent) ---
const LEAD_KEYWORDS = [
    'price', 'dm', 'info', 'order',
    'size', 'shipping', 'available',
    'how much', 'buy', 'link'
];

const DEFAULT_INTENT_WEIGHTS = {
    BUY_INTENT: {
        'buy': 0.8,
        'purchase': 0.75,
        'order': 0.7,
        'price': 0.6,
        'cost': 0.6,
        'how much': 0.7,
        'available': 0.5,
        'in stock': 0.5,
        'stock': 0.4,
        'shipping': 0.5,
        'ship': 0.4,
        'link': 0.4,
        'dm': 0.3,
        'where to buy': 0.7,
        'fiyat': 0.6,
        'ne kadar': 0.7,
        'satın al': 0.75,
        'satin al': 0.75,
        'sipariş': 0.6,
        'siparis': 0.6,
        'kargo': 0.5,
        'stok': 0.4,
        'var mı': 0.4,
        'var mi': 0.4,
        'comprar': 0.8,
        'compra': 0.7,
        'precio': 0.6,
        'cuanto': 0.6,
        'cuánto': 0.6,
        'pedido': 0.6,
        'disponible': 0.5,
        'envio': 0.5,
        'envío': 0.5,
        'enlace': 0.4,
        'कीमत': 0.6,
        'दाम': 0.6,
        'कितना': 0.6,
        'खरीद': 0.6,
        'खरीदना': 0.7,
        'ऑर्डर': 0.6,
        'उपलब्ध': 0.5,
        'डिलीवरी': 0.5,
        'शिप': 0.4,
        'लिंक': 0.4
    },
    QUESTION: {
        '?': 0.2,
        'how': 0.35,
        'where': 0.35,
        'when': 0.25,
        'what': 0.25,
        'why': 0.25,
        'info': 0.3,
        'details': 0.3,
        'nasıl': 0.35,
        'nasil': 0.35,
        'nerede': 0.35,
        'ne zaman': 0.25,
        'nedir': 0.25,
        'bilgi': 0.3,
        'detay': 0.3,
        'como': 0.35,
        'cómo': 0.35,
        'donde': 0.35,
        'dónde': 0.35,
        'cuando': 0.25,
        'cuándo': 0.25,
        'que': 0.25,
        'qué': 0.25,
        'por que': 0.25,
        'por qué': 0.25,
        'detalles': 0.3,
        'información': 0.3,
        'informacion': 0.3,
        'कैसे': 0.35,
        'कहाँ': 0.35,
        'कहां': 0.35,
        'कब': 0.25,
        'क्या': 0.25,
        'क्यों': 0.25,
        'जानकारी': 0.3,
        'विवरण': 0.3
    },
    COMPLAINT: {
        'scam': 0.8,
        'fraud': 0.8,
        'fake': 0.7,
        'broken': 0.6,
        'bad': 0.4,
        'never': 0.4,
        'hate': 0.4,
        'problem': 0.5,
        'issue': 0.5,
        'refund': 0.6,
        'return': 0.5,
        'sahte': 0.7,
        'dolandırıcı': 0.8,
        'dolandirici': 0.8,
        'bozuk': 0.6,
        'kötü': 0.5,
        'kotu': 0.5,
        'asla': 0.4,
        'nefret': 0.4,
        'sorun': 0.5,
        'şikayet': 0.6,
        'sikayet': 0.6,
        'iade': 0.6,
        'estafa': 0.8,
        'fraude': 0.8,
        'falso': 0.7,
        'roto': 0.6,
        'malo': 0.5,
        'nunca': 0.4,
        'odio': 0.4,
        'problema': 0.5,
        'queja': 0.6,
        'devolución': 0.6,
        'devolucion': 0.6,
        'reembolso': 0.6,
        'धोखा': 0.8,
        'फर्जी': 0.7,
        'खराब': 0.6,
        'बुरा': 0.5,
        'समस्या': 0.5,
        'शिकायत': 0.6,
        'रिफंड': 0.6,
        'धोखाधड़ी': 0.8
    },
    PROMOTER_SPAM: {
        'follow me': 0.9,
        'check my story': 0.8,
        'link in bio': 0.9,
        'dm me': 0.6,
        'subscribe': 0.7,
        'giveaway': 0.7,
        'promo': 0.6,
        'discount': 0.6,
        'use my code': 0.7,
        'check my page': 0.7,
        'check my profile': 0.7,
        'check my account': 0.7,
        'like my reels': 0.7,
        'like my reel': 0.7,
        'like my posts': 0.6,
        'like my page': 0.6,
        'referral': 0.7,
        'ref code': 0.7,
        'invite code': 0.7,
        'promo code': 0.7,
        'takip et': 0.9,
        'hikayeme bak': 0.8,
        'bio link': 0.7,
        'dm at': 0.6,
        'abone ol': 0.7,
        'çekiliş': 0.7,
        'cekilis': 0.7,
        'indirim': 0.6,
        'kodu kullan': 0.7,
        'sígueme': 0.9,
        'sigueme': 0.9,
        'mira mi historia': 0.8,
        'link en bio': 0.9,
        'suscríbete': 0.7,
        'suscribete': 0.7,
        'sorteo': 0.7,
        'promoción': 0.6,
        'promocion': 0.6,
        'descuento': 0.6,
        'usa mi codigo': 0.7,
        'फॉलो': 0.9,
        'मेरी स्टोरी': 0.8,
        'बायो लिंक': 0.9,
        'डीएम': 0.6,
        'सब्सक्राइब': 0.7,
        'गिवअवे': 0.7,
        'प्रोमो': 0.6,
        'डिस्काउंट': 0.6,
        'कोड': 0.6
    },
    RANDOM: {}
};

const INTENT_LABELS = new Set(['BUY_INTENT', 'QUESTION', 'COMPLAINT', 'PROMOTER_SPAM', 'RANDOM']);
const INTENT_PRIORITY = ['PROMOTER_SPAM', 'COMPLAINT', 'BUY_INTENT', 'QUESTION', 'RANDOM'];

const TOKENIZER = new natural.WordTokenizer();

const LOW_SIGNAL_PHRASES = new Set([
    'ok', 'okay', 'nice', 'cool', 'wow', 'woww', 'amazing', 'great', 'super', 'love',
    'superb'
]);

const PROMOTER_SPAM_PHRASES = [
    'follow me',
    'check my page',
    'check my profile',
    'check my account',
    'check my bio',
    'like my reels',
    'like my reel',
    'like my posts',
    'like my page',
    'visit my page',
    'visit my profile',
    'link in bio',
    'dm me',
    'message me',
    'subscribe',
    'subscribe to my',
    'join my',
    'sign up',
    'signup',
    'register',
    'use my code',
    'promo code',
    'ref code',
    'referral',
    'invite code',
    'invite link',
    'giveaway',
    'airdrop'
];

const REFERRAL_PATTERN = /\b(referral|ref code|invite code|promo code|use my code|ref link|invite link|discount code)\b/i;
const ETH_ADDRESS_PATTERN = /\b0x[a-fA-F0-9]{40}\b/;
const BASE58_ADDRESS_PATTERN = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
const CRYPTO_CONTEXT_PATTERN = /\b(token|contract|address|ca)\b/i;

const MAX_DEDUPE_SIZE = 200000;
const SEEN_COMMENT_KEYS = new Set();

const ENRICHMENT_CACHE = new Map();
const ENRICHMENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ENRICHMENT_CACHE_MAX = 50000;

const INTENT_CACHE = new Map();
const INTENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const INTENT_CACHE_MAX = 50000;

const USER_COMMENT_COUNTS = new Map();

let LLM_CONFIG = null;
const LLM_STATE = {
    requestsMade: 0,
    pendingBatches: 0,
    lastRequestAt: 0
};

let INTENT_WEIGHT_CONFIG = DEFAULT_INTENT_WEIGHTS;
let INTENT_MATCHERS = buildIntentMatchers(INTENT_WEIGHT_CONFIG);

const COMMENT_PROCESS_CONCURRENCY = 5;
const WEBHOOK_DEFAULTS = {
    maxRetries: 4,
    baseDelayMs: 500,
    maxDelayMs: 8000,
    timeoutMs: 8000,
    concurrency: 3
};

const DEFAULT_LANGUAGE_DETECTION = {
    enableFastText: false,
    fastTextMinChars: 20,
    fastTextTimeoutMs: 2000
};

const DEFAULT_SAMPLING_MODE = 'ALL';
const DEFAULT_TARGET_LEAD_COUNT = 50;
const DEFAULT_SAMPLING_PROBABILITY = 0.3;
const DEFAULT_MIN_LIKES = 5;
const DEFAULT_DATASET_BYTES_PER_RECORD = 1500;

let LLM_BATCHER = null;
let WEBHOOK_DISPATCHER = null;
let LANGUAGE_CONFIG = DEFAULT_LANGUAGE_DETECTION;
let DATASET_AVG_RECORD_BYTES = DEFAULT_DATASET_BYTES_PER_RECORD;
let COST_GUARD_LIMIT_BYTES = null;
let COST_GUARD_TRIGGERED = false;
let config = null;
let EARLY_STOP_REACHED = false;
let TARGET_LEAD_COUNT = DEFAULT_TARGET_LEAD_COUNT;

const GLOBAL_STATS = {
    totalComments: 0,
    totalLeads: 0,
    highValueLeads: 0,
    highIntentLeads: 0,
    intentBreakdown: {},
    keywordCounts: new Map(),
    filteredComments: 0,
    duplicateComments: 0,
    llmClassifications: 0
};

async function runActor() {
    await Actor.init();
    LLM_CONFIG = getLlmConfig();
    LLM_BATCHER = createLlmBatcher(LLM_CONFIG);

// --- INPUT VALIDATION ---
const input = (await Actor.getInput()) ?? {};
config = validateInput(input);
WEBHOOK_DISPATCHER = createWebhookDispatcher(config.webhookUrl, config.webhookConfig);
INTENT_WEIGHT_CONFIG = mergeIntentWeights(DEFAULT_INTENT_WEIGHTS, config.intentWeights);
INTENT_MATCHERS = buildIntentMatchers(INTENT_WEIGHT_CONFIG);
LANGUAGE_CONFIG = config.languageDetection || DEFAULT_LANGUAGE_DETECTION;
TARGET_LEAD_COUNT = config.targetLeadCount;
COST_GUARD_LIMIT_BYTES = normalizeLimitBytes(config.userDefinedLimitMB);

if (config.targetUrls.length === 0) {
    log.warning('No post URL provided. Please enter a valid Instagram post or reel URL.');
    await Actor.exit();
}

// Session ID check (required for comments)
if (config.sessionId) {
    log.info('Session ID provided. Comments and detailed data can be fetched.');
} else {
    log.error('Session ID missing or invalid. Provide the sessionid value or the full cookie string.');
    await Actor.exit();
}

// --- QUEUE SETUP ---
const requestQueue = await Actor.openRequestQueue();

for (const url of config.targetUrls) {
    const type = getUrlType(url);
    await requestQueue.addRequest({
        url: url,
        uniqueKey: url,
        userData: { type, originalUrl: url }
    });
}

const proxyConfiguration = await Actor.createProxyConfiguration(config.proxyConfiguration);
if (config.enrichLeads && !proxyConfiguration) {
    log.warning('Enrichment is enabled but no proxy configuration is set. Apify Proxy is recommended to reduce ban risk.');
}

// --- CRAWLER CONFIGURATION ---
const crawler = new PlaywrightCrawler({
    requestQueue,
    proxyConfiguration,
    maxConcurrency: 1,
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: 120,

    launchContext: {
        launchOptions: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
        },
    },

    preNavigationHooks: [
        async ({ page }) => {
            // Block heavy resources for speed
            await page.route('**/*.{png,jpg,jpeg,mp4,avi,woff,woff2}', (route) => route.abort());

            // Add session cookie
            if (config.sessionId) {
                await page.context().addCookies([{
                    name: 'sessionid',
                    value: config.sessionId,
                    domain: '.instagram.com',
                    path: '/',
                    secure: true,
                    httpOnly: true,
                    sameSite: 'Lax',
                }]);
            }

            // Mobile viewport
            await page.setViewportSize(DEVICE_PROFILE.viewport);
            await page.setExtraHTTPHeaders({
                'User-Agent': DEVICE_PROFILE.userAgent,
                'Accept-Language': 'en-US,en;q=0.9',
            });
        },
    ],

    async requestHandler({ request, page, response }) {
        if (shouldStopEarly()) {
            log.info(`Early stop reached. Skipping request: ${request.url}`);
            return;
        }
        const { type, originalUrl, isEnrichment, commentData } = request.userData;
        log.info(`Processing ${isEnrichment ? 'enrichment' : type}: ${request.url}`);

        await randomDelay(800, 1600, page); // Human-like delay

        // Login redirect guard
        if (page.url().includes('accounts/login')) {
            log.error(`Login wall encountered: ${request.url}. Provide a valid Session ID.`);
            return;
        }

        if (isEnrichment) {
            await handleEnrichment(page, commentData);
            return;
        }

        // Scenario 1: Profile URL -> enqueue recent posts
        if (type === 'profile') {
            await handleProfile(page, requestQueue, config.maxPostsPerProfile);
            return;
        }

        // Scenario 2: Post URL -> fetch comments
        if (type === 'post') {
            const shortcode = extractShortcode(request.url);
            if (!shortcode) {
                log.error(`Shortcode not found: ${request.url}`);
                return;
            }

            // Convert to Media ID (required for API)
            const mediaId = await getMediaId(page, shortcode, INSTAGRAM_APP_ID);

            if (!mediaId) {
                log.error(`Media ID could not be retrieved; page may not be loaded: ${shortcode}`);
                return;
            }

            log.info(`Fetching comments... MediaID: ${mediaId}`);

            // Fetch comments via API (streaming)
            const samplingMode = config.samplingMode;
            const samplingProbability = config.samplingProbability;
            const minLikes = config.minLikes;
            let maxComments = config.maxComments;
            const maxPages = config.maxPages;
            let processedCount = 0;
            let adaptiveIncreased = false;

            for await (const batch of fetchCommentsIterator(page, {
                mediaId,
                appId: INSTAGRAM_APP_ID,
                scrapeSince: config.scrapeSince,
                maxPages
            })) {
                if (shouldStopEarly()) break;
                if (checkCostGuard(processedCount, maxComments)) break;
                if (!batch.length) continue;

                if (samplingMode === 'RANDOM' && Math.random() < samplingProbability) {
                    continue;
                }

                let batchToProcess = batch;
                if (samplingMode === 'TOP_LIKED') {
                    batchToProcess = batch.filter((comment) => {
                        const likes = Number(comment?.comment_like_count ?? 0);
                        return Number.isFinite(likes) && likes >= minLikes;
                    });
                    if (!batchToProcess.length) continue;
                }

                const remaining = Math.max(0, maxComments - processedCount);
                if (remaining === 0) break;
                batchToProcess = batchToProcess.slice(0, remaining);
                await processComments(batchToProcess, COMMENT_PROCESS_CONCURRENCY, handleComment);
                processedCount += batchToProcess.length;
                if (processedCount >= maxComments) break;
            }

            log.info(`Processed ${processedCount} comments with sampling mode ${samplingMode}.`);

            async function handleComment(comment) {
                if (checkCostGuard(processedCount, maxComments)) return;
                const dedupeKey = getCommentDedupKey(comment, shortcode);
                if (isDuplicateComment(dedupeKey)) {
                    GLOBAL_STATS.duplicateComments += 1;
                    return;
                }

                const shouldFilter = isLowSignalComment(comment.text);
                if (shouldFilter) {
                    GLOBAL_STATS.filteredComments += 1;
                    return;
                }
                const quality = assessCommentQuality(comment.text, {
                    username: comment.user.username,
                    postShortcode: shortcode
                });
                if (quality.is_low_quality) {
                    GLOBAL_STATS.filteredComments += 1;
                    return;
                }

                const analysis = await analyzeComment(comment.text);
                if (!analysis) {
                    GLOBAL_STATS.filteredComments += 1;
                    return;
                }

                const username = comment.user.username;
                const userCommentCount = incrementUserCommentCount(username);
                const baseIntentScore = Number(analysis.intent_score || 0);
                const boost = userCommentCount > 1
                    ? Math.min(userCommentCount / 3, 1) * 0.2
                    : 0;
                const boostedIntentScore = Math.min(1, Math.max(0, baseIntentScore + boost));
                const cached = getEnrichmentCache(username);
                const followerBucket = cached?.follower_bucket ?? cached?.followerBucket ?? null;
                const followerCount = cached?.follower_count ?? cached?.followers ?? cached?.followerCount ?? null;
                const engagementRatio = cached?.engagement_proxy ?? null;
                const leadScoring = computeLeadScore(boostedIntentScore, followerCount, comment.text);
                const isPromoterSpam = analysis.intent === 'PROMOTER_SPAM';
                const isLead = isPromoterSpam ? false : isLeadQualified(leadScoring.category);
                updateGlobalStats(analysis, isPromoterSpam ? 'LOW' : leadScoring.category);
                adaptScrapingBasedOnLeadRatio();

                const profileUrl = `https://www.instagram.com/${username}/`;
                const leadType = classifyLeadType(comment.text, analysis);
                const commercialScore = estimateCommercialValue({
                    username,
                    bio: cached?.bio ?? '',
                    followerCount,
                    engagementRatio
                });
                const record = {
                    postUrl: originalUrl,
                    source_shortcode: shortcode,
                    username,
                    text: comment.text,
                    intent: analysis.intent,
                    intent_score: boostedIntentScore,
                    detected_language: analysis.language,
                    is_lead: leadType === 'PROMOTER_SPAM' ? false : isLead,
                    keywords: analysis.keywords,
                    leadScore: leadScoring.category,
                    lead_type: leadType,
                    commercial_score: commercialScore,
                    audience_qualification: cached?.audience_qualification ?? null,
                    user_comment_count: userCommentCount,
                    profileUrl,
                    likeCount: comment.comment_like_count,
                    postedAt: new Date(comment.created_at * 1000).toISOString(),
                    extractedAt: new Date().toISOString()
                };

                if (config.enrichLeads && boostedIntentScore > 0.5 && !cached) {
                    if (shouldStopEarly()) {
                        return;
                    }
                    await requestQueue.addRequest({
                        url: profileUrl,
                        uniqueKey: `enrich:${comment.id ?? username}:${shortcode}`,
                        userData: {
                            isEnrichment: true,
                            commentData: record,
                            intent_score: boostedIntentScore
                        }
                    });
                    return;
                }

                if (cached) {
                    const scoring = computeLeadScore(boostedIntentScore, followerCount, comment.text);
                    record.leadScore = scoring.category;
                    record.is_lead = record.intent === 'PROMOTER_SPAM'
                        ? false
                        : isLeadQualified(scoring.category);
                    record.audience_qualification = cached.audience_qualification ?? null;
                }
                if (!meetsMinLeadScore(record.leadScore, config.minLeadScore)) {
                    GLOBAL_STATS.filteredComments += 1;
                    return;
                }
                if (shouldNotifyWebhook(record)) {
                    void WEBHOOK_DISPATCHER?.enqueue(record);
                }
                updateLeadValueStats(record);
                updateDatasetSizeEstimate(record);
                await Dataset.pushData(record);
            }

            function adaptScrapingBasedOnLeadRatio() {
                const leadRatio = GLOBAL_STATS.totalComments > 0
                    ? GLOBAL_STATS.totalLeads / GLOBAL_STATS.totalComments
                    : 0;

                if (!adaptiveIncreased && leadRatio < 0.01) {
                    adaptiveIncreased = true;
                    maxComments = Math.max(1, maxComments * 2);
                    log.info(`Adaptive scraping: lead ratio ${(leadRatio * 100).toFixed(2)}% < 1%. Increasing maxComments to ${maxComments}.`);
                }

                if (leadRatio > 0.10 && !EARLY_STOP_REACHED) {
                    EARLY_STOP_REACHED = true;
                    log.info(`Adaptive scraping: lead ratio ${(leadRatio * 100).toFixed(2)}% > 10%. Early stop enabled.`);
                }
            }
        }
    },

    failedRequestHandler({ request }, error) {
        log.error(`Request failed: ${request.url} - ${error.message}`);
    },
});

await crawler.run();
await generateSummary();
    await Actor.exit();
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain && process.env.NODE_ENV !== 'test') {
    runActor().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

// 1. Load recent posts from a profile and enqueue them
async function handleProfile(page, queue, limit) {
    try {
        const links = new Set();
        let stagnantRounds = 0;

        while (links.size < limit && stagnantRounds < 3) {
            const batch = await page.evaluate(() => {
                const anchors = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
                return anchors.map(a => a.href);
            });

            const before = links.size;
            for (const link of batch) links.add(link);

            if (links.size === before) {
                stagnantRounds += 1;
            } else {
                stagnantRounds = 0;
            }

            if (links.size >= limit) break;

            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await randomDelay(800, 1600, page);
        }

        const selected = Array.from(links).slice(0, limit);
        log.info(`Found ${selected.length} posts on profile.`);

        for (const link of selected) {
            if (shouldStopEarly()) {
                log.info('Early stop reached. Skipping remaining profile posts.');
                break;
            }
            await queue.addRequest({
                url: link,
                uniqueKey: link,
                userData: { type: 'post', originalUrl: link }
            });
            await randomDelay(300, 700);
        }
    } catch (e) {
        log.error(`Error while processing profile: ${e.message}`);
    }
}


// Enrichment: Fetch follower count from profile and attach to the comment record
async function handleEnrichment(page, commentData) {
    const followerCount = await extractFollowerCount(page);
    const followerBucket = bucketFollowerCount(followerCount);
    const intentScore = typeof commentData?.intent_score === 'number'
        ? commentData.intent_score
        : typeof commentData?.intentScore === 'number'
            ? commentData.intentScore / 100
            : 0;
    const engagementProxy = getEngagementProxy(commentData?.likeCount, followerCount);
    const profileSignals = await extractProfileSignals(page);
    const bioText = buildProfileBio(profileSignals);
    const leadScoring = computeLeadScore(intentScore, followerCount, commentData?.text || '');
    const isLead = commentData?.intent === 'PROMOTER_SPAM'
        ? false
        : isLeadQualified(leadScoring.category);

    if (followerCount === null) {
        log.warning(`Follower count not found: ${page.url()}`);
    }

    const audienceQualification = buildAudienceQualification(followerCount, engagementProxy);
    const commercialScore = estimateCommercialValue({
        username: commentData?.username,
        bio: bioText,
        followerCount,
        engagementRatio: engagementProxy
    });
    const cachePayload = {
        follower_bucket: followerBucket ?? null,
        audience_qualification: audienceQualification,
        engagement_proxy: engagementProxy,
        follower_count: followerCount ?? null,
        commercial_score: commercialScore,
        bio: bioText
    };

    if (commentData?.username) {
        setEnrichmentCache(commentData.username, cachePayload);
    }

    const outputRecord = {
        ...(commentData || {}),
        is_lead: isLead,
        leadScore: leadScoring.category,
        audience_qualification: audienceQualification,
        commercial_score: commercialScore,
        extractedAt: commentData?.extractedAt || new Date().toISOString()
    };

    if (!meetsMinLeadScore(outputRecord.leadScore, config.minLeadScore)) {
        GLOBAL_STATS.filteredComments += 1;
        return;
    }
    if (shouldNotifyWebhook(outputRecord)) {
        void WEBHOOK_DISPATCHER?.enqueue(outputRecord);
    }

    updateLeadValueStats(outputRecord);
    updateDatasetSizeEstimate(outputRecord);
    await Dataset.pushData(outputRecord);
}

async function extractProfileSignals(page) {
    return await page.evaluate(() => {
        const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
        const ogDescription = document.querySelector('meta[property="og:description"]')?.content || '';
        let ldDescription = '';
        const ldJson = document.querySelector('script[type="application/ld+json"]')?.textContent;
        if (ldJson) {
            try {
                const parsed = JSON.parse(ldJson);
                if (parsed && typeof parsed.description === 'string') {
                    ldDescription = parsed.description;
                }
            } catch {
                ldDescription = '';
            }
        }
        const headerText = document.querySelector('header')?.innerText || '';
        const externalUrl = document.querySelector('header a[href^="http"]')?.getAttribute('href') || '';
        return {
            metaDescription,
            ogDescription,
            ldDescription,
            headerText,
            externalUrl
        };
    });
}

function buildProfileBio(signals) {
    if (!signals) return '';
    const parts = [signals.headerText, signals.ldDescription, signals.metaDescription, signals.ogDescription, signals.externalUrl]
        .filter(Boolean)
        .map((value) => String(value));
    return parts.join(' ').trim();
}

async function extractFollowerCount(page) {
    const metaText = await page.evaluate(() => {
        const og = document.querySelector('meta[property="og:description"]')?.content;
        const desc = document.querySelector('meta[name="description"]')?.content;
        return og || desc || null;
    });

    const fromMeta = parseFollowerCount(metaText);
    if (fromMeta !== null) return fromMeta;

    const html = await page.content();
    const edgeMatch = html.match(/"edge_followed_by":\{"count":(\d+)\}/);
    if (edgeMatch) return Number(edgeMatch[1]);

    const altMatch = html.match(/"follower_count":(\d+)/);
    if (altMatch) return Number(altMatch[1]);

    return null;
}

function parseFollowerCount(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/([0-9.,]+)\s*([km])?\s*(followers?)/i);
    if (!match) return null;

    const raw = match[1];
    const unit = match[2]?.toLowerCase();
    let value;

    if (raw.includes(',') && !raw.includes('.') && unit) {
        value = Number(raw.replace(',', '.'));
    } else {
        value = Number(raw.replace(/,/g, ''));
    }

    if (Number.isNaN(value)) return null;

    if (unit === 'k') value *= 1000;
    if (unit === 'm') value *= 1000000;

    return Math.round(value);
}

function bucketFollowerCount(count) {
    if (typeof count !== 'number' || Number.isNaN(count)) return null;
    if (count < 1000) return '<1k';
    if (count < 10000) return '1k-10k';
    if (count < 100000) return '10k-100k';
    return '100k+';
}

function getEngagementProxy(likeCount, followerCount) {
    const likes = Number(likeCount);
    const followers = Number(followerCount);
    if (!Number.isFinite(likes) || !Number.isFinite(followers) || followers <= 0) return null;
    const ratio = likes / followers;
    if (!Number.isFinite(ratio)) return null;
    return Math.round(ratio * 100000) / 100000;
}

function buildAudienceQualification(followerCount, engagementRatio) {
    const followers = Number.isFinite(followerCount) ? Math.round(Number(followerCount)) : null;
    const bucket = bucketFollowerCount(followers);
    const engagement = Number.isFinite(engagementRatio) ? Number(engagementRatio) : null;

    let tier = 'LOW_VALUE_AUDIENCE';
    if (followers !== null && followers > 10000 && (engagement ?? 0) > 0.02) {
        tier = 'HIGH_VALUE_AUDIENCE';
    } else if (followers !== null && followers > 1000) {
        tier = 'MID_VALUE_AUDIENCE';
    }

    return {
        followers,
        bucket,
        tier
    };
}

function isLeadQualified(leadScoreCategory) {
    if (leadScoreCategory === null || leadScoreCategory === undefined) return false;
    if (typeof leadScoreCategory === 'number') return leadScoreCategory >= 0.4;

    const normalized = String(leadScoreCategory).trim().toUpperCase();
    return normalized === 'MEDIUM' || normalized === 'HIGH';
}

async function randomDelay(minMs, maxMs, page) {
    const min = Number.isFinite(minMs) ? minMs : 0;
    const max = Number.isFinite(maxMs) ? maxMs : min;
    const delay = Math.max(min, Math.floor(min + Math.random() * (max - min)));

    if (page && typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(delay);
        return;
    }

    await new Promise(r => setTimeout(r, delay));
}

function parseScrapeSince(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        log.warning('Invalid scrapeSince date. Delta mode disabled.');
        return null;
    }
    return Math.floor(date.getTime() / 1000);
}

function getCommentDedupKey(comment, shortcode) {
    const username = comment?.user?.username || '';
    const text = comment?.text || '';
    const base = `${shortcode || ''}|${username}|${text}`;
    return `dedupe:${crypto.createHash('sha1').update(base).digest('hex')}`;
}

function isDuplicateComment(key) {
    if (SEEN_COMMENT_KEYS.has(key)) return true;
    SEEN_COMMENT_KEYS.add(key);
    if (SEEN_COMMENT_KEYS.size > MAX_DEDUPE_SIZE) {
        SEEN_COMMENT_KEYS.clear();
    }
    return false;
}

function getLlmConfig() {
    const apiKey = process.env.LEAD_LLM_API_KEY || process.env.OPENAI_API_KEY || null;
    const rawEndpoint = process.env.LEAD_LLM_ENDPOINT || process.env.OPENAI_BASE_URL || null;
    const endpoint = rawEndpoint
        ? (rawEndpoint.endsWith('/chat/completions')
            ? rawEndpoint
            : `${rawEndpoint.replace(/\/$/, '')}/chat/completions`)
        : 'https://api.openai.com/v1/chat/completions';
    const model = process.env.LEAD_LLM_MODEL || 'gpt-4o-mini';
    const maxRequests = Number(process.env.LEAD_LLM_MAX_REQUESTS || 25);
    const timeoutMs = Number(process.env.LEAD_LLM_TIMEOUT_MS || 8000);
    const minChars = Number(process.env.LEAD_LLM_MIN_CHARS || 6);
    const batchSize = Number(process.env.LEAD_LLM_BATCH_SIZE || 6);
    const batchWaitMs = Number(process.env.LEAD_LLM_BATCH_WAIT_MS || 150);
    const maxParallel = Number(process.env.LEAD_LLM_MAX_PARALLEL || 1);
    const minIntervalMs = Number(process.env.LEAD_LLM_MIN_INTERVAL_MS || 400);

    const enabled = Boolean(apiKey);
    if (enabled) {
        log.info(`LLM fallback enabled. Max requests: ${maxRequests}`);
    }

    return {
        enabled,
        apiKey,
        endpoint,
        model,
        maxRequests,
        timeoutMs,
        minChars,
        batchSize: Math.max(1, batchSize),
        batchWaitMs: Math.max(50, batchWaitMs),
        maxParallel: Math.max(1, maxParallel),
        minIntervalMs: Math.max(0, minIntervalMs)
    };
}

// 2. Find or calculate Media ID from the page
async function getMediaId(page, shortcode, appId) {
    // First attempt: parse via URL-based conversion (JS side)
    // If that fails, try in-page context via API call.
    // On Instagram, MediaID is often stored in <meta property="al:ios:url"> as "instagram://media?id=..."

    return await page.evaluate(async ({ code, id }) => {
        // Method A: Meta tag
        const iosMeta = document.querySelector('meta[property="al:ios:url"]');
        if (iosMeta) {
            const match = iosMeta.content.match(/id=(\d+)/);
            if (match) return match[1];
        }

        // Method B: JS Shortcode -> MediaID (simple version)
        // This is complex, so use the API directly:
        try {
            // Small trick: oEmbed endpoint is publicly accessible
            const resp = await fetch(`https://www.instagram.com/api/v1/oembed/?url=https://www.instagram.com/p/${code}/`);
            const data = await resp.json();
            return data.media_id; // "3234..."
        } catch (e) { return null; }

    }, { code: shortcode, id: appId });
}

// 3. Fetch comments via internal API (streaming pagination)
async function* fetchCommentsIterator(page, { mediaId, appId, scrapeSince, maxPages }) {
    let nextMinId = null;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore) {
        if (Number.isFinite(maxPages) && maxPages > 0 && pageCount >= maxPages) break;
        pageCount += 1;

        const pageResult = await fetchCommentsPage(page, {
            mediaId,
            appId,
            minId: nextMinId,
            scrapeSince
        });

        if (!pageResult) break;
        const { comments, nextMinId: nextCursor, hasMore: pageHasMore, stopDueToDelta } = pageResult;
        yield comments || [];

        if (stopDueToDelta) break;
        if (!pageHasMore || !nextCursor) break;

        nextMinId = nextCursor;
        await randomDelay(800, 1500, page);
    }
}

async function fetchCommentsPage(page, { mediaId, appId, minId, scrapeSince }) {
    return await page.evaluate(async ({ mediaId, appId, minId, scrapeSince }) => {
        try {
            let url = `https://www.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true`;
            if (minId) url += `&min_id=${encodeURIComponent(minId)}`;

            const response = await fetch(url, {
                headers: {
                    'X-IG-App-ID': appId,
                    'X-Requested-With': 'XMLHttpRequest',
                }
            });

            if (!response.ok) {
                return { comments: [], nextMinId: null, hasMore: false, stopDueToDelta: false };
            }

            const data = await response.json();
            const comments = data.comments || [];
            const sinceTs = typeof scrapeSince === 'number' ? scrapeSince : null;

            const collected = [];
            let stopDueToDelta = false;

            for (const c of comments) {
                if (sinceTs && typeof c.created_at === 'number' && c.created_at < sinceTs) {
                    stopDueToDelta = true;
                    break;
                }

                collected.push({
                    id: c.pk,
                    text: c.text,
                    user: {
                        username: c.user.username,
                        full_name: c.user.full_name,
                        id: c.user.pk
                    },
                    created_at: c.created_at,
                    comment_like_count: c.comment_like_count || 0
                });
            }

            return {
                comments: collected,
                nextMinId: data.next_min_id || null,
                hasMore: Boolean(data.next_min_id),
                stopDueToDelta
            };
        } catch {
            return { comments: [], nextMinId: null, hasMore: false, stopDueToDelta: false };
        }
    }, { mediaId, appId, minId, scrapeSince });
}

// Sampling helpers removed in favor of streaming selection.


// 4. Lead Keyword Analysis
function hasIntentSignal(text) {
    if (!text) return false;
    const promo = detectPromoterSpam(text);
    if (promo.isSpam) return true;
    const result = scoreIntentMatches(text, INTENT_MATCHERS);
    return result.intent !== 'RANDOM' && result.intent_score > 0;
}

function filterComment(commentText) {
    if (!commentText || typeof commentText !== 'string') return false;
    const trimmed = commentText.trim();
    if (!trimmed) return false;
    if (trimmed.length < 3) return false;

    // Only mentions or hashtags
    const mentionHashRemainder = trimmed
        .replace(/[@#][\w-]+/g, '')
        .replace(/\s+/g, '')
        .trim();
    if (!mentionHashRemainder) return false;

    // Only emojis
    const emojiRemainder = trimmed
        .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
        .replace(/\s+/g, '')
        .trim();
    if (!emojiRemainder) return false;

    return true;
}

function isLowSignalComment(text) {
    if (!filterComment(text)) return true;
    const trimmed = text.trim();

    const normalized = trimmed.toLowerCase();
    if (hasIntentSignal(normalized)) return false;

    const cleaned = normalized
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[@#][\w-]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) return true;
    if (LOW_SIGNAL_PHRASES.has(cleaned)) return true;
    if (/^(.)\1{3,}$/.test(cleaned)) return true;
    if (/^[\d\W_]+$/.test(cleaned)) return true;

    const alphaCount = cleaned.replace(/[^a-zA-Z]/g, '').length;
    if (alphaCount === 0 && !/\d/.test(cleaned)) return true;
    const tokens = TOKENIZER.tokenize(cleaned);
    if (cleaned.length <= 4 && alphaCount <= 2 && tokens.length <= 1) return true;

    return false;
}

function scoreIntentMatches(text, matchers) {
    const normalized = String(text || '').toLowerCase();
    const intents = matchers && typeof matchers === 'object' ? matchers : {};

    let bestIntent = 'RANDOM';
    let bestScore = 0;
    let bestKeywords = [];

    for (const [intent, config] of Object.entries(intents)) {
        const entries = config?.entries || [];
        const maxWeight = Number(config?.maxWeight) || 0;
        if (entries.length === 0 || maxWeight <= 0) {
            if (intent === 'RANDOM' && bestScore === 0) {
                bestIntent = 'RANDOM';
                bestKeywords = [];
            }
            continue;
        }

        let total = 0;
        const matched = [];
        for (const entry of entries) {
            if (!entry || !entry.matcher) continue;
            if (matchesKeyword(normalized, entry.matcher)) {
                total += entry.weight;
                matched.push(entry.keyword);
            }
        }

        const score = Math.min(1, total / maxWeight);
        if (score > bestScore) {
            bestScore = score;
            bestIntent = intent;
            bestKeywords = matched;
        } else if (score === bestScore && score > 0) {
            if (INTENT_PRIORITY.indexOf(intent) < INTENT_PRIORITY.indexOf(bestIntent)) {
                bestIntent = intent;
                bestKeywords = matched;
            }
        }
    }

    if (!INTENT_LABELS.has(bestIntent)) {
        bestIntent = 'RANDOM';
    }

    return {
        intent: bestIntent,
        intent_score: bestScore,
        keywords: bestKeywords
    };
}

function detectPromoterSpam(text) {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) return { isSpam: false, score: 0, keywords: [] };

    const keywords = new Set();
    let score = 0;
    let phraseHits = 0;

    for (const phrase of PROMOTER_SPAM_PHRASES) {
        if (phrase && normalized.includes(phrase)) {
            phraseHits += 1;
            keywords.add(phrase);
        }
    }

    if (phraseHits > 0) {
        score = Math.max(score, 0.7);
    }

    if (REFERRAL_PATTERN.test(normalized)) {
        keywords.add('referral');
        score = Math.max(score, 0.75);
    }

    const hasEthAddress = ETH_ADDRESS_PATTERN.test(text);
    const hasBase58Address = BASE58_ADDRESS_PATTERN.test(text) && CRYPTO_CONTEXT_PATTERN.test(normalized);
    if (hasEthAddress || hasBase58Address) {
        keywords.add('crypto_address');
        score = Math.max(score, 0.9);
    }

    const promoVerbMatches = normalized.match(/\b(follow|check|like|subscribe|dm|message|link|bio|promo|code|ref|referral|invite|join|signup|sign up|register|giveaway|airdrop)\b/gi) || [];
    const verbCounts = new Map();
    for (const match of promoVerbMatches) {
        const key = match.toLowerCase();
        verbCounts.set(key, (verbCounts.get(key) || 0) + 1);
    }
    const hasRepeatedVerb = Array.from(verbCounts.values()).some((count) => count >= 2);
    const hasRepeatedPromo = hasRepeatedVerb || promoVerbMatches.length >= 3;

    if (hasRepeatedPromo) {
        keywords.add('repeated_promo');
        score = Math.max(score, 0.8);
    }

    if (phraseHits >= 2) {
        score = Math.min(1, score + 0.05);
    }

    return {
        isSpam: score > 0,
        score,
        keywords: Array.from(keywords)
    };
}

function matchesKeyword(text, matcher) {
    if (!matcher || !text) return false;
    if (matcher.type === 'question_mark') return text.includes('?');
    if (matcher.type === 'regex') return matcher.regex.test(text);
    return text.includes(matcher.token);
}

function buildIntentMatchers(weightsByIntent) {
    const matchers = {};
    const intentEntries = weightsByIntent && typeof weightsByIntent === 'object'
        ? weightsByIntent
        : {};

    for (const [intent, weights] of Object.entries(intentEntries)) {
        const entries = [];
        let maxWeight = 0;

        if (weights && typeof weights === 'object') {
            for (const [keyword, weight] of Object.entries(weights)) {
                const normalized = normalizeKeyword(keyword);
                if (!normalized) continue;
                const numericWeight = Math.max(0, Math.min(1, Number(weight) || 0));
                const matcher = createKeywordMatcher(normalized);
                if (!matcher) continue;
                entries.push({
                    keyword: normalized,
                    weight: numericWeight,
                    matcher
                });
                maxWeight += numericWeight;
            }
        }

        matchers[intent] = {
            entries,
            maxWeight
        };
    }

    return matchers;
}

function createKeywordMatcher(keyword) {
    const normalized = normalizeKeyword(keyword);
    if (!normalized) return null;
    if (normalized === '?') return { type: 'question_mark' };

    const isShort = normalized.length <= 3;
    const isAsciiWord = /^[a-z0-9]+$/.test(normalized);
    if (isShort && isAsciiWord) {
        return {
            type: 'regex',
            regex: new RegExp(`(^|\\W)${escapeRegExp(normalized)}(\\W|$)`, 'i')
        };
    }

    return {
        type: 'includes',
        token: normalized
    };
}

function normalizeKeyword(keyword) {
    return String(keyword || '').trim().toLowerCase();
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classifyIntentHeuristic(text) {
    const promo = detectPromoterSpam(text);
    const result = scoreIntentMatches(text, INTENT_MATCHERS);
    let intent = result.intent;
    let intentScore = Math.max(0, Math.min(1, Number(result.intent_score) || 0));
    let keywords = result.keywords;

    if (promo.isSpam) {
        intent = 'PROMOTER_SPAM';
        intentScore = Math.max(intentScore, promo.score);
        keywords = Array.from(new Set([...(keywords || []), ...promo.keywords]));
    }

    return {
        intent,
        score: Math.round(intentScore * 100),
        intent_score: intentScore,
        keywords,
        confidence: intentScore,
        source: 'heuristic',
        language: detectLanguage(text)
    };
}

function shouldUseLLMFallback(text, heuristic) {
    if (!LLM_CONFIG || !LLM_CONFIG.enabled) return false;
    if (LLM_STATE.requestsMade >= LLM_CONFIG.maxRequests) return false;
    if (!text || text.length < LLM_CONFIG.minChars) return false;
    if (heuristic.intent === 'PROMOTER_SPAM') return false;
    if (heuristic.intent !== 'RANDOM' && heuristic.intent_score >= 0.7) return false;
    return true;
}

async function classifyIntentWithLLM(text, language) {
    if (!LLM_CONFIG || !LLM_CONFIG.enabled) return null;
    if (!LLM_BATCHER) return null;
    return await LLM_BATCHER.enqueue({ text, language });
}

function mergeIntentResults(heuristic, llmResult) {
    if (!llmResult) return heuristic;
    if (heuristic.intent === 'RANDOM') return llmResult;

    if ((llmResult.intent_score || 0) > (heuristic.intent_score || 0) + 0.15) {
        const mergedKeywords = new Set([...(heuristic.keywords || []), ...(llmResult.keywords || [])]);
        return {
            ...llmResult,
            keywords: Array.from(mergedKeywords)
        };
    }

    return heuristic;
}

function classifyLeadType(commentText, analysis) {
    const promoSignal = detectPromoterSpam(commentText);
    if (promoSignal.isSpam) return 'PROMOTER_SPAM';

    switch (analysis?.intent) {
        case 'BUY_INTENT':
            return 'BUY_INTENT';
        case 'QUESTION':
            return 'QUESTION';
        case 'PROMOTER_SPAM':
            return 'PROMOTER_SPAM';
        default:
            return 'RANDOM';
    }
}

async function analyzeComment(text) {
    if (!text || typeof text !== 'string') return null;

    const cached = getIntentCache(text);
    if (cached) return cached;

    const heuristic = classifyIntentHeuristic(text);
    let finalResult = heuristic;

    if (shouldUseLLMFallback(text, heuristic)) {
        const llmResult = await classifyIntentWithLLM(text, heuristic.language);
        if (llmResult) {
            GLOBAL_STATS.llmClassifications += 1;
        }
        finalResult = mergeIntentResults(heuristic, llmResult);
    }

    const result = {
        ...finalResult
    };
    setIntentCache(text, result);
    return result;
}

function detectLanguage(text) {
    const raw = String(text || '');
    if (!raw.trim()) return 'unknown';

    const scriptLang = detectLanguageByScript(raw);
    if (scriptLang) return scriptLang;

    const stopwordLang = detectLanguageByStopwords(raw);
    if (stopwordLang) return stopwordLang;

    const fastTextLang = detectLanguageWithFastText(raw);
    if (fastTextLang) return fastTextLang;

    return 'unknown';
}

function detectLanguageByScript(text) {
    const totalLetters = (text.match(/\p{L}/gu) || []).length;
    if (totalLetters === 0) return null;

    const scripts = [
        { lang: 'hi', regex: /[\u0900-\u097F]/g },
        { lang: 'ar', regex: /[\u0600-\u06FF]/g },
        { lang: 'ru', regex: /[\u0400-\u04FF]/g },
        { lang: 'zh', regex: /[\u4E00-\u9FFF]/g },
        { lang: 'ja', regex: /[\u3040-\u30FF]/g },
        { lang: 'ko', regex: /[\uAC00-\uD7AF]/g },
        { lang: 'th', regex: /[\u0E00-\u0E7F]/g }
    ];

    let best = null;
    let bestRatio = 0;

    for (const script of scripts) {
        const count = (text.match(script.regex) || []).length;
        if (count === 0) continue;
        const ratio = count / totalLetters;
        if (ratio > bestRatio) {
            bestRatio = ratio;
            best = script.lang;
        }
    }

    if (best && (bestRatio >= 0.2 || totalLetters <= 12)) return best;
    return null;
}

function detectLanguageByStopwords(text) {
    const tokens = (text.toLowerCase().match(/\p{L}+/gu) || []).filter(Boolean);
    if (tokens.length === 0) return null;

    const scores = {};
    for (const [lang, stopwords] of Object.entries(LANGUAGE_STOPWORDS)) {
        let count = 0;
        for (const token of tokens) {
            if (stopwords.has(token)) count += 1;
        }
        scores[lang] = count / tokens.length;
    }

    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) return null;
    const [bestLang, bestScore] = ranked[0];
    const secondScore = ranked[1]?.[1] ?? 0;

    if (bestScore >= 0.08 && bestScore - secondScore >= 0.02) {
        return bestLang;
    }

    return null;
}

function detectLanguageWithFastText(text) {
    if (!LANGUAGE_CONFIG?.enableFastText) return null;
    if (!process.env.FASTTEXT_BIN || !process.env.FASTTEXT_MODEL) return null;
    if (text.length < (LANGUAGE_CONFIG.fastTextMinChars || 0)) return null;

    try {
        const result = spawnSync(
            process.env.FASTTEXT_BIN,
            ['predict', process.env.FASTTEXT_MODEL, '-'],
            {
                input: text,
                encoding: 'utf8',
                timeout: LANGUAGE_CONFIG.fastTextTimeoutMs || 2000,
                maxBuffer: 1024 * 1024
            }
        );

        if (result.error || result.status !== 0) return null;
        const output = String(result.stdout || '').trim();
        if (!output) return null;

        const label = output.split(/\s+/)[0] || '';
        if (!label.startsWith('__label__')) return null;
        const lang = label.replace('__label__', '').trim();
        if (!lang) return null;
        return lang.toLowerCase();
    } catch {
        return null;
    }
}

const LANGUAGE_STOPWORDS = {
    en: new Set(['the', 'and', 'for', 'with', 'this', 'that', 'you', 'your', 'are', 'was', 'were', 'from', 'have', 'has', 'not', 'but', 'what', 'how', 'where', 'why', 'when']),
    es: new Set(['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'por', 'para', 'con', 'como', 'donde', 'cuando', 'por', 'qué', 'qué', 'cuál', 'cual', 'porque']),
    tr: new Set(['ve', 'bir', 'bu', 'da', 'de', 'ne', 'mi', 'mı', 'mu', 'mü', 'ile', 'icin', 'için', 'çok', 'cok', 'ben', 'sen', 'siz', 'biz', 'var', 'yok']),
    hi: new Set(['और', 'का', 'की', 'के', 'यह', 'वह', 'क्या', 'कैसे', 'कहाँ', 'कब', 'क्यों', 'मुझे', 'आप', 'हम', 'है', 'थे', 'थे'])
};


function createLlmBatcher(config) {
    if (!config || !config.enabled) return null;

    const queue = [];
    let flushTimer = null;
    let activeBatches = 0;

    const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            void flushQueue();
        }, config.batchWaitMs);
    };

    const enqueue = ({ text, language }) => {
        if (!config.enabled) return Promise.resolve(null);
        if (LLM_STATE.requestsMade + LLM_STATE.pendingBatches >= config.maxRequests) {
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            const id = typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : crypto.randomBytes(12).toString('hex');
            queue.push({ id, text, language, resolve });
            if (queue.length >= config.batchSize) {
                void flushQueue();
            } else {
                scheduleFlush();
            }
        });
    };

    const flushQueue = async () => {
        if (activeBatches >= config.maxParallel) return;
        if (queue.length === 0) return;

        const batch = queue.splice(0, config.batchSize);
        activeBatches += 1;
        LLM_STATE.pendingBatches += 1;

        try {
            await enforceLlmRateLimit(config);
            LLM_STATE.requestsMade += 1;
            LLM_STATE.lastRequestAt = Date.now();
            const results = await sendLlmBatch(config, batch);
            for (const item of batch) {
                item.resolve(results[item.id] || null);
            }
        } catch (e) {
            for (const item of batch) {
                item.resolve(null);
            }
        } finally {
            LLM_STATE.pendingBatches = Math.max(0, LLM_STATE.pendingBatches - 1);
            activeBatches = Math.max(0, activeBatches - 1);
            if (queue.length > 0) {
                void flushQueue();
            }
        }
    };

    return { enqueue };
}

async function enforceLlmRateLimit(config) {
    const now = Date.now();
    const waitMs = Math.max(0, config.minIntervalMs - (now - LLM_STATE.lastRequestAt));
    if (waitMs > 0) {
        await new Promise(r => setTimeout(r, waitMs));
    }
}

async function sendLlmBatch(config, batch) {
    const inputMap = new Map(batch.map(item => [item.id, item]));
    const items = batch.map(item => ({
        id: item.id,
        language: item.language || 'unknown',
        text: item.text
    }));

    const prompt = {
        model: config.model,
        temperature: 0,
        max_tokens: 250,
        messages: [
            {
                role: 'system',
                content: 'You are an intent classifier for Instagram comments. Return ONLY JSON array with items: {id, intent (BUY_INTENT|QUESTION|COMPLAINT|PROMOTER_SPAM|RANDOM), intent_score (0-1), keywords (array)}.'
            },
            {
                role: 'user',
                content: JSON.stringify(items)
            }
        ]
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
        const response = await fetch(config.endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(prompt),
            signal: controller.signal
        });

        if (!response.ok) return {};
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
        if (!content) return {};

        const jsonStart = content.indexOf('[');
        const jsonEnd = content.lastIndexOf(']');
        if (jsonStart == -1 || jsonEnd == -1) return {};

        const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
        if (!Array.isArray(parsed)) return {};

        const results = {};
        for (const item of parsed) {
            if (!item || typeof item.id !== 'string' || typeof item.intent !== 'string') continue;
            const intent = item.intent.toUpperCase();
            if (!INTENT_LABELS.has(intent)) continue;

            const intentScore = Math.max(0, Math.min(1, Number(item.intent_score) || 0));
            const keywords = Array.isArray(item.keywords) ? item.keywords.map(k => String(k).trim()).filter(Boolean) : [];
            const sourceText = inputMap.get(item.id)?.text || '';
            results[item.id] = {
                intent,
                score: Math.round(intentScore * 100),
                intent_score: intentScore,
                keywords,
                confidence: intentScore,
                source: 'llm',
                language: detectLanguage(sourceText)
            };
        }
        return results;
    } catch (e) {
        return {};
    } finally {
        clearTimeout(timeout);
    }
}

function updateGlobalStats(analysis, leadCategory) {
    GLOBAL_STATS.totalComments += 1;
    if (leadCategory === 'HIGH' || leadCategory === 'MEDIUM') {
        GLOBAL_STATS.totalLeads += 1;
    }

    const intentKey = analysis.intent || 'RANDOM';
    GLOBAL_STATS.intentBreakdown[intentKey] = (GLOBAL_STATS.intentBreakdown[intentKey] || 0) + 1;

    if (Array.isArray(analysis.keywords)) {
        for (const keyword of analysis.keywords) {
            const normalized = String(keyword || '').trim().toLowerCase();
            if (!normalized) continue;
            const current = GLOBAL_STATS.keywordCounts.get(normalized) || 0;
            GLOBAL_STATS.keywordCounts.set(normalized, current + 1);
        }
    }
}

function updateLeadValueStats(record) {
    if (!record || !record.is_lead) return;
    if (record.leadScore === 'HIGH') {
        GLOBAL_STATS.highIntentLeads += 1;
        if (!EARLY_STOP_REACHED && GLOBAL_STATS.highIntentLeads >= TARGET_LEAD_COUNT) {
            EARLY_STOP_REACHED = true;
            log.info(`Early stop triggered after reaching ${GLOBAL_STATS.highIntentLeads} high-intent leads.`);
        }
    }
    const tier = record?.audience_qualification?.tier;
    if (tier === 'HIGH_VALUE_AUDIENCE') {
        GLOBAL_STATS.highValueLeads += 1;
    }
}

function shouldStopEarly() {
    if (TARGET_LEAD_COUNT === null || TARGET_LEAD_COUNT === undefined) return false;
    if (!Number.isFinite(TARGET_LEAD_COUNT) || TARGET_LEAD_COUNT <= 0) return false;
    return EARLY_STOP_REACHED || COST_GUARD_TRIGGERED;
}

function updateDatasetSizeEstimate(record) {
    if (!record) return;
    try {
        const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
        if (!Number.isFinite(bytes) || bytes <= 0) return;
        DATASET_AVG_RECORD_BYTES = Math.max(DEFAULT_DATASET_BYTES_PER_RECORD, Math.round(((DATASET_AVG_RECORD_BYTES * 9) + bytes) / 10));
    } catch {
        return;
    }
}

function estimateRemainingComments(processedCount, maxComments) {
    const processed = Math.max(0, Number(processedCount) || 0);
    const maxTotal = Math.max(0, Number(maxComments) || 0);
    if (maxTotal === 0) return 0;
    return Math.max(0, maxTotal - processed);
}

function checkCostGuard(processedCount, maxComments) {
    if (!Number.isFinite(COST_GUARD_LIMIT_BYTES) || COST_GUARD_LIMIT_BYTES <= 0) return false;
    if (COST_GUARD_TRIGGERED) return true;

    const remaining = estimateRemainingComments(processedCount, maxComments);
    const estimatedTotalBytes = Math.round((processedCount + remaining) * DATASET_AVG_RECORD_BYTES);
    if (estimatedTotalBytes > COST_GUARD_LIMIT_BYTES) {
        COST_GUARD_TRIGGERED = true;
        const estimatedMb = bytesToMb(estimatedTotalBytes).toFixed(2);
        const limitMb = bytesToMb(COST_GUARD_LIMIT_BYTES).toFixed(2);
        log.warning(`Cost guard triggered. Estimated dataset size ${estimatedMb} MB exceeds limit ${limitMb} MB. Aborting further scraping.`);
        return true;
    }
    return false;
}

function bytesToMb(bytes) {
    const value = Number(bytes) || 0;
    return value / (1024 * 1024);
}

async function generateSummary() {
    const topKeywords = Array.from(GLOBAL_STATS.keywordCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([keyword, count]) => ({ keyword, count }));

    const stats = {
        total_comments: GLOBAL_STATS.totalComments,
        leads_count: GLOBAL_STATS.totalLeads,
        high_intent_leads: GLOBAL_STATS.highIntentLeads,
        high_value_leads: GLOBAL_STATS.highValueLeads,
        intent_distribution: GLOBAL_STATS.intentBreakdown,
        top_keywords: topKeywords
    };

    const summary = {
        stats,
        totalComments: GLOBAL_STATS.totalComments,
        totalLeads: GLOBAL_STATS.totalLeads,
        highIntentLeads: GLOBAL_STATS.highIntentLeads,
        highValueLeads: GLOBAL_STATS.highValueLeads,
        intentBreakdown: GLOBAL_STATS.intentBreakdown,
        topKeywords,
        filteredComments: GLOBAL_STATS.filteredComments,
        duplicateComments: GLOBAL_STATS.duplicateComments,
        llmClassifications: GLOBAL_STATS.llmClassifications
    };

    const kv = await KeyValueStore.open();
    await kv.setValue('OUTPUT_ANALYTICS', summary);
    return summary;
}

function resetGlobalStats() {
    GLOBAL_STATS.totalComments = 0;
    GLOBAL_STATS.totalLeads = 0;
    GLOBAL_STATS.highValueLeads = 0;
    GLOBAL_STATS.highIntentLeads = 0;
    GLOBAL_STATS.intentBreakdown = {};
    GLOBAL_STATS.keywordCounts = new Map();
    GLOBAL_STATS.filteredComments = 0;
    GLOBAL_STATS.duplicateComments = 0;
    GLOBAL_STATS.llmClassifications = 0;
}

function resetEarlyStopState() {
    EARLY_STOP_REACHED = false;
    COST_GUARD_TRIGGERED = false;
    TARGET_LEAD_COUNT = DEFAULT_TARGET_LEAD_COUNT;
    COST_GUARD_LIMIT_BYTES = null;
    DATASET_AVG_RECORD_BYTES = DEFAULT_DATASET_BYTES_PER_RECORD;
}

function setTargetLeadCountForTests(value) {
    if (!Number.isFinite(value) || value <= 0) {
        TARGET_LEAD_COUNT = DEFAULT_TARGET_LEAD_COUNT;
        return;
    }
    TARGET_LEAD_COUNT = Math.floor(value);
}

function setCostGuardLimitBytesForTests(value) {
    if (!Number.isFinite(value) || value <= 0) {
        COST_GUARD_LIMIT_BYTES = null;
        return;
    }
    COST_GUARD_LIMIT_BYTES = Math.floor(value);
}

function setLanguageConfigForTests(value) {
    LANGUAGE_CONFIG = value || DEFAULT_LANGUAGE_DETECTION;
}

function setIntentMatchersForTests(matchers) {
    INTENT_MATCHERS = matchers || buildIntentMatchers(DEFAULT_INTENT_WEIGHTS);
}

function extractShortcode(url) {
    const match = url.match(/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
}

function validateInput(input) {
    const urls = normalizeTargetUrls(input.targetUrls || input.startUrls || []);
    const supportedUrls = urls.filter(isSupportedUrl);
    const rejectedUrls = urls.filter(u => !isSupportedUrl(u));
    if (rejectedUrls.length > 0) {
        log.warning(`Only Instagram post, reel, or profile URLs are supported. Skipped ${rejectedUrls.length} URL(s). Example: ${rejectedUrls[0]}`);
    }

    return {
        targetUrls: supportedUrls,
        sessionId: extractSessionId(input),
        scrapeSince: parseScrapeSince(input.scrapeSince),
        enrichLeads: Boolean(input.enrichLeads),
        intentWeights: normalizeIntentWeights(input.intentWeights),
        languageDetection: normalizeLanguageDetection(input.languageDetection),
        minLeadScore: normalizeMinLeadScore(input.minLeadScore),
        targetLeadCount: normalizeTargetLeadCount(input.targetLeadCount),
        webhookUrl: normalizeWebhookUrl(input.webhookUrl || input.webhook),
        webhookConfig: {
            ...WEBHOOK_DEFAULTS,
            ...(input.webhookConfig || {})
        },
        maxComments: normalizeMaxComments(input.maxComments),
        maxPages: normalizeMaxPages(input.maxPages),
        samplingMode: normalizeSamplingMode(input.samplingMode),
        samplingProbability: normalizeSamplingProbability(input.samplingProbability),
        minLikes: normalizeMinLikes(input.minLikes),
        maxPostsPerProfile: input.maxPostsPerProfile || DEFAULT_MAX_POSTS,
        userDefinedLimitMB: normalizeUserDefinedLimitMB(input.userDefinedLimitMB),
        proxyConfiguration: input.proxyConfiguration || {},
    };
}

function normalizeTargetUrls(value) {
    let urls = [];
    if (Array.isArray(value)) {
        urls = value
            .map((item) => {
                if (typeof item === 'string') return item;
                if (item && typeof item === 'object') return item.url || item.link || null;
                return null;
            })
            .filter(Boolean);
    } else if (typeof value === 'string') {
        urls = [value];
    } else if (value && typeof value === 'object' && value.url) {
        urls = [value.url];
    }

    return urls.map(u => u.trim()).filter(Boolean);
}

function normalizeIntentWeights(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch {
            return null;
        }
    }
    return null;
}

function normalizeLanguageDetection(value) {
    const base = { ...DEFAULT_LANGUAGE_DETECTION };
    if (!value) return base;
    if (typeof value !== 'object') return base;

    if (typeof value.enableFastText === 'boolean') base.enableFastText = value.enableFastText;
    if (Number.isFinite(value.fastTextMinChars)) {
        base.fastTextMinChars = Math.max(0, Number(value.fastTextMinChars));
    }
    if (Number.isFinite(value.fastTextTimeoutMs)) {
        base.fastTextTimeoutMs = Math.max(0, Number(value.fastTextTimeoutMs));
    }
    return base;
}

function normalizeMaxComments(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return DEFAULT_MAX_COMMENTS;
    return Math.floor(number);
}

function normalizeMaxPages(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return Math.floor(number);
}

function normalizeSamplingMode(value) {
    const normalized = String(value || DEFAULT_SAMPLING_MODE).trim().toUpperCase();
    if (normalized === 'ALL' || normalized === 'RANDOM' || normalized === 'TOP_LIKED') {
        return normalized;
    }
    return DEFAULT_SAMPLING_MODE;
}

function normalizeSamplingProbability(value) {
    if (value === null || value === undefined || value === '') return DEFAULT_SAMPLING_PROBABILITY;
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_SAMPLING_PROBABILITY;
    return Math.max(0, Math.min(1, number));
}

function normalizeMinLikes(value) {
    if (value === null || value === undefined || value === '') return DEFAULT_MIN_LIKES;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return DEFAULT_MIN_LIKES;
    return Math.floor(number);
}

function normalizeTargetLeadCount(value) {
    if (value === null || value === undefined || value === '') return DEFAULT_TARGET_LEAD_COUNT;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return DEFAULT_TARGET_LEAD_COUNT;
    return Math.floor(number);
}

function normalizeUserDefinedLimitMB(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return Math.max(1, number);
}

function normalizeLimitBytes(valueMb) {
    if (valueMb === null || valueMb === undefined) return null;
    const number = Number(valueMb);
    if (!Number.isFinite(number) || number <= 0) return null;
    return Math.round(number * 1024 * 1024);
}

function mergeIntentWeights(baseWeights, overrideWeights) {
    const base = baseWeights && typeof baseWeights === 'object' ? baseWeights : {};
    const overrides = overrideWeights && typeof overrideWeights === 'object' ? overrideWeights : null;
    if (!overrides) return base;

    const merged = {};
    const intents = new Set([...Object.keys(base), ...Object.keys(overrides)]);
    for (const intent of intents) {
        merged[intent] = {
            ...(base[intent] || {})
        };
        const overrideIntent = overrides[intent];
        if (overrideIntent && typeof overrideIntent === 'object') {
            for (const [keyword, weight] of Object.entries(overrideIntent)) {
                merged[intent][keyword] = weight;
            }
        }
    }
    return merged;
}

function isPostUrl(url) {
    return /instagram\.com\/(p|reel)\//i.test(url);
}

function isProfileUrl(url) {
    if (!isInstagramUrl(url)) return false;
    const match = url.match(/^https?:\/\/(www\.)?instagram\.com\/([^/?#]+)\/?(\?.*)?$/i);
    if (!match) return false;
    const slug = match[2].toLowerCase();
    const reserved = new Set([
        'p',
        'reel',
        'reels',
        'explore',
        'stories',
        'accounts',
        'about',
        'developer',
        'tags',
        'privacy',
        'terms',
        'api',
        'challenge',
        'directory'
    ]);
    return !reserved.has(slug);
}

function isInstagramUrl(url) {
    return /^https?:\/\/(www\.)?instagram\.com\//i.test(url);
}

function isSupportedUrl(url) {
    return isPostUrl(url) || isProfileUrl(url);
}

function getUrlType(url) {
    return isPostUrl(url) ? 'post' : 'profile';
}

function extractSessionId(input) {
    const direct = extractSessionIdFromString(input.sessionId);
    if (direct) return direct;

    const fromSessionCookie = extractSessionIdFromString(input.sessionCookie);
    if (fromSessionCookie) return fromSessionCookie;

    if (typeof input.cookie === 'string') {
        const fromCookie = extractSessionIdFromString(input.cookie);
        if (fromCookie) return fromCookie;
    }

    if (typeof input.cookies === 'string') {
        const fromCookiesString = extractSessionIdFromString(input.cookies);
        if (fromCookiesString) return fromCookiesString;
    }

    if (Array.isArray(input.cookies)) {
        const cookieObj = input.cookies.find((c) => (c?.name || '').toLowerCase() === 'sessionid');
        if (cookieObj?.value) return cookieObj.value;
    }

    if (Array.isArray(input.sessionCookies)) {
        const cookieObj = input.sessionCookies.find((c) => (c?.name || '').toLowerCase() === 'sessionid');
        if (cookieObj?.value) return cookieObj.value;
    }

    return null;
}

function extractSessionIdFromString(value) {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/(?:^|;\s*)sessionid=([^;]+)/i);
    if (match) {
        try {
            return decodeURIComponent(match[1]).trim();
        } catch {
            return match[1].trim();
        }
    }

    const looksLikeCookieHeader = /;/.test(trimmed) || /[A-Za-z0-9_]+=/i.test(trimmed);
    if (looksLikeCookieHeader) return null;

    return trimmed;
}

async function processComments(items, concurrency, handler) {
    const pending = new Set();
    for (const item of items) {
        const task = handler(item);
        pending.add(task);
        task.finally(() => pending.delete(task));
        if (pending.size >= concurrency) {
            await Promise.race(pending);
        }
    }
    await Promise.all(pending);
}

function normalizeMinLeadScore(value) {
    const normalized = String(value || 'LOW').toUpperCase();
    if (normalized === 'HIGH' || normalized === 'MEDIUM' || normalized === 'LOW') return normalized;
    return 'LOW';
}

function normalizeWebhookUrl(value) {
    if (!value) return null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
}

function meetsMinLeadScore(leadScore, minLeadScore) {
    const normalize = (value) => String(value || '').toUpperCase();
    const lead = normalize(leadScore);
    const min = normalize(minLeadScore || 'LOW');

    const rank = (value) => {
        if (value === 'HIGH') return 3;
        if (value === 'MEDIUM') return 2;
        return 1;
    };

    return rank(lead) >= rank(min);
}

function shouldNotifyWebhook(record) {
    if (!record) return false;
    const leadScore = String(record.leadScore || '').toUpperCase();
    const intentScore = Number(record.intent_score || 0);
    return leadScore === 'HIGH' && intentScore > 0.7;
}

function createWebhookDispatcher(webhookUrl, config) {
    if (!webhookUrl) return null;
    const queue = [];
    let active = 0;

    const enqueue = (payload) => {
        return new Promise((resolve) => {
            queue.push({ payload, resolve });
            void drain();
        });
    };

    const drain = async () => {
        while (active < config.concurrency && queue.length > 0) {
            const item = queue.shift();
            active += 1;
            void sendWithRetry(webhookUrl, item.payload, config)
                .catch(() => null)
                .finally(() => {
                    active -= 1;
                    item.resolve();
                    void drain();
                });
        }
    };

    return { enqueue };
}

async function sendWithRetry(url, payload, config) {
    const maxRetries = Number(config.maxRetries) || 0;
    const baseDelayMs = Number(config.baseDelayMs) || 500;
    const maxDelayMs = Number(config.maxDelayMs) || 8000;
    const timeoutMs = Number(config.timeoutMs) || 8000;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            await postWebhook(url, payload, timeoutMs);
            return;
        } catch (e) {
            if (attempt >= maxRetries) throw e;
            const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
            const jitter = Math.floor(Math.random() * 200);
            await new Promise(r => setTimeout(r, delay + jitter));
        }
    }
}

async function postWebhook(url, payload, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`Webhook failed: ${response.status}`);
        }
    } finally {
        clearTimeout(timeout);
    }
}

function incrementUserCommentCount(username) {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return 0;
    const next = (USER_COMMENT_COUNTS.get(key) || 0) + 1;
    USER_COMMENT_COUNTS.set(key, next);
    return next;
}

function getEnrichmentCache(username) {
    if (!username) return null;
    const entry = ENRICHMENT_CACHE.get(username);
    if (!entry) return null;
    if (Date.now() - entry.ts > ENRICHMENT_CACHE_TTL_MS) {
        ENRICHMENT_CACHE.delete(username);
        return null;
    }
    return entry.value;
}

function setEnrichmentCache(username, payload) {
    if (!username) return;
    ENRICHMENT_CACHE.set(username, { value: payload, ts: Date.now() });
    if (ENRICHMENT_CACHE.size > ENRICHMENT_CACHE_MAX) {
        ENRICHMENT_CACHE.clear();
    }
}

function getIntentCache(text) {
    if (!text) return null;
    const key = getIntentCacheKey(text);
    const entry = INTENT_CACHE.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > INTENT_CACHE_TTL_MS) {
        INTENT_CACHE.delete(key);
        return null;
    }
    return entry.value;
}

function setIntentCache(text, payload) {
    if (!text) return;
    const key = getIntentCacheKey(text);
    INTENT_CACHE.set(key, { value: payload, ts: Date.now() });
    if (INTENT_CACHE.size > INTENT_CACHE_MAX) {
        INTENT_CACHE.clear();
    }
}

function getIntentCacheKey(text) {
    const normalized = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
    return crypto.createHash('sha1').update(normalized).digest('hex');
}

export {
    DEFAULT_INTENT_WEIGHTS,
    INTENT_LABELS,
    INTENT_PRIORITY,
    DEFAULT_LANGUAGE_DETECTION,
    DEFAULT_SAMPLING_MODE,
    DEFAULT_TARGET_LEAD_COUNT,
    DEFAULT_SAMPLING_PROBABILITY,
    DEFAULT_MIN_LIKES,
    classifyIntentHeuristic,
    buildIntentMatchers,
    scoreIntentMatches,
    detectPromoterSpam,
    detectLanguage,
    detectLanguageByScript,
    detectLanguageByStopwords,
    detectLanguageWithFastText,
    getEngagementProxy,
    buildAudienceQualification,
    fetchCommentsIterator,
    fetchCommentsPage,
    estimateRemainingComments,
    checkCostGuard,
    shouldStopEarly,
    updateLeadValueStats,
    resetGlobalStats,
    resetEarlyStopState,
    setTargetLeadCountForTests,
    setCostGuardLimitBytesForTests,
    setLanguageConfigForTests,
    setIntentMatchersForTests,
    normalizeSamplingMode,
    normalizeSamplingProbability,
    normalizeMinLikes,
    normalizeTargetLeadCount,
    normalizeUserDefinedLimitMB,
    normalizeLimitBytes,
    bytesToMb,
    LANGUAGE_STOPWORDS
};
