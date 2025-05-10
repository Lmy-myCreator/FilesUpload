import React, { useState, type DragEvent, useEffect } from 'react';
import { createFileChunks, calculateHash } from '../utils/fileChunk';
import { uploadChunk, checkFileStatus, mergeChunks } from '../services/uploadService';
import './FileUploader.css';

interface UploadProgress {
  percentage: number;
  status: 'uploading' | 'success' | 'error' | 'waiting' | 'rapid-success';
  currentChunk: number;
  totalChunks: number;
  currentFile: number;
  totalFiles: number;
}

const FileUploader: React.FC = () => {
  const [progress, setProgress] = useState<UploadProgress>({
    percentage: 0, status: 'waiting', currentChunk: 0,
    totalChunks: 0, currentFile: 0, totalFiles: 0
  });
  const [isDragging, setIsDragging] = useState(false);
  const [showProgress, setShowProgress] = useState(false);

  const initProgress = (totalFiles: number) => setProgress({
    percentage: 0, status: 'uploading', currentChunk: 0,
    totalChunks: 0, currentFile: 0, totalFiles
  });

  const updateProgress = (data: Partial<UploadProgress>) => 
    setProgress(prev => ({ ...prev, ...data }));

  const handleFileUpload = async (file: File, index: number) => {
    const hash = calculateHash(file);
    const chunks = createFileChunks(file);
    
    updateProgress({
      currentFile: index + 1,
      totalChunks: chunks.length,
      currentChunk: 0
    });

    const checkResult = await checkFileStatus(hash, file.name);
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

    await Promise.all(chunks.map(async (chunk, idx) => {
      if (uploadedChunks.has(idx.toString())) {
        completedChunks++;
        updateProgress({
          percentage: Math.round((completedChunks * 100) / chunks.length),
          currentChunk: completedChunks
        });
        return;
      }

      await uploadChunk(chunk.file, chunk.index, hash, (chunkProgress) => {
        const totalProgress = Math.round(
          ((completedChunks * 100 + chunkProgress) * 100) / (chunks.length * 100)
        );
        updateProgress({
          percentage: totalProgress,
          currentChunk: completedChunks
        });
      });

      completedChunks++;
      updateProgress({
        percentage: Math.round((completedChunks * 100) / chunks.length),
        currentChunk: completedChunks
      });
    }));

    await mergeChunks(hash, file.name, file.size, chunks.length);
  };

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

  useEffect(() => {
    if (progress.status === 'success' || progress.status === 'rapid-success') {
      setShowProgress(true);
      const timer = setTimeout(() => setShowProgress(false), 1000);
      return () => clearTimeout(timer);
    }
    setShowProgress(progress.status === 'uploading');
  }, [progress.status]);

  return (
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