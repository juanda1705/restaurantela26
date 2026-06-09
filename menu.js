// ============================================================
// RESTAURANTE LA 26 — PANEL DE MESERO
// menu.js · Versión 7.2 — Fuente única de verdad
// Bucaramanga, Santander — Colombia
//
// CAMBIOS v7.2:
//  [ADD-DIRECCION] Order.enviar: se captura el campo
//             #form-direccion, se valida como obligatorio
//             cuando modalidad === 'domicilio', y se incluye
//             en notaCocina: "[DOMICILIO] Cliente: X | Dir: Y".
//
//  [ADD-RESET-DIRECCION] Order.nuevoPedido: limpia el campo
//             de dirección al iniciar un nuevo pedido.
//
// CAMBIOS v7.1 (sin cambios):
//  [FIX-MESA] _resolverTableId: el fallback final ya NO devuelve
//             la primera mesa disponible (siempre era Mesa 1).
//             Ahora crea la mesa con el número exacto pedido, y si
//             falla, guarda el número en notes y usa Mesa 1 solo
//             como FK de BD pero la comanda muestra el número real.
//
//  [FIX-MESA-NOTES] generarNotaCocina: el número de mesa se guarda
//             de forma explícita en notes como "[MESA N]" para que
//             cocina y admin siempre muestren el número correcto
//             independientemente del table_id resuelto.
//
// ARQUITECTURA v7.0 (sin cambios):
//  Una sola fuente de verdad: menu_items
//  - Admin escribe menu_items  ✓
//  - Menu lee   menu_items  ✓
//  daily_menu_slots_availability se mantiene como FALLBACK OPCIONAL
//
//  REALTIME v7.0:
//    Suscripción a postgres_changes en menu_items.
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

function generarNumeroOrden() {
    // VARCHAR(20) en BD — máximo 20 caracteres
    // Formato: LA26-XXXXXXXX = 13 chars (seguro)
    const rand = Math.floor(10000000 + Math.random() * 89999999);
    return `LA26-${rand}`;
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
//
// [FIX-MESA v7.1]
// PROBLEMA RAÍZ DETECTADO:
//   El fallback final devolvía la primera mesa con number != 0,
//   que siempre era Mesa 1. Esto causaba que TODOS los pedidos
//   quedaran asociados a Mesa 1 en BD, y cocina/admin mostraban
//   "Mesa 1" sin importar qué número escribió el mesero.
//
// SOLUCIÓN:
//   1. Si la mesa no existe → CREARLA con el número EXACTO.
//      El INSERT usa ON CONFLICT DO NOTHING internamente (vía try/catch)
//      para evitar duplicados en caso de race condition.
//   2. Si la creación falla (constraint, permisos, etc.) →
//      NO usar Mesa 1 como fallback FK silencioso.
//      En su lugar, devolvemos null y el número real de mesa
//      se preserva 100% en el campo `notes` de la orden.
//   3. El campo `notes` ya guarda "[MESA] Mesa: N" — es la
//      fuente de verdad para cocina y admin (ver app.js).
// ============================================================
async function _resolverTableId(modalidad, mesa) {
    if (!State.restaurantId) await _resolverRestaurant();
    if (!State.restaurantId) return null;

    // ── Para pedidos EN MESA ─────────────────────────────────
    if (modalidad === 'mesa') {
        const mesaNum = parseInt(mesa);

        // 1. Buscar por número exacto
        if (!isNaN(mesaNum) && mesaNum > 0) {
            const { data: porNum } = await db
                .from('tables')
                .select('id')
                .eq('restaurant_id', State.restaurantId)
                .eq('number', mesaNum)
                .maybeSingle();
            if (porNum?.id) {
                console.log(`[La 26] Mesa ${mesaNum} encontrada:`, porNum.id);
                return porNum.id;
            }
        }

        // 2. Buscar por label exacto (sin mesas de despacho)
        if (mesa) {
            const { data: porLabel } = await db
                .from('tables')
                .select('id')
                .eq('restaurant_id', State.restaurantId)
                .ilike('label', `%${mesa}%`)
                .not('label', 'ilike', '%llevar%')
                .not('label', 'ilike', '%domicilio%')
                .not('label', 'ilike', '%takeaway%')
                .maybeSingle();
            if (porLabel?.id) {
                console.log(`[La 26] Mesa por label "${mesa}":`, porLabel.id);
                return porLabel.id;
            }
        }

        // 3. [FIX-MESA] Crear la mesa con el número EXACTO pedido
        //    NUNCA usar fallback de "primera mesa disponible"
        const mesaNumFinal = (!isNaN(parseInt(mesa)) && parseInt(mesa) > 0)
            ? parseInt(mesa) : null;

        if (mesaNumFinal) {
            try {
                const { data: nueva, error: errNueva } = await db
                    .from('tables')
                    .insert([{
                        restaurant_id: State.restaurantId,
                        number:        mesaNumFinal,
                        label:         `Mesa ${mesaNumFinal}`,
                        qr_code:       `MESA-${State.restaurantId}-${mesaNumFinal}-${Date.now()}`,
                        capacity:      4,
                        status:        'available',
                    }])
                    .select('id')
                    .single();

                if (nueva?.id) {
                    console.log(`[La 26] Mesa ${mesaNumFinal} creada:`, nueva.id);
                    return nueva.id;
                }

                // Si insert falló por duplicado (race condition), intentar buscar de nuevo
                if (errNueva?.code === '23505') {
                    const { data: reintento } = await db
                        .from('tables')
                        .select('id')
                        .eq('restaurant_id', State.restaurantId)
                        .eq('number', mesaNumFinal)
                        .maybeSingle();
                    if (reintento?.id) {
                        console.log(`[La 26] Mesa ${mesaNumFinal} encontrada en reintento:`, reintento.id);
                        return reintento.id;
                    }
                }
            } catch (errCreate) {
                console.warn(`[La 26] No se pudo crear Mesa ${mesaNumFinal}:`, errCreate.message);
            }
        }

        // [FIX-MESA] ELIMINADO el fallback que antes devolvía Mesa 1.
        // Si no se pudo resolver la mesa exacta, devolvemos null.
        // El número real de mesa SIEMPRE queda guardado en notes de la orden.
        // Cocina y admin leen el número desde notes, no desde el JOIN a tables.
        console.warn(`[La 26] No se pudo resolver table_id para mesa "${mesa}" — se usará null. El número se preserva en notes.`);
        return null;
    }

    // ── Para Llevar / Domicilio ──────────────────────────────
    const { data: mv0 } = await db
        .from('tables')
        .select('id')
        .eq('restaurant_id', State.restaurantId)
        .eq('number', 0)
        .maybeSingle();
    if (mv0?.id) return mv0.id;

    const { data: mvLabel } = await db
        .from('tables')
        .select('id')
        .eq('restaurant_id', State.restaurantId)
        .ilike('label', '%para llevar%')
        .maybeSingle();
    if (mvLabel?.id) return mvLabel.id;

    // Crear mesa virtual para llevar
    const { data: mn } = await db
        .from('tables')
        .insert([{
            restaurant_id: State.restaurantId,
            number:        0,
            label:         'Para Llevar / Domicilio',
            qr_code:       `VIRTUAL-TAKEAWAY-${State.restaurantId}-${Date.now()}`,
            capacity:      99,
            status:        'available',
        }])
        .select('id')
        .single();

    return mn?.id || null;
}

// ============================================================
// MENÚ — Carga desde menu_items (fuente única de verdad)
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

            const { data: dataRaw, error } = await db
                .from('menu_items')
                .select('id, name, price, item_type, is_active, description, portions_today')
                .eq('restaurant_id', State.restaurantId)
                .eq('is_active', true)
                .order('item_type', { ascending: true })
                .order('name',      { ascending: true });

            const TIPOS_ACEPTADOS = [...ITEM_TYPES_VALIDOS, 'protein'];
            const data = dataRaw
                ? dataRaw.filter(i => TIPOS_ACEPTADOS.includes(i.item_type))
                : dataRaw;

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

            State.slots = data.map(item => {
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
            _suscribirRealtime();

        } catch (err) {
            console.error('[La 26] Error cargando menú:', err);
            _mostrarEstado('error', `No se pudo cargar la carta: ${err.message || 'error de red'}`);
        }
    },

};

// ── Control de pantalla ──────────────────────────────────────
function _mostrarEstado(estado, msg = '') {
    const loader   = document.getElementById('app-loader');
    const error    = document.getElementById('app-error');
    const sections = document.getElementById('menu-sections');

    if (loader)   loader.style.display   = estado === 'loader' ? 'flex'  : 'none';
    if (error)    error.style.display    = estado === 'error'  ? 'flex'  : 'none';
    if (sections) sections.style.display = estado === 'menu'   ? 'block' : 'none';

    if (estado === 'error') {
        if (loader) loader.style.display = 'none';
        console.error('[La 26] Error mostrado al usuario:', msg);
        const el = document.getElementById('error-msg');
        if (el) el.textContent = msg || 'Error desconocido. Recarga la página.';
    }
}

// ── Modo demo ────────────────────────────────────────────────
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

        const btnEl        = document.getElementById('btn-enviar');
        const mesaEl       = document.getElementById('form-mesa');
        const nombreEl     = document.getElementById('form-nombre');
        const notasEl      = document.getElementById('form-notas');
        const direccionEl  = document.getElementById('form-direccion');  // [ADD-DIRECCION v7.2]
        const modalidadEl  = document.querySelector('input[name="form-modalidad"]:checked');

        const mesa      = (mesaEl?.value      || '').trim();
        const nombre    = (nombreEl?.value    || '').trim();
        const notas     = (notasEl?.value     || '').trim();
        const direccion = (direccionEl?.value || '').trim();             // [ADD-DIRECCION v7.2]
        const modalidad = modalidadEl?.value || 'mesa';

        // Validar mesa
        if (modalidad === 'mesa' && !mesa) {
            mesaEl?.classList.add('error');
            mesaEl?.focus();
            Toast.error('Indica el número de mesa.');
            return;
        }
        mesaEl?.classList.remove('error');

        // [ADD-DIRECCION v7.2] Validar dirección en domicilio
        if (modalidad === 'domicilio' && !direccion) {
            direccionEl?.classList.add('error');
            direccionEl?.focus();
            Toast.error('Indica la dirección de entrega.');
            return;
        }
        direccionEl?.classList.remove('error');

        State.isSubmitting = true;
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Enviando…'; }

        try {
            if (!State.restaurantId) await _resolverRestaurant();
            if (!State.restaurantId) throw new Error('No se pudo identificar el restaurante.');

            // [FIX-MESA v7.1] Intentar resolver table_id pero NO bloquear si falla.
            // El número real de mesa se guarda en notes — eso es lo que cuenta.
            const tableId = await _resolverTableId(modalidad, mesa);

            // Para pedidos en mesa: si no se pudo resolver table_id,
            // buscar cualquier mesa existente solo como FK válida para la BD.
            // El número correcto ya está en notes.
            let tableIdFinal = tableId;
            if (!tableIdFinal) {
                const { data: anyTable } = await db
                    .from('tables')
                    .select('id')
                    .eq('restaurant_id', State.restaurantId)
                    .limit(1)
                    .maybeSingle();
                tableIdFinal = anyTable?.id || null;
                if (tableIdFinal) {
                    console.log(`[La 26] Usando table_id de reserva para FK. Número real en notes: "${mesa}"`);
                }
            }

            if (!tableIdFinal) throw new Error('No hay mesas configuradas. Crea al menos una mesa en el panel admin.');

            // ── Construir nota de cocina ──────────────────────
            // [FIX-MESA v7.1] El número de mesa se guarda EXPLÍCITAMENTE en notes
            // con el valor que escribió el mesero, NO el número de la FK de BD.
            // [ADD-DIRECCION v7.2] La dirección se incluye en la nota de domicilio.
            let notaCocina = '';
            if (modalidad === 'mesa') {
                notaCocina = `[MESA] Mesa: ${mesa}`;
            } else if (modalidad === 'llevar') {
                notaCocina = `[PARA LLEVAR] Cliente: ${nombre || 'Sin nombre'}`;
            } else if (modalidad === 'domicilio') {
                notaCocina = `[DOMICILIO] Cliente: ${nombre || 'Sin nombre'} | Dir: ${direccion}`;
            }
            if (notas) notaCocina += ` | Nota: ${notas}`;

            const numeroOrden = generarNumeroOrden();
            const total       = calcularTotal();

            // Insertar orden
            const { data: orden, error: errOrd } = await db
                .from('orders')
                .insert([{
                    restaurant_id: State.restaurantId,
                    table_id:      tableIdFinal,
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
            const { data: todosItems } = await db
                .from('menu_items')
                .select('id, name, item_type')
                .eq('restaurant_id', State.restaurantId)
                .eq('is_active', true);

            const listaItems  = todosItems || [];
            const fallbackId  = listaItems[0]?.id || null;

            const payload = State.cart.map(item => {
                const slot = State.slots.find(s => s.id === item.slotId);
                if (!slot) return null;

                let menuItemId = slot.menuItemId;

                if (!menuItemId && listaItems.length > 0) {
                    const nombreBuscar = (slot.nombre || '').toLowerCase().trim();
                    const exacto = listaItems.find(m =>
                        m.name.toLowerCase().trim() === nombreBuscar
                    );
                    const parcial = !exacto && listaItems.find(m =>
                        m.name.toLowerCase().includes(nombreBuscar.split(' ')[0])
                    );
                    menuItemId = exacto?.id || parcial?.id || fallbackId;
                }

                console.log(`[La 26] Item "${slot.nombre}" → menu_item_id: ${menuItemId}`);

                return {
                    order_id:     orden.id,
                    menu_item_id: menuItemId,
                    quantity:     item.cantidad,
                    unit_price:   slot.precio,
                    item_status:  'pending',
                    product_name: slot.nombre,
                    notes:        `[nombre]${slot.nombre}`,
                };
            }).filter(Boolean);

            console.log('[La 26] Insertando order_items:', JSON.stringify(payload.map(p => ({
                nombre: p.product_name, qty: p.quantity, menu_item_id: p.menu_item_id
            }))));

            if (payload.length > 0) {
                const { error: errItems } = await db
                    .from('order_items')
                    .insert(payload);

                if (errItems) {
                    console.warn('[La 26] order_items primer intento error:', errItems.message);

                    if (errItems.code === '42703' || errItems.message?.includes('product_name')) {
                        console.log('[La 26] Reintentando sin product_name (columna no existe en BD)');
                        const payloadSinProductName = payload.map(p => {
                            const { product_name, ...rest } = p;
                            return rest;
                        });
                        const { error: err2 } = await db
                            .from('order_items')
                            .insert(payloadSinProductName);
                        if (err2) {
                            console.error('[La 26] order_items segundo intento error:', err2.message, err2);
                            Toast.error('El pedido se registró pero los ítems fallaron. Avisa al administrador.', 6000);
                        } else {
                            console.log('[La 26] order_items insertados OK (sin product_name):', payloadSinProductName.length);
                        }
                    } else {
                        console.error('[La 26] order_items ERROR no recuperable:', errItems.message, errItems);
                        Toast.error('El pedido se registró pero los ítems fallaron. Avisa al administrador.', 6000);
                    }
                } else {
                    console.log('[La 26] order_items insertados OK:', payload.length);
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

        // Limpiar campos del formulario
        const notasEl     = document.getElementById('form-notas');
        const direccionEl = document.getElementById('form-direccion');  // [ADD-RESET-DIRECCION v7.2]
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
// REALTIME — suscripción a menu_items
// ============================================================
function _suscribirRealtime() {
    if (!State.restaurantId) return;

    if (State.realtimeChannel) {
        db.removeChannel(State.realtimeChannel);
        State.realtimeChannel = null;
    }

    State.realtimeChannel = db
        .channel(`la26-menu-v72-${State.restaurantId}`)
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

function _actualizarSlotDesdeRealtime(item) {
    if (!item || !item.id) return;

    const idx = State.slots.findIndex(s => s.id === item.id);

    if (idx === -1) {
        Menu.cargar();
        return;
    }

    const tienePortions = item.portions_today !== null && item.portions_today !== undefined;
    const porciones     = tienePortions ? Number(item.portions_today) : 999;
    const disponible    = item.is_active === true && porciones > 0;

    State.slots[idx] = {
        ...State.slots[idx],
        nombre:     item.name,
        precio:     Number(item.price) || 0,
        porciones,
        disponible,
    };

    _refrescarTarjeta(item.id);

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
// INIT
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
