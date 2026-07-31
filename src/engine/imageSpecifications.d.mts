export type ImageAspectRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16';
export type ImageResolutionTier = 'standard' | '2k' | '2.7k' | '4k';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high';
export interface ImageGenerationOptions { aspectRatio: ImageAspectRatio; resolution: ImageResolutionTier; quality: ImageQuality }
export interface ImageSpecification extends ImageGenerationOptions { width: number; height: number; pixels: number; size: string; customSizeSupported: boolean; requestedResolution: ImageResolutionTier; effectiveResolution: ImageResolutionTier }
export const IMAGE_ASPECT_OPTIONS: ReadonlyArray<{ value: ImageAspectRatio; label: string; orientation: 'square' | 'landscape' | 'portrait' }>;
export const IMAGE_RESOLUTION_OPTIONS: ReadonlyArray<{ value: ImageResolutionTier; label: string }>;
export const IMAGE_QUALITY_OPTIONS: ReadonlyArray<{ value: ImageQuality; label: string }>;
export const DEFAULT_IMAGE_GENERATION_OPTIONS: Readonly<ImageGenerationOptions>;
export const GPT_IMAGE_2_LIMITS: Readonly<{ maxEdge: number; maxPixels: number; minPixels: number; maxAspectRatio: number; edgeMultiple: number }>;
export function normalizeImageGenerationOptions(input?: Partial<ImageGenerationOptions>): ImageGenerationOptions;
export function isGptImage2(model?: string): boolean;
export function resolveImageSpecification(model: string, input?: Partial<ImageGenerationOptions>): ImageSpecification;
export function imageSpecificationLabel(specification: ImageSpecification | Partial<ImageGenerationOptions>): string;
