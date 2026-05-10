/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-orbitron)', 'monospace'],
        body: ['var(--font-rajdhani)', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'monospace'],
      },
      colors: {
        pom: {
          bg: '#0a0c0f',
          surface: '#111318',
          border: '#1e2330',
          accent: '#f97316',
          'accent-dim': '#7c3a10',
          muted: '#6b7280',
          text: '#e2e8f0',
          success: '#22c55e',
          warning: '#eab308',
          danger: '#ef4444',
          info: '#3b82f6',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'scan': 'scan 3s linear infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #f97316, 0 0 10px #f97316' },
          '100%': { boxShadow: '0 0 10px #f97316, 0 0 30px #f97316, 0 0 50px #f97316' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
      },
    },
  },
  plugins: [],
};
