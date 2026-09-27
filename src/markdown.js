import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.use({ gfm: true, breaks: true });

export function renderMarkdown(markdown) {
  const rendered = marked.parse(markdown);
  return sanitizeHtml(rendered, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'video', 'source', 'iframe', 'figure', 'figcaption']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      video: ['src', 'controls', 'preload', 'poster', 'width', 'height', 'playsinline'],
      source: ['src', 'type'],
      iframe: ['src', 'title', 'width', 'height', 'loading', 'referrerpolicy', 'sandbox', 'allow', 'allowfullscreen'],
      code: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https'],
      video: ['http', 'https'],
      source: ['http', 'https'],
      iframe: ['https'],
    },
    allowProtocolRelative: false,
    allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'],
    allowIframeRelativeUrls: true,
    exclusiveFilter(frame) {
      if (frame.tag !== 'iframe') return false;
      const source = frame.attribs.src || '';
      if (source.startsWith('/media/')) return false;
      try {
        return !['www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'].includes(new URL(source).hostname);
      } catch {
        return true;
      }
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
      img: sanitizeHtml.simpleTransform('img', { loading: 'lazy' }, true),
      video: sanitizeHtml.simpleTransform('video', { controls: '', preload: 'metadata', playsinline: '' }, true),
      iframe: sanitizeHtml.simpleTransform('iframe', { loading: 'lazy', referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-presentation' }, true),
    },
  });
}

export function extractMediaIds(markdown) {
  const html = renderMarkdown(markdown);
  const ids = new Set();
  const attributePattern = /(?:src|href|poster)="((?:https?:\/\/[^/"\s]+)?\/media\/([a-f0-9-]{36})(?:[?#][^"]*)?)"/gi;
  for (const match of html.matchAll(attributePattern)) ids.add(match[2].toLowerCase());
  return ids;
}
