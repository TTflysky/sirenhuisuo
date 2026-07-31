import { describe, expect, it } from 'vitest';
import {
  GPT_IMAGE_2_LIMITS,
  IMAGE_ASPECT_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
  normalizeImageGenerationOptions,
  resolveImageSpecification,
} from '../../src/engine/imageSpecifications.mjs';

describe('GPT Image 2 output specifications', () => {
  it('covers every supported aspect ratio and resolution tier', () => {
    for (const resolution of IMAGE_RESOLUTION_OPTIONS) {
      for (const aspectRatio of IMAGE_ASPECT_OPTIONS) {
        const spec = resolveImageSpecification('gpt-image-2', {
          aspectRatio: aspectRatio.value,
          resolution: resolution.value,
          quality: 'high',
        });
        expect(spec.size).toBe(`${spec.width}x${spec.height}`);
        expect(spec.width % GPT_IMAGE_2_LIMITS.edgeMultiple).toBe(0);
        expect(spec.height % GPT_IMAGE_2_LIMITS.edgeMultiple).toBe(0);
        expect(Math.max(spec.width, spec.height)).toBeLessThanOrEqual(GPT_IMAGE_2_LIMITS.maxEdge);
        expect(Math.max(spec.width, spec.height) / Math.min(spec.width, spec.height)).toBeLessThanOrEqual(GPT_IMAGE_2_LIMITS.maxAspectRatio);
        expect(spec.pixels).toBeGreaterThanOrEqual(GPT_IMAGE_2_LIMITS.minPixels);
        expect(spec.pixels).toBeLessThanOrEqual(GPT_IMAGE_2_LIMITS.maxPixels);
      }
    }
  });

  it('normalizes unknown persisted values to safe defaults', () => {
    expect(normalizeImageGenerationOptions({
      aspectRatio: '21:9',
      resolution: '8k',
      quality: 'ultra',
    })).toEqual({ aspectRatio: '1:1', resolution: 'standard', quality: 'auto' });
  });

  it('keeps older compatible image APIs on their supported size set', () => {
    const spec = resolveImageSpecification('gpt-image-1', { aspectRatio: '16:9', resolution: '4k' });
    expect(spec.customSizeSupported).toBe(false);
    expect(spec.effectiveResolution).toBe('standard');
    expect(spec.size).toBe('1536x1024');
  });
});
