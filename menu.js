// ============================================================
// RESTAURANTE LA 26 — PANEL DE MESERO
// menu.js · Versión 6.0 — Flujo directo (sin auth)
// Bucaramanga, Santander — Colombia
//
// FLUJO: Carta → Carrito → Modal de Pedido → Envío
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
    protein:        { label: 'Proteína con Salsa',  icono: '🥩', orden: 1 },
    side:           { label: 'Principio',           icono: '🍲', orden: 2 },
    drink:          { label: 'Bebida',              icono: '🥤', orden: 3 },
    a_la_carte:     { label: 'A la Carta',          icono: '✨', orden: 4 },
    executive_lunch:{ label: 'Menú Ejecutivo',      icono: '🍱', orden: 5 },
    dessert:        { label: 'Postre',              icono: '🍮', orden: 6 },
};

const ITEM_TYPES_VALIDOS = ['protein','side','drink','a_la_carte','executive_lunch','dessert'];

// ============================================================
// ESTADO GLOBAL
// ============================================================
const State = {
    restaurantId: null,
    dailyMenuId:  null,
    slots:        [],
    cart:         [],
    filtro:       'todos',
    isSubmitting: false,
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
    try {
        const { data: r1 } = await db.from('restaurants')
            .select('id').eq('slug', RESTAURANT_SLUG).maybeSingle();
        if (r1?.id) { State.restaurantId = r1.id; return; }

        const { data: r2 } = await db.from('restaurants')
            .select('id').limit(1).maybeSingle();
        if (r2?.id) { State.restaurantId = r2.id; return; }

        const { data: r3 } = await db.from('restaurants')
            .insert([{ name: 'Restaurante la 26', slug: RESTAURANT_SLUG }])
            .select('id').single();
        if (r3?.id) State.restaurantId = r3.id;

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
        const { data } = await db.from('tables')
            .select('id')
            .eq('restaurant_id', State.restaurantId)
            .or(`number.eq.${isNaN(mesaVal) ? 0 : mesaVal},label.ilike.${mesaVal}`)
            .maybeSingle();
        if (data?.id) return data.id;
    }

    const { data: mv } = await db.from('tables')
        .select('id')
        .eq('restaurant_id', State.restaurantId)
        .ilike('label', '%para llevar%')
        .maybeSingle();

    if (mv?.id) return mv.id;

    const { data: mn } = await db.from('tables')
        .upsert([{
            restaurant_id: State.restaurantId,
            number:        0,
            label:         'Para Llevar / Domicilio',
            qr_code:       `VIRTUAL-TAKEAWAY-${State.restaurantId}`,
            capacity:      99,
            status:        'available',
        }], { onConflict: 'restaurant_id,number' })
        .select('id').single();

    return mn?.id || null;
}

// ============================================================
// MENÚ — Carga y renderizado
// ============================================================
const Menu = {

    async cargar() {
        _mostrarEstado('loader');

        if (!State.restaurantId) await _resolverRestaurant();
        if (!State.restaurantId) {
            _mostrarEstado('error', 'No se pudo identificar el restaurante. Contacta al administrador.');
            return;
        }

        try {
            const { data: dm } = await db.from('daily_menus')
                .select('id')
                .eq('restaurant_id', State.restaurantId)
                .eq('menu_date', todayISO())
                .eq('is_published', true)
                .maybeSingle();

            if (dm?.id) {
                State.dailyMenuId = dm.id;
                await this._cargarDesdeMenuDia();
            } else {
                State.dailyMenuId = null;
                await this._cargarDesdeCatalogo();
            }
        } catch (err) {
            console.error('[La 26] Error cargando menú:', err);
            _mostrarEstado('error', 'No se pudo cargar la carta. Por favor reinténtalo.');
        }
    },

    async _cargarDesdeMenuDia() {
        const { data, error } = await db
            .from('daily_menu_slots_availability')
            .select('id,menu_item_id,item_name,price,item_type,is_truly_available,portions_available,portions_sold,category_order,display_order')
            .eq('daily_menu_id', State.dailyMenuId)
            .in('item_type', ITEM_TYPES_VALIDOS)
            .order('category_order', { ascending: true })
            .order('display_order',  { ascending: true });

        if (error || !data || data.length === 0) {
            await this._cargarDesdeCatalogo();
            return;
        }

        State.slots = data.map(s => ({
            id:          s.id,
            menuItemId:  s.menu_item_id,
            nombre:      s.item_name,
            precio:      Number(s.price) || 0,
            descripcion: '',
            itemType:    CATEGORIAS[s.item_type] ? s.item_type : 'a_la_carte',
            porciones:   s.is_truly_available
                             ? Math.max(0, (s.portions_available || 0) - (s.portions_sold || 0))
                             : 0,
            disponible:  Boolean(s.is_truly_available),
        }));

        _renderizarMenu();
        _mostrarEstado('menu');
        _suscribirRealtime();
    },

    async _cargarDesdeCatalogo() {
        const { data, error } = await db.from('menu_items')
            .select('id,name,price,item_type,is_active,description')
            .eq('restaurant_id', State.restaurantId)
            .eq('is_active', true)
            .in('item_type', ITEM_TYPES_VALIDOS)
            .order('item_type', { ascending: true })
            .order('name',      { ascending: true });

        if (error || !data || data.length === 0) {
            _activarModoDemo();
            return;
        }

        State.slots = data.map(i => ({
            id:          i.id,
            menuItemId:  i.id,
            nombre:      i.name,
            precio:      Number(i.price) || 0,
            descripcion: i.description || '',
            itemType:    CATEGORIAS[i.item_type] ? i.item_type : 'a_la_carte',
            porciones:   999,
            disponible:  true,
        }));

        _renderizarMenu();
        _mostrarEstado('menu');
    },
};

// ── Control de pantalla ──────────────────────────────────────
function _mostrarEstado(estado, msg = '') {
    const loader   = document.getElementById('app-loader');
    const error    = document.getElementById('app-error');
    const sections = document.getElementById('menu-sections');

    if (loader)   loader.style.display    = estado === 'loader' ? 'flex'  : 'none';
    if (error)    error.style.display     = estado === 'error'  ? 'flex'  : 'none';
    if (sections) sections.style.display  = estado === 'menu'   ? 'block' : 'none';

    if (estado === 'error' && msg) {
        const el = document.getElementById('error-msg');
        if (el) el.textContent = msg;
    }
}

// ── Modo demo ────────────────────────────────────────────────
function _activarModoDemo() {
    State.slots = [
        { id:'demo-p1', menuItemId:null, nombre:'Pechuga a la Plancha con Salsa Criolla',  precio:16000, descripcion:'Pechuga jugosa bañada en salsa criolla de tomate y cebolla.', itemType:'protein',    porciones:12, disponible:true  },
        { id:'demo-p2', menuItemId:null, nombre:'Tilapia Frita con Salsa de Ajo',          precio:18000, descripcion:'Tilapia frita con salsa de ajo y limón.',                      itemType:'protein',    porciones:8,  disponible:true  },
        { id:'demo-p3', menuItemId:null, nombre:'Cerdo al Horno con Salsa BBQ',            precio:17000, descripcion:'Lomo de cerdo con salsa BBQ artesanal.',                        itemType:'protein',    porciones:0,  disponible:false },
        { id:'demo-s1', menuItemId:null, nombre:'Arroz Blanco',                             precio:0,     descripcion:'Acompañamiento del almuerzo.',                                 itemType:'side',       porciones:30, disponible:true  },
        { id:'demo-s2', menuItemId:null, nombre:'Fríjoles Rojos con Hogao',                precio:0,     descripcion:'Fríjoles cocinados a fuego lento.',                             itemType:'side',       porciones:25, disponible:true  },
        { id:'demo-s3', menuItemId:null, nombre:'Patacón Tostado con Guacamole',           precio:0,     descripcion:'Plátano verde frito con guacamole fresco.',                     itemType:'side',       porciones:20, disponible:true  },
        { id:'demo-d1', menuItemId:null, nombre:'Jugo Natural del Día',                    precio:3000,  descripcion:'Fruta fresca de temporada.',                                    itemType:'drink',      porciones:30, disponible:true  },
        { id:'demo-d2', menuItemId:null, nombre:'Limonada de Panela',                      precio:3500,  descripcion:'Limón con panela orgánica.',                                    itemType:'drink',      porciones:25, disponible:true  },
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
    const pocas      = disponible && slot.porciones > 0 && slot.porciones <= 5;
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
            if (slot.porciones > 0 && existente.cantidad >= slot.porciones) {
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

        if (delta > 0 && slot.porciones > 0 && State.cart[idx].cantidad + delta > slot.porciones) {
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

        if (document.getElementById('order-modal').classList.contains('open')) {
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

        const btnEl      = document.getElementById('btn-enviar');
        const mesaEl     = document.getElementById('form-mesa');
        const nombreEl   = document.getElementById('form-nombre');
        const notasEl    = document.getElementById('form-notas');
        const modalidadEl = document.querySelector('input[name="form-modalidad"]:checked');

        const mesa       = (mesaEl?.value     || '').trim();
        const nombre     = (nombreEl?.value   || '').trim();
        const notas      = (notasEl?.value    || '').trim();
        const modalidad  = modalidadEl?.value || 'mesa';

        // Validar mesa si aplica
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

            const itemsResueltos = await this._resolverMenuItemIds();

            // Construir nota de cocina
            let notaCocina = '';
            if (modalidad === 'mesa')       notaCocina = `[MESA ${mesa}]`;
            else if (modalidad === 'llevar') notaCocina = `[PARA LLEVAR] Cliente: ${nombre}`;
            else if (modalidad === 'domicilio') notaCocina = `[DOMICILIO] Cliente: ${nombre}`;
            if (notas) notaCocina += ` | ${notas}`;

            const numeroOrden = generarNumeroOrden();
            const total       = calcularTotal();

            // Insertar orden
            const { data: orden, error: errOrd } = await db.from('orders')
                .insert([{
                    restaurant_id: State.restaurantId,
                    table_id:      tableId,
                    order_number:  numeroOrden,
                    status:        'pending',
                    customer_name: nombre || null,
                    total_amount:  total,
                    daily_menu_id: State.dailyMenuId || null,
                    notes:         notaCocina || null,
                }])
                .select('id')
                .single();

            if (errOrd) throw errOrd;

            // Insertar ítems
            if (itemsResueltos.length > 0) {
                const payload = itemsResueltos.map(item => ({
                    order_id:           orden.id,
                    menu_item_id:       item.menuItemId,   // puede ser null si no se resolvió
                    daily_menu_slot_id: item.slotId,       // null si es mock o sin daily_menu
                    quantity:           item.cantidad,
                    unit_price:         item.precio,
                    item_status:        'pending',
                    notes:              `[nombre]${item.nombre}`, // prefijo que lee la cocina
                }));

                const { error: errItems } = await db.from('order_items').insert(payload);

                if (errItems) {
                    console.warn('[La 26] order_items primer intento falló:', errItems.message);
                    // Segundo intento: forzar menu_item_id con el primer item_id disponible
                    // y daily_menu_slot_id en null para evitar cualquier FK inválida
                    const { data: primerItem } = await db.from('menu_items')
                        .select('id').eq('restaurant_id', State.restaurantId)
                        .eq('is_active', true).limit(1).maybeSingle();

                    const payloadSeguro = payload.map(item => ({
                        ...item,
                        menu_item_id:       item.menu_item_id || primerItem?.id || null,
                        daily_menu_slot_id: null,
                    }));

                    const { error: errItems2 } = await db.from('order_items').insert(payloadSeguro);
                    if (errItems2) {
                        console.error('[La 26] order_items segundo intento falló:', errItems2.message);
                    }
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

    async _resolverMenuItemIds() {
        const { data: items } = await db.from('menu_items')
            .select('id,name,price,item_type')
            .eq('is_active', true)
            .eq('restaurant_id', State.restaurantId)
            .in('item_type', ['executive_lunch','a_la_carte','drink','dessert','side','protein']);

        const lista      = items || [];
        const fallbackId = lista[0]?.id || null;
        const resultado  = [];

        for (const item of State.cart) {
            const slot = State.slots.find(s => s.id === item.slotId);
            if (!slot) continue;

            let menuItemId = slot.menuItemId;

            if (!menuItemId && lista.length > 0) {
                const nombreBuscar = (slot.nombre || '').toLowerCase().trim();

                // 1. Coincidencia exacta
                const exacto = lista.find(m =>
                    m.name.toLowerCase().trim() === nombreBuscar
                );
                // 2. Coincidencia parcial (primera palabra)
                const parcial = !exacto && lista.find(m =>
                    m.name.toLowerCase().includes(nombreBuscar.split(' ')[0]) ||
                    nombreBuscar.includes(m.name.toLowerCase().split(' ')[0])
                );
                // 3. Mismo item_type
                const mismoCat = !exacto && !parcial && lista.find(m =>
                    m.item_type === slot.itemType
                );

                menuItemId = exacto?.id || parcial?.id || mismoCat?.id || fallbackId;
            }

            // NUNCA omitir el ítem — si no hay menuItemId, se inserta con null.
            // La cocina lee el nombre desde notes con prefijo [nombre], no desde el join.
            if (!menuItemId) {
                console.warn(`[La 26] Sin menu_item_id para "${slot.nombre}". Insertando con null.`);
            }

            // daily_menu_slot_id: null si es slot mock o si no hay menú del día
            const esSlotMock = item.slotId && item.slotId.startsWith('demo-');
            const dailySlotId = (esSlotMock || !State.dailyMenuId) ? null : item.slotId;

            resultado.push({
                slotId:    dailySlotId,
                menuItemId: menuItemId || null,
                cantidad:  item.cantidad,
                precio:    slot.precio,
                nombre:    slot.nombre,
            });
        }

        return resultado;
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
// TIEMPO REAL
// ============================================================
function _suscribirRealtime() {
    if (!State.dailyMenuId || !State.restaurantId) return;

    db.channel('la26-mesero-rt')
        .on('postgres_changes', {
            event: '*', schema: 'public', table: 'daily_menu_slots',
            filter: `daily_menu_id=eq.${State.dailyMenuId}`,
        }, () => Menu.cargar())
        .on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'menu_items',
            filter: `restaurant_id=eq.${State.restaurantId}`,
        }, () => { if (State.dailyMenuId) Menu.cargar(); })
        .subscribe();
}

// ============================================================
// INIT — Carga directa, sin autenticación
// ============================================================
(async function init() {
    await _resolverRestaurant();
    Menu.cargar();
})();
