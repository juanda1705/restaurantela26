// ============================================================
// RESTAURANTE LA 26 — PANEL DE MESERO
// menu.js · Versión 7.0 — Fuente única de verdad
// Bucaramanga, Santander — Colombia
//
// ARQUITECTURA v7.0:
//
//  PROBLEMA RAÍZ (detectado en auditoría):
//    admin.js  → escribe: menu_items (is_active, price, portions_today)
//    menu.js   → leía:    daily_menu_slots_availability  ← TABLA DIFERENTE
//    Resultado: cambios de Admin nunca llegaban a Menu.
//
//  SOLUCIÓN:
//    Una sola fuente de verdad: menu_items
//    - Admin escribe menu_items  ✓
//    - Menu lee   menu_items  ✓  (mismo dato, misma tabla)
//    - Cocina resuelve nombres desde order_items.product_name ✓
//
//  daily_menu_slots_availability se mantiene como FALLBACK OPCIONAL
//  solo si el admin quiere granularidad de porciones por día.
//  Nunca reemplaza is_active como señal de disponibilidad.
//
//  REALTIME v7.0:
//    Suscripción a postgres_changes en menu_items.
//    Cualquier UPDATE desde Admin se refleja en ≤2 seg en Menu.
//
//  BUGS SINTAXIS CORREGIDOS (de v6.0):
//    [FIX-1] generarNumeroOrden: template literal con backticks
//    [FIX-2] _activarModoDemo: campos booleanos y menuItemId definidos
//    [FIX-3] _refrescarTarjeta: backtick en getElementById
//    [FIX-4] order_items: agrega product_name (Capa 1 de cocina v3.3)
//    [FIX-5] _mostrarEstado('error') siempre oculta el spinner
//    [FIX-6] try/catch en init() con mensaje visible al usuario
// ============================================================

'use strict';

// ============================================================
// CREDENCIALES SUPABASE
// ============================================================
const SUPABASE_URL      = "https://hxmodeduckuhvvspnkxd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ESxhljLgqWkGvrnKhvbeEg_iBqaGciv";
const RESTAURANT_SLUG   = "restaurante-la-26";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// CATEGORÍAS DE MENÚ
// ============================================================
const CATEGORIAS = {
    protein:        { label: 'Proteína con Salsa', icono: '🥩', orden: 1 },
    side:           { label: 'Principio',          icono: '🍲', orden: 2 },
    drink:          { label: 'Bebida',             icono: '🥤', orden: 3 },
    a_la_carte:     { label: 'A la Carta',         icono: '✨', orden: 4 },
    executive_lunch:{ label: 'Menú Ejecutivo',     icono: '🍱', orden: 5 },
    dessert:        { label: 'Postre',             icono: '🍮', orden: 6 },
};

const ITEM_TYPES_VALIDOS = ['protein','side','drink','a_la_carte','executive_lunch','dessert'];

// ============================================================
// ESTADO GLOBAL
// ============================================================
const State = {
    restaurantId:   null,
    slots:          [],
    cart:           [],
    filtro:         'todos',
    isSubmitting:   false,
    realtimeChannel: null,
};

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
const Toast = (function() {
    let container = null;

    function _ensureContainer() {
        if (container) return;
        container = document.createElement('div');
        Object.assign(container.style, {
            position: 'fixed', top: '20px', left: '50%',
            transform: 'translateX(-50%)', zIndex: '9999',
            display: 'flex', flexDirection: 'column',
            gap: '8px', alignItems: 'center',
            pointerEvents: 'none', width: 'max-content',
            maxWidth: 'calc(100vw - 32px)',
        });
        document.body.appendChild(container);
    }

    function show(msg, tipo = 'info', duracion = 3800) {
        _ensureContainer();
        const c = {
            ok:    { bg: '#f5f7f0', border: 'rgba(74,103,65,0.35)',  text: '#2e4028', dot: '#4a6741' },
            error: { bg: '#fdf5f3', border: 'rgba(192,80,60,0.30)',  text: '#6b2a1e', dot: '#c0503c' },
            info:  { bg: '#f5f7f0', border: 'rgba(74,103,65,0.25)',  text: '#3a4a38', dot: '#4a6741' },
        }[tipo] || {};

        const t = document.createElement('div');
        Object.assign(t.style, {
            display: 'flex', alignItems: 'center', gap: '9px',
            background: c.bg, border: `1.5px solid ${c.border}`,
            borderRadius: '999px', padding: '10px 20px 10px 14px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
            fontSize: '13.5px', fontFamily: "'DM Sans',sans-serif",
            fontWeight: '500', color: c.text,
            pointerEvents: 'auto', opacity: '0',
            transform: 'translateY(-8px)',
            transition: 'opacity .28s ease, transform .28s ease',
            maxWidth: 'calc(100vw - 32px)',
        });

        const dot = document.createElement('span');
        Object.assign(dot.style, {
            width: '7px', height: '7px', borderRadius: '50%',
            background: c.dot, flexShrink: '0', display: 'block',
        });
        const txt = document.createElement('span');
        txt.textContent = msg;
        t.appendChild(dot);
        t.appendChild(txt);
        container.appendChild(t);

        requestAnimationFrame(() => requestAnimationFrame(() => {
            t.style.opacity   = '1';
            t.style.transform = 'translateY(0)';
        }));

        const timer = setTimeout(() => {
            t.style.opacity   = '0';
            t.style.transform = 'translateY(-8px)';
            setTimeout(() => t.remove(), 300);
        }, duracion);

        t.onclick = () => { clearTimeout(timer); t.remove(); };
    }

    return {
        ok:    (msg, ms) => show(msg, 'ok',    ms),
        error: (msg, ms) => show(msg, 'error', ms),
        info:  (msg, ms) => show(msg, 'info',  ms),
    };
})();

// ============================================================
// HELPERS
// ============================================================
function formatCOP(v) {
    return '$' + Math.round(v).toLocaleString('es-CO');
}

function todayISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

// [FIX-1] Template literal corregido
function generarNumeroOrden() {
    const year = new Date().getFullYear();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `MES-LA26-${year}-${rand}`;
}

function calcularTotal() {
    return State.cart.reduce((acc, item) => {
        const slot = State.slots.find(s => s.id === item.slotId);
        return acc + (slot ? slot.precio * item.cantidad : 0);
    }, 0);
}

function calcularCantidadTotal() {
    return State.cart.reduce((acc, item) => acc + item.cantidad, 0);
}

function slotsFiltrados() {
    if (State.filtro === 'todos') return State.slots;
    return State.slots.filter(s => s.itemType === State.filtro);
}

// ============================================================
// RESOLVER RESTAURANT_ID
// ============================================================
let _restaurantResolving = false;

async function _resolverRestaurant() {
    if (State.restaurantId || _restaurantResolving) return;
    _restaurantResolving = true;
    console.log('[La 26] Resolviendo restaurant_id…');
    try {
        const { data: r1, error: e1 } = await db
            .from('restaurants')
            .select('id')
            .eq('slug', RESTAURANT_SLUG)
            .maybeSingle();

        if (e1) console.warn('[La 26] restaurants query error:', e1.message);
        if (r1?.id) {
            State.restaurantId = r1.id;
            console.log('[La 26] Restaurant OK:', r1.id);
            return;
        }

        const { data: r2 } = await db
            .from('restaurants')
            .select('id')
            .limit(1)
            .maybeSingle();
        if (r2?.id) {
            State.restaurantId = r2.id;
            console.log('[La 26] Restaurant fallback OK:', r2.id);
            return;
        }

        const { data: r3 } = await db
            .from('restaurants')
            .insert([{ name: 'Restaurante la 26', slug: RESTAURANT_SLUG }])
            .select('id')
            .single();
        if (r3?.id) {
            State.restaurantId = r3.id;
            console.log('[La 26] Restaurant creado:', r3.id);
        }

    } catch (err) {
        console.warn('[La 26] Error resolviendo restaurant_id:', err);
    } finally {
        _restaurantResolving = false;
    }
}

// ============================================================
// RESOLVER TABLE_ID
// ============================================================
async function _resolverTableId(modalidad, mesa) {
    if (!State.restaurantId) await _resolverRestaurant();
    if (!State.restaurantId) return null;

    if (modalidad === 'mesa') {
        const mesaVal = mesa;
        const { data } = await db
            .from('tables')
            .select('id')
            .eq('restaurant_id', State.restaurantId)
            .or(`number.eq.${isNaN(mesaVal) ? 0 : mesaVal},label.ilike.${mesaVal}`)
            .maybeSingle();
        if (data?.id) return data.id;
    }

    const { data: mv } = await db
        .from('tables')
        .select('id')
        .eq('restaurant_id', State.restaurantId)
        .ilike('label', '%para llevar%')
        .maybeSingle();

    if (mv?.id) return mv.id;

    const { data: mn } = await db
        .from('tables')
        .upsert([{
            restaurant_id: State.restaurantId,
            number:        0,
            label:         'Para Llevar / Domicilio',
            qr_code:       `VIRTUAL-TAKEAWAY-${State.restaurantId}`,
            capacity:      99,
            status:        'available',
        }], { onConflict: 'restaurant_id,number' })
        .select('id')
        .single();

    return mn?.id || null;
}

// ============================================================
// MENÚ — Carga desde menu_items (fuente única de verdad)
//
// LÓGICA DE DISPONIBILIDAD (misma que Admin):
//   disponible = is_active === true  AND  portions_today > 0
//   Si portions_today es NULL → se trata como ilimitado (disponible).
//   Si portions_today = 0    → agotado aunque is_active sea true.
//   Si is_active = false     → agotado aunque portions_today > 0.
//
// Esta lógica replica exactamente lo que Admin controla con:
//   - El switch "Activo / Agotado" → is_active
//   - El input "Porciones hoy"     → portions_today
// ============================================================
const Menu = {

    async cargar() {
        console.log('[La 26] Inicio carga menú');
        _mostrarEstado('loader');

        if (!State.restaurantId) await _resolverRestaurant();
        if (!State.restaurantId) {
            console.error('[La 26] restaurant_id no disponible — abortando');
            _mostrarEstado('error', 'No se pudo identificar el restaurante. Contacta al administrador.');
            return;
        }

        try {
            console.log('[La 26] Consulta menu_items para restaurant_id:', State.restaurantId);

            // ── FUENTE ÚNICA DE VERDAD: menu_items ────────────
            // La misma tabla que Admin modifica.
            // Se traen TODOS los items activos del restaurante.
            // La disponibilidad se calcula localmente con la misma
            // lógica que Admin usa para mostrar el switch.
            const { data, error } = await db
                .from('menu_items')
                .select('id, name, price, item_type, is_active, description, portions_today')
                .eq('restaurant_id', State.restaurantId)
                .in('item_type', ITEM_TYPES_VALIDOS)
                .order('item_type', { ascending: true })
                .order('name',      { ascending: true });

            if (error) {
                console.error('[La 26] Error Supabase en menu_items:', error);
                throw error;
            }

            console.log('[La 26] Productos recibidos:', data?.length ?? 0);

            if (!data || data.length === 0) {
                console.warn('[La 26] Sin productos activos — activando modo demo');
                _activarModoDemo();
                return;
            }

            // Mapear a slots con lógica de disponibilidad unificada
            State.slots = data.map(item => {
                // portions_today null = sin límite configurado → disponible
                const tienePortions = item.portions_today !== null && item.portions_today !== undefined;
                const porciones     = tienePortions ? Number(item.portions_today) : 999;
                const disponible    = item.is_active === true && porciones > 0;

                return {
                    id:          item.id,
                    menuItemId:  item.id,
                    nombre:      item.name,
                    precio:      Number(item.price) || 0,
                    descripcion: item.description || '',
                    itemType:    CATEGORIAS[item.item_type] ? item.item_type : 'a_la_carte',
                    porciones,
                    disponible,
                };
            });

            _renderizarMenu();
            _mostrarEstado('menu');

            // Activar Realtime sobre menu_items para reflejar
            // cambios de Admin sin recargar la página
            _suscribirRealtime();

        } catch (err) {
            console.error('[La 26] Error cargando menú:', err);
            _mostrarEstado('error', `No se pudo cargar la carta: ${err.message || 'error de red'}`);
        }
    },

};

// ── Control de pantalla ──────────────────────────────────────
// [FIX-5] Siempre oculta spinner al mostrar error
function _mostrarEstado(estado, msg = '') {
    const loader   = document.getElementById('app-loader');
    const error    = document.getElementById('app-error');
    const sections = document.getElementById('menu-sections');

    if (loader)   loader.style.display   = estado === 'loader' ? 'flex'  : 'none';
    if (error)    error.style.display    = estado === 'error'  ? 'flex'  : 'none';
    if (sections) sections.style.display = estado === 'menu'   ? 'block' : 'none';

    if (estado === 'error') {
        if (loader) loader.style.display = 'none'; // garantía extra
        console.error('[La 26] Error mostrado al usuario:', msg);
        const el = document.getElementById('error-msg');
        if (el) el.textContent = msg || 'Error desconocido. Recarga la página.';
    }
}

// ── Modo demo ────────────────────────────────────────────────
// [FIX-2] Objetos con todos los campos correctamente definidos
function _activarModoDemo() {
    console.log('[La 26] Activando modo demo');
    State.slots = [
        { id:'demo-p1', menuItemId: null, nombre:'Pechuga a la Plancha con Salsa Criolla',  precio:16000, descripcion:'Pechuga jugosa bañada en salsa criolla de tomate y cebolla.', itemType:'protein',    porciones:12, disponible: true  },
        { id:'demo-p2', menuItemId: null, nombre:'Tilapia Frita con Salsa de Ajo',          precio:18000, descripcion:'Tilapia frita con salsa de ajo y limón.',                      itemType:'protein',    porciones:8,  disponible: true  },
        { id:'demo-p3', menuItemId: null, nombre:'Cerdo al Horno con Salsa BBQ',            precio:17000, descripcion:'Lomo de cerdo con salsa BBQ artesanal.',                        itemType:'protein',    porciones:0,  disponible: false },
        { id:'demo-s1', menuItemId: null, nombre:'Arroz Blanco',                            precio:0,     descripcion:'Acompañamiento del almuerzo.',                                 itemType:'side',       porciones:30, disponible: true  },
        { id:'demo-s2', menuItemId: null, nombre:'Fríjoles Rojos con Hogao',               precio:0,     descripcion:'Fríjoles cocinados a fuego lento.',                             itemType:'side',       porciones:25, disponible: true  },
        { id:'demo-s3', menuItemId: null, nombre:'Patacón Tostado con Guacamole',          precio:0,     descripcion:'Plátano verde frito con guacamole fresco.',                     itemType:'side',       porciones:20, disponible: true  },
        { id:'demo-d1', menuItemId: null, nombre:'Jugo Natural del Día',                   precio:3000,  descripcion:'Fruta fresca de temporada.',                                    itemType:'drink',      porciones:30, disponible: true  },
        { id:'demo-d2', menuItemId: null, nombre:'Limonada de Panela',                     precio:3500,  descripcion:'Limón con panela orgánica.',                                    itemType:'drink',      porciones:25, disponible: true  },
    ];
    _renderizarMenu();
    _mostrarEstado('menu');
}

// ── Renderizado del menú ─────────────────────────────────────
function _renderizarCatsBar() {
    const bar = document.getElementById('cats-bar');
    if (!bar) return;
    bar.innerHTML = '';

    const btnTodos = document.createElement('button');
    btnTodos.className   = `cat-btn${State.filtro === 'todos' ? ' active' : ''}`;
    btnTodos.textContent = 'Todos';
    btnTodos.onclick     = () => _cambiarFiltro('todos');
    bar.appendChild(btnTodos);

    const tipos = [...new Set(State.slots.map(s => s.itemType))].filter(t => CATEGORIAS[t]);
    tipos.sort((a, b) => (CATEGORIAS[a]?.orden || 99) - (CATEGORIAS[b]?.orden || 99))
        .forEach(tipo => {
            const cfg = CATEGORIAS[tipo];
            const btn = document.createElement('button');
            btn.className   = `cat-btn${State.filtro === tipo ? ' active' : ''}`;
            btn.textContent = `${cfg.icono} ${cfg.label}`;
            btn.onclick     = () => _cambiarFiltro(tipo);
            bar.appendChild(btn);
        });
}

function _cambiarFiltro(tipo) {
    State.filtro = tipo;
    _renderizarCatsBar();
    _renderizarMenu();
}

function _renderizarMenu() {
    _renderizarCatsBar();

    const sections = document.getElementById('menu-sections');
    if (!sections) return;
    sections.innerHTML = '';

    const lista = slotsFiltrados();

    if (!lista || lista.length === 0) {
        sections.innerHTML = `
            <div class="empty-state">
                <div class="icon">🍽️</div>
                <p>No hay platos disponibles<br>en esta categoría.</p>
            </div>`;
        return;
    }

    const grupos = {};
    lista.forEach(slot => {
        const tipo = CATEGORIAS[slot.itemType] ? slot.itemType : 'a_la_carte';
        if (!grupos[tipo]) grupos[tipo] = [];
        grupos[tipo].push(slot);
    });

    Object.keys(grupos)
        .sort((a, b) => (CATEGORIAS[a]?.orden || 99) - (CATEGORIAS[b]?.orden || 99))
        .forEach((tipo, secIdx) => {
            const cfg    = CATEGORIAS[tipo];
            const platos = grupos[tipo];
            if (!platos?.length) return;

            const sec = document.createElement('div');

            const header = document.createElement('div');
            header.className = 'section-label';
            header.innerHTML = `<h2>${cfg.icono} ${cfg.label}</h2>`;
            sec.appendChild(header);

            platos.forEach((slot, i) => {
                const t = _crearTarjeta(slot);
                t.style.animationDelay = `${secIdx * 0.06 + i * 0.05}s`;
                sec.appendChild(t);
            });

            sections.appendChild(sec);
        });
}

function _crearTarjeta(slot) {
    const disponible = slot.disponible && slot.porciones > 0;
    const pocas      = disponible && slot.porciones > 0 && slot.porciones < 999 && slot.porciones <= 5;
    const enCarrito  = State.cart.find(c => c.slotId === slot.id);
    const qty        = enCarrito ? enCarrito.cantidad : 0;

    let badgeHTML = '';
    if (!disponible)  badgeHTML = `<span class="badge-agotado">Agotado</span>`;
    else if (pocas)   badgeHTML = `<span class="badge-pocas">¡Solo quedan ${slot.porciones}!</span>`;

    const precioHTML = slot.precio > 0
        ? `<span class="plate-price">${formatCOP(slot.precio)}</span>`
        : `<span class="plate-price incluido">Incluido</span>`;

    let ctrlHTML = '';
    if (disponible) {
        if (qty === 0) {
            ctrlHTML = `<button class="btn-add" onclick="Cart.agregar('${slot.id}')" aria-label="Agregar ${slot.nombre}">+</button>`;
        } else {
            ctrlHTML = `
                <div class="qty-chip">
                    <button onclick="Cart.cambiar('${slot.id}',-1)" aria-label="Quitar">−</button>
                    <span>${qty}</span>
                    <button onclick="Cart.cambiar('${slot.id}',+1)" aria-label="Agregar">+</button>
                </div>`;
        }
    }

    const card     = document.createElement('div');
    card.id        = `tarjeta-${slot.id}`;
    card.className = `plate-card${!disponible ? ' agotado' : ''} fade-up`;
    card.innerHTML = `
        <div class="plate-info">
            <p class="plate-name">${slot.nombre}</p>
            ${slot.descripcion ? `<p class="plate-desc">${slot.descripcion}</p>` : ''}
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px;">
                ${precioHTML}
                ${badgeHTML}
            </div>
        </div>
        <div style="flex-shrink:0;">${ctrlHTML}</div>`;

    return card;
}

// [FIX-3] Template literal corregido
function _refrescarTarjeta(slotId) {
    const slot  = State.slots.find(s => s.id === slotId);
    if (!slot) return;
    const vieja = document.getElementById(`tarjeta-${slotId}`);
    if (vieja) vieja.replaceWith(_crearTarjeta(slot));
}

// ============================================================
// CARRITO
// ============================================================
const Cart = {

    agregar(slotId) {
        const slot = State.slots.find(s => s.id === slotId);
        if (!slot || !slot.disponible) return;

        const existente = State.cart.find(c => c.slotId === slotId);
        if (existente) {
            if (slot.porciones < 999 && existente.cantidad >= slot.porciones) {
                Toast.error(`Solo quedan ${slot.porciones} porciones de "${slot.nombre}".`);
                return;
            }
            existente.cantidad++;
        } else {
            State.cart.push({ slotId, cantidad: 1 });
        }

        _refrescarTarjeta(slotId);
        _actualizarCartBar();
    },

    cambiar(slotId, delta) {
        const slot = State.slots.find(s => s.id === slotId);
        if (!slot) return;

        const idx = State.cart.findIndex(c => c.slotId === slotId);
        if (idx === -1) return;

        if (delta > 0 && slot.porciones < 999 && State.cart[idx].cantidad + delta > slot.porciones) {
            Toast.error(`Solo quedan ${slot.porciones} porciones.`);
            return;
        }

        const nueva = State.cart[idx].cantidad + delta;
        if (nueva <= 0) {
            State.cart.splice(idx, 1);
        } else {
            State.cart[idx].cantidad = nueva;
        }

        _refrescarTarjeta(slotId);
        _actualizarCartBar();

        const modal = document.getElementById('order-modal');
        if (modal && modal.classList.contains('open')) {
            Cart._renderSummary();
        }
    },

    abrir() {
        if (State.cart.length === 0) return;
        this._renderSummary();
        document.getElementById('order-modal').classList.add('open');
        document.body.style.overflow = 'hidden';
    },

    cerrar() {
        document.getElementById('order-modal').classList.remove('open');
        document.body.style.overflow = '';
    },

    _renderSummary() {
        const listEl  = document.getElementById('summary-items');
        const totalEl = document.getElementById('summary-total');

        if (!listEl) return;
        listEl.innerHTML = '';

        if (State.cart.length === 0) {
            listEl.innerHTML = `<div style="text-align:center;padding:36px 0;">
                <p style="font-size:13px;color:var(--ink-ghost);">Tu pedido está vacío.</p></div>`;
            if (totalEl) totalEl.textContent = '$0';
            return;
        }

        State.cart.forEach(item => {
            const slot = State.slots.find(s => s.id === item.slotId);
            if (!slot) return;

            const row = document.createElement('div');
            row.className = 'summary-row';
            row.innerHTML = `
                <div style="flex:1;min-width:0;">
                    <p class="summary-name">${slot.nombre}</p>
                    <p class="summary-qty">${item.cantidad} × ${slot.precio > 0 ? formatCOP(slot.precio) : 'Incluido'}</p>
                </div>
                <span class="summary-price">${slot.precio > 0 ? formatCOP(slot.precio * item.cantidad) : '—'}</span>`;
            listEl.appendChild(row);
        });

        if (totalEl) totalEl.textContent = formatCOP(calcularTotal());
    },

};

function _actualizarCartBar() {
    const qty     = calcularCantidadTotal();
    const total   = calcularTotal();
    const bar     = document.getElementById('cart-bar');
    const countEl = document.getElementById('cart-count');
    const totalEl = document.getElementById('cart-total');

    if (countEl) countEl.textContent = qty;
    if (totalEl) totalEl.textContent = formatCOP(total);

    if (bar) {
        if (qty > 0) bar.classList.add('visible');
        else         bar.classList.remove('visible');
    }
}

// ============================================================
// ENVÍO DEL PEDIDO
// ============================================================
const Order = {

    async enviar() {
        if (State.isSubmitting) return;
        if (State.cart.length === 0) {
            Toast.error('Agrega al menos un plato al pedido.');
            return;
        }

        const btnEl       = document.getElementById('btn-enviar');
        const mesaEl      = document.getElementById('form-mesa');
        const nombreEl    = document.getElementById('form-nombre');
        const notasEl     = document.getElementById('form-notas');
        const modalidadEl = document.querySelector('input[name="form-modalidad"]:checked');

        const mesa      = (mesaEl?.value     || '').trim();
        const nombre    = (nombreEl?.value   || '').trim();
        const notas     = (notasEl?.value    || '').trim();
        const modalidad = modalidadEl?.value || 'mesa';

        if (modalidad === 'mesa' && !mesa) {
            mesaEl?.classList.add('error');
            mesaEl?.focus();
            Toast.error('Indica el número de mesa.');
            return;
        }
        mesaEl?.classList.remove('error');

        State.isSubmitting = true;
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Enviando…'; }

        try {
            if (!State.restaurantId) await _resolverRestaurant();
            if (!State.restaurantId) throw new Error('No se pudo identificar el restaurante.');

            const tableId = await _resolverTableId(modalidad, mesa);
            if (!tableId) throw new Error('No se pudo identificar la mesa.');

            // Construir nota de cocina
            let notaCocina = '';
            if (modalidad === 'mesa')         notaCocina = `[MESA ${mesa}]`;
            else if (modalidad === 'llevar')   notaCocina = `[PARA LLEVAR] Cliente: ${nombre}`;
            else if (modalidad === 'domicilio') notaCocina = `[DOMICILIO] Cliente: ${nombre}`;
            if (notas) notaCocina += ` | ${notas}`;

            const numeroOrden = generarNumeroOrden();
            const total       = calcularTotal();

            // Insertar orden
            const { data: orden, error: errOrd } = await db
                .from('orders')
                .insert([{
                    restaurant_id: State.restaurantId,
                    table_id:      tableId,
                    order_number:  numeroOrden,
                    status:        'pending',
                    customer_name: nombre || null,
                    total_amount:  total,
                    notes:         notaCocina || null,
                }])
                .select('id')
                .single();

            if (errOrd) throw errOrd;

            // ── Insertar ítems ────────────────────────────────
            // product_name → Capa 1 de cocina (app.js v3.3)
            // notes [nombre] → Capa 2 legacy
            // Ambas apuntan al nombre real del slot, nunca al JOIN.
            const payload = State.cart.map(item => {
                const slot = State.slots.find(s => s.id === item.slotId);
                if (!slot) return null;
                return {
                    order_id:     orden.id,
                    menu_item_id: slot.menuItemId || null,
                    quantity:     item.cantidad,
                    unit_price:   slot.precio,
                    item_status:  'pending',
                    product_name: slot.nombre,                    // [FIX-4] Capa 1
                    notes:        `[nombre]${slot.nombre}`,       // Capa 2 legacy
                };
            }).filter(Boolean);

            if (payload.length > 0) {
                const { error: errItems } = await db
                    .from('order_items')
                    .insert(payload);

                if (errItems) {
                    console.warn('[La 26] order_items falló:', errItems.message);
                    // Segundo intento sin menu_item_id por si hay FK inválida
                    const payloadSafe = payload.map(p => ({ ...p, menu_item_id: null }));
                    const { error: err2 } = await db.from('order_items').insert(payloadSafe);
                    if (err2) console.error('[La 26] order_items segundo intento falló:', err2.message);
                }
            }

            this._mostrarExito(numeroOrden);

        } catch (err) {
            console.error('[La 26] Error enviando pedido:', err);
            Toast.error('No se pudo enviar el pedido. Verifica tu conexión.', 5000);
        } finally {
            State.isSubmitting = false;
            if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Enviar a cocina'; }
        }
    },

    _mostrarExito(numeroOrden) {
        Cart.cerrar();

        const el = document.getElementById('success-order-no');
        if (el) el.textContent = numeroOrden;

        document.getElementById('success-modal').classList.add('open');

        State.cart = [];
        _actualizarCartBar();
    },

    nuevoPedido() {
        document.getElementById('success-modal').classList.remove('open');

        const notasEl = document.getElementById('form-notas');
        if (notasEl) notasEl.value = '';

        window.scrollTo({ top: 0, behavior: 'smooth' });
        _renderizarMenu();
    },

    cerrarExito() {
        document.getElementById('success-modal').classList.remove('open');
    },

};

// ============================================================
// REALTIME — suscripción a menu_items
//
// Cuando Admin cambia is_active, price o portions_today en un
// plato, Supabase Realtime dispara el evento UPDATE en esta
// tabla. Menu.js actualiza el slot en memoria y refresca solo
// la tarjeta afectada — sin recargar toda la carta.
//
// Esto cubre:
//   - Bloquear un plato (is_active = false)  → aparece "Agotado"
//   - Desbloquear un plato (is_active = true) → botón "+" vuelve
//   - Cambiar precio                          → precio actualizado
//   - Cambiar porciones a 0                  → aparece "Agotado"
//   - Agregar producto nuevo                 → recarga completa
//   - Eliminar producto                      → recarga completa
// ============================================================
function _suscribirRealtime() {
    if (!State.restaurantId) return;

    // Cancelar canal anterior si existe
    if (State.realtimeChannel) {
        db.removeChannel(State.realtimeChannel);
        State.realtimeChannel = null;
    }

    State.realtimeChannel = db
        .channel(`la26-menu-v70-${State.restaurantId}`)
        .on(
            'postgres_changes',
            {
                event:  'UPDATE',
                schema: 'public',
                table:  'menu_items',
                filter: `restaurant_id=eq.${State.restaurantId}`,
            },
            (payload) => {
                console.log('[La 26] Realtime UPDATE en menu_items:', payload.new?.name);
                _actualizarSlotDesdeRealtime(payload.new);
            }
        )
        .on(
            'postgres_changes',
            {
                // Producto nuevo o eliminado → recarga completa para mantener
                // el orden y las categorías correctas
                event:  'INSERT',
                schema: 'public',
                table:  'menu_items',
                filter: `restaurant_id=eq.${State.restaurantId}`,
            },
            (payload) => {
                console.log('[La 26] Realtime INSERT en menu_items:', payload.new?.name);
                Menu.cargar();
            }
        )
        .on(
            'postgres_changes',
            {
                event:  'DELETE',
                schema: 'public',
                table:  'menu_items',
            },
            () => {
                console.log('[La 26] Realtime DELETE en menu_items — recargando carta');
                Menu.cargar();
            }
        )
        .subscribe((status) => {
            console.log('[La 26] Realtime canal menu_items:', status);
        });
}

// Actualiza un slot individual cuando llega un UPDATE de Realtime
// sin recargar toda la carta — experiencia sin parpadeo.
function _actualizarSlotDesdeRealtime(item) {
    if (!item || !item.id) return;

    const idx = State.slots.findIndex(s => s.id === item.id);

    if (idx === -1) {
        // Producto que no estaba en la lista (estaba inactivo antes)
        // → recarga completa para incluirlo correctamente
        Menu.cargar();
        return;
    }

    const tienePortions = item.portions_today !== null && item.portions_today !== undefined;
    const porciones     = tienePortions ? Number(item.portions_today) : 999;
    const disponible    = item.is_active === true && porciones > 0;

    // Actualizar slot en memoria
    State.slots[idx] = {
        ...State.slots[idx],
        nombre:     item.name,
        precio:     Number(item.price) || 0,
        porciones,
        disponible,
    };

    // Refrescar solo la tarjeta de este producto
    _refrescarTarjeta(item.id);

    // Si el producto estaba en el carrito y ahora está agotado,
    // eliminarlo del carrito y avisar al usuario
    if (!disponible) {
        const enCarrito = State.cart.findIndex(c => c.slotId === item.id);
        if (enCarrito !== -1) {
            const nombre = State.slots[idx].nombre;
            State.cart.splice(enCarrito, 1);
            _actualizarCartBar();
            Toast.error(`"${nombre}" se agotó y fue removido de tu pedido.`, 5000);
        }
    }
}

// ============================================================
// INIT — Carga directa, sin autenticación
// [FIX-6] try/catch con mensaje visible si algo falla
// ============================================================
(async function init() {
    console.log('[La 26] Inicio carga menú');
    try {
        await _resolverRestaurant();
        console.log('[La 26] Consulta productos iniciada');
        await Menu.cargar();
    } catch (err) {
        console.error('[La 26] Error crítico en init:', err);
        _mostrarEstado('error', `Error al iniciar la carta: ${err.message}`);
    }
})();
