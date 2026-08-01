// ==============================================
// 基金持仓系统 - PM2 生态系统配置文件
// 使用方法：pm2 start ecosystem.config.js
// ==============================================

module.exports = {
  apps: [
    {
      // 应用名称
      name: 'fund-server',
      
      // 启动脚本
      script: 'server.js',
      
      // 工作目录
      cwd: '/www/fundscope',
      
      // 实例数量（fork 模式设为 1）
      instances: 1,
      
      // 运行模式：fork 或 cluster
      exec_mode: 'fork',
      
      // 环境变量
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // BASE_PATH: '/fundscope', // 子路径部署时取消注释
      },
      
      // 日志配置
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/root/.pm2/logs/fund-server-error.log',
      out_file: '/root/.pm2/logs/fund-server-out.log',
      
      // 自动重启
      autorestart: true,
      
      // 监听文件变化重启（开发环境用）
      watch: false,
      
      // 忽略监听的目录
      ignore_watch: ['node_modules', 'logs', '.git'],
      
      // 最大内存限制（超过自动重启）
      max_memory_restart: '500M',
      
      // 最小运行时间（小于此时间崩溃不计入重启次数）
      min_uptime: '10s',
      
      // 最大重启次数（达到后停止重启）
      max_restarts: 10,
      
      // 重启延迟
      restart_delay: 3000,
    }
  ],
  
  // 部署配置（可选，配合 pm2 deploy 使用）
  deploy: {
    production: {
      user: 'root',
      host: '47.107.183.204',
      ref: 'origin/main',
      repo: 'https://github.com/whjin/fundscope.git',
      path: '/www/fundscope',
      'post-deploy': 'npm install --production && pm2 reload ecosystem.config.js --env production',
    }
  }
};
