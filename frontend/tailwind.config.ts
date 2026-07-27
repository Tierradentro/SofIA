import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        sofia: {
          50: '#eef6ff',
          100: '#d9eaff',
          500: '#1e6fd9',
          600: '#1858ad',
          700: '#124381',
          900: '#0a2547',
        },
      },
    },
  },
  plugins: [],
};
export default config;
