import { app } from './app';
import { env } from './config/env';
import { prisma } from './config/db';

const server = app.listen(env.PORT, () => {
  console.log(`🚀 OpsFlow backend listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Initiating graceful shutdown...`);
  server.close(async () => {
    console.log('🔌 HTTP server closed.');
    await prisma.$disconnect();
    console.log('🗄️ Database connections closed. Process terminating.');
    process.exit(0);
  });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
