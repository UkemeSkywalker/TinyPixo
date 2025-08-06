import "./globals.css";
import Navigation from "../components/Navigation";

export const metadata = {
  title: "TinyPixo - Free Image Optimizer & Media Converter",
  description:
    "Optimize and convert images, audio, and video instantly with TinyPixo. Supports WebP, PNG, JPG, AVIF, MP3, MP4, and more — all processed privately in your browser.",
  keywords:
    "free image optimizer, online image converter, video converter, audio converter, WebP, PNG, JPG, AVIF, MP3, MP4, privacy-first media tool",
  robots: "index, follow",
  icons: {
    icon: "/favicon.png",
  },
  openGraph: {
    title: "TinyPixo - Free Media Converter & Optimizer",
    description:
      "Fast and private online tool to optimize and convert images, videos, and audio. Supports formats like WebP, PNG, JPG, AVIF, MP3, and MP4.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white min-h-screen">
        <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 relative">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <h1 className="text-xl font-bold text-blue-400">TinyPixo</h1>
            <Navigation />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
