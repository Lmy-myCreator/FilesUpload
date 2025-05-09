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
  // 这里使用文件名和最后修改时间的组合作为简单的hash
  // 实际项目中可以使用更复杂的hash算法
  return `${file.name}-${file.lastModified}`;
};