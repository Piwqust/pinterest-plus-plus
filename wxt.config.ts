import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  srcDir: '.',
  manifest: {
    name: 'Pinterest Plus Plus',
    short_name: 'Pinterest++',
    description: 'Copy and download Pinterest media in full quality, collect pins into folders, save them as a ZIP, and resize the grid.',
    // Chrome 111 is the first release that honours `world: 'MAIN'` on a
    // manifest-declared content script. On 109-110 the key is ignored, the
    // grid bridge loads in the isolated world, and resizing silently does
    // nothing, so those versions must not be offered the extension at all.
    minimum_chrome_version: '111',
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
