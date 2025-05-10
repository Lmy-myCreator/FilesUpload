interface Chunk {
  file: Blob;
  index: number;
}

export const createFileChunks = (file: File, chunkSize: number = 5 * 1024 * 1024): Chunk[] => {
  const chunks: Chunk[] = [];
  let cur = 0;
  while (cur < file.size) {
    chunks.push({
      file: file.slice(cur, cur + chunkSize),
      index: chunks.length
    });
    cur += chunkSize;
  }
  return chunks;
};

export const calculateHash = (file: File): string => {
  // 移除特殊字符，只保留安全的字符
  const safeName = file.name.replace(/[^a-zA-Z0-9]/g, '_');
  return `${safeName}_${file.lastModified}`;
};