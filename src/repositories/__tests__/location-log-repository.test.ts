import { migrate } from '@/database/migrations';
import { LocationLogRepository } from '@/repositories/location-log-repository';
import { SettingsRepository } from '@/repositories/settings-repository';
import { NodeSQLiteDatabase } from '@/test-utils/node-sqlite-database';

jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('node:crypto').randomUUID(),
}));
jest.mock('@/database/database', () => ({ getDatabase: jest.fn() }));

const MIN = 60_000;
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 10, 12) + minutes * MIN).toISOString();
const reading = (minutes: number, latitude = 48.2) => ({
  capturedAt: at(minutes),
  latitude,
  longitude: 16.37,
  accuracyMeters: 20,
});

async function setup() {
  const db = new NodeSQLiteDatabase();
  await migrate(db.asExpo());
  const open = async () => db.asExpo();
  return { log: new LocationLogRepository(open), settings: new SettingsRepository(open) };
}

describe('LocationLogRepository', () => {
  it('stores readings and lists them newest first', async () => {
    const { log } = await setup();
    expect(await log.add([reading(0), reading(15), reading(30)], 12 * MIN)).toHaveLength(3);

    const listed = await log.list();
    expect(listed.map((observation) => observation.capturedAt)).toEqual([at(30), at(15), at(0)]);
    expect(listed[0]).toMatchObject({ latitude: 48.2, accuracyMeters: 20, source: 'background' });
  });

  it('drops readings closer together than the minimum gap, including across batches', async () => {
    const { log } = await setup();
    await log.add([reading(0), reading(2), reading(13)], 12 * MIN);
    await log.add([reading(14), reading(30)], 12 * MIN);

    expect((await log.list()).map((observation) => observation.capturedAt)).toEqual([at(30), at(13), at(0)]);
  });

  it('ignores invalid readings', async () => {
    const { log } = await setup();
    const stored = await log.add(
      [{ ...reading(0), latitude: 95 }, { ...reading(20), capturedAt: 'nope' }, reading(40)],
      MIN,
    );
    expect(stored).toHaveLength(1);
  });

  it('prunes old readings and deletes everything on request', async () => {
    const { log } = await setup();
    await log.add([reading(0), reading(60), reading(120)], MIN);

    await log.deleteOlderThan(at(60));
    expect(await log.count()).toBe(2);

    await log.deleteAll();
    expect(await log.count()).toBe(0);
  });
});

describe('SettingsRepository', () => {
  it('returns the fallback until a value is saved, then merges saved values', async () => {
    const { settings } = await setup();
    expect(await settings.get('reminders', { enabled: false, times: [] as number[] })).toEqual({
      enabled: false,
      times: [],
    });

    await settings.set('reminders', { enabled: true, times: [9] });
    await settings.set('reminders', { enabled: true, times: [9, 18] });
    expect(await settings.get('reminders', { enabled: false, times: [] as number[] })).toEqual({
      enabled: true,
      times: [9, 18],
    });
  });
});
