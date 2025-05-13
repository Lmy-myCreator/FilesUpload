import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';

const BASE_URL = 'http://localhost:3000';

// 添加一个全局变量来跟踪取消状态
let isCancelled = false;

export const setCancelled = (value: boolean) => {
  isCancelled = value;
};

export const checkFileStatus = async (
  hash: string, 
  filename: string,
  signal?: AbortSignal
) => {
  if (isCancelled) {
    throw new Error('检查文件状态已取消');
  }
  const config: AxiosRequestConfig = {};
  if (signal) {
    config.signal = signal;
  }

  try {
    const response = await axios.post(`${BASE_URL}/check`, {
      hash,
      filename
    }, config);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.name === 'CanceledError') {
      throw new Error('检查文件状态已取消');
    }
    throw error;
  }
};

export const uploadChunk = async (
  chunk: Blob,
  index: number,
  hash: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
) => {
  if (isCancelled) {
    throw new Error('上传已取消');
  }
  const formData = new FormData();
  formData.append('file', chunk);

  const config: AxiosRequestConfig = {
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
  };

  if (signal) {
    config.signal = signal;
  }

  try {
    // 再次检查取消状态，防止在准备请求期间状态变化
    if (isCancelled) {
      throw new Error('上传已取消');
    }
    const response = await axios.post(`${BASE_URL}/upload`, formData, config);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.name === 'CanceledError') {
        throw new Error('上传已取消');
      }
      // 处理后端返回的取消状态码
      if (error.response?.status === 499) {
        throw new Error('上传已取消');
      }
    }
    console.error('上传分片失败:', error);
    throw error;
  }
};

export const mergeChunks = async (
  hash: string,
  filename: string,
  size: number,
  total: number,
  signal?: AbortSignal
) => {
  if (isCancelled) {
    throw new Error('合并文件已取消');
  }
  const config: AxiosRequestConfig = {};
  if (signal) {
    config.signal = signal;
  }

  try {
    const response = await axios.post(`${BASE_URL}/merge`, {
      hash,
      filename,
      size,
      total
    }, config);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.name === 'CanceledError' || error.response?.status === 499) {
        throw new Error('合并文件已取消');
      }
    }
    throw error;
  }
};