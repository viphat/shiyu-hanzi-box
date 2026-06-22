import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  manifest: {
    name: '拾语汉字box',
    description: 'Capture Chinese words and quotes while reading; export daily Markdown notes.',
    permissions: [
      'contextMenus',
      'storage',
      'activeTab',
      'scripting',
      'downloads',
      'unlimitedStorage',
      'clipboardRead',
    ],
    optional_host_permissions: [
      'https://api.deepseek.com/*',
      'https://api.openai.com/*',
      'https://*/*',
    ],
    commands: {
      'save-word': {
        suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
        description: 'Save selection as a word',
      },
      'save-quote': {
        suggested_key: { default: 'Ctrl+Shift+Q', mac: 'Command+Shift+Q' },
        description: 'Save selection as a quote',
      },
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
