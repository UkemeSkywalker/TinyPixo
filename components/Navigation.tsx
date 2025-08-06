'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

export default function Navigation() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  const links = [
    { href: '/', label: '🖼️ Image Optimizer' },
    // { href: '/audio-converter', label: '🎵 Audio Converter' },
    // { href: '/video-converter', label: '🎬 Video Converter' },
  ]

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden md:flex gap-6">
        {links.map(({ href, label }) => (
          <Link 
            key={href}
            href={href}
            className={`px-4 py-2 rounded-lg transition-colors ${
              pathname === href 
                ? 'bg-blue-600 text-white' 
                : 'text-gray-300 hover:text-white hover:bg-gray-700'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* Mobile Hamburger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden p-2 text-gray-300 hover:text-white"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="fixed top-16 left-0 right-0 bg-gray-800 border-t border-gray-700 md:hidden z-50">
          <nav className="flex flex-col p-4 space-y-2">
            {links.map(({ href, label }) => (
              <Link 
                key={href}
                href={href}
                onClick={() => setIsOpen(false)}
                className={`px-4 py-3 rounded-lg transition-colors ${
                  pathname === href 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </>
  )
}