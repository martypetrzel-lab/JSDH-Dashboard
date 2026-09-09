import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingIncludes: { '/api/training/sessions/*/attendance-sheet': ['./assets/fonts/NotoSans-Regular.ttf'] },
};

export default nextConfig;
