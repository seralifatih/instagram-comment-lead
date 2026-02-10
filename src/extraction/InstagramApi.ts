export function toInstagramApiUrl(url: string): string {
  const trimmed = url.split('?')[0] ?? url;
  const normalized = trimmed.replace(/\/+$/, '');
  const match = normalized.match(/instagram\.com\/(?:p|reel)\/([^/?#]+)/);
  if (!match?.[1]) return normalized.endsWith('/') ? normalized : `${normalized}/`;
  return `https://www.instagram.com/p/${match[1]}/`;
}

export function buildInstagramHeaders(sessionId: string): Record<string, string> {
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const languages = [
    'en-US,en;q=0.9',
    'en-US,en;q=0.8',
    'en-GB,en;q=0.8',
  ];
  const acceptEncodings = ['gzip, deflate, br', 'gzip, br'];
  const lang = languages[Math.floor(Math.random() * languages.length)] || languages[0] || '';
  const enc =
    acceptEncodings[Math.floor(Math.random() * acceptEncodings.length)] ||
    acceptEncodings[0] ||
    '';
  return {
    Cookie: `sessionid=${sessionId};`,
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
  method: 'POST';
  body: string;
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
  warning: (message: string, data?: Record<string, unknown>) => void;
};

export async function fetchGraphqlComments(params: {
  shortcode: string;
  maxComments: number;
  sessionId: string;
  proxyConfiguration: ProxyConfiguration;
  request: GraphqlRequest;
  logger: GraphqlLogger;
}): Promise<Array<{ username: string; text: string }>> {
  const { shortcode, maxComments, sessionId, proxyConfiguration, request, logger } = params;
  const endpoint = 'https://www.instagram.com/graphql/query/';
  const docId = '8845758582119845';
  const pageSize = Math.min(50, Math.max(10, maxComments));
  let after: string | null = null;
  const results: Array<{ username: string; text: string }> = [];

  for (let page = 0; page < 40 && results.length < maxComments; page += 1) {
    const variables: Record<string, unknown> = {
      shortcode,
      first: pageSize,
    };
    if (after) variables['after'] = after;

    let proxyUrl: string | undefined;
    try {
      const proxyInfo = await proxyConfiguration?.newProxyInfo();
      proxyUrl = proxyInfo?.url ?? undefined;
    } catch {
      proxyUrl = undefined;
    }

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
          ...buildInstagramHeaders(sessionId),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        proxyUrl,
        timeout: { request: 30000 },
        retry: { limit: 0 },
      });

      const statusCode = response.statusCode;
      const location = response.headers?.['location'];
      const isLoginRedirect = typeof location === 'string' && location.includes('login');
      const blocked =
        statusCode === 403 ||
        statusCode === 429 ||
        (statusCode === 302 && isLoginRedirect);
      if (blocked) {
        logger.warning('GraphQL blocked', {
          shortcode,
          statusCode,
          location: location ?? null,
          responseHeaders: response.headers ?? null,
        });
        return results;
      }

      const payload = safeJsonParse(response.body?.toString() ?? '');
      if (!payload) return results;

      const parsed = parseGraphqlComments(payload);
      if (parsed.comments.length === 0) return results;

      results.push(...parsed.comments);
      after = parsed.endCursor ?? null;
      if (!parsed.hasNextPage || !after) break;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warning('GraphQL fallback failed', { shortcode, error: msg });
      return results;
    }
  }

  return results.slice(0, maxComments);
}

function parseGraphqlComments(data: unknown): {
  comments: Array<{ username: string; text: string }>;
  hasNextPage: boolean;
  endCursor?: string;
} {
  const media =
    (data as any)?.data?.shortcode_media ??
    (data as any)?.data?.xdt_shortcode_media ??
    (data as any)?.shortcode_media;

  const edge = media?.edge_media_to_parent_comment ?? media?.edge_media_to_comment;
  const edges = edge?.edges ?? [];
  const comments: Array<{ username: string; text: string }> = [];
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
