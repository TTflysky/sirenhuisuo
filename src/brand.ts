export const APP_BRAND_NAME = '太极';
export const APP_PRODUCT_NAME = '太极 AI 办公会所';
export const LEGACY_PRODUCT_NAME = '私人办公会所';

const BRAND_MIGRATION_KEY = 'hermes_office_brand_migration_v1';

/** Records the visible-brand migration without moving or renaming legacy data. */
export function ensureBrandMigrationMarker(): void {
  try {
    if (localStorage.getItem(BRAND_MIGRATION_KEY)) return;
    localStorage.setItem(BRAND_MIGRATION_KEY, JSON.stringify({
      schema: 1,
      from: LEGACY_PRODUCT_NAME,
      to: APP_BRAND_NAME,
      storageNamespace: 'hermes_office',
      migratedAt: new Date().toISOString(),
    }));
  } catch {}
}
