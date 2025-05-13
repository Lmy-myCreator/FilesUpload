import React, { useState, useEffect, useRef } from 'react';

/**
 * @file SearchSuggestions.tsx
 * @description 商品实时搜索建议组件，支持 Web Worker + IndexedDB 大数据本地检索，主线程与 Worker 分片通信，内存裁剪，性能优化。
 * @author
 */

/**
 * 商品类型定义
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
 * 模拟 10 万条商品数据
 * @type {Product[]}
 */
const mockProducts: Product[] = Array.from({ length: 100000 }).map((_, i) => ({
  id: String(i),
  name: `商品${i}`,
  price: Math.round(Math.random() * 1000),
  description: `描述${i}`
}));

/**
 * 分片大小，单次传输/存储的商品数量
 * @type {number}
 */
const CHUNK_SIZE = 10000;

/**
 * 全局唯一 Worker 实例，负责分片数据缓存与搜索
 * @type {Worker}
 */
const globalWorker = new Worker(new URL('../workers/search.worker.ts', import.meta.url));

/**
 * 商品搜索建议组件
 * @component
 */
const SearchSuggestions: React.FC = () => {
  /**
   * 搜索关键词
   * @type {[string, Function]}
   */
  const [query, setQuery] = useState('');
  /**
   * 搜索结果
   * @type {[Product[], Function]}
   */
  const [results, setResults] = useState<Product[]>([]);
  /**
   * 是否处于加载中
   * @type {[boolean, Function]}
   */
  const [loading, setLoading] = useState(false);
  /**
   * Worker 是否已初始化完成
   * @type {[boolean, Function]}
   */
  const [workerReady, setWorkerReady] = useState(false);
  /**
   * IndexedDB 是否已初始化
   * @type {[boolean, Function]}
   */
  const [dbInitialized, setDbInitialized] = useState(false);
  /**
   * 防抖定时器引用
   * @type {React.MutableRefObject<number | null>}
   */
  const timerRef = useRef<number | null>(null);
  /**
   * 当前最新的搜索任务ID
   * @type {React.MutableRefObject<string>}
   */
  const latestTaskId = useRef<string>('');
  /**
   * IndexedDB 数据库实例引用
   * @type {React.MutableRefObject<IDBDatabase | null>}
   */
  const dbRef = useRef<IDBDatabase | null>(null);

  /**
   * 延迟初始化 IndexedDB 并写入商品数据，分片传输到 Worker
   * 只在首屏渲染后或首次交互时触发，优化首屏性能
   */
  const initIndexedDB = () => {
    if (dbInitialized) return;
    setDbInitialized(true);
    /**
     * 打开/升级 IndexedDB 数据库
     */
    const request = indexedDB.open('ProductDB', 1);
    request.onupgradeneeded = (e) => {
      const db = request.result;
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => {
      const db = request.result;
      dbRef.current = db;
      // 分片写入 IndexedDB
      let sent = 0;
      while (sent < mockProducts.length) {
        const chunk = mockProducts.slice(sent, sent + CHUNK_SIZE);
        const tx = db.transaction('products', 'readwrite');
        const store = tx.objectStore('products');
        chunk.forEach(item => store.put(item));
        sent += CHUNK_SIZE;
      }
      // 分片传输到 Worker
      sent = 0;
      while (sent < mockProducts.length) {
        const chunk = mockProducts.slice(sent, sent + CHUNK_SIZE);
        globalWorker.postMessage({ type: 'INIT_DATA_CHUNK', payload: { products: chunk } });
        sent += CHUNK_SIZE;
      }
      globalWorker.postMessage({ type: 'INIT_DATA_END' });
    };
  };

  /**
   * 首屏渲染后，window.onload 触发初始化（懒加载）
   */
  useEffect(() => {
    window.addEventListener('load', initIndexedDB);
    return () => {
      window.removeEventListener('load', initIndexedDB);
    };
  }, []);

  /**
   * 用户首次聚焦输入框时也可触发初始化（懒加载）
   */
  const handleInputFocus = () => {
    initIndexedDB();
  };

  /**
   * Worker 消息监听，处理搜索结果、初始化完成、请求补全数据等事件
   */
  useEffect(() => {
    globalWorker.onmessage = async (e: MessageEvent) => {
      const { type, payload, taskId, query: workerQuery, needed } = e.data;
      // 搜索结果返回
      if (type === 'SEARCH_RESULTS') {
        if (taskId && taskId === latestTaskId.current) {
          if (payload && payload.length) {
            setResults(payload);
            setLoading(false);
          } else if (dbRef.current) {
            // Worker 未命中时主线程用 IndexedDB 补全
            const db = dbRef.current;
            const tx = db.transaction('products', 'readonly');
            const store = tx.objectStore('products');
            const products: Product[] = [];
            store.openCursor().onsuccess = function (event) {
              const cursor = (event.target as IDBRequest).result;
              if (cursor) {
                if (cursor.value.name.toLowerCase().includes(workerQuery.toLowerCase())) {
                  products.push(cursor.value);
                }
                cursor.continue();
              } else {
                setResults(products.slice(0, 10));
                setLoading(false);
              }
            };
          }
        }
      }
      // Worker 初始化完成
      if (type === 'INIT_COMPLETE') {
        setWorkerReady(true);
      }
      // Worker 请求更多数据，主线程分片补充
      if (type === 'REQUEST_MORE_DATA' && dbRef.current) {
        const db = dbRef.current;
        const tx = db.transaction('products', 'readonly');
        const store = tx.objectStore('products');
        const products: Product[] = [];
        let count = 0;
        store.openCursor().onsuccess = function (event) {
          const cursor = (event.target as IDBRequest).result;
          if (cursor && count < 100000) {
            if (count >= 50000 && products.length < needed) {
              products.push(cursor.value);
            }
            count++;
            cursor.continue();
          } else {
            let sent = 0;
            while (sent < products.length) {
              const chunk = products.slice(sent, sent + CHUNK_SIZE);
              globalWorker.postMessage({ type: 'INIT_DATA_CHUNK', payload: { products: chunk } });
              sent += CHUNK_SIZE;
            }
          }
        };
      }
    };
    // 页面关闭时销毁 Worker，释放内存
    window.addEventListener('unload', () => {
      globalWorker.terminate();
    });
  }, []);

  /**
   * 输入框变更，200ms 防抖，带 taskId 唯一标识，向 Worker 发起搜索
   * @param {React.ChangeEvent<HTMLInputElement>} e - 输入事件
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    setLoading(true);
    if (!workerReady) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const taskId = Date.now() + '_' + Math.random();
      latestTaskId.current = taskId;
      globalWorker.postMessage({
        type: 'SEARCH',
        payload: {
          query: newQuery,
          limit: 10
        },
        taskId
      });
    }, 200);
  };

  return (
    <div className="search-container">
      <input
        type="text"
        value={query}
        onFocus={handleInputFocus}
        onChange={handleInputChange}
        placeholder="搜索商品..."
        className="search-input"
      />
      {loading && <div className="loading">搜索中...</div>}
      {results.length > 0 && (
        <ul className="search-results">
          {results.map(product => (
            <li key={product.id} className="result-item">
              <div className="product-name">{product.name}</div>
              <div className="product-price">¥{product.price}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SearchSuggestions;