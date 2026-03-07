import 'server-only';

export {
  db,
  getMainDb,
  testMainDbConnection,
  closeMainDb,
} from '@/server/db/mysql';

export { db as default } from '@/server/db/mysql';
