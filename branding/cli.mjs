import { apply } from './apply.mjs';
if (!['win32', 'darwin'].includes(process.argv[2])) throw Error('Choose native platform');
apply(process.argv[2], process.argv[3]);
