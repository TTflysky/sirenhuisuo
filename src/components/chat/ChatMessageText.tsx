import { useEffect, useMemo, useState } from 'react';
import { BUS_CHANNELS, onBus } from '../../ipcBus';
import { loadOutputsByScope, type OutputRecord, type OutputScope } from '../../data/outputs';
import { linkify } from '../../utils/linkify';

interface Props {
  content: string;
  scope: OutputScope;
  outputs?: OutputRecord[];
  onOpenOutput: (output: OutputRecord) => void;
}

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

  const referenced = useMemo(() => [...new Map(loadedOutputs.map((output) => [output.filename, output])).values()]
    .filter((output) => output.filename && content.includes(output.filename))
    .sort((a, b) => b.filename.length - a.filename.length), [content, loadedOutputs]);

  if (!referenced.length) return <>{linkify(content)}</>;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let nodeIndex = 0;
  while (cursor < content.length) {
    let matched: OutputRecord | undefined;
    let matchedAt = Number.POSITIVE_INFINITY;
    for (const output of referenced) {
      const index = content.indexOf(output.filename, cursor);
      if (index >= 0 && index < matchedAt) { matched = output; matchedAt = index; }
    }
    if (!matched) {
      nodes.push(...linkify(content.slice(cursor)).map((node) => <span key={`text-${nodeIndex++}`}>{node}</span>));
      break;
    }
    if (matchedAt > cursor) nodes.push(...linkify(content.slice(cursor, matchedAt)).map((node) => <span key={`text-${nodeIndex++}`}>{node}</span>));
    nodes.push(<button type="button" className="msg-output-link" key={`output-${nodeIndex++}`} onClick={() => onOpenOutput(matched!)} title="在交付物中定位">{matched.filename}</button>);
    cursor = matchedAt + matched.filename.length;
  }
  return <>{nodes}</>;
}
