import React, { useEffect, useMemo, useState } from 'react';
import { BUS_CHANNELS, onBus } from '../../ipcBus';
import { loadOutputsByScope, type OutputRecord, type OutputScope } from '../../data/outputs';
import { linkify } from '../../utils/linkify';

interface Props {
  content: string;
  scope: OutputScope;
  outputs?: OutputRecord[];
  onOpenOutput: (output: OutputRecord) => void;
}

const basename = (filename: string) => filename.replace(/\\/g, '/').split('/').pop() || filename;

export default function ChatMessageText({ content, scope, outputs: providedOutputs, onOpenOutput }: Props) {
  const [loadedOutputs, setLoadedOutputs] = useState<OutputRecord[]>(() => providedOutputs ?? loadOutputsByScope(scope));

  useEffect(() => {
    if (providedOutputs) {
      setLoadedOutputs(providedOutputs);
      return;
    }
    const refresh = () => setLoadedOutputs(loadOutputsByScope(scope));
    refresh();
    return onBus(BUS_CHANNELS.OUTPUTS_CHANGED, (payload) => {
      const changedScope = typeof payload === 'object' && payload !== null && 'scope' in payload
        ? (payload as { scope?: string }).scope
        : undefined;
      if (!changedScope || changedScope === scope || changedScope === 'global') refresh();
    });
  }, [providedOutputs, scope]);

  const displayContent = useMemo(() => content.replace(/\[([^\]]+)]\((sandbox:[^)]+)\)/gi, (_whole, label: string, rawPath: string) => {
    let decoded = rawPath;
    try { decoded = decodeURIComponent(rawPath); } catch {}
    const targetName = basename(decoded).trim().toLowerCase();
    const output = loadedOutputs.find((item) => {
      const outputName = basename(item.filename).toLowerCase();
      return outputName === targetName || (outputName && label.toLowerCase().includes(outputName));
    });
    return output?.filename ?? `${label}（未找到对应产出物）`;
  }), [content, loadedOutputs]);

  const referenced = useMemo(() => [...new Map(loadedOutputs.map((output) => [output.filename, output])).values()]
    .filter((output) => output.filename && (displayContent.includes(output.filename) || displayContent.includes(basename(output.filename))))
    .sort((a, b) => b.filename.length - a.filename.length), [displayContent, loadedOutputs]);

  const markdown = (value: string): React.ReactNode[] => value.split(/\r?\n/gu).map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return <br key={`br-${index}`} />;
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/u);
    const body = heading ? heading[2] : trimmed;
    const parts = body.split(/(\*\*[^*]+\*\*|`[^`]+`)/gu).filter(Boolean).map((part, partIndex) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`')) return <code key={partIndex}>{part.slice(1, -1)}</code>;
      return <span key={partIndex}>{linkify(part)}</span>;
    });
    if (heading) {
      const Heading = `h${heading[1].length}` as 'h1' | 'h2' | 'h3';
      return React.createElement(Heading, { key: `h-${index}` }, parts);
    }
    return <p key={`p-${index}`}>{parts}</p>;
  });
  if (!referenced.length) return <div className="chat-markdown-content">{markdown(displayContent)}</div>;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let nodeIndex = 0;
  while (cursor < displayContent.length) {
    let matched: OutputRecord | undefined;
    let matchedText = '';
    let matchedAt = Number.POSITIVE_INFINITY;
    for (const output of referenced) {
      for (const candidate of [...new Set([output.filename, basename(output.filename)])]) {
        const index = displayContent.indexOf(candidate, cursor);
        if (index >= 0 && index < matchedAt) {
          matched = output;
          matchedText = candidate;
          matchedAt = index;
        }
      }
    }
    if (!matched) {
      nodes.push(...linkify(displayContent.slice(cursor)).map((node) => <span key={`text-${nodeIndex++}`}>{node}</span>));
      break;
    }
    if (matchedAt > cursor) nodes.push(...linkify(displayContent.slice(cursor, matchedAt)).map((node) => <span key={`text-${nodeIndex++}`}>{node}</span>));
    nodes.push(
      <button type="button" className="msg-output-link" key={`output-${nodeIndex++}`} onClick={() => onOpenOutput(matched!)} title="在交付文件中定位">
        {matchedText}
      </button>,
    );
    cursor = matchedAt + matchedText.length;
  }
  return <>{nodes}</>;
}
