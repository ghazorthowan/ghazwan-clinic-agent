import { syncSheets } from '../lib/sheets';

syncSheets()
  .then(result => {
    console.log('[sheets-sync]', JSON.stringify(result));
    process.exit(0);
  })
  .catch(err => {
    console.error('[sheets-sync] fatal:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
