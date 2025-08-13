'use client'

import { useState, useEffect } from 'react'

interface FFmpegLogsViewerProps {
  jobId: string
  isVisible: boolean
  onClose: () => void
}

interface LogsResponse {
  jobId: string
  logs: string[]
  logCount: number
  retrievedAt: string
}

export default function FFmpegLogsViewer({ jobId, isVisible, onClose }: FFmpegLogsViewerProps) {
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchLogs = async () => {
    if (!jobId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/ffmpeg-logs?jobId=${jobId}`, {
        headers: {
          'Cache-Control': 'no-cache',
        },
      })

      if (response.ok) {
        const data: LogsResponse = await response.json()
        setLogs(data.logs)
      } else {
        setError(`Failed to fetch logs: ${response.status}`)
      }
    } catch (err) {
      setError(`Error fetching logs: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  // Auto-refresh logs every 2 seconds when visible and auto-refresh is enabled
  useEffect(() => {
    if (!isVisible || !autoRefresh) return

    fetchLogs() // Initial fetch
    const interval = setInterval(fetchLogs, 2000)

    return () => clearInterval(interval)
  }, [jobId, isVisible, autoRefresh])

  // Manual refresh
  const handleRefresh = () => {
    fetchLogs()
  }

  if (!isVisible) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-3/4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center space-x-4">
            <h2 className="text-lg font-semibold">FFmpeg Logs</h2>
            <span className="text-sm text-gray-500">Job: {jobId}</span>
          </div>
          
          <div className="flex items-center space-x-2">
            <label className="flex items-center space-x-2 text-sm">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="rounded"
              />
              <span>Auto-refresh</span>
            </label>
            
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 text-sm"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            
            <button
              onClick={onClose}
              className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
            >
              Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 overflow-hidden">
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {logs.length === 0 && !loading && !error && (
            <div className="text-gray-500 text-center py-8">
              No FFmpeg logs available for this job yet.
            </div>
          )}

          {logs.length > 0 && (
            <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm h-full overflow-auto">
              <div className="mb-2 text-gray-400">
                {logs.length} log lines • Last updated: {new Date().toLocaleTimeString()}
              </div>
              
              {logs.map((log, index) => (
                <div key={index} className="mb-1 break-all">
                  <span className="text-gray-500 mr-2">{String(index + 1).padStart(3, '0')}:</span>
                  <span className={
                    log.includes('error') || log.includes('Error') ? 'text-red-400' :
                    log.includes('warning') || log.includes('Warning') ? 'text-yellow-400' :
                    log.includes('time=') ? 'text-blue-400' :
                    log.includes('Duration:') ? 'text-purple-400' :
                    log.includes('Stream #') ? 'text-cyan-400' :
                    'text-green-400'
                  }>
                    {log}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 text-sm text-gray-600">
          <div className="flex justify-between items-center">
            <span>
              {logs.length > 0 && `Showing ${logs.length} recent log lines`}
            </span>
            <span>
              {autoRefresh && 'Auto-refreshing every 2 seconds'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}