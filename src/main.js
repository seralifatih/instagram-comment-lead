import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, log, KeyValueStore } from 'crawlee';
import { devices } from 'playwright';
import natural from 'natural';
import crypto from 'crypto';

// --- SABİTLER ---
const DEFAULT_MAX_POSTS = 3; // Profil linki verilirse son kaç post?
const DEFAULT_MAX_COMMENTS = 100; // Post başına maksimum yorum
const DEVICE_PROFILE = devices['iPhone 14 Pro'];
const INSTAGRAM_APP_ID = '936619743392459';

// --- LEAD ANAHTAR KELİMELERİ (Satın alma niyeti) ---
const LEAD_KEYWORDS = [
    'fiyat', 'price', 'dm', 'bilgi', 'info', 'sipariş', 'order',
    'beden', 'size', 'kargo', 'shipping', 'available', 'var mı',
    'how much', 'ne kadar', 'satın', 'buy', 'link'
];

const INTENT_PATTERNS = {
    PURCHASE_INTENT: [
        /\b(buy|order|purchase|satın|satin|sipariş|siparis|available|stock|stok|link|dm|pm|ship|shipping|kargo)\b/i
    ],
    PRICE_INQUIRY: [
        /\b(price|fiyat|cost|how much|ne kadar|ücret|ucret)\b/i
    ],
    QUESTION: [
        /\b(how|nasıl|nasil|where|nerede|info|detay|details|why|neden)\b|\?/i
    ],
    SERVICE_REQUEST: [
        /\b(appointment|booking|reserve|rezervasyon|randevu|service|hizmet)\b/i
    ],
    INFLUENCER_INTEREST: [
        /\b(collab|collaboration|influencer|sponsor|sponsorship|partner|review)\b/i
    ],
    OTHER: []
};

const INTENT_BASE_SCORES = {
    PURCHASE_INTENT: 90,
    PRICE_INQUIRY: 85,
    SERVICE_REQUEST: 75,
    QUESTION: 65,
    INFLUENCER_INTEREST: 50,
    OTHER: 0
};

const TOKENIZER = new natural.WordTokenizer();

const LOW_SIGNAL_PHRASES = new Set([
    'ok', 'okay', 'nice', 'cool', 'wow', 'woww', 'amazing', 'great', 'super', 'love',
    'güzel', 'guzel', 'harika', 'mükemmel', 'mukemmel', 'süper', 'superb', '👍', '🔥', '😍'
]);

const SPAM_PATTERN = /\b(follow me|check my story|link in bio|dm me|subscribe)\b/i;

const MAX_DEDUPE_SIZE = 200000;
const SEEN_COMMENT_KEYS = new Set();

const ENRICHMENT_CACHE = new Map();
const ENRICHMENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ENRICHMENT_CACHE_MAX = 50000;

const INTENT_CACHE = new Map();
const INTENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const INTENT_CACHE_MAX = 50000;

let LLM_CONFIG = null;
const LLM_STATE = {
    requestsMade: 0,
    pendingBatches: 0,
    lastRequestAt: 0
};

const COMMENT_PROCESS_CONCURRENCY = 5;

let LLM_BATCHER = null;

const GLOBAL_STATS = {
    totalComments: 0,
    totalLeads: 0,
    intentBreakdown: {},
    keywordCounts: new Map(),
    filteredComments: 0,
    duplicateComments: 0,
    llmClassifications: 0
};

await Actor.init();
LLM_CONFIG = getLlmConfig();
LLM_BATCHER = createLlmBatcher(LLM_CONFIG);

// --- GİRİŞ KONTROLÜ ---
const input = (await Actor.getInput()) ?? {};
const config = validateInput(input);

if (config.targetUrls.length === 0) {
    log.warning('İşlenecek post URL bulunamadı. Lütfen geçerli bir Instagram post veya reel linki girin.');
    await Actor.exit();
}

// Session ID Kontrolü (Yorumlar için kritik!)
if (config.sessionId) {
    log.info('🔐 Session ID tanımlandı. Yorumlar ve detaylı veri çekilebilir.');
} else {
    log.error('❌ Session ID eksik veya geçersiz. Lütfen tarayıcınızdaki sessionid değerini veya tam cookie stringini girin.');
    await Actor.exit();
}

// --- QUEUE KURULUMU ---
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
    log.warning('Enrichment aktif ama proxy ayarı yok. Ban riskini azaltmak için Apify Proxy önerilir.');
}

// --- CRAWLER YAPILANDIRMASI ---
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
            // Gereksiz kaynakları engelle (hız için)
            await page.route('**/*.{png,jpg,jpeg,mp4,avi,woff,woff2}', (route) => route.abort());

            // Session Cookie Ekle
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

            // Mobile Viewport
            await page.setViewportSize(DEVICE_PROFILE.viewport);
            await page.setExtraHTTPHeaders({
                'User-Agent': DEVICE_PROFILE.userAgent,
                'Accept-Language': 'en-US,en;q=0.9',
            });
        },
    ],

    async requestHandler({ request, page, response }) {
        const { type, originalUrl, isEnrichment, commentData } = request.userData;
        log.info(`Processing ${isEnrichment ? 'enrichment' : type}: ${request.url}`);

        await randomDelay(800, 1600, page); // İnsan taklidi

        // Login Redirect Kontrolü
        if (page.url().includes('accounts/login')) {
            log.error(`❌ Login duvarına takıldı: ${request.url}. Lütfen geçerli bir Session ID girin.`);
            return;
        }

        if (isEnrichment) {
            await handleEnrichment(page, commentData);
            return;
        }

        // 1. SENARYO: PROFİL URL GELDİYSE -> SON POSTLARI BUL
        if (type === 'profile') {
            await handleProfile(page, requestQueue, config.maxPostsPerProfile);
            return;
        }

        // 2. SENARYO: POST URL GELDİYSE -> YORUMLARI ÇEK
        if (type === 'post') {
            const shortcode = extractShortcode(request.url);
            if (!shortcode) {
                log.error(`Shortcode bulunamadı: ${request.url}`);
                return;
            }

            // Media ID'ye çevir (API için gerekli)
            const mediaId = await getMediaId(page, shortcode, INSTAGRAM_APP_ID);

            if (!mediaId) {
                log.error(`Media ID alınamadı, sayfa yüklenmemiş olabilir: ${shortcode}`);
                return;
            }

            log.info(`💬 Yorumlar çekiliyor... MediaID: ${mediaId}`);

            // Yorumları API ile Çek
            const comments = await fetchComments(page, mediaId, config.maxComments, INSTAGRAM_APP_ID, config.scrapeSince);

            log.info(`✅ Toplam ${comments.length} yorum bulundu.`);

            await processComments(comments, COMMENT_PROCESS_CONCURRENCY, async (comment) => {
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

                const analysis = await analyzeComment(comment.text);
                if (!analysis) {
                    GLOBAL_STATS.filteredComments += 1;
                    return;
                }

                const username = comment.user.username;
                const cached = getEnrichmentCache(username);
                const followerBucket = cached?.follower_bucket ?? cached?.followerBucket ?? null;
                const leadScoring = computeLeadScore(analysis.intent_score ?? 0, followerBucket, comment.text);
                const isLead = isLeadQualified(analysis.intent_score ?? 0, followerBucket);
                updateGlobalStats(analysis, isLead ? 'HIGH' : 'LOW');

                const profileUrl = `https://www.instagram.com/${username}/`;
                const leadType = classifyLeadType(comment.text, analysis);
                const record = {
                    postUrl: originalUrl,
                    source_shortcode: shortcode,
                    username,
                    text: comment.text,
                    intent: analysis.intent,
                    intent_score: analysis.intent_score,
                    is_lead: isLead,
                    keywords: analysis.keywords,
                    leadScore: leadScoring.category,
                    lead_type: leadType,
                    audience_qualification: cached?.audience_qualification ?? null,
                    profileUrl,
                    likeCount: comment.comment_like_count,
                    postedAt: new Date(comment.created_at * 1000).toISOString(),
                    extractedAt: new Date().toISOString()
                };

                if (config.enrichLeads && (analysis.intent_score ?? 0) > 0.5 && !cached) {
                    await requestQueue.addRequest({
                        url: profileUrl,
                        uniqueKey: `enrich:${comment.id ?? username}:${shortcode}`,
                        userData: {
                            isEnrichment: true,
                            commentData: record,
                            intent_score: analysis.intent_score
                        }
                    });
                    return;
                }

                if (cached) {
                    const scoring = computeLeadScore(analysis.intent_score ?? 0, followerBucket, comment.text);
                    record.leadScore = scoring.category;
                    record.is_lead = isLeadQualified(analysis.intent_score ?? 0, followerBucket);
                    record.audience_qualification = cached.audience_qualification ?? null;
                }
                if (!meetsMinLeadScore(record.leadScore, config.minLeadScore)) {
                    GLOBAL_STATS.filteredComments += 1;
                    return;
                }
                await Dataset.pushData(record);
            });
        }
    },

    failedRequestHandler({ request }, error) {
        log.error(`Request failed: ${request.url} - ${error.message}`);
    },
});

await crawler.run();
await generateSummary();
await Actor.exit();

// ============================================================
// YARDIMCI FONKSİYONLAR
// ============================================================

// 1. Profil sayfasından son gönderileri bulur ve kuyruğa ekler
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
        log.info(`?? Profilde bulunan g?nderiler: ${selected.length}`);

        for (const link of selected) {
            await queue.addRequest({
                url: link,
                uniqueKey: link,
                userData: { type: 'post', originalUrl: link }
            });
            await randomDelay(300, 700);
        }
    } catch (e) {
        log.error(`Profil i?lenirken hata: ${e.message}`);
    }
}


// Enrichment: Profil sayfasından takipçi sayısını alır ve yoruma ekler
async function handleEnrichment(page, commentData) {
    const followerCount = await extractFollowerCount(page);
    const followerBucket = bucketFollowerCount(followerCount);
    const intentScore = typeof commentData?.intent_score === 'number'
        ? commentData.intent_score
        : typeof commentData?.intentScore === 'number'
            ? commentData.intentScore / 100
            : 0;
    const engagementProxy = getEngagementProxy(commentData?.likeCount, followerCount);
    const leadScoring = computeLeadScore(intentScore, followerBucket, commentData?.text || '');
    const isLead = isLeadQualified(intentScore, followerBucket);

    if (followerCount === null) {
        log.warning(`Takipçi sayısı bulunamadı: ${page.url()}`);
    }

    const audienceQualification = buildAudienceQualification(followerCount, followerBucket);
    const cachePayload = {
        follower_bucket: followerBucket ?? null,
        audience_qualification: audienceQualification,
        engagement_proxy: engagementProxy,
        follower_count: followerCount ?? null
    };

    if (commentData?.username) {
        setEnrichmentCache(commentData.username, cachePayload);
    }

    const outputRecord = {
        ...(commentData || {}),
        is_lead: isLead,
        leadScore: leadScoring.category,
        audience_qualification: audienceQualification,
        extractedAt: commentData?.extractedAt || new Date().toISOString()
    };

    if (!meetsMinLeadScore(outputRecord.leadScore, config.minLeadScore)) {
        GLOBAL_STATS.filteredComments += 1;
        return;
    }

    await Dataset.pushData(outputRecord);
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
    const match = text.match(/([0-9.,]+)\s*([km])?\s*(followers?|takipci)/i);
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

// 2. Sayfa içinden Media ID'yi bulur veya hesaplar
async function getMediaId(page, shortcode, appId) {
    // Önce URL'den alphabet conversion deneyelim (JS tarafında)
    // Eğer bu tutmazsa page context içinde API call deneriz.
    // Instagram'da MediaID genellikle <meta property="al:ios:url"> içinde "instagram://media?id=..." olarak gizlidir.

    return await page.evaluate(async ({ code, id }) => {
        // Yöntem A: Meta tag
        const iosMeta = document.querySelector('meta[property="al:ios:url"]');
        if (iosMeta) {
            const match = iosMeta.content.match(/id=(\d+)/);
            if (match) return match[1];
        }

        // Yöntem B: JS ile Shortcode -> MediaID (Basit versiyon)
        // Bu karmaşık olduğu için direkt API'ye soralım:
        try {
            // Küçük bir trick: oembed endpoint halka açıktır
            const resp = await fetch(`https://www.instagram.com/api/v1/oembed/?url=https://www.instagram.com/p/${code}/`);
            const data = await resp.json();
            return data.media_id; // "3234..."
        } catch (e) { return null; }

    }, { code: shortcode, id: appId });
}

// 3. Dahili API ile Yorumları Çek (Pagination dahil)
async function fetchComments(page, mediaId, maxComments, appId, scrapeSince) {
    return await page.evaluate(async ({ mediaId, maxComments, appId, scrapeSince }) => {
        const collectedComments = [];
        let nextMinId = null;
        let hasMore = true;
        const sinceTs = typeof scrapeSince === 'number' ? scrapeSince : null;

        while (hasMore && collectedComments.length < maxComments) {
            try {
                let url = `https://www.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true`;
                if (nextMinId) url += `&min_id=${encodeURIComponent(nextMinId)}`;

                const response = await fetch(url, {
                    headers: {
                        'X-IG-App-ID': appId,
                        'X-Requested-With': 'XMLHttpRequest',
                    }
                });

                if (!response.ok) break;

                const data = await response.json();
                const comments = data.comments || [];

                let stopDueToDelta = false;
                // Yorumlar? i?le
                for (const c of comments) {
                    if (sinceTs && typeof c.created_at === 'number' && c.created_at < sinceTs) {
                        stopDueToDelta = true;
                        break;
                    }

                    collectedComments.push({
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

                if (stopDueToDelta) {
                    hasMore = false;
                    break;
                }

                // Pagination kontrol?
                if (data.next_min_id && collectedComments.length < maxComments) {
                    nextMinId = data.next_min_id;
                    // H?zl? istek at?p banlanmamak i?in k?sa bir delay (browser context i?inde)
                    await new Promise(r => setTimeout(r, 800 + Math.random() * 700));
                } else {
                    hasMore = false;
                }

            } catch (e) {
                console.error(e);
                hasMore = false;
            }
        }
        return collectedComments;
    }, { mediaId, maxComments, appId, scrapeSince });
}


// 4. Lead Kelime Analizi
function hasIntentSignal(text) {
    if (!text) return false;
    for (const patterns of Object.values(INTENT_PATTERNS)) {
        for (const pattern of patterns) {
            if (pattern.test(text)) return true;
        }
    }
    return false;
}

function filterComment(commentText) {
    if (!commentText || typeof commentText !== 'string') return false;
    const trimmed = commentText.trim();
    if (!trimmed) return false;
    if (trimmed.length < 3) return false;

    const lower = trimmed.toLowerCase();
    if (SPAM_PATTERN.test(lower)) return false;

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
    if (/^(.){3,}$/.test(cleaned)) return true;
    if (/^[\d\W_]+$/.test(cleaned)) return true;

    const alphaCount = cleaned.replace(/[^a-zA-Z????????????]/g, '').length;
    if (alphaCount === 0 && !/\d/.test(cleaned)) return true;
    const tokens = TOKENIZER.tokenize(cleaned);
    if (cleaned.length <= 4 && alphaCount <= 2 && tokens.length <= 1) return true;

    return false;
}

function classifyIntentHeuristic(text) {
    const normalizedText = text.toLowerCase();
    const keywordMatches = new Map();

    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
        for (const pattern of patterns) {
            if (!pattern.test(normalizedText)) continue;

            if (!keywordMatches.has(intent)) {
                keywordMatches.set(intent, new Set());
            }

            const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
            const globalPattern = new RegExp(pattern.source, flags);
            let match;
            while ((match = globalPattern.exec(normalizedText)) !== null) {
                const keyword = (match[1] || match[0] || '').trim();
                if (keyword) keywordMatches.get(intent).add(keyword);
                if (globalPattern.lastIndex === match.index) globalPattern.lastIndex++;
            }
        }
    }

    let intent = 'OTHER';
    let baseScore = 0;
    for (const [candidate, candidateScore] of Object.entries(INTENT_BASE_SCORES)) {
        if (!keywordMatches.has(candidate)) continue;
        if (candidateScore > baseScore) {
            intent = candidate;
            baseScore = candidateScore;
        }
    }

    const keywords = intent === 'OTHER'
        ? []
        : Array.from(keywordMatches.get(intent) ?? []);

    const intentScore = intent === 'OTHER'
        ? 0.1
        : Math.min(0.98, 0.45 + 0.15 * keywords.length);

    return {
        intent,
        score: baseScore,
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
    if (heuristic.intent !== 'OTHER' && heuristic.intent_score >= 0.7) return false;
    return true;
}

async function classifyIntentWithLLM(text, language) {
    if (!LLM_CONFIG || !LLM_CONFIG.enabled) return null;
    if (!LLM_BATCHER) return null;
    return await LLM_BATCHER.enqueue({ text, language });
}

function mergeIntentResults(heuristic, llmResult) {
    if (!llmResult) return heuristic;
    if (heuristic.intent === 'OTHER') return llmResult;

    if ((llmResult.intent_score || 0) > (heuristic.intent_score || 0) + 0.15) {
        const mergedKeywords = new Set([...(heuristic.keywords || []), ...(llmResult.keywords || [])]);
        return {
            ...llmResult,
            keywords: Array.from(mergedKeywords)
        };
    }

    return heuristic;
}

function getFollowerBucketWeight(bucket) {
    switch (bucket) {
        case '<1k':
            return 0.1;
        case '1k-10k':
            return 0.3;
        case '10k-100k':
            return 0.6;
        case '100k+':
            return 1.0;
        case 'Nano (<1k)':
            return 0.1;
        case 'Micro (1k-10k)':
            return 0.3;
        case 'Mid-Tier (10k-100k)':
            return 0.6;
        case 'Macro (>100k)':
            return 1.0;
        default:
            return 0.1;
    }
}

function getAudienceTier(bucket) {
    switch (bucket) {
        case '<1k':
            return 'low';
        case '1k-10k':
            return 'qualified';
        case '10k-100k':
        case '100k+':
            return 'high_value';
        default:
            return 'low';
    }
}

function buildAudienceQualification(followerCount, followerBucket) {
    if (!followerBucket && typeof followerCount !== 'number') return null;
    const bucket = followerBucket || bucketFollowerCount(followerCount);
    return {
        followers: Number.isFinite(followerCount) ? followerCount : null,
        bucket,
        tier: getAudienceTier(bucket)
    };
}

function getEngagementProxy(commentLikeCount, followerCount) {
    const likes = Number(commentLikeCount);
    const followers = Number(followerCount);
    if (!Number.isFinite(likes) || !Number.isFinite(followers) || followers <= 0) return null;
    const ratio = likes / followers;
    return Math.round(ratio * 100000) / 100000;
}

function getCommentLengthWeight(text) {
    if (!text) return 0.1;
    const length = text.trim().length;
    if (length < 20) return 0.1;
    if (length <= 100) return 0.5;
    return 1.0;
}

function categorizeLeadScore(score) {
    if (score >= 0.7) return 'HIGH';
    if (score >= 0.4) return 'MEDIUM';
    return 'LOW';
}

function meetsMinLeadScore(category, minCategory) {
    const order = { LOW: 0, MEDIUM: 1, HIGH: 2 };
    const categoryRank = order[String(category || 'LOW').toUpperCase()] ?? 0;
    const minRank = order[String(minCategory || 'LOW').toUpperCase()] ?? 0;
    return categoryRank >= minRank;
}

function isLeadQualified(intentScore, followerBucket) {
    const intent = Number(intentScore) || 0;
    if (intent <= 0.5) return false;
    if (!followerBucket) return false;
    return followerBucket === '1k-10k' || followerBucket === '10k-100k' || followerBucket === '100k+';
}

function computeLeadScore(intentScore, followerBucket, commentText) {
    const normalizedIntent = Math.max(0, Math.min(1, Number(intentScore) || 0));
    const followerWeight = getFollowerBucketWeight(followerBucket);
    const lengthWeight = getCommentLengthWeight(commentText);

    const score = (normalizedIntent * 0.6) + (followerWeight * 0.2) + (lengthWeight * 0.2);
    const rounded = Math.round(score * 1000) / 1000;

    return {
        score: rounded,
        category: categorizeLeadScore(rounded)
    };
}

function classifyLeadType(commentText, analysis) {
    const text = String(commentText || '').toLowerCase();
    if (SPAM_PATTERN.test(text)) return 'SPAM';

    switch (analysis?.intent) {
        case 'PURCHASE_INTENT':
        case 'PRICE_INQUIRY':
        case 'SERVICE_REQUEST':
            return 'BUY_INTENT';
        case 'QUESTION':
            return 'QUESTION';
        case 'INFLUENCER_INTEREST':
            return 'INFLUENCER';
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
    if (/[??????]/i.test(text)) return 'tr';
    return 'en';
}


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
                content: 'You are an intent classifier for Instagram comments. Return ONLY JSON array with items: {id, intent (PURCHASE_INTENT|QUESTION|PRICE_INQUIRY|SERVICE_REQUEST|INFLUENCER_INTEREST|OTHER), intent_score (0-1), keywords (array)}.'
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
            if (!INTENT_BASE_SCORES[intent] && intent !== 'OTHER') continue;

            const intentScore = Math.max(0, Math.min(1, Number(item.intent_score) || 0));
            const keywords = Array.isArray(item.keywords) ? item.keywords.map(k => String(k).trim()).filter(Boolean) : [];
            const sourceText = inputMap.get(item.id)?.text || '';
            results[item.id] = {
                intent,
                score: INTENT_BASE_SCORES[intent] || 0,
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
    if (leadCategory === 'HIGH') GLOBAL_STATS.totalLeads += 1;

    const intentKey = analysis.intent || 'OTHER';
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

async function generateSummary() {
    const topKeywords = Array.from(GLOBAL_STATS.keywordCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([keyword, count]) => ({ keyword, count }));

    const summary = {
        totalComments: GLOBAL_STATS.totalComments,
        totalLeads: GLOBAL_STATS.totalLeads,
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

function extractShortcode(url) {
    const match = url.match(/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
}

function validateInput(input) {
    const urls = normalizeTargetUrls(input.targetUrls || input.startUrls || []);
    const supportedUrls = urls.filter(isSupportedUrl);
    const rejectedUrls = urls.filter(u => !isSupportedUrl(u));
    if (rejectedUrls.length > 0) {
        log.warning(`Sadece Instagram post, reel veya profil linkleri destekleniyor. ${rejectedUrls.length} URL atlandı. Örnek: ${rejectedUrls[0]}`);
    }

    return {
        targetUrls: supportedUrls,
        sessionId: extractSessionId(input),
        scrapeSince: parseScrapeSince(input.scrapeSince),
        enrichLeads: Boolean(input.enrichLeads),
        minLeadScore: normalizeMinLeadScore(input.minLeadScore),
        maxComments: input.maxComments || DEFAULT_MAX_COMMENTS,
        maxPostsPerProfile: input.maxPostsPerProfile || DEFAULT_MAX_POSTS,
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
