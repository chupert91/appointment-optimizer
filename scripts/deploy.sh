#!/bin/bash

# Deployment script for Vercel
echo "🚀 Starting deployment process..."

# Generate Prisma client
echo "📦 Generating Prisma client..."
npx prisma generate

# Run database migrations
echo "🗄️ Running database migrations..."
npx prisma migrate deploy

echo "✅ Deployment process completed!"