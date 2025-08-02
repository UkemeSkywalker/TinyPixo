export async function GET() {
  const memUsage = process.memoryUsage()
  const isHealthy = memUsage.heapUsed < 1.8 * 1024 * 1024 * 1024 // 1.8GB threshold

  return Response.json({
    status: isHealthy ? 'ok' : 'warning',
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
    },
    uptime: process.uptime()
  });
}