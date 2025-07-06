import json
import yt_dlp
import tempfile
import base64
import os
from urllib.parse import urlparse

def lambda_handler(event, context):
    try:
        # Parse request body
        body = json.loads(event['body']) if event.get('body') else event
        url = body.get('url')
        action = body.get('action', 'info')  # 'info' or 'download'
        format_type = body.get('format', 'mp4')  # 'mp4' or 'mp3'
        
        if not url:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'URL is required'})
            }
        
        # Validate YouTube URL
        if not ('youtube.com' in url or 'youtu.be' in url):
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Invalid YouTube URL'})
            }
        
        if action == 'info':
            return get_video_info(url)
        elif action == 'download':
            return download_video(url, format_type)
        else:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Invalid action'})
            }
            
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': str(e)})
        }

def get_video_info(url):
    """Get video information without downloading"""
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'title': info.get('title', 'Unknown'),
                'thumbnail': info.get('thumbnail'),
                'duration': info.get('duration'),
                'uploader': info.get('uploader'),
                'view_count': info.get('view_count'),
                'formats_available': len(info.get('formats', []))
            })
        }

def download_video(url, format_type):
    """Download video and return as base64"""
    with tempfile.TemporaryDirectory() as temp_dir:
        output_path = os.path.join(temp_dir, f'video.{format_type}')
        
        if format_type == 'mp3':
            ydl_opts = {
                'format': 'bestaudio/best',
                'outtmpl': output_path,
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
                'quiet': True,
            }
        else:  # mp4
            ydl_opts = {
                'format': 'best[ext=mp4]/best',
                'outtmpl': output_path,
                'quiet': True,
            }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        
        # Find the downloaded file
        files = os.listdir(temp_dir)
        if not files:
            raise Exception('Download failed - no file created')
        
        downloaded_file = os.path.join(temp_dir, files[0])
        
        # Read file and encode as base64
        with open(downloaded_file, 'rb') as f:
            file_data = f.read()
            file_base64 = base64.b64encode(file_data).decode('utf-8')
        
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'file_data': file_base64,
                'filename': files[0],
                'content_type': 'video/mp4' if format_type == 'mp4' else 'audio/mpeg'
            })
        }