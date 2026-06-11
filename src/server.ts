import { app } from './app';
import { config } from './config';

const port = config.port;

app.listen(port, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           外星人发现后端服务 启动成功                          ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 服务地址:  http://localhost:${port}                         ║
║  📖 API 文档:   http://localhost:${port}/api/docs               ║
║  💊 健康检查:   http://localhost:${port}/api/health             ║
╠══════════════════════════════════════════════════════════════╣
║  环境: ${config.nodeEnv.padEnd(48)}║
║  8 大能力模块已就绪:                                           ║
║    ✓ 线索提交    ✓ 媒体上传    ✓ 重复检测    ✓ 可信度评分        ║
║    ✓ 事件聚合    ✓ 用户协作    ✓ 通知        ✓ 统计             ║
╚══════════════════════════════════════════════════════════════╝
`);
});

process.on('unhandledRejection', (err: any) => {
  console.error('未处理的 Promise 拒绝:', err);
});
