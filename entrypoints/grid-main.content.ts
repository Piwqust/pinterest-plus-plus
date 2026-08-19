import { MasonryGridBridge } from '../shared/masonry-grid-bridge';

export default defineContentScript({
  matches: ['https://*.pinterest.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  globalName: false,
  noScriptStartedPostMessage: true,
  main() {
    new MasonryGridBridge().start();
  },
});
