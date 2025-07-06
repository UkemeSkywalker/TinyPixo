import './globals.css'
import Navigation from '../components/Navigation'

export const metadata = {
  title: 'TinyPixo - Free Image Optimizer & Video Converter',
  description: 'Free online tool to optimize images, convert videos, and process audio files. Supports WebP, AVIF, MP4, WebM conversion with privacy-first browser processing.',
  keywords: 'image optimizer, video converter, audio converter, WebP, AVIF, MP4, WebM, free online tool',
  robots: 'index, follow',
  openGraph: {
    title: 'TinyPixo - Free Media Converter & Optimizer',
    description: 'Convert and optimize images, videos, and audio files for free. All processing happens in your browser.',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white min-h-screen">
        <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <h1 className="text-xl font-bold text-blue-400">TinyPixo</h1>
            <Navigation />
          </div>
        </header>
        {children}
      </body>
    </html>
  )
}