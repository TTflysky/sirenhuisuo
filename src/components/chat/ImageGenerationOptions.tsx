import { useEffect, useState } from 'react';
import { PictureOutlined } from '@ant-design/icons';
import { Segmented, Select } from 'antd';
import type { ModelConfig } from '../../types';
import {
  getConversationModel,
  isImageGenerationModel,
  loadSettings,
  type ChatModelScene,
} from '../../data/hermesClient';
import { getImageGenerationOptions, saveImageGenerationOptions } from '../../data/imageGenerationSettings';
import {
  IMAGE_ASPECT_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
  isGptImage2,
  resolveImageSpecification,
  type ImageAspectRatio,
  type ImageGenerationOptions,
  type ImageQuality,
  type ImageResolutionTier,
} from '../../engine/imageSpecifications.mjs';

interface Props {
  scene: ChatModelScene;
  modelConfig?: ModelConfig;
}

function effectiveModel(scene: ChatModelScene, modelConfig?: ModelConfig): ModelConfig {
  const selected = getConversationModel(scene);
  const hasSceneOverride = Boolean(loadSettings().chatModelOverrides?.[scene]);
  return hasSceneOverride || scene !== 'dm' ? selected : (modelConfig ?? selected);
}

export default function ImageGenerationOptions({ scene, modelConfig }: Props) {
  const [, setRevision] = useState(0);
  const [options, setOptions] = useState<ImageGenerationOptions>(() => getImageGenerationOptions(scene));
  const model = effectiveModel(scene, modelConfig);
  const supportsCustomSize = isGptImage2(model.model ?? '');

  useEffect(() => {
    const refresh = () => {
      setOptions(getImageGenerationOptions(scene));
      setRevision((value) => value + 1);
    };
    window.addEventListener('taiji-settings:changed', refresh);
    return () => window.removeEventListener('taiji-settings:changed', refresh);
  }, [scene]);

  if (!isImageGenerationModel(model)) return null;

  const specification = resolveImageSpecification(model.model ?? '', options);
  const update = (partial: Partial<ImageGenerationOptions>) => {
    setOptions(saveImageGenerationOptions(scene, { ...options, ...partial }));
  };

  return (
    <section className="image-generation-options" aria-label="图片输出规格">
      <div className="image-generation-options-heading">
        <PictureOutlined />
        <strong>输出规格</strong>
        <span>{specification.width} x {specification.height}px</span>
      </div>
      <div className="image-generation-options-control">
        <span>画幅</span>
        <Segmented
          size="small"
          value={options.aspectRatio}
          options={IMAGE_ASPECT_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
          onChange={(value) => update({ aspectRatio: value as ImageAspectRatio })}
          aria-label="图片画幅"
        />
      </div>
      <div className="image-generation-options-control">
        <span>清晰度</span>
        <Segmented
          size="small"
          value={supportsCustomSize ? options.resolution : 'standard'}
          disabled={!supportsCustomSize}
          options={IMAGE_RESOLUTION_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
          onChange={(value) => update({ resolution: value as ImageResolutionTier })}
          aria-label="图片清晰度"
        />
      </div>
      <label className="image-generation-options-quality">
        <span>质量</span>
        <Select
          size="small"
          value={options.quality}
          options={IMAGE_QUALITY_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
          onChange={(value) => update({ quality: value as ImageQuality })}
          aria-label="图片生成质量"
          popupMatchSelectWidth={false}
        />
      </label>
      {!supportsCustomSize && <small className="image-generation-options-note">当前模型仅支持兼容尺寸；切换到 GPT Image 2 可选 2K、2.7K 和 4K。</small>}
    </section>
  );
}
