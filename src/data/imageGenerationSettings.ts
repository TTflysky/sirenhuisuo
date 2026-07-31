import { loadSettings, saveSettings, type ChatModelScene } from './hermesClient';
import {
  normalizeImageGenerationOptions,
  type ImageGenerationOptions,
} from '../engine/imageSpecifications.mjs';

export function getImageGenerationOptions(scene: ChatModelScene): ImageGenerationOptions {
  return normalizeImageGenerationOptions(loadSettings().imageGenerationOptions?.[scene]);
}

export function saveImageGenerationOptions(scene: ChatModelScene, options: Partial<ImageGenerationOptions>): ImageGenerationOptions {
  const settings = loadSettings();
  const normalized = normalizeImageGenerationOptions(options);
  settings.imageGenerationOptions = { ...settings.imageGenerationOptions, [scene]: normalized };
  saveSettings(settings);
  return normalized;
}
