const MODEL_MAX_EDGE = 3840;
const MODEL_MAX_PIXELS = 8_294_400;
const MODEL_MIN_PIXELS = 655_360;
const MODEL_MAX_ASPECT_RATIO = 3;

export const IMAGE_ASPECT_OPTIONS = Object.freeze([
  { value: '1:1', label: '1:1', orientation: 'square' },
  { value: '4:3', label: '4:3', orientation: 'landscape' },
  { value: '3:4', label: '3:4', orientation: 'portrait' },
  { value: '16:9', label: '16:9', orientation: 'landscape' },
  { value: '9:16', label: '9:16', orientation: 'portrait' },
]);

export const IMAGE_RESOLUTION_OPTIONS = Object.freeze([
  { value: 'standard', label: '标准' },
  { value: '2k', label: '2K' },
  { value: '2.7k', label: '2.7K' },
  { value: '4k', label: '4K' },
]);

export const IMAGE_QUALITY_OPTIONS = Object.freeze([
  { value: 'auto', label: '自动' },
  { value: 'low', label: '快速' },
  { value: 'medium', label: '均衡' },
  { value: 'high', label: '精细' },
]);

export const DEFAULT_IMAGE_GENERATION_OPTIONS = Object.freeze({
  aspectRatio: '1:1',
  resolution: 'standard',
  quality: 'auto',
});

// GPT Image 2 accepts custom dimensions within the documented edge, aspect,
// alignment and total-pixel limits.
const GPT_IMAGE_2_SIZES = Object.freeze({
  standard: Object.freeze({
    '1:1': [1024, 1024], '4:3': [1024, 768], '3:4': [768, 1024],
    '16:9': [1280, 720], '9:16': [720, 1280],
  }),
  '2k': Object.freeze({
    '1:1': [2048, 2048], '4:3': [2048, 1536], '3:4': [1536, 2048],
    '16:9': [2048, 1152], '9:16': [1152, 2048],
  }),
  '2.7k': Object.freeze({
    '1:1': [2704, 2704], '4:3': [2688, 2016], '3:4': [2016, 2688],
    '16:9': [2704, 1520], '9:16': [1520, 2704],
  }),
  '4k': Object.freeze({
    '1:1': [2880, 2880], '4:3': [3264, 2448], '3:4': [2448, 3264],
    '16:9': [3840, 2160], '9:16': [2160, 3840],
  }),
});

const LEGACY_SIZES = Object.freeze({
  '1:1': [1024, 1024],
  '4:3': [1536, 1024],
  '3:4': [1024, 1536],
  '16:9': [1536, 1024],
  '9:16': [1024, 1536],
});

function allowed(value, options, fallback) {
  return options.some((item) => item.value === value) ? value : fallback;
}

export function normalizeImageGenerationOptions(input = {}) {
  return {
    aspectRatio: allowed(input.aspectRatio, IMAGE_ASPECT_OPTIONS, DEFAULT_IMAGE_GENERATION_OPTIONS.aspectRatio),
    resolution: allowed(input.resolution, IMAGE_RESOLUTION_OPTIONS, DEFAULT_IMAGE_GENERATION_OPTIONS.resolution),
    quality: allowed(input.quality, IMAGE_QUALITY_OPTIONS, DEFAULT_IMAGE_GENERATION_OPTIONS.quality),
  };
}

export function isGptImage2(model) {
  return /^gpt-image-2(?:$|[-:])/iu.test(String(model || '').trim());
}

export function resolveImageSpecification(model, input = {}) {
  const options = normalizeImageGenerationOptions(input);
  const customSizeSupported = isGptImage2(model);
  const pair = customSizeSupported
    ? GPT_IMAGE_2_SIZES[options.resolution][options.aspectRatio]
    : LEGACY_SIZES[options.aspectRatio];
  const [width, height] = pair;
  const pixels = width * height;
  const longToShortRatio = Math.max(width, height) / Math.min(width, height);
  if (width % 16 !== 0 || height % 16 !== 0 || width > MODEL_MAX_EDGE || height > MODEL_MAX_EDGE
    || (customSizeSupported && (longToShortRatio > MODEL_MAX_ASPECT_RATIO || pixels < MODEL_MIN_PIXELS || pixels > MODEL_MAX_PIXELS))) {
    throw new Error(`图片规格 ${width}x${height} 不符合当前模型限制`);
  }
  return {
    ...options,
    width,
    height,
    pixels,
    size: `${width}x${height}`,
    customSizeSupported,
    requestedResolution: options.resolution,
    effectiveResolution: customSizeSupported ? options.resolution : 'standard',
  };
}

export function imageSpecificationLabel(specification) {
  const spec = specification?.size ? specification : resolveImageSpecification('gpt-image-2', specification);
  const quality = IMAGE_QUALITY_OPTIONS.find((item) => item.value === spec.quality)?.label ?? spec.quality;
  return `${spec.aspectRatio} · ${spec.width} x ${spec.height} · ${quality}`;
}

export const GPT_IMAGE_2_LIMITS = Object.freeze({
  maxEdge: MODEL_MAX_EDGE,
  maxPixels: MODEL_MAX_PIXELS,
  minPixels: MODEL_MIN_PIXELS,
  maxAspectRatio: MODEL_MAX_ASPECT_RATIO,
  edgeMultiple: 16,
});
