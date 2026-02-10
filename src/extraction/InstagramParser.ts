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

  const bboxResult = extractBboxJson(html);
  if (bboxResult.comments.length > 0 || bboxResult.post) return bboxResult;

  const requireResult = extractRequireDefineComments(html);
  if (requireResult.comments.length > 0 || requireResult.post) return requireResult;

  const polarisResult = extractPolarisSharedData(html);
  if (polarisResult.comments.length > 0 || polarisResult.post) return polarisResult;

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

  const hasAnyKey =
    html.includes('edge_media_to_parent_comment') ||
    html.includes('edge_media_to_comment') ||
    html.includes('xdt_api__v1') ||
    html.includes('__bbox') ||
    html.includes('preview_comments') ||
    html.includes('"comments":[');

  if (!hasAnyKey) {
    console.warn('HTML_MISSING_DATA_KEYS');
  }

  const dirty = extractCommentsFromDirtyHtml(html);
  if (dirty.comments.length > 0) return dirty;

  return { comments: [] };
}

export function extractShortcode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel)\/([^/?#]+)/);
  return match?.[1] ?? null;
}

const MAX_DEPTH = 14;
const MAX_COMMENTS_PER_CALL = 500;

function extractBboxJson(html: string): ParseResult {
  const bboxMatches = html.matchAll(
    /(?:__bbox|__eqmc)\s*=\s*(\{[\s\S]{20,600000}\})\s*;/g,
  );
  for (const m of bboxMatches) {
    if (!m[1]) continue;
    const data = safeJsonParse(m[1]);
    if (!data) continue;
    const result = deepSearchComments(data);
    if (result.comments.length > 0 || result.post) return result;
  }

  const applyMatches = html.matchAll(
    /handleWithCustomApplyEach\(\s*(\[[\s\S]{10,400000}?\])\s*\)/g,
  );
  for (const m of applyMatches) {
    if (!m[1]) continue;
    const data = safeJsonParse(m[1]);
    if (!data) continue;
    const result = deepSearchComments(data);
    if (result.comments.length > 0 || result.post) return result;
  }

  return { comments: [] };
}

function extractRequireDefineComments(html: string): ParseResult {
  const scriptBlocks: string[] = [];

  const scriptRegex =
    /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    if (match[1] && match[1].length > 100) scriptBlocks.push(match[1]);
  }

  const inlineJsonRegex =
    /(?:self\.__next_f|globalThis\.__RELAY_STORE__|window\.FB_DATA)\s*=\s*(\{[\s\S]{500,}\})/g;
  while ((match = inlineJsonRegex.exec(html)) !== null) {
    if (match[1]) scriptBlocks.push(match[1]);
  }

  for (const block of scriptBlocks) {
    const data = safeJsonParse(block);
    if (!data) continue;
    const result = deepSearchComments(data);
    if (result.comments.length > 0 || result.post) return result;
  }

  return { comments: [] };
}

function extractPolarisSharedData(html: string): ParseResult {
  const polarisMatch = html.match(
    /"(?:PolarisPostRootWithSharedData|PolarisPostAction)"[,\s]*(\{[\s\S]{50,500000}\})\s*(?:\]|\))/, 
  );
  if (polarisMatch?.[1]) {
    const data = safeJsonParse(polarisMatch[1]);
    if (data) {
      const result = deepSearchComments(data);
      if (result.comments.length > 0 || result.post) return result;
    }
  }
  return { comments: [] };
}

function deepSearchComments(data: unknown, depth = 0): ParseResult {
  if (depth > MAX_DEPTH || data === null || typeof data !== 'object') {
    return { comments: [] };
  }

  const obj = data as Record<string, unknown>;

  const text = obj['text'];
  const owner = obj['owner'] as Record<string, unknown> | undefined;
  const user = obj['user'] as Record<string, unknown> | undefined;
  const username =
    (typeof owner?.['username'] === 'string' ? owner['username'] : undefined) ??
    (typeof user?.['username'] === 'string' ? user['username'] : undefined) ??
    (typeof obj['username'] === 'string' ? obj['username'] : undefined);

  if (typeof text === 'string' && text.length > 0 && username) {
    return { comments: [{ username, text }] };
  }

  const commentArrayKeys = [
    'comments',
    'preview_comments',
    'edges',
    'edge_media_to_parent_comment',
    'edge_media_to_comment',
  ];

  for (const key of commentArrayKeys) {
    const val = obj[key];
    if (key === 'edge_media_to_parent_comment' || key === 'edge_media_to_comment') {
      const edgesVal = (val as Record<string, unknown> | undefined)?.['edges'];
      if (Array.isArray(edgesVal) && edgesVal.length > 0) {
        const comments = extractFromEdges(edgesVal, depth);
        if (comments.length > 0) {
          return { comments };
        }
      }
    }
    if (!Array.isArray(val) || val.length === 0) continue;
    const comments = extractFromEdges(val, depth);
    if (comments.length > 0) return { comments };
  }

  const xdtMedia =
    (obj as any)?.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0] ??
    (obj as any)?.xdt_api__v1__media__shortcode__web_info?.items?.[0];
  if (xdtMedia) {
    const r = deepSearchComments(xdtMedia, depth + 1);
    if (r.comments.length > 0 || r.post) return r;
  }

  const allComments: Comment[] = [];
  const seen = new Set<string>();
  let foundPost: Post | undefined;

  for (const value of Object.values(obj)) {
    if (allComments.length >= MAX_COMMENTS_PER_CALL) break;
    if (typeof value !== 'object' || value === null) continue;
    const r = deepSearchComments(value, depth + 1);
    for (const c of r.comments) {
      const key = `${c.username}::${c.text}`;
      if (!seen.has(key)) {
        seen.add(key);
        allComments.push(c);
      }
    }
    if (r.post && !foundPost) foundPost = r.post;
  }

  return { post: foundPost, comments: allComments };
}

function extractFromEdges(edges: unknown[], depth: number): Comment[] {
  const comments: Comment[] = [];
  for (const item of edges) {
    const node: unknown = (item as Record<string, unknown>)?.['node'] ?? item;
    const r = deepSearchComments(node, depth + 1);
    comments.push(...r.comments);
  }
  return comments;
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

  if (!media) return { comments };

  const post: Post = {
    id: media.id ?? null,
    shortcode: media.shortcode ?? null,
    caption: media?.edge_media_to_caption?.edges?.[0]?.node?.text ?? media?.caption?.text ?? null,
    likeCount: media?.edge_media_preview_like?.count ?? media?.like_count ?? null,
    commentCount: media?.edge_media_to_parent_comment?.count ?? media?.comment_count ?? null,
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
  const m = html.match(/window\.__additionalDataLoaded\([^,]+,\s*([\s\S]*?)\);/);
  if (!m?.[1]) return null;
  return safeJsonParse(m[1]);
}

function extractSharedDataJson(html: string): unknown | null {
  const m = html.match(/window\._sharedData\s*=\s*(\{[\s\S]*?\});/);
  if (!m?.[1]) return null;
  return safeJsonParse(m[1]);
}

function extractNextDataJson(html: string): unknown | null {
  const m = html.match(
    /<script type="application\/json" id="__NEXT_DATA__">([\s\S]*?)<\/script>/,
  );
  if (!m?.[1]) return null;
  return safeJsonParse(m[1]);
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
    if (!normalized || uiPhrases.has(normalized.toLowerCase())) continue;
    if (normalized.length > 400) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push({ username: '', text: normalized });
  }

  return { comments: candidates };
}
