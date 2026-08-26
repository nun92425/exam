/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./suggest.html",
    "./admin.html",
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter','Noto Sans JP','Hiragino Sans','system-ui','sans-serif'],
        mono: ['JetBrains Mono','monospace'],
      },
      colors: {
        ink: {
          900: '#070A14',
          800: '#0F162E',
          700: '#1A2442',
        },
        neon: {
          cyan: '#22d3ee',
          violet: '#8b5cf6',
          pink: '#ec4899',
        }
      },
      boxShadow: {
        'glass': '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
        'glow': '0 0 24px rgba(34,211,238,0.35)',
        'glow-violet': '0 0 24px rgba(139,92,246,0.35)',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        float: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        }
      }
    },
  },
  plugins: [],
}
