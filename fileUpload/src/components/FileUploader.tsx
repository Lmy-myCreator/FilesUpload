import React, { useState } from 'react';
import { createFileChunks, calculateHash } from '../utils/fileChunk';
import { uploadChunk, checkFileStatus, mergeChunks } from '../services/uploadService';
import './FileUploader.css';

// 定义上传进度接口，用于跟踪文件上传状态
interface UploadProgress {
  percentage: number;      // 上传进度百分比
  status: 'uploading' | 'success' | 'error' | 'waiting' | 'rapid-success';  // 上传状态
  currentChunk: number;    // 当前上传的分片序号
  totalChunks: number;     // 总分片数
  currentFile: number;     // 当前正在上传第几个文件
  totalFiles: number;      // 总文件数
}

const FileUploader: React.FC = () => {
  // 使用 useState 管理上传进度状态
  const [progress, setProgress] = useState<UploadProgress>({
    percentage: 0,
    status: 'waiting',
    currentChunk: 0,
    totalChunks: 0,
    currentFile: 0,
    totalFiles: 0
  });

  // 文件选择处理函数
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    try {
      // 初始化上传状态
      setProgress({
        percentage: 0,
        status: 'uploading',
        currentChunk: 0,
        totalChunks: 0,
        currentFile: 0,
        totalFiles: files.length
      });

      // 循环处理所有选中的文件
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const hash = calculateHash(file);        // 计算文件哈希值
        const chunks = createFileChunks(file);   // 将文件分片
        
        // 更新当前处理的文件信息
        setProgress(prev => ({
          ...prev,
          currentFile: i + 1,
          totalChunks: chunks.length,
          currentChunk: 0
        }));

        // 检查文件是否已存在（秒传功能）
        const checkResult = await checkFileStatus(hash, file.name);
        if (checkResult.data.exists) {
          // 文件已存在，显示秒传成功
          setProgress(prev => ({
            ...prev,
            percentage: 100,
            status: 'rapid-success',
            currentChunk: chunks.length,
            totalChunks: chunks.length
          }));
          // 延迟1秒显示秒传成功状态
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        // 获取已上传的分片信息（断点续传）
        const uploadedChunks = new Set(checkResult.data.uploadedChunks || []);
        let completedChunks = 0;

        // 并发上传所有分片
        await Promise.all(
          chunks.map(async (chunk, index) => {
            // 如果分片已上传，跳过
            if (uploadedChunks.has(index.toString())) {
              completedChunks++;
              setProgress(prev => ({
                ...prev,
                percentage: Math.round((completedChunks * 100) / chunks.length),
                currentChunk: completedChunks
              }));
              return;
            }

            // 上传分片并更新进度
            await uploadChunk(chunk.file, chunk.index, hash, (chunkProgress) => {
              const totalProgress = Math.round(
                ((completedChunks * 100 + chunkProgress) * 100) / (chunks.length * 100)
              );
              setProgress(prev => ({
                ...prev,
                percentage: totalProgress,
                currentChunk: completedChunks
              }));
            });

            // 更新已完成的分片数
            completedChunks++;
            setProgress(prev => ({
              ...prev,
              percentage: Math.round((completedChunks * 100) / chunks.length),
              currentChunk: completedChunks
            }));
          })
        );

        // 所有分片上传完成，请求合并
        await mergeChunks(hash, file.name, file.size, chunks.length);
      }
      
      // 所有文件上传完成
      setProgress(prev => ({
        ...prev,
        percentage: 100,
        status: 'success',
        currentFile: files.length,
        currentChunk: 0,
        totalChunks: 0
      }));
    } catch (error) {
      // 错误处理
      console.error('上传失败:', error);
      setProgress(prev => ({
        ...prev,
        status: 'error'
      }));
    }
  };

  // 渲染上传组件UI
  return (
    <div className="file-uploader">
      {/* 文件选择输入框 */}
      <input
        type="file"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        id="file-input"
        multiple
      />
      {/* 自定义上传按钮 */}
      <label htmlFor="file-input" className="upload-button">
        选择文件
      </label>
      
      {/* 上传进度显示 */}
      {progress.status !== 'waiting' && (
        <div className="upload-progress">
          {/* 进度条 */}
          <div className="progress-bar">
            <div 
              className={`progress-inner ${progress.status}`}
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
          {/* 进度信息 */}
          <div className="progress-info">
            {progress.status === 'uploading' && (
              <>
                <span>正在上传第 {progress.currentFile}/{progress.totalFiles} 个文件</span>
                <span>当前文件进度: {progress.percentage}%</span>
                {progress.totalChunks > 0 && (
                  <span>({progress.currentChunk}/{progress.totalChunks})</span>
                )}
              </>
            )}
            {progress.status === 'rapid-success' && <span>秒传成功！文件已存在</span>}
            {progress.status === 'success' && <span>上传成功！</span>}
            {progress.status === 'error' && <span>上传失败，请重试</span>}
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUploader;