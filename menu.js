// ============================================================
// RESTAURANTE LA 26 — PANEL DE MESERO
// menu.js · Versión 7.3
//
// CAMBIOS v7.3:
//  [ADD-HISTORIAL] Módulo Hist integrado directamente en este
//             archivo. El historial se muestra como pestaña
//             dentro de menu.html sin necesidad de archivo
//             separado. Incluye stats, filtros, tarjetas
//             expandibles, realtime y badge de pendientes.
//
// CAMBIOS v7.2:
//  [ADD-DIRECCION] Campo de dirección en pedidos a domicilio.
//  [ADD-RESET-DIRECCION] Reset en nuevoPedido().
//
// CAMBIOS v7.1:
//  [FIX-MESA] _resolverTableId sin fallback a Mesa 1.
//  [FIX-MESA-NOTES] Número real en notes de la orden.
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

const ITEM_TYPES_VALIDOS = ['executive_lunch','a_la_carte','drink','dessert','side'];

// ============================================================
// ESTADO GLOBAL
// ============================================================
const State = {
    restaurantId:    null,
    slots:           [],
    cart:            [],
    filtro:          'todos',
    isSubmitting:    false,
    realtimeChannel: null,
};

// ============================================================
// TOAST
// ============================================================
const Toast = (function() {
    function show(msg, tipo = 'info', dur = 3800) {
        const wrap = document.getElementById('toast-wrap');
        if (!wrap) return;
        const c = {
            ok:    { bg:'#f5f7f0', border:'rgba(74,103,65,0.35)',  text:'#2e4028', dot:'#4a6741' },
            error: { bg:'#fdf5f3', border:'rgba(192,80,60,0.30)',  text:'#6b2a1e', dot:'#c0503c' },
            info:  { bg:'#f5f7f0', border:'rgba(74,103,65,0.25)',  text:'#3a4a38', dot:'#4a6741' },
        }[tipo] || {};

        const t = document.createElement('div');
        Object.assign(t.style, {
            display:'flex', alignItems:'center', gap:'9px',
            background:c.bg, border:`1.5px solid ${c.border}`,
            borderRadius:'999px', padding:'10px 20px 10px 14px',
            boxShadow:'0 4px 20px rgba(0,0,0,0.10)',
            fontSize:'13.5px', fontFamily:"'DM Sans',sans-serif",
            fontWeight:'500', color:c.text,
            pointerEvents:'auto', opacity:'0',
            transform:'translateY(-8px)',
            transition:'opacity .28s ease, transform .28s ease',
            maxWidth:'calc(100vw - 32px)',
        });
        const dot = document.createElement('span');
        Object.assign(dot.style,{ width:'7px',height:'7px',borderRadius:'50%',background:c.dot,flexShrink:'0',display:'block' });
        const txt = document.createElement('span');
        txt.textContent = msg;
        t.appendChild(dot); t.appendChild(txt);
        wrap.appendChild(t);

        requestAnimationFrame(() => requestAnimationFrame(() => {
            t.style.opacity = '1'; t.style.transform = 'translateY(0)';
        }));
        const timer = setTimeout(() => {
            t.style.opacity = '0'; t.style.transform = 'translateY(-8px)';
            setTimeout(() => t.remove(), 300);
        }, dur);
        t.onclick = () => { clearTimeout(timer); t.remove(); };
    }
    return {
        ok:    (m,ms) => show(m,'ok',ms),
        error: (m,ms) => show(m,'error',ms),
        info:  (m,ms) => show(m,'info',ms),
    };
})();

// ============================================================
// HELPERS
// ============================================================
function formatCOP(v) {
    return '$' + Math.round(v || 0).toLocaleString('es-CO');
}
function todayISO() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}
function generarNumeroOrden() {
    return `LA26-${Math.floor(10000000 + Math.random() * 89999999)}`;
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
        const { data: r1, error: e1 } = await db
            .from('restaurants').select('id')
            .eq('slug', RESTAURANT_SLUG).maybeSingle();
        if (e1) console.warn('[La 26] restaurants query error:', e1.message);
        if (r1?.id) { State.restaurantId = r1.id; return; }

        const { data: r2 } = await db.from('restaurants').select('id').limit(1).maybeSingle();
        if (r2?.id) { State.restaurantId = r2.id; return; }

        const { data: r3 } = await db
            .from('restaurants')
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
// RESOLVER TABLE_ID  (v7.1 — sin fallback a Mesa 1)
// ============================================================
async function _resolverTableId(modalidad, mesa) {
    if (!State.restaurantId) await _resolverRestaurant();
    if (!State.restaurantId) return null;

    if (modalidad === 'mesa') {
        const mesaNum = parseInt(mesa);

        if (!isNaN(mesaNum) && mesaNum > 0) {
            const { data: porNum } = await db.from('tables').select('id')
                .eq('restaurant_id', State.restaurantId).eq('number', mesaNum).maybeSingle();
            if (porNum?.id) return porNum.id;
        }

        if (mesa) {
            const { data: porLabel } = await db.from('tables').select('id')
                .eq('restaurant_id', State.restaurantId)
                .ilike('label', `%${mesa}%`)
                .not('label','ilike','%llevar%')
                .not('label','ilike','%domicilio%')
                .not('label','ilike','%takeaway%')
                .maybeSingle();
            if (porLabel?.id) return porLabel.id;
        }

        const mesaNumFinal = (!isNaN(parseInt(mesa)) && parseInt(mesa) > 0) ? parseInt(mesa) : null;
        if (mesaNumFinal) {
            try {
                const { data: nueva, error: errNueva } = await db.from('tables')
                    .insert([{
                        restaurant_id: State.restaurantId,
                        number: mesaNumFinal,
                        label: `Mesa ${mesaNumFinal}`,
                        qr_code: `MESA-${State.restaurantId}-${mesaNumFinal}-${Date.now()}`,
                        capacity: 4, status: 'available',
                    }]).select('id').single();
                if (nueva?.id) return nueva.id;
                if (errNueva?.code === '23505') {
                    const { data: reintento } = await db.from('tables').select('id')
                        .eq('restaurant_id', State.restaurantId).eq('number', mesaNumFinal).maybeSingle();
                    if (reintento?.id) return reintento.id;
                }
            } catch (e) {
                console.warn(`[La 26] No se pudo crear Mesa ${mesaNumFinal}:`, e.message);
            }
        }
        return null;
    }

    // Para llevar / domicilio
    const { data: mv0 } = await db.from('tables').select('id')
        .eq('restaurant_id', State.restaurantId).eq('number', 0).maybeSingle();
    if (mv0?.id) return mv0.id;

    const { data: mvL } = await db.from('tables').select('id')
        .eq('restaurant_id', State.restaurantId).ilike('label','%para llevar%').maybeSingle();
    if (mvL?.id) return mvL.id;

    const { data: mn } = await db.from('tables').insert([{
        restaurant_id: State.restaurantId, number: 0,
        label: 'Para Llevar / Domicilio',
        qr_code: `VIRTUAL-TAKEAWAY-${State.restaurantId}-${Date.now()}`,
        capacity: 99, status: 'available',
    }]).select('id').single();
    return mn?.id || null;
}

// ============================================================
// MENÚ
// ============================================================
const Menu = {
    async cargar() {
        _mostrarEstado('loader');
        if (!State.restaurantId) await _resolverRestaurant();
        if (!State.restaurantId) {
            _mostrarEstado('error', 'No se pudo identificar el restaurante.');
            return;
        }
        try {
            const { data: dataRaw, error } = await db
                .from('menu_items')
                .select('id, name, price, item_type, is_active, description, portions_today')
                .eq('restaurant_id', State.restaurantId)
                .eq('is_active', true)
                .order('item_type', { ascending: true })
                .order('name',      { ascending: true });

            const TIPOS_ACEPTADOS = [...ITEM_TYPES_VALIDOS, 'protein'];
            const data = dataRaw ? dataRaw.filter(i => TIPOS_ACEPTADOS.includes(i.item_type)) : dataRaw;

            if (error) throw error;
            if (!data || data.length === 0) { _activarModoDemo(); return; }

            State.slots = data.map(item => {
                const tienePortions = item.portions_today !== null && item.portions_today !== undefined;
                const porciones     = tienePortions ? Number(item.portions_today) : 999;
                const disponible    = item.is_active === true && porciones > 0;
                return {
                    id: item.id, menuItemId: item.id,
                    nombre: item.name, precio: Number(item.price) || 0,
                    descripcion: item.description || '',
                    itemType: CATEGORIAS[item.item_type] ? item.item_type : 'a_la_carte',
                    porciones, disponible,
                };
            });

            _renderizarMenu();
            _mostrarEstado('menu');
            _suscribirRealtimeMenu();
        } catch (err) {
            _mostrarEstado('error', `No se pudo cargar la carta: ${err.message || 'error de red'}`);
        }
    },
};

function _mostrarEstado(estado, msg = '') {
    const loader   = document.getElementById('app-loader');
    const error    = document.getElementById('app-error');
    const sections = document.getElementById('menu-sections');
    if (loader)   loader.style.display   = estado === 'loader' ? 'flex'  : 'none';
    if (error)    error.style.display    = estado === 'error'  ? 'flex'  : 'none';
    if (sections) sections.style.display = estado === 'menu'   ? 'block' : 'none';
    if (estado === 'error') {
        if (loader) loader.style.display = 'none';
        const el = document.getElementById('error-msg');
        if (el) el.textContent = msg || 'Error desconocido. Recarga la página.';
    }
}

function _activarModoDemo() {
    State.slots = [
        { id:'demo-p1', menuItemId:null, nombre:'Pechuga a la Plancha con Salsa Criolla', precio:16000, descripcion:'Pechuga jugosa bañada en salsa criolla.', itemType:'protein', porciones:12, disponible:true  },
        { id:'demo-p2', menuItemId:null, nombre:'Tilapia Frita con Salsa de Ajo',         precio:18000, descripcion:'Tilapia frita con salsa de ajo y limón.',  itemType:'protein', porciones:8,  disponible:true  },
        { id:'demo-p3', menuItemId:null, nombre:'Cerdo al Horno con Salsa BBQ',           precio:17000, descripcion:'Lomo de cerdo con salsa BBQ artesanal.',   itemType:'protein', porciones:0,  disponible:false },
        { id:'demo-s1', menuItemId:null, nombre:'Arroz Blanco',                           precio:0,     descripcion:'Acompañamiento del almuerzo.',             itemType:'side',    porciones:30, disponible:true  },
        { id:'demo-s2', menuItemId:null, nombre:'Fríjoles Rojos con Hogao',              precio:0,     descripcion:'Fríjoles cocinados a fuego lento.',         itemType:'side',    porciones:25, disponible:true  },
        { id:'demo-d1', menuItemId:null, nombre:'Jugo Natural del Día',                  precio:3000,  descripcion:'Fruta fresca de temporada.',                itemType:'drink',   porciones:30, disponible:true  },
        { id:'demo-d2', menuItemId:null, nombre:'Limonada de Panela',                    precio:3500,  descripcion:'Limón con panela orgánica.',                itemType:'drink',   porciones:25, disponible:true  },
    ];
    _renderizarMenu();
    _mostrarEstado('menu');
}

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
    tipos.sort((a,b) => (CATEGORIAS[a]?.orden||99) - (CATEGORIAS[b]?.orden||99))
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
        sections.innerHTML = `<div class="empty-state"><div class="icon">🍽️</div><p>No hay platos disponibles<br>en esta categoría.</p></div>`;
        return;
    }
    const grupos = {};
    lista.forEach(slot => {
        const tipo = CATEGORIAS[slot.itemType] ? slot.itemType : 'a_la_carte';
        if (!grupos[tipo]) grupos[tipo] = [];
        grupos[tipo].push(slot);
    });
    Object.keys(grupos)
        .sort((a,b) => (CATEGORIAS[a]?.orden||99) - (CATEGORIAS[b]?.orden||99))
        .forEach((tipo, secIdx) => {
            const cfg = CATEGORIAS[tipo];
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
    if (!disponible) badgeHTML = `<span class="badge-agotado">Agotado</span>`;
    else if (pocas)  badgeHTML = `<span class="badge-pocas">¡Solo quedan ${slot.porciones}!</span>`;

    const precioHTML = slot.precio > 0
        ? `<span class="plate-price">${formatCOP(slot.precio)}</span>`
        : `<span class="plate-price incluido">Incluido</span>`;

    let ctrlHTML = '';
    if (disponible) {
        ctrlHTML = qty === 0
            ? `<button class="btn-add" onclick="Cart.agregar('${slot.id}')" aria-label="Agregar ${slot.nombre}">+</button>`
            : `<div class="qty-chip">
                   <button onclick="Cart.cambiar('${slot.id}',-1)" aria-label="Quitar">−</button>
                   <span>${qty}</span>
                   <button onclick="Cart.cambiar('${slot.id}',+1)" aria-label="Agregar">+</button>
               </div>`;
    }

    const card = document.createElement('div');
    card.id        = `tarjeta-${slot.id}`;
    card.className = `plate-card${!disponible ? ' agotado' : ''} fade-up`;
    card.innerHTML = `
        <div class="plate-info">
            <p class="plate-name">${slot.nombre}</p>
            ${slot.descripcion ? `<p class="plate-desc">${slot.descripcion}</p>` : ''}
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px;">
                ${precioHTML}${badgeHTML}
            </div>
        </div>
        <div style="flex-shrink:0;">${ctrlHTML}</div>`;
    return card;
}

function _refrescarTarjeta(slotId) {
    const slot = State.slots.find(s => s.id === slotId);
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
        if (nueva <= 0) State.cart.splice(idx, 1);
        else            State.cart[idx].cantidad = nueva;
        _refrescarTarjeta(slotId);
        _actualizarCartBar();
        const modal = document.getElementById('order-modal');
        if (modal?.classList.contains('open')) Cart._renderSummary();
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
            listEl.innerHTML = `<div style="text-align:center;padding:36px 0;"><p style="font-size:13px;color:var(--ink-ghost);">Tu pedido está vacío.</p></div>`;
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
    const qty = calcularCantidadTotal();
    const bar     = document.getElementById('cart-bar');
    const countEl = document.getElementById('cart-count');
    const totalEl = document.getElementById('cart-total');
    if (countEl) countEl.textContent = qty;
    if (totalEl) totalEl.textContent = formatCOP(calcularTotal());
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
        if (State.cart.length === 0) { Toast.error('Agrega al menos un plato al pedido.'); return; }

        const btnEl       = document.getElementById('btn-enviar');
        const mesaEl      = document.getElementById('form-mesa');
        const nombreEl    = document.getElementById('form-nombre');
        const notasEl     = document.getElementById('form-notas');
        const direccionEl = document.getElementById('form-direccion');
        const modalidadEl = document.querySelector('input[name="form-modalidad"]:checked');

        const mesa      = (mesaEl?.value      || '').trim();
        const nombre    = (nombreEl?.value    || '').trim();
        const notas     = (notasEl?.value     || '').trim();
        const direccion = (direccionEl?.value || '').trim();
        const modalidad = modalidadEl?.value || 'mesa';

        if (modalidad === 'mesa' && !mesa) {
            mesaEl?.classList.add('error'); mesaEl?.focus();
            Toast.error('Indica el número de mesa.'); return;
        }
        mesaEl?.classList.remove('error');

        if (modalidad === 'domicilio' && !direccion) {
            direccionEl?.classList.add('error'); direccionEl?.focus();
            Toast.error('Indica la dirección de entrega.'); return;
        }
        direccionEl?.classList.remove('error');

        State.isSubmitting = true;
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Enviando…'; }

        try {
            if (!State.restaurantId) await _resolverRestaurant();
            if (!State.restaurantId) throw new Error('No se pudo identificar el restaurante.');

            const tableId = await _resolverTableId(modalidad, mesa);
            let tableIdFinal = tableId;
            if (!tableIdFinal) {
                const { data: anyTable } = await db.from('tables').select('id')
                    .eq('restaurant_id', State.restaurantId).limit(1).maybeSingle();
                tableIdFinal = anyTable?.id || null;
            }
            if (!tableIdFinal) throw new Error('No hay mesas configuradas. Crea al menos una en el panel admin.');

            let notaCocina = '';
            if (modalidad === 'mesa')      notaCocina = `[MESA] Mesa: ${mesa}`;
            else if (modalidad === 'llevar')    notaCocina = `[PARA LLEVAR] Cliente: ${nombre || 'Sin nombre'}`;
            else if (modalidad === 'domicilio') notaCocina = `[DOMICILIO] Cliente: ${nombre || 'Sin nombre'} | Dir: ${direccion}`;
            if (notas) notaCocina += ` | Nota: ${notas}`;

            const numeroOrden = generarNumeroOrden();
            const total       = calcularTotal();

            const { data: orden, error: errOrd } = await db.from('orders').insert([{
                restaurant_id: State.restaurantId,
                table_id:      tableIdFinal,
                order_number:  numeroOrden,
                status:        'pending',
                customer_name: nombre || null,
                total_amount:  total,
                notes:         notaCocina || null,
            }]).select('id').single();
            if (errOrd) throw errOrd;

            const { data: todosItems } = await db.from('menu_items').select('id,name,item_type')
                .eq('restaurant_id', State.restaurantId).eq('is_active', true);
            const listaItems = todosItems || [];
            const fallbackId = listaItems[0]?.id || null;

            const payload = State.cart.map(item => {
                const slot = State.slots.find(s => s.id === item.slotId);
                if (!slot) return null;
                let menuItemId = slot.menuItemId;
                if (!menuItemId && listaItems.length > 0) {
                    const nb  = (slot.nombre || '').toLowerCase().trim();
                    const ex  = listaItems.find(m => m.name.toLowerCase().trim() === nb);
                    const par = !ex && listaItems.find(m => m.name.toLowerCase().includes(nb.split(' ')[0]));
                    menuItemId = ex?.id || par?.id || fallbackId;
                }
                return {
                    order_id: orden.id, menu_item_id: menuItemId,
                    quantity: item.cantidad, unit_price: slot.precio,
                    item_status: 'pending',
                    product_name: slot.nombre,
                    notes: `[nombre]${slot.nombre}`,
                };
            }).filter(Boolean);

            if (payload.length > 0) {
                const { error: errItems } = await db.from('order_items').insert(payload);
                if (errItems) {
                    if (errItems.code === '42703' || errItems.message?.includes('product_name')) {
                        const p2 = payload.map(({ product_name, ...rest }) => rest);
                        const { error: err2 } = await db.from('order_items').insert(p2);
                        if (err2) Toast.error('Pedido registrado pero ítems fallaron. Avisa al admin.', 6000);
                    } else {
                        Toast.error('Pedido registrado pero ítems fallaron. Avisa al admin.', 6000);
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

    _mostrarExito(numeroOrden) {
        Cart.cerrar();
        const el = document.getElementById('success-order-no');
        if (el) el.textContent = numeroOrden;
        document.getElementById('success-modal').classList.add('open');
        State.cart = [];
        _actualizarCartBar();
        // Refrescar historial si está cargado
        if (HistState.cargado) Hist.cargar();
    },

    nuevoPedido() {
        document.getElementById('success-modal').classList.remove('open');
        const notasEl     = document.getElementById('form-notas');
        const direccionEl = document.getElementById('form-direccion');
        if (notasEl)     notasEl.value     = '';
        if (direccionEl) direccionEl.value = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        _renderizarMenu();
    },

    cerrarExito() {
        document.getElementById('success-modal').classList.remove('open');
    },
};

// ============================================================
// REALTIME — menu_items
// ============================================================
function _suscribirRealtimeMenu() {
    if (!State.restaurantId) return;
    if (State.realtimeChannel) { db.removeChannel(State.realtimeChannel); State.realtimeChannel = null; }

    State.realtimeChannel = db
        .channel(`la26-menu-v73-${State.restaurantId}`)
        .on('postgres_changes',{ event:'UPDATE', schema:'public', table:'menu_items',
            filter:`restaurant_id=eq.${State.restaurantId}` },
            (payload) => _actualizarSlotDesdeRealtime(payload.new))
        .on('postgres_changes',{ event:'INSERT', schema:'public', table:'menu_items',
            filter:`restaurant_id=eq.${State.restaurantId}` },
            () => Menu.cargar())
        .on('postgres_changes',{ event:'DELETE', schema:'public', table:'menu_items' },
            () => Menu.cargar())
        .subscribe();
}

function _actualizarSlotDesdeRealtime(item) {
    if (!item?.id) return;
    const idx = State.slots.findIndex(s => s.id === item.id);
    if (idx === -1) { Menu.cargar(); return; }

    const tienePortions = item.portions_today !== null && item.portions_today !== undefined;
    const porciones     = tienePortions ? Number(item.portions_today) : 999;
    const disponible    = item.is_active === true && porciones > 0;

    State.slots[idx] = { ...State.slots[idx], nombre:item.name, precio:Number(item.price)||0, porciones, disponible };
    _refrescarTarjeta(item.id);

    if (!disponible) {
        const idx2 = State.cart.findIndex(c => c.slotId === item.id);
        if (idx2 !== -1) {
            const nombre = State.slots[idx].nombre;
            State.cart.splice(idx2, 1);
            _actualizarCartBar();
            Toast.error(`"${nombre}" se agotó y fue removido de tu pedido.`, 5000);
        }
    }
}

// ============================================================
// ═══ MÓDULO HISTORIAL (v7.3) ═══
// ============================================================

const HistState = {
    pedidos:         [],
    filtro:          'todos',
    cargado:         false,
    realtimeChannel: null,
};

// ── Parsear el campo notes para extraer tipo, destino, etc. ──
function _parsearNota(notes) {
    const n = notes || '';
    let tipo = 'mesa', destino = '', cliente = '', direccion = '', nota = '';

    if (n.startsWith('[MESA]')) {
        tipo = 'mesa';
        const m = n.match(/Mesa:\s*([^|]+)/);
        destino = m ? `Mesa ${m[1].trim()}` : 'Mesa';
    } else if (n.startsWith('[PARA LLEVAR]')) {
        tipo = 'llevar'; destino = 'Para Llevar';
        const m = n.match(/Cliente:\s*([^|]+)/);
        cliente = m ? m[1].trim() : '';
    } else if (n.startsWith('[DOMICILIO]')) {
        tipo = 'domicilio'; destino = 'Domicilio';
        const mc = n.match(/Cliente:\s*([^|]+)/);
        const md = n.match(/Dir:\s*([^|]+)/);
        cliente   = mc ? mc[1].trim() : '';
        direccion = md ? md[1].trim() : '';
    } else {
        tipo = 'mesa'; destino = n || 'Sin datos';
    }

    const mn = n.match(/Nota:\s*(.+)$/);
    nota = mn ? mn[1].trim() : '';
    return { tipo, destino, cliente, direccion, nota };
}

function _horaCorta(isoStr) {
    if (!isoStr) return '';
    try {
        return new Date(isoStr).toLocaleTimeString('es-CO',
            { hour:'2-digit', minute:'2-digit', timeZone:'America/Bogota' });
    } catch { return ''; }
}

const Hist = {

    async cargar() {
        _histSetLoader(true);
        if (!State.restaurantId) await _resolverRestaurant();
        if (!State.restaurantId) {
            _histSetError('No se pudo identificar el restaurante.');
            return;
        }
        try {
            const hoy = todayISO();
            const { data: ordenes, error } = await db
                .from('orders')
                .select(`
                    id, order_number, status, customer_name,
                    total_amount, notes, created_at,
                    order_items (
                        id, quantity, unit_price, notes,
                        menu_items ( name )
                    )
                `)
                .eq('restaurant_id', State.restaurantId)
                .gte('created_at', `${hoy}T00:00:00`)
                .lte('created_at', `${hoy}T23:59:59`)
                .order('created_at', { ascending: false });

            if (error) throw error;

            HistState.pedidos = ordenes || [];
            HistState.cargado = true;
            this._render();
            this._suscribirRealtime();
        } catch (err) {
            console.error('[Hist] Error:', err);
            _histSetError(`No se pudo cargar el historial: ${err.message}`);
        }
    },

    cargarSiNecesario() {
        // Si ya está cargado solo re-renderiza; si no, carga desde Supabase
        if (HistState.cargado) {
            this._render();
        } else {
            this.cargar();
        }
    },

    async recargar() {
        const btn = document.getElementById('btn-refresh-hist');
        btn?.classList.add('spinning');
        await this.cargar();
        btn?.classList.remove('spinning');
        Toast.ok('Historial actualizado');
    },

    filtrar(valor, btnEl) {
        HistState.filtro = valor;
        document.querySelectorAll('.hfilt-btn').forEach(b => b.classList.remove('active'));
        btnEl.classList.add('active');
        this._render();
    },

    _pedidosFiltrados() {
        if (HistState.filtro === 'todos') return HistState.pedidos;
        return HistState.pedidos.filter(p => _parsearNota(p.notes).tipo === HistState.filtro);
    },

    _render() {
        // ── Stats ──
        const total      = HistState.pedidos.length;
        const pendientes = HistState.pedidos.filter(p => p.status === 'pending' || p.status === 'preparing').length;
        const entregados = HistState.pedidos.filter(p => p.status === 'delivered').length;
        const venta      = HistState.pedidos
            .filter(p => p.status !== 'cancelled')
            .reduce((a,p) => a + (Number(p.total_amount)||0), 0);

        const set = (id,v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
        set('st-total',      total);
        set('st-pendientes', pendientes);
        set('st-entregados', entregados);
        set('st-venta',      formatCOP(venta));

        // Badge en la pestaña
        const badge = document.getElementById('badge-pendientes');
        if (badge) {
            badge.textContent = pendientes;
            badge.classList.toggle('visible', pendientes > 0);
        }

        // Fecha
        const fechaEl = document.getElementById('hist-fecha');
        if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-CO',
            { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'America/Bogota' });

        // Lista
        const lista    = document.getElementById('hist-lista');
        if (!lista) return;
        lista.innerHTML = '';

        const items = this._pedidosFiltrados();

        if (items.length === 0) {
            lista.innerHTML = `
                <div class="empty-state" style="padding:56px 28px;">
                    <div class="icon">🍽️</div>
                    <p>${HistState.pedidos.length === 0
                        ? 'Aún no hay pedidos hoy.'
                        : 'No hay pedidos en esta categoría.'}</p>
                </div>`;
            return;
        }

        items.forEach((pedido, i) => {
            const card = _crearTarjetaPedido(pedido, i);
            lista.appendChild(card);
        });
    },

    _suscribirRealtime() {
        if (!State.restaurantId) return;
        if (HistState.realtimeChannel) {
            db.removeChannel(HistState.realtimeChannel);
            HistState.realtimeChannel = null;
        }
        HistState.realtimeChannel = db
            .channel(`la26-hist-v73-${State.restaurantId}`)
            .on('postgres_changes', {
                event:'*', schema:'public', table:'orders',
                filter:`restaurant_id=eq.${State.restaurantId}`,
            }, (payload) => {
                Hist.cargar().then(() => {
                    if (payload.eventType === 'INSERT') Toast.ok('Nuevo pedido registrado');
                });
            })
            .subscribe();
    },
};

function _histSetLoader(activo) {
    const lista = document.getElementById('hist-lista');
    if (activo && lista) {
        lista.innerHTML = `<div class="hist-loader"><div class="spinner-sm"></div><p>Cargando pedidos…</p></div>`;
    }
}

function _histSetError(msg) {
    const lista = document.getElementById('hist-lista');
    if (lista) lista.innerHTML = `
        <div class="empty-state" style="padding:56px 28px;">
            <div class="icon">⚠️</div>
            <p>${msg}</p>
            <button onclick="Hist.recargar()"
                style="margin-top:12px;padding:11px 24px;border-radius:9999px;
                       background:var(--oliva);color:#fff;border:none;
                       font-family:'DM Sans',sans-serif;font-size:13px;
                       font-weight:500;cursor:pointer;">
                Reintentar
            </button>
        </div>`;
}

function _crearTarjetaPedido(pedido, idx) {
    const { tipo, destino, cliente, direccion, nota } = _parsearNota(pedido.notes);

    const tipoIcons  = { mesa:'🍽️', llevar:'🛵', domicilio:'📦' };
    const tipoLabels = { mesa:'Mesa', llevar:'Para Llevar', domicilio:'Domicilio' };
    const statusLabels = {
        pending:'Pendiente', preparing:'En cocina',
        ready:'Listo', delivered:'Entregado', cancelled:'Cancelado',
    };

    const statusClass = pedido.status || 'pending';
    const nombreMostrar = pedido.customer_name || cliente || '';

    // Items
    const items = pedido.order_items || [];
    const itemsHTML = items.length > 0
        ? items.map(it => {
            let nombre = it.menu_items?.name || '';
            if (!nombre && it.notes) {
                const m = it.notes.match(/\[nombre\](.+)/);
                nombre = m ? m[1] : 'Ítem';
            }
            if (!nombre) nombre = 'Ítem';
            const precio = Number(it.unit_price) || 0;
            return `<div class="item-row">
                <div class="item-qty">${it.quantity}</div>
                <span class="item-name">${nombre}</span>
                <span class="item-price">${precio > 0 ? formatCOP(precio * it.quantity) : '—'}</span>
            </div>`;
        }).join('')
        : `<p style="font-size:12.5px;color:var(--ink-ghost);padding:4px 0;">Sin detalle de ítems.</p>`;

    const direccionHTML = (tipo === 'domicilio' && direccion)
        ? `<div class="card-direccion">
               <span style="font-size:15px;flex-shrink:0;margin-top:1px;">📍</span>
               <span class="card-direccion-text">${direccion}</span>
           </div>` : '';

    const notaHTML = nota
        ? `<div class="card-nota">
               <span style="font-size:14px;flex-shrink:0;margin-top:1px;">📝</span>
               <span class="card-nota-text">${nota}</span>
           </div>` : '';

    const bodyId = `hbody-${pedido.id}`;
    const chevId = `hchev-${pedido.id}`;

    const card = document.createElement('div');
    card.className = 'order-card';
    card.style.animationDelay = `${idx * 0.04}s`;

    card.innerHTML = `
        <div class="card-head" onclick="toggleHistCard('${bodyId}','${chevId}')">
            <div class="card-head-left">
                <div class="card-tipo">
                    <span style="font-size:13px;">${tipoIcons[tipo]||'🍽️'}</span>
                    <span class="tipo-text ${tipo}">${tipoLabels[tipo]||tipo}</span>
                </div>
                <p class="card-destino">${destino}</p>
                ${nombreMostrar ? `<p class="card-cliente">👤 ${nombreMostrar}</p>` : ''}
                <p class="card-hora">🕐 ${_horaCorta(pedido.created_at)}</p>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
                <span class="status-badge ${statusClass}">${statusLabels[statusClass]||statusClass}</span>
                <span class="card-chevron" id="${chevId}">▼</span>
            </div>
        </div>
        <div class="card-body" id="${bodyId}">
            ${direccionHTML}
            ${notaHTML}
            <div>${itemsHTML}</div>
            <div class="card-total-row">
                <span class="card-total-label">Total</span>
                <span class="card-total-monto">${formatCOP(pedido.total_amount)}</span>
            </div>
            <p class="card-order-no"># ${pedido.order_number || '—'}</p>
        </div>`;

    return card;
}

function toggleHistCard(bodyId, chevId) {
    const body = document.getElementById(bodyId);
    const chev = document.getElementById(chevId);
    if (!body) return;
    const abierto = body.classList.toggle('open');
    if (chev) chev.classList.toggle('open', abierto);
}

// ============================================================
// INIT
// ============================================================
(async function init() {
    try {
        await _resolverRestaurant();
        await Menu.cargar();
    } catch (err) {
        console.error('[La 26] Error crítico en init:', err);
        _mostrarEstado('error', `Error al iniciar la carta: ${err.message}`);
    }
})();
