import './globals.css'

export const metadata = {
  title: 'TinyPixo - Image Optimizer',
  description: 'Optimize and compress images with ease',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white min-h-screen">{children}</body>
    </html>
  )
}