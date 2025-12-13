const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // 只在客户端侧（浏览器 bundle）生效，服务器侧不需要
    if (!isServer) {
      // 添加 fallback（可选，防止其他 node 内置模块报错）
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,        // 大多数情况下设为 false 即可
        net: false,
        tls: false,
        // 如果有 crypto/buffer 等错误，再加
        // crypto: require.resolve('crypto-browserify'),
        // stream: require.resolve('stream-browserify'),
      };

      // 关键：替换所有 node:xxx 导入为 xxx
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:/,
          (resource) => {
            resource.request = resource.request.replace(/^node:/, '');
          }
        )
      );
    }

    return config;
  },
})
module.exports = withBundleAnalyzer({})