// Create: src/app/api/debug-env/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;

  return NextResponse.json({
    // Show the actual value Vercel is reading
    databaseUrl: databaseUrl || 'UNDEFINED',
    databaseUrlExists: !!databaseUrl,
    databaseUrlLength: databaseUrl?.length || 0,
    databaseUrlStartsWith: databaseUrl?.substring(0, 30) || 'N/A',

    // Show if it has the right protocol
    hasPostgresProtocol: databaseUrl?.startsWith('postgresql://') || databaseUrl?.startsWith('postgres://') || false,

    // Show all environment variables that start with common prefixes
    envKeys: Object.keys(process.env).filter(key =>
      key.includes('DATABASE') ||
      key.includes('NEXTAUTH') ||
      key.includes('GOOGLE') ||
      key.includes('POSTGRES')
    ),

    // Check other NextAuth vars
    nextAuthUrl: process.env.NEXTAUTH_URL || 'UNDEFINED',
    nextAuthSecret: process.env.NEXTAUTH_SECRET ? 'SET (length: ' + process.env.NEXTAUTH_SECRET.length + ')' : 'UNDEFINED',

    // Vercel environment info
    vercelEnv: process.env.VERCEL_ENV || 'UNDEFINED',
    nodeEnv: process.env.NODE_ENV || 'UNDEFINED',

    // All env keys for debugging
    allEnvKeys: Object.keys(process.env).sort()
  });
}