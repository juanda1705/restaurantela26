/* Selector compartido de servicio para las pantallas internas. */
(() => {
    'use strict';

    const URL = 'https://hxmodeduckuhvvspnkxd.supabase.co';
    const KEY = 'sb_publishable_ESxhljLgqWkGvrnKhvbeEg_iBqaGciv';
    const ACTIVE_KEY = 'active_menu_period';
    const START_KEYS = { day: 'day_service_started_at', night: 'night_service_started_at' };
    const client = window.supabase?.createClient(URL, KEY);
    if (!client) return;

    let current = 'day';
    let changing = false;
    let dock;
    let status;
    let dayButton;
    let nightButton;
    let adminSidebar = null;

    function hasInternalSession() {
        const path = location.pathname.toLowerCase();
        // El panel administrativo ya es la pantalla de control del servicio.
        // No depender de sessionStorage evita que el selector desaparezca al
        // abrir o recargar admin.html sin una sesión guardada en esa pestaña.
        if (path.endsWith('/admin.html') || path === 'admin.html') return true;
        // La cocina solo recibe el periodo decidido desde Administración.
        if (path.endsWith('/index.html') || path === '/' || path === 'index.html') return false;
        // El servicio es una decisión administrativa. El mesero solo escucha
        // el cambio y aplica el tema; nunca recibe controles para cambiarlo.
        if (path.endsWith('/menu.html') || path === 'menu.html') return false;
        return false;
    }

    function apply(period) {
        current = period === 'night' ? 'night' : 'day';
        try { localStorage.setItem('la26_active_menu_period', current); } catch (_) {}
        window.menuPeriodActivo = current;
        document.body.classList.toggle('theme-night', current === 'night');
        document.documentElement.style.colorScheme = current === 'night' ? 'dark' : 'light';
        if (status) status.textContent = `Servicio ${current === 'night' ? 'noche' : 'día'}`;
        dayButton?.classList.toggle('is-active', current === 'day');
        nightButton?.classList.toggle('is-active', current === 'night');
        dayButton?.setAttribute('aria-pressed', String(current === 'day'));
        nightButton?.setAttribute('aria-pressed', String(current === 'night'));
    }

    function notify(kind, message) {
        if (typeof Toast !== 'undefined' && typeof Toast[kind] === 'function') {
            Toast[kind](message);
            return;
        }
        if (status) status.textContent = message;
        window.setTimeout(() => apply(current), 2600);
    }

    function addStyles() {
        if (document.getElementById('service-period-switcher-styles')) return;
        const style = document.createElement('style');
        style.id = 'service-period-switcher-styles';
        style.textContent = `
            .service-period-dock { position:fixed; z-index:8000; left:50%; bottom:12px; transform:translateX(-50%); width:max-content; max-width:calc(100vw - 24px); display:flex; align-items:center; gap:7px; padding:7px 9px 7px 14px; border:1px solid rgba(110,120,108,.24); border-radius:18px; background:rgba(255,255,255,.96); color:#202820; box-shadow:0 10px 32px rgba(15,25,17,.18); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); font:500 12px/1.2 'DM Sans',system-ui,sans-serif; transition:background .2s,border-color .2s,color .2s; }
            .service-period-dock__status { min-width:100px; font-weight:700; letter-spacing:.01em; white-space:nowrap; }
            .service-period-dock__button { min-width:112px; min-height:48px; display:inline-flex; align-items:center; justify-content:center; gap:8px; border:1px solid #dfe4dc; border-radius:12px; padding:0 17px; background:#f7f8f5; color:#4c574c; font:600 14px/1 'DM Sans',system-ui,sans-serif; cursor:pointer; touch-action:manipulation; transition:transform .18s,border-color .18s,background .18s,color .18s,box-shadow .18s; }
            .service-period-dock__button:hover { transform:translateY(-1px); border-color:#71866a; }
            .service-period-dock__button.is-active { border-color:#456442; background:#456442; color:#fff; box-shadow:0 4px 11px rgba(36,70,42,.17); }
            .theme-night .service-period-dock { background:rgba(31,38,33,.97); border-color:#455148; color:#eeeae0; }
            .theme-night .service-period-dock__button { background:#29312b; border-color:#465248; color:#d5d9d1; }
            .theme-night .service-period-dock__button.is-active { background:#829775; border-color:#9bae8d; color:#101711; }
            .service-period-dock button:disabled { opacity:.55; cursor:wait; }
            .service-period-dock.is-obscured { display:none !important; }
            @media (max-width:760px) {
                .service-period-dock { bottom:calc(10px + env(safe-area-inset-bottom, 0px)); width:calc(100vw - 20px); max-width:460px; justify-content:space-between; padding:7px; border-radius:16px; }
                .service-period-dock__status { min-width:0; padding-left:7px; font-size:11px; }
                .service-period-dock__button { flex:1; min-width:0; min-height:50px; padding:0 12px; font-size:14px; }
                body.service-period-has-bottom-nav .service-period-dock { bottom:calc(78px + env(safe-area-inset-bottom, 0px)); }
            }
            @media (min-width:761px) and (max-width:1180px) {
                .service-period-dock { bottom:16px; max-width:500px; }
                body.service-period-has-bottom-nav .service-period-dock { bottom:88px; }
            }
            @media (min-width:769px) {
                .service-period-dock--sidebar { position:sticky; left:auto; bottom:0; transform:none; z-index:2; width:100%; max-width:none; display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:auto; padding:10px; border-radius:14px; box-shadow:0 -6px 14px rgba(15,25,17,.06); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); }
                .service-period-dock--sidebar .service-period-dock__status { grid-column:1/-1; min-width:0; padding:2px 3px 5px; font-size:11px; }
                .service-period-dock--sidebar .service-period-dock__button { min-width:0; min-height:46px; padding:0 7px; font-size:12px; }
            }
            body.service-period-cart-open .service-period-dock { bottom:calc(92px + env(safe-area-inset-bottom, 0px)); }
            @media (prefers-reduced-motion:reduce) { .service-period-dock, .service-period-dock * { transition:none !important; } }
        `;
        document.head.appendChild(style);
    }

    function render() {
        if (dock || !document.body) return;
        addStyles();
        dock = document.createElement('aside');
        dock.className = 'service-period-dock';
        dock.setAttribute('aria-label', 'Cambiar servicio activo');
        status = document.createElement('span');
        status.className = 'service-period-dock__status';
        dayButton = document.createElement('button');
        dayButton.type = 'button';
        dayButton.className = 'service-period-dock__button';
        dayButton.innerHTML = '<span aria-hidden="true">☀</span><span>Día</span>';
        dayButton.setAttribute('aria-label', 'Activar servicio de día');
        nightButton = document.createElement('button');
        nightButton.type = 'button';
        nightButton.className = 'service-period-dock__button';
        nightButton.innerHTML = '<span aria-hidden="true">☾</span><span>Noche</span>';
        nightButton.setAttribute('aria-label', 'Activar servicio de noche');
        dayButton.addEventListener('click', () => setPeriod('day'));
        nightButton.addEventListener('click', () => setPeriod('night'));
        dock.append(status, dayButton, nightButton);
        adminSidebar = location.pathname.toLowerCase().endsWith('/admin.html')
            ? document.querySelector('.layout-wrapper > aside') : null;
        placeDock();
        detectBottomNav();
        apply(current);
    }

    function detectBottomNav() {
        const candidates = ['bottom-nav', 'bottom-nav-cocina', 'bottom-nav-mesero'];
        const exists = candidates.some(id => {
            const el = document.getElementById(id);
            if (!el) return false;
            const css = getComputedStyle(el);
            return css.display !== 'none' && (css.position === 'fixed' || css.position === 'sticky');
        });
        document.body.classList.toggle('service-period-has-bottom-nav', exists);
        const cartBar = document.getElementById('cart-bar');
        const cartOpen = Boolean(cartBar?.classList.contains('visible'));
        document.body.classList.toggle('service-period-cart-open', cartOpen);
        const blockingLayers = document.querySelectorAll('[aria-modal="true"], [id*="modal"], #order-modal, .adicional-modal-wrap.open');
        const modalOpen = [...blockingLayers].some(el => {
            const css = getComputedStyle(el);
            return css.display !== 'none' && css.visibility !== 'hidden' && el.getClientRects().length > 0;
        });
        dock?.classList.toggle('is-obscured', modalOpen);
        placeDock();
        if (cartBar && !cartBar.dataset.servicePeriodObserver) {
            cartBar.dataset.servicePeriodObserver = '1';
            new MutationObserver(detectBottomNav).observe(cartBar, { attributes:true, attributeFilter:['class','style'] });
        }
        const dialog = document.getElementById('order-modal');
        if (dialog && !dialog.dataset.servicePeriodObserver) {
            dialog.dataset.servicePeriodObserver = '1';
            new MutationObserver(detectBottomNav).observe(dialog, { attributes:true, attributeFilter:['class','style'] });
        }
        document.querySelectorAll('[id*="modal"], .adicional-modal-wrap').forEach(modal => {
            if (modal.dataset.servicePeriodObserver) return;
            modal.dataset.servicePeriodObserver = '1';
            new MutationObserver(detectBottomNav).observe(modal, { attributes:true, attributeFilter:['class','style','aria-hidden'] });
        });
    }

    function placeDock() {
        if (!dock) return;
        const useSidebar = Boolean(adminSidebar && window.innerWidth > 768);
        dock.classList.toggle('service-period-dock--sidebar', useSidebar);
        const target = useSidebar ? adminSidebar : document.body;
        if (dock.parentElement !== target) target.appendChild(dock);
    }

    async function setPeriod(period) {
        if (changing || !['day', 'night'].includes(period) || period === current) return;
        changing = true;
        [dayButton, nightButton].forEach(button => { if (button) button.disabled = true; });
        try {
            // El panel admin mantiene su flujo de actualización y cierre existentes.
            if (typeof window.activarPeriodoMenu === 'function') {
                const ok = await window.activarPeriodoMenu(period, { mostrarToast: false });
                if (!ok) return;
            } else {
                const startKey = START_KEYS[period];
                const startResult = await client.from('system_settings').upsert(
                    [{ key: startKey, value: new Date().toISOString() }], { onConflict: 'key' }
                );
                if (startResult.error) throw startResult.error;
                const activeResult = await client.from('system_settings').upsert(
                    [{ key: ACTIVE_KEY, value: period }], { onConflict: 'key' }
                );
                if (activeResult.error) throw activeResult.error;
            }
            apply(period);
            notify('ok', `Servicio de ${period === 'night' ? 'noche' : 'día'} activado.`);
        } catch (error) {
            console.error('No se pudo cambiar el servicio activo:', error);
            notify('error', 'No se pudo cambiar el servicio. Revisa la conexión.');
        } finally {
            changing = false;
            [dayButton, nightButton].forEach(button => { if (button) button.disabled = false; });
        }
    }

    async function load() {
        if (!hasInternalSession()) return;
        let cached = '';
        try { cached = localStorage.getItem('la26_active_menu_period') || ''; } catch (_) {}
        current = window.menuPeriodActivo === 'night' || cached === 'night' ? 'night' : 'day';
        render();
        try {
            const { data, error } = await client.from('system_settings').select('value').eq('key', ACTIVE_KEY).maybeSingle();
            if (error) throw error;
            apply(data?.value === 'night' ? 'night' : 'day');
        } catch (error) {
            console.warn('No se pudo leer el servicio activo:', error);
            apply(window.menuPeriodActivo === 'night' || cached === 'night' ? 'night' : current);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, { once: true });
    else load();

    client.channel('service-period-switcher')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'system_settings', filter: `key=eq.${ACTIVE_KEY}` }, payload => {
            const value = payload.new?.value || payload.old?.value;
            const period = value === 'night' ? 'night' : 'day';
            const previousPeriod = window.menuPeriodActivo === 'night' ? 'night' : 'day';
            apply(period);
            if (typeof window._renderPeriodoMenu === 'function' && previousPeriod !== period) {
                const syncAdmin = async () => {
                    window._mostrarCargandoServicioAdmin?.(true, 'Cambiando el servicio activo');
                    try {
                        if (period === 'night' && typeof window._asegurarInicioServicioNoche === 'function') {
                            await window._asegurarInicioServicioNoche();
                        }
                        window._renderPeriodoMenu(period);
                        await Promise.all([
                            window.cargarDashboardReal?.(),
                            window.cargarHistorialPedidos?.(),
                            window.cargarGastosReal?.(),
                            window.cargarSlotsMenuReal?.()
                        ]);
                        if (period === 'night' && !window._nightCloseTimerStarted) {
                            window._nightCloseTimerStarted = true;
                            window._cerrarNocheSiVencida?.();
                            setInterval(() => window._cerrarNocheSiVencida?.(), 30000);
                        }
                    } finally {
                        window._mostrarCargandoServicioAdmin?.(false);
                    }
                };
                syncAdmin().catch(error => console.warn('No se pudo actualizar el panel al cambiar de servicio:', error));
            }
            if (typeof window.La26?.cargarPedidos === 'function') window.La26.cargarPedidos();
            if (document.getElementById('hist-cocina-section')?.style.display !== 'none'
                && typeof window._cargarHistorialCocina === 'function') {
                window._cargarHistorialCocina();
            }
        }).subscribe();
    window.addEventListener('resize', detectBottomNav, { passive: true });
    window.addEventListener('la26:session-changed', () => {
        if (hasInternalSession()) load();
        else dock?.remove();
        if (!hasInternalSession()) dock = null;
    });
})();
