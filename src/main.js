import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, log, KeyValueStore } from 'crawlee';
import { devices } from 'playwright';

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
    await requestQueue.addRequest({
        url: url,
        uniqueKey: url,
        userData: { type: 'post', originalUrl: url }
    });
}

const proxyConfiguration = await Actor.createProxyConfiguration(config.proxyConfiguration);

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
        const { type, originalUrl } = request.userData;
        log.info(`Processing ${type}: ${request.url}`);

        await page.waitForTimeout(1000 + Math.random() * 1000); // İnsan taklidi

        // Login Redirect Kontrolü
        if (page.url().includes('accounts/login')) {
            log.error(`❌ Login duvarına takıldı: ${request.url}. Lütfen geçerli bir Session ID girin.`);
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
            const comments = await fetchComments(page, mediaId, config.maxComments, INSTAGRAM_APP_ID);

            log.info(`✅ Toplam ${comments.length} yorum bulundu.`);

            // Sonuçları İşle ve Kaydet
            for (const comment of comments) {
                const isLead = checkIsLead(comment.text);

                await Dataset.pushData({
                    postUrl: originalUrl,
                    shortcode,
                    username: comment.user.username,
                    fullName: comment.user.full_name,
                    profileUrl: `https://www.instagram.com/${comment.user.username}/`,
                    text: comment.text,
                    likeCount: comment.comment_like_count,
                    postedAt: new Date(comment.created_at * 1000).toISOString(),
                    isLead: isLead, // Potansiyel müşteri mi?
                    leadScore: isLead ? 'HIGH' : 'LOW',
                    extractedAt: new Date().toISOString()
                });
            }
        }
    },

    failedRequestHandler({ request }, error) {
        log.error(`Request failed: ${request.url} - ${error.message}`);
    },
});

await crawler.run();
await Actor.exit();

// ============================================================
// YARDIMCI FONKSİYONLAR
// ============================================================

// 1. Profil sayfasından son gönderileri bulur ve kuyruğa ekler
async function handleProfile(page, queue, limit) {
    try {
        // GraphQL veya mevcut DOM yapısından linkleri al
        const links = await page.evaluate((limit) => {
            const anchors = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
            return anchors
                .map(a => a.href)
                .filter((v, i, a) => a.indexOf(v) === i) // Unique
                .slice(0, limit);
        }, limit);

        log.info(`📌 Profilde bulunan gönderiler: ${links.length}`);

        for (const link of links) {
            await queue.addRequest({
                url: link,
                userData: { type: 'post', originalUrl: link }
            });
        }
    } catch (e) {
        log.error(`Profil işlenirken hata: ${e.message}`);
    }
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
async function fetchComments(page, mediaId, maxComments, appId) {
    return await page.evaluate(async ({ mediaId, maxComments, appId }) => {
        const collectedComments = [];
        let nextMinId = null;
        let hasMore = true;

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

                // Yorumları işle
                for (const c of comments) {
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

                // Pagination kontrolü
                if (data.next_min_id && collectedComments.length < maxComments) {
                    nextMinId = data.next_min_id;
                    // Hızlı istek atıp banlanmamak için kısa bir delay (browser context içinde)
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    hasMore = false;
                }

            } catch (e) {
                console.error(e);
                hasMore = false;
            }
        }
        return collectedComments;
    }, { mediaId, maxComments, appId });
}

// 4. Lead Kelime Analizi
function checkIsLead(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return LEAD_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

function extractShortcode(url) {
    const match = url.match(/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
}

function validateInput(input) {
    const urls = normalizeTargetUrls(input.targetUrls || input.startUrls || []);
    const postUrls = urls.filter(isPostUrl);
    const rejectedUrls = urls.filter(u => !isPostUrl(u));
    if (rejectedUrls.length > 0) {
        log.warning(`Sadece post veya reel linkleri destekleniyor. ${rejectedUrls.length} URL atlandı. Örnek: ${rejectedUrls[0]}`);
    }

    return {
        targetUrls: postUrls,
        sessionId: extractSessionId(input),
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
