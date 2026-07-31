export interface EditableImageAttachment {
  name: string;
  mime: string;
  dataUrl?: string;
  kind: 'image' | 'text' | 'file';
}

export function isEditableImageAttachment(attachment?: EditableImageAttachment): boolean;
export function selectEditableImage(attachments?: EditableImageAttachment[]): EditableImageAttachment | undefined;
export function dataUrlToBlob(dataUrl: string, fallbackMime?: string): Blob;
export function buildImageEditFormData(model: string, prompt: string, attachment: EditableImageAttachment, options?: import('./imageSpecifications.mjs').ImageGenerationOptions): FormData;
