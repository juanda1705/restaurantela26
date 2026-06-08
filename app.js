// ============================================================
// RESTAURANTE LA 26 — app.js · Versión 3.2
// Módulo principal: login, cocina, Supabase Realtime
// Namespace global: window.La26
// Bucaramanga, Santander — Colombia
//
// CAMBIOS v3.2 (fixes críticos):
//  [FIX-1] cargarPedidos: fallback sin join anidado a menu_items
//          → el fallback ahora solo pide order_items sin menu_items(name)
//            porque si RLS bloquea ese sub-join devuelve [] silencioso.
//            El nombre del plato se resuelve desde notes con [nombre].
//  [FIX-2] Realtime INSERT orders: delay 300 → 1500 ms
//          → le da tiempo a que order_items ya esté en BD antes del fetch.
//  [FIX-3] Realtime INSERT order_items: delay 600 → 1200 ms y fuerza
//          recarga aunque la orden ya estuviera en _allOrders vacía.
//  [FIX-4] _crearCardHTML: muestra nota de entrega (Para Llevar / Domicilio)
//          parseada del campo notes de la orden, útil para cocina.
// ============================================================

const SUPABASE_URL      = "https://hxmodeduckuhvvspnkxd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ESxhljLgqWkGvrnKhvbeEg_iBqaGciv";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const _supabase = supabaseClient;

const RESTAURANT_SLUG = "restaurante-la-26";
let _restaurantId = null;

const LA26_USERS = {
    'admin':   { password: 'admin26',   role: 'admin',   label: 'Administrador', emoji: '👑' },
    'cocina':  { password: 'cocina26',  role: 'cocina',  label: 'Cocina',        emoji: '🍳' },
    'cliente': { password: 'cliente26', role: 'cliente', label: 'Cliente',       emoji: '👤' },
};

let _currentRole     = null;
let _currentUser     = null;
let _allOrders       = [];
let _activeFilter    = 'all';
let _realtimeChannel = null;
let _timerInterval   = null;
let _audioCtx        = null;

// ============================================================
// NAMESPACE PÚBLICO
// ============================================================
window.La26 = {

    ejecutarLogin() {
        const userInput = (document.getElementById('login-user')?.value || '').trim().toLowerCase();
        const passInput =  document.getElementById('login-pass')?.value || '';
        const card      =  document.getElementById('login-card');
        const btnText   =  document.getElementById('btn-login-text');
        const btnEl     =  document.getElementById('btn-login');

        _ocultarMsgLogin();
        document.getElementById('login-user')?.classList.remove('field-error');
        document.getElementById('login-pass')?.classList.remove('field-error');

        if (!userInput || !passInput) {
            _mostrarMsgLogin('Completa el usuario y la contraseña.', 'error');
            if (!userInput) document.getElementById('login-user')?.classList.add('field-error');
            if (!passInput) document.getElementById('login-pass')?.classList.add('field-error');
            _shake(card);
            return;
        }

        const userData = LA26_USERS[userInput];
        if (!userData || userData.password !== passInput) {
            _mostrarMsgLogin('Usuario o contraseña incorrectos.', 'error');
            document.getElementById('login-user')?.classList.add('field-error');
            document.getElementById('login-pass')?.classList.add('field-error');
            document.getElementById('login-pass').value = '';
            document.getElementById('login-pass')?.focus();
            _shake(card);
            return;
        }

        if (btnEl) btnEl.disabled = true;
        if (btnText) btnText.textContent = 'Verificando…';

        setTimeout(() => {
            _currentRole = userData.role;
            _currentUser = userInput;
            sessionStorage.setItem('user_role', _currentRole);
            sessionStorage.setItem('user_name', _currentUser);
            _iniciarApp();
        }, 600);
    },

    cerrarSesion() {
        if (_realtimeChannel) { supabaseClient.removeChannel(_realtimeChannel); _realtimeChannel = null; }
        if (_timerInterval)   { clearInterval(_timerInterval); _timerInterval = null; }

        sessionStorage.removeItem('user_role');
        sessionStorage.removeItem('user_name');
        sessionStorage.removeItem('mesa_id');
        sessionStorage.removeItem('mesa_nombre');
        _currentRole = null; _currentUser = null; _allOrders = [];

        const userEl = document.getElementById('login-user');
        const passEl = document.getElementById('login-pass');
        const btnEl  = document.getElementById('btn-login');
        const btnTxt = document.getElementById('btn-login-text');
        if (userEl) { userEl.value = ''; userEl.classList.remove('field-error'); }
        if (passEl) { passEl.value = ''; passEl.classList.remove('field-error'); passEl.type = 'password'; }
        if (btnEl)  btnEl.disabled = false;
        if (btnTxt) btnTxt.textContent = 'Ingresar';
        _ocultarMsgLogin();

        document.getElementById('bottom-nav-cocina')?.remove();

        _mostrarLogin();
    },

    navTo(destino, btn) {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        if (btn) btn.classList.add('active');
        if (destino === 'admin')        window.location.href = 'admin.html';
        else if (destino === 'cliente') window.location.href = 'index-cliente.html';
        else _mostrarToast('📍 Vista de Cocina', 'info');
    },

    // ──────────────────────────────────────────────────────────
    // cargarPedidos — v3.2
    //
    // ESTRATEGIA DE 3 CAPAS para resistir RLS silenciosos:
    //
    //  Capa 1 — Query principal con join completo (ideal, funciona
    //           si RLS de order_items y menu_items tienen policy SELECT).
    //
    //  Capa 2 — Fallback SIN join a menu_items: solo trae order_items
    //           planos. El nombre del plato viene de notes con [nombre].
    //           Se activa para cada orden que llegó con order_items=[].
    //           CRÍTICO: NO incluimos menu_items(name) aquí para evitar
    //           que un RLS en menu_items mate el array completo.
    //
    //  Capa 3 — Si aun así order_items está vacío (timing: el INSERT
    //           de order_items aún no se procesó), la tarjeta muestra
    //           un mensaje de espera y el Realtime la actualizará en
    //           cuanto llegue el INSERT de order_items (~1-2 seg).
    // ──────────────────────────────────────────────────────────
    async cargarPedidos() {
        const grid = document.getElementById('contenedor-pedidos');
        if (!grid) return;

        grid.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <span>Cargando comandas…</span>
            </div>`;

        try {
            // ── Capa 1: query principal con join anidado ──────
            const { data: orders, error } = await supabaseClient
                .from('orders')
                .select(`
                    id,
                    order_number,
                    status,
                    customer_name,
                    total_amount,
                    created_at,
                    notes,
                    tables ( number, label ),
                    order_items (
                        id,
                        order_id,
                        quantity,
                        unit_price,
                        notes,
                        item_status,
                        menu_item_id,
                        menu_items ( name )
                    )
                `)
                .in('status', ['pending', 'confirmed', 'in_kitchen'])
                .order('created_at', { ascending: true });

            if (error) throw error;

            // ── Capa 2: fallback para órdenes sin ítems ───────
            // IMPORTANTE: este segundo SELECT no incluye menu_items(name)
            // para evitar que RLS en esa tabla elimine el resultado entero.
            // El nombre del plato se extrae de notes con el prefijo [nombre].
            const ordenesSinItems = (orders || []).filter(o =>
                !o.order_items || o.order_items.length === 0
            );

            if (ordenesSinItems.length > 0) {
                const ids = ordenesSinItems.map(o => o.id);

                // [FIX-1] Sin join a menu_items — solo columnas directas de order_items
                const { data: itemsDirectos, error: errFallback } = await supabaseClient
                    .from('order_items')
                    .select('id, order_id, quantity, unit_price, notes, item_status, menu_item_id')
                    .in('order_id', ids);

                if (errFallback) {
                    console.warn('[La 26] Fallback order_items error:', errFallback.message);
                }

                if (itemsDirectos && itemsDirectos.length > 0) {
                    (orders || []).forEach(o => {
                        if (!o.order_items || o.order_items.length === 0) {
                            // Inyectamos los ítems; menu_items será null pero
                            // _parsearNotes(item.notes) resolverá el nombre desde [nombre].
                            o.order_items = itemsDirectos
                                .filter(i => i.order_id === o.id)
                                .map(i => ({ ...i, menu_items: null }));
                        }
                    });
                }
                // Si itemsDirectos sigue vacío → Capa 3 (timing): la tarjeta
                // mostrará "Preparando comanda…" y Realtime la recargará.
            }

            _allOrders = orders || [];
            _actualizarContadores();
            _renderizarPedidos();

            const ahora   = new Date();
            const timeStr = ahora.toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
            const el = document.getElementById('last-update-text');
            if (el) el.textContent = `Actualizado a las ${timeStr} · ${_allOrders.length} comanda(s) activa(s)`;

        } catch (err) {
            console.error('[La 26] Error cargando pedidos:', err);
            grid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">⚠️</div>
                    <div class="empty-title">Error de conexión</div>
                    <div class="empty-sub">${err.message}<br><br>
                        <button onclick="La26.cargarPedidos()" style="font-size:13px;color:var(--oliva);text-decoration:underline;background:none;border:none;cursor:pointer;">
                            Reintentar
                        </button>
                    </div>
                </div>`;
        }
    },

    setFilter(filter, btn) {
        _activeFilter = filter;
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        _renderizarPedidos();
    },

    async cambiarEstado(pedidoId, nuevoEstado) {
        const { error } = await supabaseClient
            .from('orders')
            .update({ status: nuevoEstado })
            .eq('id', pedidoId);

        if (error) {
            console.error('[La 26] Error al cambiar estado:', error);
            _mostrarToast('Error al actualizar el pedido.', 'error');
        }
    },

    async despacharPedido(pedidoId) {
        const tarjeta = document.getElementById(`pedido-${pedidoId}`);
        if (tarjeta) tarjeta.classList.add('despachando');

        const { error } = await supabaseClient
            .from('orders')
            .update({ status: 'delivered' })
            .eq('id', pedidoId);

        if (error) {
            console.error('[La 26] Error al despachar:', error);
            _mostrarToast(`❌ Error al despachar: ${error.message}`, 'error');
            if (tarjeta) tarjeta.classList.remove('despachando');
            return;
        }

        _mostrarToast('✅ Pedido despachado correctamente', 'success');
        setTimeout(() => La26.cargarPedidos(), 800);
    },
};

// Aliases globales para compatibilidad con onclick en HTML
function cambiarEstado(pedidoId, nuevoEstado) { return La26.cambiarEstado(pedidoId, nuevoEstado); }
function despacharPedido(pedidoId)            { return La26.despacharPedido(pedidoId); }
function cargarPedidos()                      { return La26.cargarPedidos(); }

// ============================================================
// FUNCIONES PRIVADAS
// ============================================================

function _mostrarLogin() {
    const scLogin   = document.getElementById('screen-login');
    const scCocina  = document.getElementById('screen-cocina');
    const navAdmin  = document.getElementById('nav-admin');
    const barCocina = document.getElementById('bar-cocina');

    if (scLogin)   scLogin.style.display = 'flex';
    if (scCocina)  scCocina.classList.remove('visible');
    if (navAdmin)  navAdmin.classList.remove('visible');
    if (barCocina) barCocina.classList.remove('visible');
    document.body.className = '';

    setTimeout(() => document.getElementById('login-user')?.focus(), 300);
}

function _iniciarApp() {
    const scLogin = document.getElementById('screen-login');
    if (scLogin) scLogin.style.display = 'none';
    document.body.className = `role-${_currentRole}`;

    const userData = LA26_USERS[_currentUser] || {};
    const navEmoji    = document.getElementById('nav-emoji');
    const navUsername = document.getElementById('nav-username');
    if (navEmoji)    navEmoji.textContent    = userData.emoji || '';
    if (navUsername) navUsername.textContent = _currentUser;

    if (_currentRole === 'admin') {
        document.getElementById('nav-admin')?.classList.add('visible');
        _mostrarCocina();
    } else if (_currentRole === 'cocina') {
        _mostrarCocina();
    } else if (_currentRole === 'cliente') {
        _mostrarMsgLogin('Bienvenido. Redirigiendo…', 'success');
        if (scLogin) scLogin.style.display = 'flex';
        setTimeout(() => {
            window.location.href = `menu.html?usuario=${encodeURIComponent(_currentUser)}`;
        }, 900);
    }
}

function _mostrarCocina() {
    document.getElementById('screen-cocina')?.classList.add('visible');
    document.getElementById('bar-cocina')?.classList.add('visible');

    const barLabel = document.getElementById('bar-user-label');
    const userData = LA26_USERS[_currentUser] || {};
    if (barLabel) barLabel.textContent = `${userData.emoji || ''} ${userData.label || ''}`;

    _inyectarBottomNav();

    La26.cargarPedidos();
    _activarRealtime();
    _iniciarTimers();
}

// ── BOTTOM NAV MÓVIL — solo se inyecta una vez ────────────
function _inyectarBottomNav() {
    if (document.getElementById('bottom-nav-cocina')) return;

    const esAdmin = sessionStorage.getItem('user_role') === 'admin';

    const nav = document.createElement('nav');
    nav.id = 'bottom-nav-cocina';
    Object.assign(nav.style, {
        display:        'none',
        position:       'fixed',
        bottom:         '0',
        left:           '0',
        right:          '0',
        zIndex:         '9000',
        background:     '#ffffff',
        borderTop:      '1.5px solid #e8e8e2',
        boxShadow:      '0 -4px 20px rgba(26,31,24,0.08)',
        height:         '66px',
        alignItems:     'stretch',
        paddingBottom:  'env(safe-area-inset-bottom, 0px)',
    });

    const styleEl = document.createElement('style');
    styleEl.textContent = `
        @media (max-width: 768px) {
            #bottom-nav-cocina { display: flex !important; }
            #screen-cocina .cocina-main { padding-bottom: 80px !important; }
        }
        .bnav-cocina-item {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 3px;
            padding: 8px 4px;
            cursor: pointer;
            border: none;
            background: transparent;
            color: #78786e;
            font-family: 'DM Sans', sans-serif;
            font-size: 10px;
            font-weight: 500;
            text-decoration: none;
            transition: color .18s;
            -webkit-tap-highlight-color: transparent;
        }
        .bnav-cocina-item:active { opacity: .7; }
        .bnav-cocina-icon { font-size: 20px; line-height: 1; }
        .bnav-cocina-label { font-size: 9.5px; font-weight: 600; letter-spacing: .2px; white-space: nowrap; }
    `;
    document.head.appendChild(styleEl);

    nav.innerHTML = `
        <button class="bnav-cocina-item" onclick="La26.cargarPedidos()" aria-label="Actualizar">
            <span class="bnav-cocina-icon">🔄</span>
            <span class="bnav-cocina-label">Actualizar</span>
        </button>
        <button class="bnav-cocina-item" onclick="La26.setFilter('all', null)" aria-label="Todos">
            <span class="bnav-cocina-icon">🍽️</span>
            <span class="bnav-cocina-label">Todos</span>
        </button>
        <button class="bnav-cocina-item" onclick="La26.setFilter('pending', null)" aria-label="Pendientes">
            <span class="bnav-cocina-icon">⏳</span>
            <span class="bnav-cocina-label">Pendientes</span>
        </button>
        <button class="bnav-cocina-item" onclick="La26.cerrarSesion()" aria-label="Salir">
            <span class="bnav-cocina-icon">🚪</span>
            <span class="bnav-cocina-label">Salir</span>
        </button>
        ${esAdmin ? `
        <a class="bnav-cocina-item" href="admin.html" aria-label="Panel Admin"
           style="color:#4a6741;">
            <span class="bnav-cocina-icon">📊</span>
            <span class="bnav-cocina-label" style="color:#4a6741;font-weight:700;">Admin</span>
        </a>` : ''}
    `;

    document.body.appendChild(nav);
}

// ── Realtime ──────────────────────────────────────────────
// [FIX-2] INSERT orders: delay aumentado a 1500 ms para darle tiempo
//         al INSERT de order_items que ocurre inmediatamente después.
// [FIX-3] INSERT order_items: delay 1200 ms y fuerza recarga total.
function _activarRealtime() {
    if (_realtimeChannel) supabaseClient.removeChannel(_realtimeChannel);

    let debounceTimer = null;
    const recargar = (ms = 400) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => La26.cargarPedidos(), ms);
    };

    _realtimeChannel = supabaseClient
        .channel('la26-cocina-v32')
        .on('postgres_changes', { event:'INSERT', schema:'public', table:'orders' },
            (payload) => {
                console.info('[La 26] 📦 Nuevo pedido:', payload.new?.order_number || payload.new?.id);
                _dispararAlerta(payload.new);
                // [FIX-2] 1500 ms: el INSERT de order_items llega ~200-800 ms
                // después del INSERT de orders desde menu.js.
                recargar(1500);
            })
        .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders' },
            () => { console.info('[La 26] 🔄 Pedido actualizado'); recargar(300); })
        .on('postgres_changes', { event:'INSERT', schema:'public', table:'order_items' },
            (payload) => {
                console.info('[La 26] 🍽️ Nuevo ítem recibido, recargando comanda…');
                // [FIX-3] Siempre recarga cuando llega un nuevo item, sin debounce largo.
                // Esto cubre el caso donde la orden ya apareció en pantalla vacía.
                recargar(1200);
            })
        .subscribe((status) => {
            console.info('[La 26] Canal RT:', status);
            const dot = document.getElementById('dot-live');
            if (dot) dot.style.background = status === 'SUBSCRIBED' ? '#4ade80' : '#f87171';
        });
}

function _dispararAlerta(pedido) {
    const mesa = pedido?.table_id || pedido?.tables?.label || 'nueva mesa';
    _mostrarToast(`🛎️ Nuevo pedido — ${mesa}`, 'new');

    const banner    = document.getElementById('new-order-banner');
    const bannerTxt = document.getElementById('banner-text');
    if (banner && bannerTxt) {
        bannerTxt.textContent = `¡Nuevo pedido recibido! — ${mesa}`;
        banner.classList.add('visible');
        setTimeout(() => banner.classList.remove('visible'), 3500);
    }
    _reproducirSonido();
}

function _reproducirSonido() {
    try {
        if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = _audioCtx, now = ctx.currentTime;
        [523.25, 659.25, 783.99].forEach((freq, i) => {
            const osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.13);
            gain.gain.setValueAtTime(0, now + i * 0.13);
            gain.gain.linearRampToValueAtTime(0.18, now + i * 0.13 + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.13 + 0.38);
            osc.start(now + i * 0.13);
            osc.stop(now  + i * 0.13 + 0.45);
        });
    } catch(e) { console.warn('[La 26] Audio no disponible:', e); }
}

function _mostrarToast(mensaje, tipo = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    if (tipo === 'new')     toast.style.borderLeftColor = '#4ade80';
    if (tipo === 'error')   toast.style.borderLeftColor = '#ef4444';
    if (tipo === 'success') toast.style.borderLeftColor = '#22c55e';
    const iconos = { new:'🛎️', info:'ℹ️', success:'✅', warning:'⚠️', error:'❌' };
    toast.innerHTML = `<span>${iconos[tipo]||'ℹ️'}</span><span>${_esc(mensaje)}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('out'); setTimeout(() => toast.remove(), 350); }, 4000);
}

function _renderizarPedidos(nuevoId = null) {
    const grid = document.getElementById('contenedor-pedidos');
    if (!grid) return;

    const filtradas = _activeFilter === 'all'
        ? _allOrders
        : _allOrders.filter(o => o.status === _activeFilter);

    if (filtradas.length === 0) {
        const msgs = {
            all:        { icon:'🍽️', title:'Cocina despejada',     sub:'No hay comandas activas.' },
            pending:    { icon:'⏳', title:'Sin pendientes',        sub:'Todos los pedidos han sido tomados.' },
            in_kitchen: { icon:'🔥', title:'Nada en preparación',  sub:'No hay órdenes siendo preparadas.' },
            confirmed:  { icon:'✅', title:'Sin confirmados',       sub:'Los pedidos confirmados aparecerán aquí.' },
        };
        const m = msgs[_activeFilter] || msgs.all;
        grid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${m.icon}</div>
                <div class="empty-title">${m.title}</div>
                <div class="empty-sub">${m.sub}</div>
            </div>`;
        return;
    }

    const ORDEN = { pending:0, in_kitchen:1, confirmed:2 };
    const ordenadas = [...filtradas].sort((a, b) => {
        const oa = ORDEN[a.status] ?? 9, ob = ORDEN[b.status] ?? 9;
        return oa !== ob ? oa - ob : new Date(a.created_at) - new Date(b.created_at);
    });

    grid.innerHTML = ordenadas.map(o => _crearCardHTML(o, o.id === nuevoId)).join('');
    _actualizarTimers();
}

// ── _crearCardHTML v3.2 ────────────────────────────────────
// [FIX-4] Muestra la modalidad de entrega (notes de la orden)
//         arriba del listado de platos para que cocina sepa
//         si es para llevar, domicilio o en mesa.
//
// Resolución del nombre del plato — 4 capas:
//   1. item.menu_items?.name       → join exitoso (ideal, requiere RLS OK)
//   2. _parsearNotes(notes).nombrePlato → prefijo [nombre] en notes
//   3. notes plano (sin prefijo)   → último recurso legible
//   4. '(Plato sin nombre)'        → placeholder
function _crearCardHTML(order, esNuevo = false) {
    const identificadorMesa = order.tables?.label
        || (order.tables?.number ? `Mesa ${order.tables.number}` : 'Mesa Rápida');

    const estadoMap = {
        pending:    { label:'Pendiente',      cls:'pending'    },
        confirmed:  { label:'Confirmado',     cls:'confirmed'  },
        in_kitchen: { label:'En preparación', cls:'in_kitchen' },
    };
    const cfg = estadoMap[order.status] || { label: order.status, cls:'pending' };

    // [FIX-4] Parsear modalidad de entrega desde notes de la orden
    const notasOrden  = order.notes || '';
    let   modalidad   = '';
    let   modalidadCls = '';
    if (notasOrden.includes('[PARA LLEVAR]')) {
        modalidad    = '🛍️ Para Llevar / Retiro';
        modalidadCls = 'modalidad-llevar';
    } else if (notasOrden.includes('[DOMICILIO]')) {
        // Extraer dirección si existe
        const matchDir = notasOrden.match(/Dirección:\s*(.+)$/);
        const dir = matchDir ? matchDir[1].trim() : '';
        modalidad    = `🛵 Domicilio${dir ? ` — ${dir}` : ''}`;
        modalidadCls = 'modalidad-domicilio';
    } else if (notasOrden.includes('[MESA]')) {
        modalidad    = `🍽️ En mesa — ${identificadorMesa}`;
        modalidadCls = 'modalidad-mesa';
    }

    const items = order.order_items || [];

    // Capa 3 de seguridad: si la orden acaba de crearse y los ítems
    // aún no llegaron (timing), mostramos un mensaje de espera activa
    // en vez del frustrante "Sin detalle registrado".
    let itemsHTML;
    if (items.length === 0) {
        itemsHTML = `
            <p style="font-size:13px;color:#9ca3af;font-style:italic;padding:4px 0;display:flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;
                      background:#fbbf24;animation:pulse 1.2s infinite;"></span>
                Preparando comanda… (actualizando)
            </p>`;
    } else {
        itemsHTML = items.map(item => {
            const parsed = _parsearNotes(item.notes);

            // PROBLEMA 2 FIX — prioridad de resolución del nombre:
            //   ANTES: item.menu_items?.name (JOIN) tenía prioridad máxima.
            //          Si menu_item_id apuntaba al producto equivocado (bug del
            //          fallback fuzzy en menu.js), el JOIN devolvía ese nombre
            //          incorrecto (ej: "Albondigas") ignorando el notes correcto.
            //
            //   AHORA: notes[nombre] tiene prioridad máxima.
            //          El mesero escribe [nombre]<plato real> en el momento del
            //          pedido. Es la fuente de verdad. El JOIN solo se usa como
            //          respaldo para órdenes antiguas sin prefijo [nombre].
            //
            // Capa 1: prefijo [nombre] en notes  → fuente de verdad del pedido
            // Capa 2: notes plano sin prefijo     → órdenes antiguas
            // Capa 3: item.menu_items?.name (JOIN) → respaldo para casos legacy
            // Capa 4: placeholder

            const nombrePlato = parsed.nombrePlato
                || (item.notes && !item.notes.startsWith('[nombre]') ? item.notes : null)
                || item.menu_items?.name
                || '(Plato sin nombre)';

            // Nota del cliente: texto libre después de " | " en notes
            const notaCliente = parsed.notaCliente;

            return `
            <div class="order-item">
                <div class="item-top">
                    <span class="item-qty">${item.quantity}×</span>
                    <span class="item-name">${_esc(nombrePlato)}</span>
                </div>
                ${notaCliente ? `<div class="item-nota">✏️ ${_esc(notaCliente)}</div>` : ''}
            </div>`;
        }).join('');
    }

    let botonesHTML = '';
    if (order.status === 'pending' || order.status === 'confirmed') {
        botonesHTML = `
            <button class="btn-kitchen en-cocina"
                    onclick="La26.cambiarEstado('${order.id}', 'in_kitchen')">
                👨‍🍳 En cocina
            </button>`;
    }
    botonesHTML += `
        <button class="btn-kitchen despachar"
                onclick="La26.despacharPedido('${order.id}')">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
            </svg>
            Despachar
        </button>`;

    const fechaStr = order.created_at
        ? new Date(order.created_at).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })
        : '—';

    return `
    <div id="pedido-${order.id}"
         class="order-card${esNuevo ? ' is-new' : ''}"
         data-status="${order.status}"
         data-created="${order.created_at || ''}">
        <div class="card-header">
            <div>
                <div class="order-number">${_esc(order.order_number || '—')}</div>
                <div class="customer-name">${_esc(order.customer_name || 'Cliente en Mesa')}</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
                <span class="status-badge ${cfg.cls}">${cfg.label}</span>
                <span class="mesa-tag">📍 ${_esc(identificadorMesa)}</span>
                <span style="font-size:11px;color:#6b7280;">🕐 ${fechaStr}</span>
                <span class="card-timer" data-created="${order.created_at || ''}" id="timer-${order.id}"
                      style="font-size:12px;font-weight:500;color:#9ca3af;">—</span>
            </div>
        </div>
        <div class="card-body">
            ${modalidad ? `<div class="comanda-modalidad ${modalidadCls}">${_esc(modalidad)}</div>` : ''}
            <div class="items-label">Comanda</div>
            ${itemsHTML}
        </div>
        <div class="card-footer">
            ${botonesHTML}
        </div>
    </div>`;
}

function _iniciarTimers() {
    if (_timerInterval) clearInterval(_timerInterval);
    _actualizarTimers();
    _timerInterval = setInterval(_actualizarTimers, 30000);
}

function _actualizarTimers() {
    const ahora = Date.now();
    document.querySelectorAll('.card-timer[data-created]').forEach(el => {
        const raw = el.getAttribute('data-created');
        if (!raw) { el.textContent = '—'; return; }
        const mins = Math.floor((ahora - new Date(raw).getTime()) / 60000);
        if (mins < 1)       { el.textContent = 'Ahora mismo';         el.style.color = '#4ade80'; }
        else if (mins < 10) { el.textContent = `Hace ${mins} min`;    el.style.color = '#9ca3af'; }
        else if (mins < 20) { el.textContent = `⚠ ${mins} min`;      el.style.color = '#fbbf24'; }
        else                { el.textContent = `🔴 ${mins} min`;      el.style.color = '#f87171'; }
    });
}

function _actualizarContadores() {
    const counts = _allOrders.reduce((acc, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1;
        return acc;
    }, {});
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || 0; };
    set('count-pending',   counts.pending);
    set('count-preparing', (counts.in_kitchen || 0) + (counts.confirmed || 0));
    set('count-delivered', counts.delivered);
}

function _mostrarMsgLogin(texto, tipo) {
    const el = document.getElementById('login-msg');
    if (!el) return;
    el.textContent = texto;
    el.className = `msg-box ${tipo}`;
}
function _ocultarMsgLogin() {
    const el = document.getElementById('login-msg');
    if (el) { el.className = 'msg-box'; el.textContent = ''; }
}
function _shake(el) {
    if (!el) return;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 450);
}

function _parsearNotes(notes) {
    if (!notes) return { nombrePlato: null, notaCliente: null };
    if (notes.startsWith('[nombre]')) {
        const partes = notes.replace('[nombre]', '').split(' | ');
        return { nombrePlato: partes[0]?.trim() || null, notaCliente: partes[1]?.trim() || null };
    }
    return { nombrePlato: null, notaCliente: notes };
}
function parsearNotes(notes) { return _parsearNotes(notes); }

function _esc(str) {
    if (typeof str !== 'string') return String(str ?? '');
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
              .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ============================================================
// FUNCIONES HEREDADAS GLOBALES
// ============================================================
async function resolverRestaurantId() {
    if (_restaurantId) return _restaurantId;
    try {
        const { data: rest } = await supabaseClient
            .from('restaurants').select('id').eq('slug', RESTAURANT_SLUG).maybeSingle();
        if (rest?.id) { _restaurantId = rest.id; return _restaurantId; }

        const { data: any } = await supabaseClient
            .from('restaurants').select('id').limit(1).maybeSingle();
        if (any?.id) { _restaurantId = any.id; return _restaurantId; }

        const { data: nuevo } = await supabaseClient
            .from('restaurants')
            .insert([{ name:'Restaurante la 26', slug:RESTAURANT_SLUG }])
            .select('id').single();
        if (nuevo?.id) { _restaurantId = nuevo.id; return _restaurantId; }
    } catch(err) { console.error('[La 26] resolverRestaurantId:', err); }
    return null;
}

window.abrirMenu = function(mesa, nombre) {
    if (!mesa) return;
    sessionStorage.setItem('mesa_id',     mesa);
    sessionStorage.setItem('mesa_nombre', nombre || 'Comensal');
    window.location.href = `menu.html?mesa=${encodeURIComponent(mesa)}&nombre=${encodeURIComponent(nombre||'Comensal')}`;
};

window.simularPedido = async function() {
    sessionStorage.setItem('mesa_id',     'QR-Demo');
    sessionStorage.setItem('mesa_nombre', 'Demo');
    window.location.href = 'menu.html?mesa=QR-Demo&nombre=Demo&modo=simulacion';
};

function leerParamsURL() {
    const p = new URLSearchParams(window.location.search);
    return {
        mesa:   p.get('mesa')   || sessionStorage.getItem('mesa_id')     || null,
        nombre: p.get('nombre') || sessionStorage.getItem('mesa_nombre') || 'Comensal',
        modo:   p.get('modo')   || null,
    };
}

const btnSimular = document.getElementById('btn-simular');
if (btnSimular) btnSimular.addEventListener('click', ejecutarSimulador);

async function ejecutarSimulador() {
    if (!btnSimular) return;
    btnSimular.disabled = true; btnSimular.textContent = '⏳ Generando comanda...';
    try {
        const restaurantId = await resolverRestaurantId();
        if (!restaurantId) { alert('No se pudo resolver el ID del restaurante.'); return; }

        const { data: mesa } = await supabaseClient
            .from('tables').select('id').eq('restaurant_id', restaurantId).limit(1).maybeSingle();
        if (!mesa) { alert('Crea al menos una mesa en Supabase (tabla "tables").'); return; }

        const { data: platos } = await supabaseClient
            .from('menu_items').select('id, name, price')
            .eq('is_active', true).eq('restaurant_id', restaurantId).limit(3);

        let items = platos || [];
        if (items.length === 0) {
            const { data: cat } = await supabaseClient
                .from('menu_categories').select('id').eq('restaurant_id', restaurantId).limit(1).maybeSingle();
            if (cat?.id) {
                const { data: nuevo } = await supabaseClient
                    .from('menu_items')
                    .insert([{ restaurant_id:restaurantId, category_id:cat.id,
                               name:'Bandeja Paisa La 26 (Demo)', price:22000,
                               item_type:'protein', is_active:true }])
                    .select('id, name, price').single();
                if (nuevo) items = [nuevo];
            }
        }
        if (items.length === 0) { alert('No hay platos activos en el catálogo.'); return; }

        const rand    = Math.floor(1000 + Math.random() * 9000);
        const total   = items.reduce((s, p) => s + (p.price || 0), 0);
        const orderNo = `ORD-LA26-${rand}`;

        const { data: nuevaOrden, error: errOrden } = await supabaseClient
            .from('orders')
            .insert([{ restaurant_id:restaurantId, table_id:mesa.id,
                       order_number:orderNo, status:'pending',
                       customer_name:'Cliente Demo — La 26', total_amount:total }])
            .select('id').single();

        if (errOrden || !nuevaOrden) throw new Error(errOrden?.message || 'Error creando orden');

        const orderItems = items.map((p, i) => ({
            order_id: nuevaOrden.id, menu_item_id: p.id,
            quantity: i === 0 ? 2 : 1, unit_price: p.price || 0,
            item_status: 'pending',
            notes: `[nombre]${p.name}${i === 0 ? ' | Sin cebolla por favor 🧅' : ''}`,
        }));

        const { error: errItems } = await supabaseClient.from('order_items').insert(orderItems);
        if (errItems) console.error('[La 26] Error en order_items del simulador:', errItems);
        else console.log(`[La 26] ✅ Pedido simulado ${orderNo} con ${orderItems.length} plato(s).`);

        // Esperar 1.8s para que order_items esté en BD antes de renderizar
        setTimeout(() => La26.cargarPedidos(), 1800);

    } catch(err) {
        console.error('[La 26] Error en simulador:', err);
        alert('Error al simular: ' + err.message);
    } finally {
        if (btnSimular) { btnSimular.disabled = false; btnSimular.textContent = '🚀 Simular Pedido desde QR'; }
    }
}

// ============================================================
// INICIALIZACIÓN
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const savedRole = sessionStorage.getItem('user_role');
    const savedUser = sessionStorage.getItem('user_name');
    const sesionValida = savedRole && savedUser && LA26_USERS[savedUser]?.role === savedRole;

    if (sesionValida) {
        _currentRole = savedRole;
        _currentUser = savedUser;
        _iniciarApp();
    } else {
        _mostrarLogin();
    }
});
// ═══ GUARD: Verificar si el sistema está habilitado ═══
async function verificarAccesoPedidos() {
    try {
        const { data } = await supabaseClient
            .from('system_settings')
            .select('value')
            .eq('key', 'orders_enabled')
            .maybeSingle();

        const habilitado = data ? data.value === 'true' : true;

        if (!habilitado) {
            // Ocultar toda la UI de pedidos y mostrar aviso
            document.getElementById('app-pedidos').style.display = 'none';
            document.getElementById('panel-fuera-servicio').style.display = 'flex';
            return false;
        }
        return true;
    } catch {
        return true; // En caso de error de red, permitir acceso
    }
}

// Llamar al inicio del DOMContentLoaded de app.js:
// document.addEventListener('DOMContentLoaded', async () => {
//     const ok = await verificarAccesoPedidos();
//     if (!ok) return;
//     // ... resto de la inicialización
// });

// HTML que debes tener en app.html / mesero.html:
// <div id="panel-fuera-servicio" style="display:none;...">
//   <p>🔒 Sistema Fuera de Servicio</p>
//   <p>El administrador ha cerrado el sistema temporalmente.</p>
// </div>
