import type { Attachment } from '../../data/hermesClient';

interface Props {
  attachments?: Attachment[];
}

/** Render persisted generated images in the chat history, not only in the composer preview. */
export default function GeneratedImagePreview({ attachments }: Props) {
  const images = attachments?.filter((attachment) => attachment.kind === 'image' && attachment.dataUrl) ?? [];
  if (!images.length) return null;
  return (
    <div className="chat-generated-images">
      {images.map((image) => (
        <a key={`${image.name}-${image.dataUrl}`} href={image.dataUrl} download={image.name} title="Open or save image">
          <img src={image.dataUrl} alt={image.name} />
        </a>
      ))}
    </div>
  );
}
