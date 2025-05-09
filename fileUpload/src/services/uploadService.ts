import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

export const uploadChunk = async (
  chunk: Blob, 
  index: number, 
  hash: string,
  onProgress?: (progress: number) => void
) => {
  const formData = new FormData();
  formData.append('file', chunk);

  try {
    const response = await axios.post(`${BASE_URL}/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'x-hash': hash,
        'x-index': index.toString()
      },
      // 添加上传进度监听
      onUploadProgress: (progressEvent) => {
        if (progressEvent.total && onProgress) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percentCompleted);
        }
      }
    });
    return response.data;
  } catch (error) {
    console.error('上传分片失败:', error);
    throw error;
  }
};

export const checkFileStatus = async (hash: string, filename: string) => {
  const response = await axios.post(`${BASE_URL}/check`, {
    hash,
    filename
  });
  return response.data;
};

export const mergeChunks = async (hash: string, filename: string, size: number, total: number) => {
  const response = await axios.post(`${BASE_URL}/merge`, {
    hash,
    filename,
    size,
    total
  });
  return response.data;
};