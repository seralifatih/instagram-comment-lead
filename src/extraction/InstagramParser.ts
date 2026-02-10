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
  const sharedDataMatch = body.match(/window\._sharedData\s*=\s*(\{[\s\S]*?\});/);
  if (sharedDataMatch?.[1]) {
    return safeJsonParse(sharedDataMatch[1]);
  }

  const nextDataMatch = body.match(
    /<script type="application\/json" id="__NEXT_DATA__">([\s\S]*?)<\/script>/,
  );
  if (nextDataMatch?.[1]) {
    return safeJsonParse(nextDataMatch[1]);
  }

  const additionalDataMatch = body.match(
    /window\.__additionalDataLoaded\([^,]+,\s*([\s\S]*?)\);/,
  );
  if (additionalDataMatch?.[1]) {
    return safeJsonParse(additionalDataMatch[1]);
  }

  return null;
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
