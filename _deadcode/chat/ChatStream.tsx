import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import MessageBubble from './MessageBubble';
import Composer from './Composer';

export default function ChatStream() {
  const { state } = useStore();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages.length]);
  return (
    <div className="chat">
      <div className="stream">
        {state.messages.map((m) => (
          <MessageBubble key={m.id} message={m} roles={state.roles} />
        ))}
        <div ref={endRef} />
      </div>
      <Composer />
    </div>
  );
}
