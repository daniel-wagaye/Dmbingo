const MAX_EDGE = 1600;
const TARGET_BYTES = 620 * 1024;
const MIN_QUALITY = 0.55;

const isProbablyImage = (file: File) => {
  if (file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name);
};

const loadViaElement = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this photo. Try JPEG or PNG.'));
    };
    img.src = url;
  });

const decodeImage = async (file: File): Promise<{ width: number; height: number; draw: CanvasImageSource }> => {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    return { width: bitmap.width, height: bitmap.height, draw: bitmap };
  } catch {
    const img = await loadViaElement(file);
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, draw: img };
  }
};

const blobToJpeg = (canvas: HTMLCanvasElement, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Could not compress this photo.'));
      },
      'image/jpeg',
      quality
    );
  });

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read the compressed photo.'));
    reader.readAsDataURL(blob);
  });

const drawToCanvas = (source: CanvasImageSource, width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not compress this photo.');
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
};

export type CompressedPhoto = {
  base64: string;
  previewUrl: string;
  bytes: number;
};

export const compressImageFile = async (file: File): Promise<CompressedPhoto> => {
  if (!isProbablyImage(file)) {
    throw new Error('Please choose a photo (JPEG, PNG, or similar).');
  }

  const decoded = await decodeImage(file);
  if (!decoded.width || !decoded.height) {
    throw new Error('Could not read this photo. Try JPEG or PNG.');
  }

  let scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height));
  let quality = 0.85;
  let blob: Blob | null = null;

  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const canvas = drawToCanvas(decoded.draw, decoded.width * scale, decoded.height * scale);
      blob = await blobToJpeg(canvas, quality);
      if (blob.size <= TARGET_BYTES) {
        break;
      }
      if (quality > MIN_QUALITY) {
        quality = Math.max(MIN_QUALITY, quality - 0.08);
        continue;
      }
      scale *= 0.85;
      quality = 0.72;
    }
  } finally {
    if ('close' in decoded.draw && typeof decoded.draw.close === 'function') {
      decoded.draw.close();
    }
  }

  if (!blob || blob.size > TARGET_BYTES) {
    throw new Error('This photo is still too large after compression. Try a smaller screenshot.');
  }

  const base64 = await blobToBase64(blob);
  return {
    base64,
    previewUrl: URL.createObjectURL(blob),
    bytes: blob.size,
  };
};
