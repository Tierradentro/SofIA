import type { Config } from 'tailwindcss';

/**
 * Sistema de diseño I17 (plantillas look & feel):
 * - sofia: azul marino corporativo (sidebar, primarios, encabezados).
 * - menta: acento turquesa (estados activos, KPIs, destacados).
 */
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        sofia: {
          50: '#eef6ff',
          100: '#d9eaff',
          200: '#b3d4f5',
          500: '#1e6fd9',
          600: '#1858ad',
          700: '#124381',
          800: '#0d3058',
          900: '#0a2547',
          950: '#061a33',
        },
        menta: {
          50: '#ecfdf8',
          100: '#d0faec',
          200: '#a5f3da',
          300: '#6ee7c8',
          400: '#3fd9b8',
          500: '#17b795',
          600: '#0d9379',
          700: '#0b7561',
        },
      },
    },
  },
  plugins: [],
};
export default config;
