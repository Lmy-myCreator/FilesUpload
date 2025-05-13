/**
 * @typedef {Object} Product
 * @property {string} id - 商品唯一标识
 * @property {string} name - 商品名称
 * @property {number} price - 商品价格
 * @property {string} description - 商品描述
 */
interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
}

/**
 * 商品类型定义
 * @type {Product[]}
 * @private
 */
let cachedData: Product[] = [];

/**
 * Worker 是否已准备好接收搜索请求
 * @type {boolean}
 * @private
 */
let ready = false;

/**
 * Worker 内存缓存的最大商品数量
 * @type {number}
 * @constant
 */
const maxCacheSize = 50000;

/**
 * 在缓存中搜索商品
 * @param {string} query - 搜索关键词
 * @param {number} limit - 返回结果数量上限
 * @returns {Product[]} 匹配的商品数组
 */
function searchProducts(query: string, limit: number): Product[] {
  if (!query.trim() || !ready) return [];
  const searchTerm = query.toLowerCase();
  let result = cachedData
    .filter(product => product.name.toLowerCase().includes(searchTerm) || product.description.toLowerCase().includes(searchTerm))
    .sort((a, b) => {
      const aNameMatch = a.name.toLowerCase().includes(searchTerm);
      const bNameMatch = b.name.toLowerCase().includes(searchTerm);
      if (aNameMatch && !bNameMatch) return -1;
      if (!aNameMatch && bNameMatch) return 1;
      return a.price - b.price;
    });
  // 如果结果不足且缓存未满5万，向主线程请求更多数据
  if (result.length < limit && cachedData.length < maxCacheSize) {
    /**
     * 通知主线程需要更多数据
     * @event REQUEST_MORE_DATA
     * @property {number} needed - 还需补充的商品数量
     */
    self.postMessage({ type: 'REQUEST_MORE_DATA', needed: maxCacheSize - cachedData.length });
  }
  return result.slice(0, limit);
}

/**
 * Worker 消息事件监听器
 * @param {MessageEvent} e - 消息事件对象
 */
self.onmessage = (e: MessageEvent) => {
  const { type, payload, taskId } = e.data;
  switch (type) {
    case 'INIT_DATA_CHUNK':
      /**
       * 接收主线程分片初始化数据
       * @property {Product[]} payload.products - 商品分片
       */
      if (Array.isArray(payload.products)) {
        cachedData = cachedData.concat(payload.products);
        // 超过最大缓存时只保留最新的5万条
        if (cachedData.length > maxCacheSize) {
          cachedData = cachedData.slice(-maxCacheSize);
        }
      }
      break;
    case 'INIT_DATA_END':
      /**
       * 主线程数据初始化完成，标记 Worker 可用
       */
      ready = true;
      self.postMessage({ type: 'INIT_COMPLETE' });
      break;
    case 'SEARCH':
      /**
       * 处理主线程的搜索请求
       * @property {string} payload.query - 搜索关键词
       * @property {number} payload.limit - 返回数量
       * @property {string} taskId - 本次搜索任务唯一标识
       */
      const { query, limit } = payload;
      const results = searchProducts(query, limit);
      self.postMessage({ type: 'SEARCH_RESULTS', payload: results, taskId, query });
      break;
  }
};
