import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildImageEditFormData, dataUrlToBlob, selectEditableImage } from '../src/engine/imageRequest.mjs';

const read = (file) => fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [client, settings, assistant, dm, team, selector, avatarPicker, preview, persona, personaStore] = await Promise.all([
  read('src/data/hermesClient.ts'),
  read('src/components/settings/SettingsModal.tsx'),
  read('src/components/chat/AssistantChat.tsx'),
  read('src/components/chat/DmChatApp.tsx'),
  read('src/components/chat/TeamChatApp.tsx'),
  read('src/components/chat/ModelSelector.tsx'),
  read('src/components/sidebar/EmployeeAvatarPicker.tsx'),
  read('src/components/chat/GeneratedImagePreview.tsx'),
  read('src/components/settings/AssistantSettingsModal.tsx'),
  read('src/data/assistantPrompt.ts'),
]);

assert.match(client, /export function isImageGenerationModel/u, '模型库必须识别图像模型');
assert.match(client, /export function buildImageGenerationRequest/u, '生图请求必须集中构造');
assert.match(client, /\^gpt-image-2\$/iu, 'gpt-image-2 必须有专用兼容分支');
assert.match(client, /request\.output_format = 'png'/u, 'gpt-image-2 必须使用 output_format');
assert.match(client, /else request\.response_format = 'b64_json'/u, '旧兼容接口必须保留 response_format 回退');
assert.match(client, /sourceImage \? '\/images\/edits' : '\/images\/generations'/u, '有输入图片时必须路由到图片编辑接口');
assert.match(client, /init\.body instanceof FormData/u, 'multipart 请求不得被强制覆盖为 JSON Content-Type');
assert.match(client, /getConversationModel/u, '聊天模型切换必须与角色默认模型分离');
assert.match(client, /imageModel \? '\/images\/generations' : '\/chat\/completions'/u, '连接测试必须按模型能力选择端点');

assert.match(settings, /startAddGptImage2/u, '设置页必须有 GPT Image 2 快捷添加');
assert.match(settings, /getModelCapabilities\(entry\)\.includes\('image'\)/u, '设置页必须明确标记图像模型');
assert.match(settings, /const diagnosticModels = library\.filter\(\(model\) => getModelCapabilities\(model\)\.includes\('chat'\)\)/u, '诊断优化只能选择聊天模型');
assert.match(settings, /\.\.\.diagnosticModels\.map\(\(model\) => \(\{ value: model\.id, label: model\.label \}\)\)/u, '诊断优化菜单必须使用聊天模型候选');
assert.match(settings, /\.\.\.imageModels\.map\(\(model\) => \(\{ value: model\.id, label: model\.label \}\)\)/u, '头像生图菜单必须使用图像模型候选');
assert.match(avatarPicker, /filter\(\(model\) => getModelCapabilities\(model\)\.includes\('image'\)\)/u, '头像生成只能选择图像模型');

for (const [name, source] of [['assistant', assistant], ['dm', dm], ['team', team]]) {
  assert.match(source, /isImageGenerationModel/u, `${name} 聊天必须识别图像模式`);
  assert.match(source, /generateImage/u, `${name} 聊天必须调用通用生图能力`);
  assert.match(source, /GeneratedImagePreview/u, `${name} 聊天必须展示生成结果`);
  assert.match(source, /generateImage\([^;]+(?:atts|imageAtts|attachments)[^;]*getImageGenerationOptions\(/u, `${name} 聊天必须把本轮图片附件和输出规格传入请求`);
}
assert.match(selector, /chatModelOverrides/u, '聊天内切换必须保存为场景覆盖，而不是污染默认职责模型');
assert.match(selector, /getModelCapabilities\(entry\)\.includes\('image'\)/u, '聊天模型菜单必须标记图像模型');
assert.match(preview, /download=\{image\.name\}/u, '生成图片必须可保存');
assert.match(persona, /DEFAULT_PROMPT_VERSION = '18'/u, '内置助理人格必须随版本升级');
assert.match(persona, /图片模型收到图片附件时，目标是编辑该图片/u, '人格必须承认当前图片是编辑输入');
assert.match(personaStore, /appendixSections/u, '旧的自定义人格必须按章节补齐新协议');

const sourceImage = {
  name: 'source.png',
  mime: 'image/png',
  kind: 'image',
  size: 68,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
};
assert.equal(selectEditableImage([sourceImage]), sourceImage, '必须选中当前轮次的真实图片附件');
const sourceBlob = dataUrlToBlob(sourceImage.dataUrl);
assert.equal(sourceBlob.type, 'image/png');
assert.ok(sourceBlob.size > 0, '图片 data URL 必须转换为非空 Blob');
const editForm = buildImageEditFormData('gpt-image-2', '把背景改成浅蓝色', sourceImage);
assert.equal(editForm.get('model'), 'gpt-image-2');
assert.equal(editForm.get('prompt'), '把背景改成浅蓝色');
assert.equal(editForm.get('output_format'), 'png');
assert.ok(editForm.get('image') instanceof Blob, '编辑请求必须携带真实图片二进制');
const wideEditForm = buildImageEditFormData('gpt-image-2', '改成宽屏封面', sourceImage, { aspectRatio: '16:9', resolution: '4k', quality: 'high' });
assert.equal(wideEditForm.get('size'), '3840x2160');
assert.equal(wideEditForm.get('quality'), 'high');

console.log(JSON.stringify({ passed: true, model: 'gpt-image-2', chatSurfaces: 3, imageEdit: 'multipart' }, null, 2));
