import type { ReactNode } from 'react';
const URL_RE = /(https?:\/\/[^\s<"'>）)]+)/gi;

/**
 * 将文本中的 URL 转换为可点击的 <a> 标签
 * @returns ReactNode 片段数组
 */
export function linkify(text: string): ReactNode[] {
  const parts = text.split(URL_RE);
  return parts.map((part, i) => {
    if (URL_RE.test(part)) {
      // 重新 test 后 lastIndex 变了，重置
      URL_RE.lastIndex = 0;
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/**
 * 将文本中的 URL 渲染为链接的 HTML 字符串（用于 dangerouslySetInnerHTML）
 */
export function linkifyHtml(text: string): string {
  return text.replace(URL_RE, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}
