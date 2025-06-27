import './globals.css'
import Navigation from '../components/Navigation'

export const metadata = {
  title: 'TinyPixo - Media Optimizer',
  description: 'Optimize images and convert audio files with ease',
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