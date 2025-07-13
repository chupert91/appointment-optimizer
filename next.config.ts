import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client']
  },

  // Optimize images for Google OAuth profile pictures
  images: {
    domains: ['lh3.googleusercontent.com'],
  },

  // Enable TypeScript strict mode
  typescript: {
    // Set to false if you want production builds to complete even if
    // your project has TypeScript errors
    ignoreBuildErrors: false,
  },

  // ESLint configuration
  eslint: {
    // Set to false if you want production builds to complete even if
    // your project has ESLint errors
    ignoreDuringBuilds: false,
  }
}

export default nextConfig