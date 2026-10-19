// node tests/service-period.test.cjs [ruta-a-admin.js]
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'admin.js'), 'utf8');
function extract(name) {
    let start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    if (source.slice(start - 6, start) === 'async ') start -= 6;
    const next = source.indexOf('\n}', start);
    return source.slice(start, next + 2);
}
const start = '2026-10-18T23:00:00.000Z';
const settings = { night_service_started_at: start, active_menu_period: 'night' };
const storage = new Map();
const ctx = vm.createContext({
    Date, Number, console, Promise,
    NIGHT_STARTED_KEY: 'night_service_started_at', MENU_PERIOD_KEY: 'active_menu_period',
    _nightServiceStartAt: start,
    _nightCloseConfigurationError: false,
    window: { menuPeriodActivo: 'night', _nightCloseTimerStarted: true },
    document: { getElementById: () => ({ style: { display: 'none' } }) },
    localStorage: { getItem: key => storage.get(key) || null },
    sessionStorage: { getItem: () => null },
    Toast: { ok() {}, error() {} },
    _periodoServicioActivo() { return ctx.window.menuPeriodActivo; },
    _renderPeriodoMenu(period) { ctx.window.menuPeriodActivo = period; },
    _mostrarCargandoServicioAdmin() {},
    async cargarDashboardReal() {}, async cargarHistorialPedidos() {},
    async cargarGastosReal() {}, async cargarSlotsMenuReal() {},
    supabaseClient: { from(table) {
        assert.equal(table, 'system_settings', 'No debe modificar pedidos ni gastos al alternar');
        return {
            async upsert(rows) { rows.forEach(row => { settings[row.key] = row.value; }); return {}; },
            select() { return this; }, eq(_, key) { this.key = key; return this; },
            async maybeSingle() { return { data: { value: settings[this.key] } }; }
        };
    } }
});
for (const name of ['_resolverInicioDiaEfectivo', '_leerSettingSistema', '_asegurarInicioServicioNoche', 'activarPeriodoMenu']) {
    vm.runInContext(extract(name), ctx);
}
(async () => {
    const orders = [
        { created_at: '2026-10-19T00:00:00Z', service_period: 'night', total: 45000 },
        { created_at: '2026-10-19T06:00:00Z', service_period: 'night', total: 18000 }
    ];
    const midnight = '2026-10-19T00:00:00-05:00';
    const total = () => orders.filter(o => Date.parse(o.created_at) >= Date.parse(ctx._resolverInicioDiaEfectivo(midnight, 'night'))).reduce((sum, o) => sum + o.total, 0);
    assert.equal(total(), 63000);
    assert.equal(await ctx.activarPeriodoMenu('day'), true);
    assert.equal(await ctx.activarPeriodoMenu('night'), true);
    assert.equal(total(), 63000, 'Noche → Día → Noche debe conservar ventas antes y después de medianoche');
    assert.equal(settings.night_service_started_at, start);
    storage.set('cierre_desde_night', '2026-10-19T05:30:00Z');
    assert.equal(total(), 18000, 'Un cierre explícito sí debe aplicar el nuevo corte');
    settings.night_service_started_at = '2026-10-19T17:00:00Z';
    await ctx._asegurarInicioServicioNoche();
    assert.equal(ctx._nightServiceStartAt, settings.night_service_started_at, 'Debe sincronizar cierres de otra pestaña');
    console.log('OK: alternancia sin pérdida, cruce de medianoche, cierre explícito y sincronización entre pestañas.');
})().catch(error => { console.error(error); process.exitCode = 1; });
