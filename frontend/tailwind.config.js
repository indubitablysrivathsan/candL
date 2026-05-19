/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      colors: {
        background: '#0e1117',
        card: '#1a1d26',
        border: 'rgba(255,255,255,0.08)',

        oiCE: '#00B0F0',
        oiPE: '#FF00FF',

        oiChangeCE: '#92D050',
        oiChangePE: '#E46C0A',

        volCE: '#26a69a',
        volPE: '#ef5350',

        underlying: '#FFD700',
        maxPain: '#FF69B4',
        pcr: '#FFA726'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        card: '0 4px 20px rgba(0,0,0,0.35)'
      }
    }
  },
  plugins: []
};