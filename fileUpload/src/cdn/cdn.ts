/**
 * 简易 CDN 工具模块
 * 用于统一管理静态资源路径和版本号，便于资源缓存与更新。
 * 独立于主业务代码，不影响其他文件。
 */

const CDN_BASE = 'https://cdn.example.com/project';
const VERSION = 'v1.0.0';

/**
 * 获取带版本号的 CDN 资源路径
 * @param path 资源相对路径，如 'img/logo.png'
 * @returns 完整的 CDN 资源 URL
 */
export function getCdnUrl(path: string): string {
  // 防止多余斜杠
  const cleanPath = path.replace(/^\/+/, '');
  return `${CDN_BASE}/${cleanPath}?v=${VERSION}`;
}

/**
 * 获取当前 CDN 版本号
 */
export function getCdnVersion(): string {
  return VERSION;
} 