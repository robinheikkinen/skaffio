/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Scandinavian neutral surfaces
        canvas: {
          light: '#f4f4f2',
          DEFAULT: '#f4f4f2',
          dark: '#15171c',
        },
        surface: {
          light: '#ffffff',
          DEFAULT: '#ffffff',
          dark: '#1f232c',
        },
        panel: {
          dark: '#252a34',
          dark2: '#2c323e',
        },
        // Warm terracotta — primary food accent
        primary: {
          DEFAULT: '#E07B39',
          50: '#fdf4ed',
          100: '#fbe5d0',
          200: '#f6c99e',
          300: '#f0a96b',
          400: '#eb8c42',
          500: '#E07B39',
          600: '#c4612a',
          700: '#a34b22',
          800: '#843c1e',
          900: '#6c321c',
        },
        // Sage — smart-home / in-stock accent
        sage: {
          DEFAULT: '#2D6A4F',
          50: '#f0f9f4',
          100: '#dcf0e6',
          200: '#bbe0cf',
          300: '#8dc8b0',
          400: '#5baa8c',
          500: '#3a8f71',
          600: '#2D6A4F',
          700: '#265843',
          800: '#214738',
          900: '#1c3b2f',
        },
        // Toddler pastel tags
        pastel: {
          peach: '#FFD8B5',
          mint: '#C5E8D5',
          sky: '#C5DBF0',
          lavender: '#DCD0F0',
          butter: '#F7E9B0',
          rose: '#F4CCCC',
        },
      },
      fontFamily: {
        sans: [
          'DM Sans',
          'Plus Jakarta Sans',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        'soft': '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.05)',
        'card': '0 2px 8px -2px rgb(0 0 0 / 0.06), 0 4px 16px -4px rgb(0 0 0 / 0.04)',
        'lift': '0 8px 24px -8px rgb(0 0 0 / 0.12), 0 4px 12px -4px rgb(0 0 0 / 0.06)',
      },
      transitionTimingFunction: {
        'silky': 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      keyframes: {
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
}
