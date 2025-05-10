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
    // multer 会在读取 body 之前调用这个函数，所以我们需要从请求头中获取 hash
    const hash = req.headers['x-hash'];
    if (!hash) {
      return cb(new Error('Missing hash parameter'), null);
    }
    
    const chunkDir = path.join(chunksDir, hash);
    // 确保分片目录存在
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }
    cb(null, chunkDir);
  },
  filename: function (req, file, cb) {
    // 从请求头中获取 index
    const index = req.headers['x-index'];
    if (!index) {
      return cb(new Error('Missing index parameter'), null);
    }
    cb(null, index);
  }
});

const upload = multer({ storage });

// 分片上传接口 - 只保留这一个上传处理器
router.post('/upload', upload.single('file'), (req, res) => {
  try {
    // 从请求头中获取参数
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
    console.error('分片上传失败:', error);
    res.status(500).json({
      code: 1,
      message: '分片上传失败',
      error: error.message
    });
  }
});

// 检查文件是否已上传
router.post('/check', (req, res) => {
  try {
    const { hash, filename } = req.body;
    const filePath = path.join(uploadsDir, filename);
    
    // 检查文件是否已存在
    if (fs.existsSync(filePath)) {
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
    
    // 检查分片目录
    const chunkDir = path.join(chunksDir, hash);
    if (!fs.existsSync(chunkDir)) {
      res.json({
        code: 0,
        message: '文件不存在',
        data: {
          exists: false
        }
      });
      return;
    }
    
    // 返回已上传的分片列表
    const chunks = fs.readdirSync(chunkDir);
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

// 合并分片接口
router.post('/merge', async (req, res) => {
  try {
    const { hash, filename, size, total } = req.body;
    const chunkDir = path.join(chunksDir, hash);
    const filePath = path.join(uploadsDir, filename);
    
    // 检查分片是否都已上传
    const chunks = fs.readdirSync(chunkDir);
    if (chunks.length !== parseInt(total)) {
      res.status(400).json({
        code: 1,
        message: `分片数量不符，已上传 ${chunks.length}，共 ${total} 个分片`,
      });
      return;
    }
    
    // 按照索引排序分片
    chunks.sort((a, b) => parseInt(a) - parseInt(b));
    
    // 创建写入流
    const writeStream = fs.createWriteStream(filePath);
    
    // 依次写入分片
    for (const chunk of chunks) {
      const chunkPath = path.join(chunkDir, chunk);
      const buffer = fs.readFileSync(chunkPath);
      writeStream.write(buffer);
    }
    
    // 结束写入流
    writeStream.end();
    
    // 等待文件写入完成
    await new Promise((resolve) => {
      writeStream.on('finish', resolve);
    });
    
    // 删除分片目录
    fsExtra.removeSync(chunkDir);
    
    res.json({
      code: 0,
      message: '文件合并成功',
      data: {
        url: `/uploads/${filename}`
      }
    });
  } catch (error) {
    console.error('文件合并失败:', error);
    res.status(500).json({
      code: 1,
      message: '文件合并失败',
      error: error.message
    });
  }
});

module.exports = router;

// 上传路由添加错误处理
router.post('/upload', function(req, res, next) {
  upload.single('file')(req, res, function(err) {
    if (err) {
      console.error('文件上传错误:', err);
      return res.status(400).json({
        code: 1,
        message: err.message || '文件上传失败',
        error: err
      });
    }
    
    try {
      const { index, hash } = req.body;
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
