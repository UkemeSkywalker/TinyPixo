'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Navigation() {
  const pathname = usePathname()

  return (
    <nav className="flex gap-6">
      <Link 
        href="/"
        className={`px-4 py-2 rounded-lg transition-colors ${
          pathname === '/' 
            ? 'bg-blue-600 text-white' 
            : 'text-gray-300 hover:text-white hover:bg-gray-700'
        }`}
      >
        🖼️ Image Optimizer
      </Link>
      <Link 
        href="/audio-converter"
        className={`px-4 py-2 rounded-lg transition-colors ${
          pathname === '/audio-converter' 
            ? 'bg-blue-600 text-white' 
            : 'text-gray-300 hover:text-white hover:bg-gray-700'
        }`}
      >
        🎵 Audio Converter
      </Link>
    </nav>
  )
}