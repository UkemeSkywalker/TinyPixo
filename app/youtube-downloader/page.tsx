'use client'

import { useState } from 'react'

export default function YouTubeDownloader() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [videoInfo, setVideoInfo] = useState<any>(null)

  const getVideoInfo = async () => {
    if (!url) return
    
    setLoading(true)
    setError('')
    setVideoInfo(null)
    
    try {
      const response = await fetch('/api/youtube-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      })
      
      if (!response.ok) throw new Error('Failed to get video info')
      
      const data = await response.json()
      setVideoInfo(data)
    } catch (err) {
      setError('Failed to get video info')
    } finally {
      setLoading(false)
    }
  }

  const downloadDirect = (downloadUrl: string, filename: string) => {
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = filename
    a.target = '_blank'
    a.click()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-red-600 rounded-full mb-6">
            <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
          </div>
          <h1 className="text-5xl font-bold text-white mb-4">YouTube Downloader</h1>
          <p className="text-xl text-gray-300">Download your favorite videos in MP4 or convert to MP3</p>
        </div>
        
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-8 shadow-2xl border border-gray-700">
          <div className="flex gap-4 mb-6">
            <input
              type="text"
              placeholder="Paste YouTube URL here..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 p-4 pl-12 rounded-xl bg-gray-700/50 text-white text-lg border border-gray-600 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 transition-all"
            />
            <button
              onClick={getVideoInfo}
              disabled={loading || !url}
              className="px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Get Video'}
            </button>
          </div>
          
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
              <p className="text-red-400">{error}</p>
            </div>
          )}
          
          {videoInfo && (
            <div className="bg-gray-700/30 rounded-lg p-6 mb-6">
              <div className="flex gap-4 mb-4">
                {videoInfo.thumbnail && (
                  <img src={videoInfo.thumbnail} alt="Thumbnail" className="w-32 h-24 object-cover rounded" />
                )}
                <div>
                  <h3 className="text-white font-semibold text-lg mb-2">{videoInfo.title}</h3>
                  <p className="text-gray-300">Duration: {Math.floor(videoInfo.duration / 60)}:{(videoInfo.duration % 60).toString().padStart(2, '0')}</p>
                </div>
              </div>
              
              <div className="grid md:grid-cols-2 gap-4">
                {videoInfo.formats.mp4 && (
                  <button
                    onClick={() => downloadDirect(videoInfo.formats.mp4.url, `${videoInfo.title}.mp4`)}
                    className="bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-6 rounded-xl transition-all"
                  >
                    Download MP4 ({videoInfo.formats.mp4.quality})
                  </button>
                )}
                {videoInfo.formats.audio && (
                  <button
                    onClick={() => downloadDirect(videoInfo.formats.audio.url, `${videoInfo.title}.webm`)}
                    className="bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-xl transition-all"
                  >
                    Download Audio ({videoInfo.formats.audio.bitrate}kbps)
                  </button>
                )}
              </div>
            </div>
          )}
          
          <div className="mt-8 p-4 bg-gray-700/30 rounded-lg">
            <h3 className="text-white font-semibold mb-2">How to use:</h3>
            <ul className="text-gray-300 text-sm space-y-1">
              <li>• Copy any YouTube video URL</li>
              <li>• Paste it in the input field above</li>
              <li>• Choose MP4 for video or MP3 for audio only</li>
              <li>• Your download will start automatically</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}