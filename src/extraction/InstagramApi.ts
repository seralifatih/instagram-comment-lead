export function toInstagramApiUrl(url: string): string {
  const trimmed = url.split('?')[0] ?? url;
  const normalized = trimmed.replace(/\/+$/, '');
  const match = normalized.match(/instagram\.com\/(?:p|reel)\/([^/?#]+)/);
  if (!match?.[1]) return normalized.endsWith('/') ? normalized : `${normalized}/`;
  return `https://www.instagram.com/p/${match[1]}/`;
}

export function buildInstagramHeaders(
  sessionId: string,
  cookieOverride?: string,
): Record<string, string> {
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
  const languages = ['en-US,en;q=0.9', 'en-US,en;q=0.8', 'en-GB,en;q=0.8'];
  const acceptEncodings = ['gzip, deflate, br', 'gzip, br'];
  const lang = languages[Math.floor(Math.random() * languages.length)] ?? languages[0] ?? '';
  const enc =
    acceptEncodings[Math.floor(Math.random() * acceptEncodings.length)] ??
    acceptEncodings[0] ??
    '';
  const cookieHeader = cookieOverride ?? `sessionid=${sessionId};`;
  return {
    Cookie: cookieHeader,
    'User-Agent': userAgent,
    'X-IG-App-ID': '936619743392459',
    Accept: '*/*',
    'Accept-Language': lang,
    'Accept-Encoding': enc,
    Referer: 'https://www.instagram.com/',
  };
}

export function maskSessionId(sessionId: string): string {
  if (sessionId.length <= 6) return sessionId;
  return sessionId.slice(0, 6);
}

export type ProxyConfiguration = Awaited<
  ReturnType<typeof import('apify').Actor.createProxyConfiguration>
>;

export type GraphqlRequest = (params: {
  url: string;
  method: 'POST' | 'GET';
  body?: string;
  headers: Record<string, string>;
  proxyUrl?: string;
  timeout: { request: number };
  retry: { limit: number };
}) => Promise<{
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body?: string | Buffer;
}>;

export type GraphqlLogger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warning: (message: string, data?: Record<string, unknown>) => void;
};

export type RawComment = { username: string; text: string };

export async function fetchGraphqlComments(params: {
  shortcode: string;
  maxComments: number;
  sessionId: string;
  proxyConfiguration: ProxyConfiguration;
  request: GraphqlRequest;
  logger: GraphqlLogger;
  cookieHeader?: string;
}): Promise<RawComment[]> {
  const {
    shortcode,
    maxComments,
    sessionId,
    proxyConfiguration,
    request,
    logger,
    cookieHeader,
  } = params;

  let proxyUrl: string | undefined;
  try {
    const proxyInfo = await proxyConfiguration?.newProxyInfo();
    proxyUrl = proxyInfo?.url ?? undefined;
  } catch {
    proxyUrl = undefined;
  }

  const headers = buildInstagramHeaders(sessionId, cookieHeader);

  const graphqlResult = await tryGraphqlStrategy({
    shortcode,
    maxComments,
    headers,
    proxyUrl,
    request,
    logger,
  });
  if (graphqlResult.length > 0) return graphqlResult;

  const restShortcodeResult = await tryRestShortcodeStrategy({
    shortcode,
    maxComments,
    headers,
    proxyUrl,
    request,
    logger,
  });
  if (restShortcodeResult.length > 0) return restShortcodeResult;

  logger.warning('All comment fetch strategies exhausted', { shortcode });
  return [];
}

export function mergeCookieHeader(
  baseCookie: string,
  setCookie?: string | string[],
): string {
  const jar = new Map<string, string>();

  for (const part of baseCookie.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) jar.set(key, value);
  }

  const setCookieList = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const entry of setCookieList) {
    const first = entry.split(';')[0]?.trim();
    if (!first) continue;
    const idx = first.indexOf('=');
    if (idx === -1) continue;
    const key = first.slice(0, idx).trim();
    const value = first.slice(idx + 1).trim();
    if (key) jar.set(key, value);
  }

  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
    .concat(';');
}

const GRAPHQL_DOC_IDS = [
  '7742571219201978',
  '8845758582119845',
  '17873440459141021',
];

async function tryGraphqlStrategy(params: {
  shortcode: string;
  maxComments: number;
  headers: Record<string, string>;
  proxyUrl: string | undefined;
  request: GraphqlRequest;
  logger: GraphqlLogger;
}): Promise<RawComment[]> {
  const { shortcode, maxComments, headers, proxyUrl, request, logger } = params;
  const endpoint = 'https://www.instagram.com/graphql/query/';
  const pageSize = Math.min(50, Math.max(10, maxComments));

  for (const docId of GRAPHQL_DOC_IDS) {
    const results: RawComment[] = [];
    let after: string | null = null;

    for (let page = 0; page < 40 && results.length < maxComments; page++) {
      const variables: Record<string, unknown> = { shortcode, first: pageSize };
      if (after) variables['after'] = after;

      const body = new URLSearchParams({
        doc_id: docId,
        variables: JSON.stringify(variables),
      });

      try {
        const response = await request({
          url: endpoint,
          method: 'POST',
          body: body.toString(),
          headers: {
            ...headers,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRFToken': extractCsrfToken(headers['Cookie'] ?? ''),
          },
          proxyUrl,
          timeout: { request: 30000 },
          retry: { limit: 0 },
        });

        const statusCode = response.statusCode;
        if (statusCode === 403 || statusCode === 429) {
          logger.warning('GraphQL blocked', { shortcode, statusCode, docId });
          break;
        }
        if (statusCode === 302) {
          const location = response.headers?.['location'];
          if (typeof location === 'string' && location.includes('login')) {
            logger.warning('GraphQL login redirect', { shortcode, docId });
            break;
          }
        }

        const payload = safeJsonParse(response.body?.toString() ?? '');
        if (!payload) break;

        const parsed = parseGraphqlComments(payload);
        if (parsed.comments.length === 0 && page === 0) {
          break;
        }

        results.push(...parsed.comments);
        after = parsed.endCursor ?? null;
        if (!parsed.hasNextPage || !after) {
          logger.info('GraphQL strategy succeeded', { shortcode, docId, count: results.length });
          return results.slice(0, maxComments);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warning('GraphQL request error', { shortcode, docId, error: msg });
        break;
      }
    }

    if (results.length > 0) {
      logger.info('GraphQL strategy succeeded (partial)', {
        shortcode,
        docId,
        count: results.length,
      });
      return results.slice(0, maxComments);
    }
  }

  return [];
}

async function tryRestShortcodeStrategy(params: {
  shortcode: string;
  maxComments: number;
  headers: Record<string, string>;
  proxyUrl: string | undefined;
  request: GraphqlRequest;
  logger: GraphqlLogger;
}): Promise<RawComment[]> {
  const { shortcode, maxComments, headers, proxyUrl, request, logger } = params;
  const results: RawComment[] = [];
  let nextMinId: string | null = null;

  for (let page = 0; page < 20 && results.length < maxComments; page++) {
    let url =
      `https://www.instagram.com/api/v1/media/shortcode/${shortcode}/comments/` +
      '?can_support_threading=true&permalink_enabled=true';
    if (nextMinId) url += `&min_id=${encodeURIComponent(nextMinId)}`;

    try {
      const response = await request({
        url,
        method: 'GET',
        headers: {
          ...headers,
          Accept: 'application/json',
        },
        proxyUrl,
        timeout: { request: 30000 },
        retry: { limit: 0 },
      });

      const statusCode = response.statusCode;
      if (statusCode === 404) break;
      if (statusCode === 403 || statusCode === 401) {
        logger.warning('REST comments blocked - sessionId may be invalid', {
          shortcode,
          statusCode,
        });
        break;
      }
      if (statusCode !== 200) {
        logger.warning('REST comments unexpected status', { shortcode, statusCode });
        break;
      }

      const payload = safeJsonParse(response.body?.toString() ?? '');
      if (!payload || typeof payload !== 'object') break;

      const obj = payload as Record<string, unknown>;
      const items = (obj['comments'] as unknown[] | undefined) ?? [];

      for (const item of items) {
        const c = item as Record<string, unknown>;
        const username =
          (c['user'] as Record<string, unknown> | undefined)?.['username'] ?? '';
        const text = c['text'] ?? '';
        if (typeof username === 'string' && typeof text === 'string' && username && text) {
          results.push({ username, text });
        }
      }

      const hasMore = Boolean(obj['has_more_comments'] ?? obj['has_more_headload_comments']);
      const nextId = obj['next_min_id'] ?? obj['next_max_id'];
      if (!hasMore || typeof nextId !== 'string') break;
      nextMinId = nextId;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warning('REST shortcode request error', { shortcode, error: msg });
      break;
    }
  }

  if (results.length > 0) {
    logger.info('REST shortcode strategy succeeded', {
      shortcode,
      count: results.length,
    });
  }

  return results.slice(0, maxComments);
}

function parseGraphqlComments(data: unknown): {
  comments: RawComment[];
  hasNextPage: boolean;
  endCursor?: string;
} {
  const media =
    (data as any)?.data?.shortcode_media ??
    (data as any)?.data?.xdt_shortcode_media ??
    (data as any)?.shortcode_media;

  const edge = media?.edge_media_to_parent_comment ?? media?.edge_media_to_comment;
  const edges = edge?.edges ?? [];
  const comments: RawComment[] = [];

  for (const item of edges) {
    const node = item?.node ?? item;
    const username = node?.owner?.username ?? node?.user?.username ?? '';
    const text = node?.text ?? '';
    if (username && text) comments.push({ username, text });
  }

  const pageInfo = edge?.page_info ?? edge?.pageInfo ?? {};
  const hasNextPage = Boolean(pageInfo?.has_next_page ?? pageInfo?.hasNextPage);
  const endCursor = pageInfo?.end_cursor ?? pageInfo?.endCursor;

  return { comments, hasNextPage, endCursor };
}

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractCsrfToken(cookieHeader: string): string {
  const match = cookieHeader.match(/csrftoken=([^;]+)/);
  return match?.[1] ?? '';
}
