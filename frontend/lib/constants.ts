/**
 * War-damages admin portal path, under the shared `/admin` area. The
 * admin dashboards (war-damages / lebanese / syrian) all live beneath
 * `/admin` and are gated by the staff login; citizens reach the public
 * forms only from the `/:locale` landing hub, never from here. Relocating
 * this only requires renaming app/[locale]/admin/(segment) + this constant.
 */
export const ADMIN_PATH = 'admin/war-damages';
