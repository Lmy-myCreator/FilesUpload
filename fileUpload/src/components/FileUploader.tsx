/**
 * 文件上传组件，支持分片上传、秒传、拖拽上传、进度展示与中断。
 * @module FileUploader
 * @author
 */

import React, { useState, type DragEvent, useEffect, useRef } from 'react';
import { createFileChunks, calculateHash } from '../utils/fileChunk';
import { uploadChunk, checkFileStatus, mergeChunks } from '../services/uploadService';
import './FileUploader.css';
import axios from 'axios';
import { setCancelled } from '../services/uploadService';

const BASE_URL = 'http://localhost:3000';

/**
 * 上传进度状态接口
 */
interface UploadProgress {
  percentage: number;
  status: 'uploading' | 'success' | 'error' | 'waiting' | 'rapid-success' | 'cancelled';
  currentChunk: number;
  totalChunks: number;
  currentFile: number;
  totalFiles: number;
}

/**
 * 文件上传主组件
 * @returns {JSX.Element}
 */
const FileUploader: React.FC = () => {
  /** 上传进度状态 */
  const [progress, setProgress] = useState<UploadProgress>({
    percentage: 0, status: 'waiting', currentChunk: 0,
    totalChunks: 0, currentFile: 0, totalFiles: 0
  });
  /** 拖拽状态 */
  const [isDragging, setIsDragging] = useState(false);
  /** 是否显示进度条 */
  const [showProgress, setShowProgress] = useState(false);
  /** 是否正在取消上传 */
  const [isCancelling, setIsCancelling] = useState(false);
  /** 当前请求的 AbortController */
  const abortControllerRef = useRef<AbortController | null>(null);
  /** 是否已取消上传 */
  const isCancelledRef = useRef(false);
  /** 当前正在上传的分片信息 */
  const currentUploadRef = useRef<{
    hash: string;
    index: number;
    chunk: Blob;
  } | null>(null);

  /**
   * 初始化上传进度
   * @param totalFiles 文件总数
   */
  const initProgress = (totalFiles: number) => setProgress({
    percentage: 0, status: 'uploading', currentChunk: 0,
    totalChunks: 0, currentFile: 0, totalFiles
  });

  /**
   * 更新上传进度
   * @param data 进度更新内容
   */
  const updateProgress = (data: Partial<UploadProgress>) => 
    setProgress(prev => ({ ...prev, ...data }));

  /**
   * 创建新的 AbortController 并返回 signal
   */
  const createAbortController = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    return abortControllerRef.current.signal;
  };

  /**
   * 取消上传，终止所有请求并清理分片
   */
  const cancelUpload = async () => {
    if (!isCancelling) {
      try {
        setIsCancelling(true);
        isCancelledRef.current = true;
        setCancelled(true); // 设置全局取消状态
        
        // 中断所有正在进行的请求
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }

        // 取消所有正在进行的请求
        const cancelPromises = [];
        
        if (currentUploadRef.current) {
          const { hash, index } = currentUploadRef.current;
          try {
            // 创建新的 AbortController 用于清理请求
            const cleanupSignal = createAbortController();
            cancelPromises.push(
              axios.post(`${BASE_URL}/cleanup`, {
                hash,
                index: index.toString()
              }, { signal: cleanupSignal })
            );
          } catch (error) {
            if (!axios.isCancel(error)) {
              console.error('清理分片失败:', error);
            }
          }
          currentUploadRef.current = null;
        }
        
        // 等待所有清理请求完成
        try {
          await Promise.allSettled(cancelPromises);
        } catch (error) {
          console.error('取消上传过程中出错:', error);
        }

        // 添加一个额外的延迟，确保所有请求都被中断
        await new Promise(resolve => setTimeout(resolve, 100));
        
        updateProgress({ status: 'cancelled' });
      } finally {
        setIsCancelling(false);
      }
    }
  };

  /**
   * 上传单个文件，支持分片、断点续传、秒传、取消
   * @param file 文件对象
   * @param index 当前文件索引
   */
  const handleFileUpload = async (file: File, index: number) => {
    if (isCancelling || isCancelledRef.current) {
      return;
    }
  
    isCancelledRef.current = false;
    setCancelled(false); // 重置全局取消状态
    const signal = createAbortController();

    try {
      const hash = calculateHash(file);
      const chunks = createFileChunks(file);
      
      updateProgress({
        currentFile: index + 1,
        totalChunks: chunks.length,
        currentChunk: 0,
        status: 'uploading'
      });

      try {
        const checkResult = await checkFileStatus(hash, file.name, signal);
        
        if (isCancelledRef.current) {
          return;
        }

        if (checkResult.data.exists) {
          updateProgress({
            percentage: 100,
            status: 'rapid-success',
            currentChunk: chunks.length,
            totalChunks: chunks.length
          });
          await new Promise(resolve => setTimeout(resolve, 1000));
          return;
        }

        const uploadedChunks = new Set(checkResult.data.uploadedChunks || []);
        let completedChunks = 0;

        for (const chunk of chunks) {
          if (isCancelledRef.current) {
            return;
          }

          if (uploadedChunks.has(chunk.index.toString())) {
            completedChunks++;
            updateProgress({
              percentage: Math.round((completedChunks * 100) / chunks.length),
              currentChunk: completedChunks
            });
            continue;
          }

          try {
            currentUploadRef.current = {
              hash,
              index: chunk.index,
              chunk: chunk.file
            };

            const chunkSignal = createAbortController();
            await uploadChunk(chunk.file, chunk.index, hash, (chunkProgress) => {
              if (!isCancelledRef.current) {
                const totalProgress = Math.round(
                  ((completedChunks * 100 + chunkProgress) * 100) / (chunks.length * 100)
                );
                updateProgress({
                  percentage: totalProgress,
                  currentChunk: completedChunks
                });
              }
            }, chunkSignal);

            currentUploadRef.current = null;

            if (!isCancelledRef.current) {
              completedChunks++;
              updateProgress({
                percentage: Math.round((completedChunks * 100) / chunks.length),
                currentChunk: completedChunks
              });
            }
          } catch (error: any) {
            currentUploadRef.current = null;

            if (axios.isCancel(error) || error.message === '上传已取消') {
              isCancelledRef.current = true;
              return;
            }
            throw error;
          }
        }

        if (!isCancelledRef.current) {
          const mergeSignal = createAbortController();
          await mergeChunks(hash, file.name, file.size, chunks.length, mergeSignal);
        }
      } catch (error: any) {
        if (axios.isCancel(error) || 
            error.message === '上传已取消' || 
            error.message === '检查文件状态已取消') {
          return;
        }
        throw error;
      }
    } catch (error: any) {
      console.error('上传失败:', error);
      updateProgress({ status: 'error' });
    } finally {
      abortControllerRef.current = null;
      currentUploadRef.current = null;
      setIsCancelling(false);
    }
  };

  /**
   * 处理 input[type=file] 文件选择事件
   * @param event 文件选择事件
   */
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    
    try {
      initProgress(files.length);
      for (let i = 0; i < files.length; i++) {
        await handleFileUpload(files[i], i);
      }
      updateProgress({
        percentage: 100,
        status: 'success',
        currentFile: files.length,
        currentChunk: 0,
        totalChunks: 0
      });
    } catch (error) {
      console.error('上传失败:', error);
      updateProgress({ status: 'error' });
    }
  };

  /**
   * 递归处理文件夹拖拽，获取所有文件
   * @param entry 文件或文件夹条目
   */
  const processEntry = async (entry: FileSystemEntry): Promise<File[]> => {
    if (entry.isFile) {
      return [await new Promise<File>(resolve => 
        (entry as FileSystemFileEntry).file(resolve))];
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      const entries = await new Promise<FileSystemEntry[]>(resolve => 
        dirReader.readEntries(resolve));
      const files = await Promise.all(entries.map(processEntry));
      return files.flat();
    }
    return [];
  };

  /**
   * 处理拖拽上传事件
   * @param e 拖拽事件
   */
  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    if (!items) return;

    try {
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) {
          const entryFiles = await processEntry(entry);
          files.push(...entryFiles);
        }
      }

      initProgress(files.length);
      for (let i = 0; i < files.length; i++) {
        await handleFileUpload(files[i], i);
      }
      updateProgress({
        percentage: 100,
        status: 'success',
        currentFile: files.length,
        currentChunk: 0,
        totalChunks: 0
      });
    } catch (error) {
      console.error('上传失败:', error);
      updateProgress({ status: 'error' });
    }
  };

  /**
   * 进度条展示与状态切换副作用
   */
  useEffect(() => {
    if (progress.status === 'success' || progress.status === 'rapid-success') {
      setShowProgress(true);
      const timer = setTimeout(() => setShowProgress(false), 1000);
      return () => clearTimeout(timer);
    }
    setShowProgress(progress.status === 'uploading');
  }, [progress.status]);

  /**
   * 组件卸载时中断所有未完成的请求
   */
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return (
    <div className="file-uploader-container">
      <h2 className="upload-title">文件上传示例</h2>
      
      {progress.status === 'uploading' && (
        <div className="cancel-upload-container">
          <button 
            className={`cancel-button ${isCancelling ? 'cancelling' : ''}`}
            onClick={cancelUpload}
            disabled={isCancelling}
            data-text={isCancelling ? '取消中...' : '取消上传'}
          >
            {isCancelling ? '取消中...' : '取消上传'}
          </button>
        </div>
      )}

      <div 
        className={`file-uploader ${isDragging ? 'dragging' : ''}`}
        onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
        onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={handleDrop}
      >
        <div className="upload-area">
          <input
            type="file"
            onChange={handleFileChange}
            style={{ display: 'none' }}
            id="file-input"
            multiple
            webkitdirectory=""
            directory=""
          />
          <div className="upload-buttons">
            <label htmlFor="file-input" className="upload-button">
              <i className="icon-upload"></i>点击上传
            </label>
            <div className="upload-divider">或</div>
            <div className="drag-tip">将文件拖拽到此处</div>
          </div>
        </div>
      </div>
      
      {(progress.status !== 'waiting' && showProgress) && (
        <div className="upload-progress">
          <div className="progress-bar">
            <div 
              className={`progress-inner ${progress.status}`}
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
          <div className="progress-info">
            {progress.status === 'uploading' && (
              <>
                <span>正在上传第 {progress.currentFile}/{progress.totalFiles} 个文件</span>
                <span>当前文件进度: {progress.percentage}%</span>
                {progress.totalChunks > 0 && (
                  <span>({progress.currentChunk}/{progress.totalChunks})</span>
                )}
                {/* 取消按钮已移至外部 */}
              </>
            )}
            {progress.status === 'rapid-success' && <span>秒传成功！文件已存在</span>}
            {progress.status === 'success' && <span>上传成功！</span>}
            {progress.status === 'error' && <span>上传失败，请重试</span>}
            {progress.status === 'cancelled' && <span>上传已取消</span>}
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUploader;