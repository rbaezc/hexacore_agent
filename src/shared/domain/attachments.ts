/** An image a result carries for the client to show (MCP image content), e.g. a UI screenshot. */
export interface AttachedImage {
  mimeType: 'image/png' | 'image/jpeg';
  /** Base64 data. */
  data: string;
  label: string;
}

/** Symbol-keyed so JSON (what the model reads as text) never includes the image data. */
const IMAGES = Symbol.for('hexacore.attachedImages');

export function attachImages<T extends object>(value: T, images: AttachedImage[]): T {
  if (images.length) Object.defineProperty(value, IMAGES, { value: images, enumerable: false, configurable: true });
  return value;
}

export function attachedImages(value: unknown): AttachedImage[] {
  return value !== null && typeof value === 'object' ? (((value as any)[IMAGES] as AttachedImage[] | undefined) ?? []) : [];
}
