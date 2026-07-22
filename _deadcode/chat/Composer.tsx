import { useState, useRef } from 'react';
import type { KeyboardEvent, ChangeEvent } from 'react';
import { useStore } from '../store';
import type { RoleId } from '../types';
import MentionPicker from './MentionPicker';

const MENTION_MAP: Record<string, RoleId> = {
  '@PM': 'pm',
  '@Planner': 'planner',
  '@Coder': 'coder',
  '@Checker': 'checker',
  '@老汤': 'human',
};

export default function Composer() {
  const { sendMessage } = useStore();
  const [text, setText] = useState('');
  const [showMention, setShowMention] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const submit = async () => {
    const content = text.trim();
    if (!content) return;
    const mentions = (Object.keys(MENTION_MAP) as string[])
      .filter((k) => content.includes(k))
      .map((k) => MENTION_MAP[k]);
    await sendMessage('human', content, mentions);
    setText('');
    setShowMention(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setText(v);
    setShowMention(false);
  };

  const insertMention = (label: string) => {
    setText((t) => t + label + ' ');
    setShowMention(false);
    taRef.current?.focus();
  };

  return (
    <div className="composer">
      {showMention && <MentionPicker onPick={insertMention} />}
      <div className="row">
        <textarea
          ref={taRef}
          value={text}
          placeholder="说点什么… 点 @ 按钮提及角色，Enter 发送"
          onChange={onChange}
          onKeyDown={onKeyDown}
        />
        <button className="btn primary" onClick={submit} disabled={!text.trim()}>
          发送 ➤
        </button>
      </div>
      <div className="hint">
        你是「老汤」，可 @PM / @Planner / @Coder / @Checker / @老汤 插话
        <button
          className="btn"
          style={{ marginLeft: 8, padding: '2px 8px' }}
          onClick={() => setShowMention((s) => !s)}
        >
          @ 提及
        </button>
      </div>
    </div>
  );
}
