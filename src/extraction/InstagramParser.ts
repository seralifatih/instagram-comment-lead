export interface Comment {
  username: string;
  text: string;
}

export interface Post {
  id: string | null;
  shortcode: string | null;
  caption: string | null;
  likeCount: number | null;
  commentCount: number | null;
  timestamp: number | null;
  ownerUsername: string | null;
}

export interface ParseResult {
  post?: Post;
  comments: Comment[];
}

export function parsePost(html: string): ParseResult {
  if (!html) return { comments: [] };

  const htmlParsed = parseHtmlResponse(html);
  if (htmlParsed.post || htmlParsed.comments.length > 0) return htmlParsed;

  const directJson = safeJsonParse(html);
  if (directJson) {
    const parsed = parseInstagramJson(directJson);
    if (parsed.post || parsed.comments.length > 0) return parsed;
  }

  const embeddedJson = extractEmbeddedJson(html);
  if (embeddedJson) {
    const parsed = parseInstagramJson(embeddedJson);
    if (parsed.post || parsed.comments.length > 0) return parsed;
  }

  return { comments: [] };
}

export function parseHtmlResponse(html: string): ParseResult {
  if (!html) return { comments: [] };

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? '';
  if (title.toLowerCase().includes('login')) {
    throw new Error('LOGIN_WALL_DETECTED');
  }

  if (
    !html.includes('edge_media_to_parent_comment') &&
    !html.includes('edge_media_to_comment')
  ) {
    console.warn('HTML_MISSING_DATA_KEYS');
  }

  const xdtData = extractXdtJson(html);
  if (xdtData) {
    const parsed = parseXdtJson(xdtData);
    if (parsed.post || parsed.comments.length > 0) return parsed;
  }

  const additionalData = extractAdditionalDataJson(html);
  if (additionalData) {
    const parsed = parseInstagramJson(additionalData);
    if (parsed.post || parsed.comments.length > 0) return parsed;
  }

  const sharedData = extractSharedDataJson(html);
  if (sharedData) {
    const parsed = parseInstagramJson(sharedData);
    if (parsed.post || parsed.comments.length > 0) return parsed;
  }

  const dirty = extractCommentsFromDirtyHtml(html);
  if (dirty.comments.length > 0) return dirty;

  return { comments: [] };
}

export function extractShortcode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel)\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractEmbeddedJson(body: string): unknown | null {
  return (
    extractXdtJson(body) ??
    extractAdditionalDataJson(body) ??
    extractSharedDataJson(body) ??
    extractNextDataJson(body)
  );
}

function parseInstagramJson(data: unknown): ParseResult {
  const comments: Comment[] = [];

  const media =
    (data as any)?.graphql?.shortcode_media ??
    (data as any)?.data?.shortcode_media ??
    (data as any)?.items?.[0] ??
    (data as any)?.props?.pageProps?.shortcode_media ??
    (data as any)?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media ??
    (data as any)?.entry_data?.PostPage?.[0]?.items?.[0];

  if (!media) {
    return { comments };
  }

  const post: Post = {
    id: media.id ?? null,
    shortcode: media.shortcode ?? null,
    caption:
      media?.edge_media_to_caption?.edges?.[0]?.node?.text ??
      media?.caption?.text ??
      null,
    likeCount:
      media?.edge_media_preview_like?.count ??
      media?.like_count ??
      null,
    commentCount:
      media?.edge_media_to_parent_comment?.count ??
      media?.comment_count ??
      null,
    timestamp: media?.taken_at_timestamp ?? media?.taken_at ?? null,
    ownerUsername: media?.owner?.username ?? media?.user?.username ?? null,
  };

  const edges = media?.edge_media_to_parent_comment?.edges ?? media?.comments ?? [];
  for (const edge of edges) {
    const node = edge?.node ?? edge;
    const username = node?.owner?.username ?? node?.user?.username ?? '';
    const text = node?.text ?? '';
    if (username && text) comments.push({ username, text });
  }

  return { post, comments };
}

function extractXdtJson(html: string): unknown | null {
  const match = html.match(
    /<script[^>]*type="application\/json"[^>]*>\s*({[\s\S]*?})\s*<\/script>/,
  );
  if (!match?.[1]) return null;
  const parsed = safeJsonParse(match[1]);
  const hasXdt =
    (parsed as any)?.data?.xdt_api__v1__media__shortcode__web_info ??
    (parsed as any)?.xdt_api__v1__media__shortcode__web_info;
  return hasXdt ? parsed : null;
}

function extractAdditionalDataJson(html: string): unknown | null {
  const additionalDataMatch = html.match(
    /window\.__additionalDataLoaded\([^,]+,\s*([\s\S]*?)\);/,
  );
  if (!additionalDataMatch?.[1]) return null;
  return safeJsonParse(additionalDataMatch[1]);
}

function extractSharedDataJson(html: string): unknown | null {
  const sharedDataMatch = html.match(/window\._sharedData\s*=\s*(\{[\s\S]*?\});/);
  if (!sharedDataMatch?.[1]) return null;
  return safeJsonParse(sharedDataMatch[1]);
}

function extractNextDataJson(html: string): unknown | null {
  const nextDataMatch = html.match(
    /<script type="application\/json" id="__NEXT_DATA__">([\s\S]*?)<\/script>/,
  );
  if (!nextDataMatch?.[1]) return null;
  return safeJsonParse(nextDataMatch[1]);
}

function parseXdtJson(data: unknown): ParseResult {
  const comments: Comment[] = [];
  const media =
    (data as any)?.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0] ??
    (data as any)?.xdt_api__v1__media__shortcode__web_info?.items?.[0];

  if (!media) return { comments };

  const post: Post = {
    id: media.id ?? null,
    shortcode: media.code ?? media.shortcode ?? null,
    caption: media?.caption?.text ?? null,
    likeCount: media?.like_count ?? null,
    commentCount: media?.comment_count ?? null,
    timestamp: media?.taken_at ?? null,
    ownerUsername: media?.user?.username ?? null,
  };

  const commentItems = media?.comments ?? media?.preview_comments ?? [];
  for (const item of commentItems) {
    const username = item?.user?.username ?? '';
    const text = item?.text ?? '';
    if (username && text) comments.push({ username, text });
  }

  return { post, comments };
}

function extractCommentsFromDirtyHtml(html: string): ParseResult {
  const candidates: Comment[] = [];
  const seen = new Set<string>();

  const uiPhrases = new Set([
    'log in',
    'log in to instagram',
    'sign up',
    'instagram',
    'sign up for instagram',
    'create account',
    'open in app',
  ]);

  const textRegex = /"text"\s*:\s*"([^"]*)"/g;
  let match: RegExpExecArray | null = null;
  while ((match = textRegex.exec(html)) !== null) {
    const raw = match[1] ?? '';
    const decoded = raw
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>')
      .replace(/\\u0026/g, '&')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    const normalized = decoded.trim();
    if (!normalized) continue;
    if (uiPhrases.has(normalized.toLowerCase())) continue;
    if (normalized.length > 400) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push({ username: '', text: normalized });
  }

  const requireLazyParsed = extractRequireLazyShortcodeMedia(html);
  if (requireLazyParsed.comments.length > 0 || requireLazyParsed.post) {
    return {
      post: requireLazyParsed.post,
      comments: requireLazyParsed.comments.length > 0 ? requireLazyParsed.comments : candidates,
    };
  }

  return { comments: candidates };
}

function extractRequireLazyShortcodeMedia(html: string): ParseResult {
  const regex = /"shortcode_media"\s*:\s*(\{[\s\S]*?\})\s*(?:,|\})/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    const parsed = safeJsonParse(raw);
    if (!parsed) continue;
    const wrapped = { graphql: { shortcode_media: parsed } };
    const result = parseInstagramJson(wrapped);
    if (result.post || result.comments.length > 0) return result;
  }
  return { comments: [] };
}
