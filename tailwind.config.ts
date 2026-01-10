import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./client/index.html', './client/src/**/*.{js,jsx,ts,tsx}'],
  // Theme is now defined in index.css via @theme directive
  plugins: [],
} satisfies Config;
