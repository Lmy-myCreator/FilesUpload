// 扩展 HTMLInputElement 接口以包含目录选择属性
declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

// 定义上传进度接口，用于跟踪文件上传状态
export interface UploadProgress {
  percentage: number;
  status: 'uploading' | 'success' | 'error' | 'waiting' | 'rapid-success' | 'paused';
  currentChunk: number;
  totalChunks: number;
  currentFile: number;
  totalFiles: number;
}