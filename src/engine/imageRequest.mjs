const DATA_URL_PATTERN = /^data:([^;,]+)?((?:;[^,]*)*?),(.*)$/su;

export function isEditableImageAttachment(attachment) {
  return attachment?.kind === 'image'
    && typeof attachment.dataUrl === 'string'
    && attachment.dataUrl.startsWith('data:image/');
}

export function selectEditableImage(attachments = []) {
  return attachments.find(isEditableImageAttachment);
}

export function dataUrlToBlob(dataUrl, fallbackMime = 'image/png') {
  const match = DATA_URL_PATTERN.exec(String(dataUrl || ''));
  if (!match) throw new Error('上传图片的数据格式无效，请重新选择图片');

  const mime = match[1] || fallbackMime;
  const metadata = match[2] || '';
  const encoded = match[3] || '';
  let bytes;
  try {
    if (metadata.includes(';base64')) {
      const binary = atob(encoded.replace(/\s/gu, ''));
      bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(encoded));
    }
  } catch {
    throw new Error('上传图片的数据已损坏，请重新选择图片');
  }
  return new Blob([bytes], { type: mime });
}

export function buildImageEditFormData(model, prompt, attachment) {
  if (!isEditableImageAttachment(attachment)) throw new Error('当前附件中没有可编辑的图片');
  const form = new FormData();
  form.append('model', String(model || '').trim());
  form.append('prompt', String(prompt || '').trim());
  form.append('image', dataUrlToBlob(attachment.dataUrl, attachment.mime), attachment.name || 'source.png');
  form.append('n', '1');
  form.append('size', '1024x1024');
  form.append('quality', 'auto');
  if (/^gpt-image-2$/iu.test(String(model || '').trim())) form.append('output_format', 'png');
  else form.append('response_format', 'b64_json');
  return form;
}
