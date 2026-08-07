import type { Attachment, ChatTurn, ContentPart, ImagePart } from './hermesClient';

/** Adds image attachments to the most recent user turn for multimodal model requests. */
export function attachImagesToLatestUserTurn(turns: ChatTurn[], attachments?: Attachment[]): ChatTurn[] {
  if (!attachments?.length) return turns;

  const lastUserIdx = turns.map((turn) => turn.role).lastIndexOf('user');
  if (lastUserIdx < 0) return turns;

  const latestTurn = turns[lastUserIdx];
  const textPart: ContentPart = {
    type: 'text',
    text: typeof latestTurn.content === 'string' ? latestTurn.content : '',
  };
  const imageParts: ImagePart[] = attachments
    .filter((attachment) => attachment.kind === 'image' && attachment.dataUrl)
    .map((attachment) => ({ type: 'image_url', image_url: { url: attachment.dataUrl! } }));

  if (!imageParts.length) return turns;
  return turns.map((turn, index) => index === lastUserIdx
    ? { ...turn, content: [textPart, ...imageParts] }
    : turn);
}
