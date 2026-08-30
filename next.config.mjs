/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // logo uploads: 1MB file + multipart overhead
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
