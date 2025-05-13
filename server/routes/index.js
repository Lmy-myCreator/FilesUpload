var express = require('express');
var router = express.Router();
const multer = require('multer');
const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

// 配置上传存储
const uploadsDir = path.join(__dirname, '../uploads');
const chunksDir = path.join(__dirname, '../uploads/chunks');

// 确保上传目录存在
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(chunksDir)) {
  fs.mkdirSync(chunksDir, { recursive: true });
}

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // 监听请求中断
    req.on('aborted', () => {
      console.warn('上传请求被中断');
      const hash = req.headers['x-hash'];
      const index = req.headers['x-index'];
      if (hash && index) {
        const chunkPath = path.join(chunksDir, hash, index);
        if (fs.existsSync(chunkPath)) {
          fs.unlinkSync(chunkPath);
          console.log(`已删除未完成的分片: ${chunkPath}`);
        }
      }
      // 拒绝文件上传
      cb(new Error('上传已取消'), false);
    });

    const hash = req.headers['x-hash'];
    if (!hash) {
      return cb(new Error('Missing hash parameter'), null);
    }
    
    const chunkDir = path.join(chunksDir, hash);
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }
    cb(null, chunkDir);
  },
  filename: function (req, file, cb) {
    const index = req.headers['x-index'];
    if (!index) {
      return cb(new Error('Missing index parameter'), null);
    }
    cb(null, index);
  }
});

// 创建自定义的文件过滤器
const fileFilter = (req, file, cb) => {
  // 监听请求中断
  req.on('aborted', () => {
    console.warn('请求被中断，拒绝文件上传');
    cb(new Error('上传已取消'), false);
  });
  cb(null, true);
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

// 检查文件状态接口
router.post('/check', async (req, res) => {
  let isAborted = false;
  req.on('aborted', () => {
    console.warn('检查文件状态请求被中断');
    isAborted = true;
    res.status(499).end();
  });

  try {
    if (isAborted) return;
    
    const { hash, filename } = req.body;
    const filePath = path.join(uploadsDir, filename);
    
    // 使用异步方法检查文件是否存在
    const fileExists = await new Promise(resolve => {
      fs.access(filePath, fs.constants.F_OK, (err) => {
        resolve(!err);
      });
    });
    
    if (isAborted) return;
    
    if (fileExists) {
      res.json({
        code: 0,
        message: '文件已存在',
        data: {
          exists: true,
          url: `/uploads/${filename}`
        }
      });
      return;
    }
    
    const chunkDir = path.join(chunksDir, hash);
    
    // 使用异步方法检查分片目录是否存在
    const chunkDirExists = await new Promise(resolve => {
      fs.access(chunkDir, fs.constants.F_OK, (err) => {
        resolve(!err);
      });
    });
    
    if (isAborted) return;
    
    if (!chunkDirExists) {
      res.json({
        code: 0,
        message: '文件不存在',
        data: {
          exists: false
        }
      });
      return;
    }
    
    // 使用异步方法读取目录
    const chunks = await new Promise((resolve, reject) => {
      fs.readdir(chunkDir, (err, files) => {
        if (err) reject(err);
        else resolve(files);
      });
    });
    
    if (isAborted) return;
    
    res.json({
      code: 0,
      message: '获取已上传分片成功',
      data: {
        exists: false,
        uploadedChunks: chunks
      }
    });
  } catch (error) {
    console.error('检查文件失败:', error);
    res.status(500).json({
      code: 1,
      message: '检查文件失败',
      error: error.message
    });
  }
});

// 分片上传接口
router.post('/upload', (req, res, next) => {
  // 监听请求中断
  let isAborted = false;
  req.on('aborted', () => {
    console.warn('上传请求被中断');
    isAborted = true;
    const hash = req.headers['x-hash'];
    const index = req.headers['x-index'];
    if (hash && index) {
      const chunkPath = path.join(chunksDir, hash, index);
      if (fs.existsSync(chunkPath)) {
        fs.unlinkSync(chunkPath);
        console.log(`已删除未完成的分片: ${chunkPath}`);
      }
    }
    res.status(499).end(); // 使用 499 状态码表示客户端关闭连接
  });

  upload.single('file')(req, res, function(err) {
    // 如果请求已中断，直接返回
    if (isAborted) return;
    
    if (err) {
      if (err.message === '上传已取消') {
        return res.status(499).json({
          code: 499,
          message: '上传已取消'
        });
      }
      console.error('文件上传错误:', err);
      return res.status(400).json({
        code: 1,
        message: err.message || '文件上传失败',
        error: err
      });
    }
    
    try {
      const index = req.headers['x-index'];
      const hash = req.headers['x-hash'];
      if (!index || !hash) {
        throw new Error('缺少必要参数');
      }
      
      res.json({
        code: 0,
        message: '分片上传成功',
        data: {
          index,
          hash
        }
      });
    } catch (error) {
      console.error('处理上传请求错误:', error);
      res.status(500).json({
        code: 1,
        message: error.message,
        error: error
      });
    }
  });
});

// 合并分片接口
router.post('/merge', async (req, res) => {
  let isAborted = false;
  let writeStream = null;

  // 添加请求中断监听
  req.on('aborted', () => {
    console.warn('合并文件请求被中断');
    isAborted = true;
    if (writeStream) {
      writeStream.destroy();
    }
    res.status(499).end();
  });

  try {
    const { hash, filename, size, total } = req.body;
    
    if (isAborted) return;
    
    const chunkDir = path.join(chunksDir, hash);
    const filePath = path.join(uploadsDir, filename);
    
    // 使用 Promise 包装文件系统操作
    const chunks = await new Promise((resolve, reject) => {
      fs.readdir(chunkDir, (err, files) => {
        if (err) reject(err);
        else resolve(files);
      });
    });

    if (isAborted) {
      return;
    }

    if (chunks.length !== parseInt(total)) {
      res.status(400).json({
        code: 1,
        message: `分片数量不符，已上传 ${chunks.length}，共 ${total} 个分片`,
      });
      return;
    }
    
    chunks.sort((a, b) => parseInt(a) - parseInt(b));
    
    writeStream = fs.createWriteStream(filePath);
    
    writeStream.on('error', (error) => {
      console.error('写入文件失败:', error);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });

    // 使用 Promise 和异步迭代器处理分片写入
    for (let i = 0; i < chunks.length; i++) {
      if (isAborted) {
        writeStream.destroy();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return;
      }

      const chunk = chunks[i];
      const chunkPath = path.join(chunkDir, chunk);
      
      // 使用 Promise 包装读取操作
      const buffer = await new Promise((resolve, reject) => {
        fs.readFile(chunkPath, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

      // 使用 Promise 包装写入操作
      await new Promise((resolve, reject) => {
        writeStream.write(buffer, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // 每写入一个分片后给出一个微小的延迟，让出事件循环
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    writeStream.end();
    
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    
    if (isAborted) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    }
    
    await fsExtra.remove(chunkDir);
    
    res.json({
      code: 0,
      message: '文件合并成功',
      data: {
        url: `/uploads/${filename}`
      }
    });
  } catch (error) {
    console.error('文件合并失败:', error);
    if (writeStream) {
      writeStream.destroy();
    }
    if (req.body?.filename) {
      const filePath = path.join(uploadsDir, req.body.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    res.status(500).json({
      code: 1,
      message: '文件合并失败',
      error: error.message
    });
  }
});

// 清理分片接口
router.post('/cleanup', async (req, res) => {
  let isAborted = false;
  req.on('aborted', () => {
    console.warn('清理分片请求被中断');
    isAborted = true;
    res.status(499).end();
  });

  try {
    const { hash, index } = req.body;
    if (!hash || !index) {
      return res.status(400).json({
        code: 1,
        message: '缺少必要参数'
      });
    }

    if (isAborted) return;

    const chunkPath = path.join(chunksDir, hash, index);
    
    // 使用异步方法检查文件是否存在
    const exists = await new Promise(resolve => {
      fs.access(chunkPath, fs.constants.F_OK, (err) => {
        resolve(!err);
      });
    });
    
    if (isAborted) return;
    
    if (exists) {
      await new Promise((resolve, reject) => {
        fs.unlink(chunkPath, (err) => {
          if (err) reject(err);
          else {
            console.log(`已清理分片: ${chunkPath}`);
            resolve();
          }
        });
      });
    }
    
    if (isAborted) return;
    
    res.json({
      code: 0,
      message: '清理成功'
    });
  } catch (error) {
    console.error('清理分片失败:', error);
    res.status(500).json({
      code: 1,
      message: '清理分片失败',
      error: error.message
    });
  }
});

module.exports = router;
