import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (file) => fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [client, settings, assistant, dm, team, selector, avatarPicker, preview] = await Promise.all([
  read('src/data/hermesClient.ts'),
  read('src/components/settings/SettingsModal.tsx'),
  read('src/components/chat/AssistantChat.tsx'),
  read('src/components/chat/DmChatApp.tsx'),
  read('src/components/chat/TeamChatApp.tsx'),
  read('src/components/chat/ModelSelector.tsx'),
  read('src/components/sidebar/EmployeeAvatarPicker.tsx'),
  read('src/components/chat/GeneratedImagePreview.tsx'),
]);

assert.match(client, /export function isImageGenerationModel/u, '模型库必须识别图像模型');
assert.match(client, /export function buildImageGenerationRequest/u, '生图请求必须集中构造');
assert.match(client, /\^gpt-image-2\$/iu, 'gpt-image-2 必须有专用兼容分支');
assert.match(client, /request\.output_format = 'png'/u, 'gpt-image-2 必须使用 output_format');
assert.match(client, /else request\.response_format = 'b64_json'/u, '旧兼容接口必须保留 response_format 回退');
assert.match(client, /getConversationModel/u, '聊天模型切换必须与角色默认模型分离');
assert.match(client, /imageModel \? '\/images\/generations' : '\/chat\/completions'/u, '连接测试必须按模型能力选择端点');

assert.match(settings, /startAddGptImage2/u, '设置页必须有 GPT Image 2 快捷添加');
assert.match(settings, /getModelCapabilities\(entry\)\.includes\('image'\)/u, '设置页必须明确标记图像模型');
assert.match(avatarPicker, /filter\(\(model\) => getModelCapabilities\(model\)\.includes\('image'\)\)/u, '头像生成只能选择图像模型');

for (const [name, source] of [['assistant', assistant], ['dm', dm], ['team', team]]) {
  assert.match(source, /isImageGenerationModel/u, `${name} 聊天必须识别图像模式`);
  assert.match(source, /generateImage/u, `${name} 聊天必须调用通用生图能力`);
  assert.match(source, /GeneratedImagePreview/u, `${name} 聊天必须展示生成结果`);
}
assert.match(selector, /chatModelOverrides/u, '聊天内切换必须保存为场景覆盖，而不是污染默认职责模型');
assert.match(selector, /getModelCapabilities\(entry\)\.includes\('image'\)/u, '聊天模型菜单必须标记图像模型');
assert.match(preview, /download=\{image\.name\}/u, '生成图片必须可保存');

console.log(JSON.stringify({ passed: true, model: 'gpt-image-2', chatSurfaces: 3 }, null, 2));
