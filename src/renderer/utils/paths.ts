// Path helpers for the renderer. Windows and macOS file systems are case
// insensitive, and paths may arrive with either separator.

const isCaseInsensitive = (): boolean => {
  const platform = (window as any).api?.platform;
  return platform === 'win32' || platform === 'darwin';
};

export const pathKey = (filePath: string): string => {
  const normalized = filePath.replace(/[\\/]+/g, '/').replace(/\/$/, '');
  return isCaseInsensitive() ? normalized.toLowerCase() : normalized;
};

export const samePath = (a: string, b: string): boolean => pathKey(a) === pathKey(b);

// True when `target` is `parent` itself or lies inside it.
export const isSameOrInside = (target: string, parent: string): boolean => {
  const targetKey = pathKey(target);
  const parentKey = pathKey(parent);
  return targetKey === parentKey || targetKey.startsWith(`${parentKey}/`);
};

export const fileNameOf = (filePath: string): string => filePath.split(/[\\/]/).pop() || filePath;

const BINARY_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'ico', 'tif', 'tiff', 'eps',
  'zip', 'gz', 'tgz', 'tar', '7z', 'rar', 'xz', 'bz2',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'mp3', 'mp4', 'wav', 'ogg', 'avi', 'mov', 'mkv',
  'exe', 'dll', 'so', 'dylib', 'bin', 'ttf', 'otf', 'woff', 'woff2',
  'dvi', 'xdv', 'fmt', 'pfb',
]);

export const isLikelyBinaryFile = (fileName: string): boolean => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return Boolean(ext && fileName.includes('.') && BINARY_EXTENSIONS.has(ext));
};
