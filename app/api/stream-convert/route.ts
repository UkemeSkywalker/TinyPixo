import { NextRequest } from 'next/server'
import { spawn } from 'child_process'

/**
 * True Streaming Audio Conversion API
 * 
 * This provides real streaming conversion without intermediate storage:
 * Frontend → FFmpeg → Response (no S3, no buffering)
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url)
  const format = url.searchParams.get('format') || 'wav'
  const quality = url.searchParams.get('quality') || '192k'

  console.log(`[StreamConvert] Starting true streaming conversion to ${format}`)

  try {
    // Create FFmpeg process for streaming
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',           // Read from stdin (request body)
      '-f', format,             // Output format
      '-b:a', quality,          // Audio quality
      '-y',                     // Overwrite
      'pipe:1'                  // Write to stdout (response)
    ])

    // Handle FFmpeg errors
    ffmpeg.on('error', (error) => {
      console.error('[StreamConvert] FFmpeg error:', error)
    })

    ffmpeg.stderr.on('data', (data) => {
      // Log progress but don't block streaming
      console.log('[StreamConvert] FFmpeg:', data.toString().trim())
    })

    // Create streaming response
    const stream = new ReadableStream({
      start(controller) {
        // Pipe request body to FFmpeg stdin
        if (request.body) {
          const reader = request.body.getReader()
          
          const pump = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) {
                  ffmpeg.stdin?.end()
                  break
                }
                ffmpeg.stdin?.write(value)
              }
            } catch (error) {
              console.error('[StreamConvert] Input stream error:', error)
              ffmpeg.kill()
              controller.error(error)
            }
          }
          
          pump()
        }

        // Pipe FFmpeg stdout to response
        ffmpeg.stdout?.on('data', (chunk) => {
          controller.enqueue(chunk)
        })

        ffmpeg.stdout?.on('end', () => {
          controller.close()
        })

        ffmpeg.on('exit', (code) => {
          if (code !== 0) {
            controller.error(new Error(`FFmpeg exited with code ${code}`))
          } else {
            controller.close()
          }
        })
      },

      cancel() {
        ffmpeg.kill()
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': getContentType(format),
        'Transfer-Encoding': 'chunked',
        'X-Streaming': 'true'
      }
    })

  } catch (error) {
    console.error('[StreamConvert] Error:', error)
    return new Response('Streaming conversion failed', { status: 500 })
  }
}

function getContentType(format: string): string {
  const types: Record<string, string> = {
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'aac': 'audio/aac',
    'ogg': 'audio/ogg'
  }
  return types[format] || 'audio/mpeg'
}