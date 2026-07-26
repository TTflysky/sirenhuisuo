import type { MouseEvent, ReactNode } from 'react';

const BARE_URL_RE = /https?:\/\/[^\s<"'>，。！？）】]+/gi;
const MARKDOWN_URL_RE = /\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/gi;

function openExternal(event: MouseEvent<HTMLAnchorElement>, url: string) {
  event.stopPropagation();
  if (!window.electronAPI?.openExternal) return;
  event.preventDefault();
  void window.electronAPI.openExternal(url);
}

function renderBareUrls(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of text.matchAll(BARE_URL_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(<span key={`${keyPrefix}-text-${index++}`}>{text.slice(cursor, start)}</span>);
    const url = match[0];
    nodes.push(
      <a key={`${keyPrefix}-url-${index++}`} href={url} target="_blank" rel="noopener noreferrer" onClick={(event) => openExternal(event, url)}>
        {url}
      </a>,
    );
    cursor = start + url.length;
  }
  if (cursor < text.length) nodes.push(<span key={`${keyPrefix}-text-${index++}`}>{text.slice(cursor)}</span>);
  return nodes.length ? nodes : [<span key={`${keyPrefix}-text`}>{text}</span>];
}

/** Render Markdown and bare HTTP links, using the system browser in Electron. */
export function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of text.matchAll(MARKDOWN_URL_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(...renderBareUrls(text.slice(cursor, start), `part-${index++}`));
    const label = match[1];
    const url = match[2];
    nodes.push(
      <a key={`markdown-${index++}`} href={url} target="_blank" rel="noopener noreferrer" onClick={(event) => openExternal(event, url)}>
        {label}
      </a>,
    );
    cursor = start + match[0].length;
  }
  if (cursor < text.length) nodes.push(...renderBareUrls(text.slice(cursor), `part-${index++}`));
  return nodes.length ? nodes : [<span key="text">{text}</span>];
}

/** Render bare URLs as HTML for trusted, already-escaped preview content. */
export function linkifyHtml(text: string): string {
  return text.replace(BARE_URL_RE, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}
