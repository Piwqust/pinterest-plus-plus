import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  srcDir: '.',
  manifest: {
    name: 'Pinterest Plus Plus',
    short_name: 'Pinterest++',
    description: 'Copy and download Pinterest media in full quality, and resize the responsive grid.',
    minimum_chrome_version: '109',
    permissions: ['clipboardWrite', 'downloads', 'offscreen', 'storage'],
    host_permissions: [
      'https://*.pinterest.com/*',
      'https://*.pinimg.com/*'
    ],
    action: {
      default_title: 'Pinterest Plus Plus',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png'
      }
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png'
    }
  }
});
