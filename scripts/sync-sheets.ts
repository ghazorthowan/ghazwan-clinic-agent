import {syncSheets} from '../lib/sheets';
syncSheets().then(v=>console.log(v)).catch(e=>{console.error(e);process.exit(1)});
