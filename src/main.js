import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, log, KeyValueStore } from 'crawlee';
import { devices } from 'playwright';
import natural from 'natural';

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
    PURCHASE: [
        /\b(price|fiyat|cost|dm|sipariş|siparis|order|buy|link|shipping|kargo|available|var mı|var mi|ne kadar|beden|size)\b/i
    ],
    QUESTION: [
        /\b(how|nasıl|nasil|where|nerede|info|detay|details)\b|\?/i
    ],
    COMPLAINT: [
        /\b(fake|scam|broken|bad|never|hate|sorun|problem)\b/i
    ],
    APPRECIATION: [
        /\b(love|amazing|harika|super|great)\b/i
    ]
};

const INTENT_SCORES = {
    PURCHASE: 90,
    QUESTION: 70,
    COMPLAINT: 80,
    APPRECIATION: 10
};

const TOKENIZER = new natural.WordTokenizer();

const GLOBAL_STATS = {
    totalComments: 0,
    totalLeads: 0,
    intentBreakdown: {},
    keywordCounts: new Map()
};

await Actor.init();

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

            // Sonuçları İşle ve Kaydet
            for (const comment of comments) {
                const analysis = analyzeComment(comment.text);
                updateGlobalStats(analysis);

                const profileUrl = `https://www.instagram.com/${comment.user.username}/`;
                const record = {
                    postUrl: originalUrl,
                    shortcode,
                    source_shortcode: shortcode,
                    username: comment.user.username,
                    fullName: comment.user.full_name,
                    profileUrl,
                    text: comment.text,
                    likeCount: comment.comment_like_count,
                    postedAt: new Date(comment.created_at * 1000).toISOString(),
                    isLead: analysis.isLead, // Potansiyel müşteri mi?
                    is_lead: analysis.isLead,
                    leadScore: analysis.score >= 70 ? 'HIGH' : 'LOW',
                    intent: analysis.intent,
                    intent_score: analysis.score,
                    intentScore: analysis.score,
                    intentKeywords: analysis.keywords,
                    keywords: analysis.keywords,
                    language: analysis.language,
                    audience_qualification: null,
                    extractedAt: new Date().toISOString()
                };

                if (analysis.isLead && config.enrichLeads) {
                    await requestQueue.addRequest({
                        url: profileUrl,
                        uniqueKey: `enrich:${comment.id ?? comment.user.username}:${shortcode}`,
                        userData: {
                            isEnrichment: true,
                            commentData: record
                        }
                    });
                } else {
                    await Dataset.pushData(record);
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

    if (followerCount === null) {
        log.warning(`Takipçi sayısı bulunamadı: ${page.url()}`);
    }

    await Dataset.pushData({
        ...(commentData || {}),
        followerCount,
        followerBucket,
        audience_qualification: followerBucket ?? null,
        enrichedAt: new Date().toISOString()
    });
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
    if (typeof count !== 'number' || Number.isNaN(count)) return 'Unknown';
    if (count < 1000) return 'Nano (<1k)';
    if (count < 10000) return 'Micro (1k-10k)';
    if (count < 100000) return 'Mid-Tier (10k-100k)';
    return 'Macro (>100k)';
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
function checkIsLead(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return LEAD_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

function analyzeComment(text) {
    if (!text || typeof text !== 'string') {
        return {
            intent: 'OTHER',
            score: 0,
            isLead: false,
            keywords: [],
            language: 'unknown'
        };
    }

    const tokens = TOKENIZER.tokenize(text);
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
    let score = 0;
    for (const [candidate, candidateScore] of Object.entries(INTENT_SCORES)) {
        if (!keywordMatches.has(candidate)) continue;
        if (candidateScore > score) {
            intent = candidate;
            score = candidateScore;
        }
    }

    const keywords = intent === 'OTHER'
        ? []
        : Array.from(keywordMatches.get(intent) ?? []);

    const language = /[şğıçöü]/i.test(text) ? 'tr' : 'en';

    return {
        intent,
        score,
        isLead: score >= 70,
        keywords,
        language
    };
}

function updateGlobalStats(analysis) {
    GLOBAL_STATS.totalComments += 1;
    if (analysis.isLead) GLOBAL_STATS.totalLeads += 1;

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
        topKeywords
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
